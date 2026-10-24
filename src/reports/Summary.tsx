import { useState } from "react";
import { Check, Mic } from "lucide-react";
import type { NoteKind } from "../../worker/db/schema";
import type { Citation, Coverage, Gap, GoalStatus, GradeSummary, SynthesisView, TaggedNoteResponse } from "../../worker/api-types";
import { api, fileInit, jsonInit, messageOf } from "../api";
import { calendarDay, caption, errorText, dateFormat, mmss, pct, plural, shortDateFormat } from "../ui";
import { useElapsed, useRecorder } from "../useRecorder";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// One student's structured summary: a short narrative of the period, then the highlights and
// themes, each point with its sources under it, and last the gaps, so the teacher reads the
// whole picture before adding context. The teacher writes the report; this is the brief.

const MAX_ANSWER_MS = 2 * 60 * 1000;

const monthFormat = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" });

const KIND_SHORT: Record<NoteKind, string> = { text: "note", voice: "voice note", student_form: "form", progress_report: "report" };

const LABEL = {
  well_supported: { text: "Well supported", style: "bg-mint text-mint-foreground" },
  thin: { text: "Thin", style: "bg-sunny text-sunny-foreground" },
  very_thin: { text: "Very thin", style: "bg-coral text-coral-foreground" },
} as const;

const GOAL_LABEL: Record<GoalStatus, { text: string; style: string }> = {
  met: { text: "Met", style: "bg-mint text-mint-foreground" },
  partly: { text: "Partly", style: "bg-sunny text-sunny-foreground" },
  not_yet: { text: "Not yet", style: "bg-coral text-coral-foreground" },
  no_evidence: { text: "No evidence", style: "bg-secondary text-muted-foreground" },
};

// Heading ink and card tint per section; see the tints in index.css.
const SECTION = {
  highlights: { title: "Highlights", ink: "text-accent-foreground", tint: "bg-tint-highlight" },
  strengths: { title: "Strengths", ink: "text-mint-foreground", tint: "bg-tint-strength" },
  growth: { title: "Areas to grow", ink: "text-sunny-foreground", tint: "bg-tint-grow" },
  change: { title: "Over the period", ink: "text-sky-foreground", tint: "bg-tint-change" },
} as const;

function coverageLine(c: Coverage): string {
  const sources = Object.entries(c.bySource).map(([k, n]) => plural(n, KIND_SHORT[k as NoteKind]));
  const parts = [`${plural(c.notes, "note")}${sources.length > 1 ? ` (${sources.join(", ")})` : ""}`];
  if (c.lastNotedAt) parts.push(`last ${calendarDay(c.lastNotedAt)}`);
  if (c.emptyMonths.length) parts.push(`nothing in ${c.emptyMonths.map((m) => monthFormat.format(new Date(`${m}-01T00:00:00`))).join(", ")}`);
  if (c.longestSilenceDays > 30) parts.push(`a ${c.longestSilenceDays}-day stretch with no note`);
  parts.push(c.grades + c.missing > 0 ? `${plural(c.grades, "grade")}${c.missing ? `, ${c.missing} missing` : ""}` : "no grades");
  return parts.join(" · ");
}

function chipLabel(c: Citation): string {
  if (c.type === "note") return `${shortDateFormat.format(new Date(c.notedAt))} ${KIND_SHORT[c.kind]}`;
  if (c.type === "grades") return "Grade summary";
  return `${c.assignment} · ${c.pct === null ? "missing" : pct(c.pct)}${c.classMean !== null ? ` (class ${pct(c.classMean)})` : ""}`;
}

function GradeFacts({ g }: { g: GradeSummary }) {
  return (
    <>
      <p>
        Overall {pct(g.overall)}
        {g.weighted ? ", weighted as the syllabus says" : ""} · {plural(g.count, "score")}
        {g.missing > 0 && `, ${g.missing} missing`}
      </p>
      {g.trend && (
        <p>
          {g.trend.label}: {pct(g.trend.from)} → {pct(g.trend.to)}
        </p>
      )}
      {g.strongest && g.weakest && (
        <p>
          Strongest {g.strongest}, weakest {g.weakest}
        </p>
      )}
    </>
  );
}

// The sources behind a point, as chips. A note chip opens its quotes below and the grade
// summary chip the headline numbers; a single grade chip already says everything. A point
// resting on one source says so.
function Evidence({ evidence, grades }: { evidence: Citation[]; grades: GradeSummary | null }) {
  const [open, setOpen] = useState<number | null>(null);
  const shown = open === null ? null : evidence[open];
  return (
    <>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {evidence.map((c, i) => {
          const expandable = c.type === "note" || (c.type === "grades" && grades);
          return (
            <button
              key={i}
              type="button"
              disabled={!expandable}
              aria-expanded={expandable ? open === i : undefined}
              onClick={() => setOpen(open === i ? null : i)}
              className={cn(
                "min-h-[30px] rounded-full border px-[11px] text-xs font-bold disabled:cursor-default",
                open === i ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background text-secondary-foreground enabled:hover:bg-muted",
              )}
            >
              {chipLabel(c)}
            </button>
          );
        })}
        {evidence.length === 1 && <span className="rounded-full bg-sunny px-[9px] py-[3px] text-[11.5px] font-bold text-sunny-foreground">One source</span>}
      </div>
      {shown && (
        <div className="mt-2.5 rounded-xl border-l-3 border-primary bg-background px-3.5 py-2.5 text-[13.5px] leading-normal text-secondary-foreground">
          {shown.type === "note" && (
            <>
              <p className="text-xs font-semibold text-muted-foreground">
                {calendarDay(shown.notedAt)}
                {shown.sourceName ? ` · ${shown.sourceName}` : ""}
              </p>
              {shown.quotes.map((q, i) => (
                <blockquote key={i} className="mt-1 whitespace-pre-wrap">
                  {q}
                </blockquote>
              ))}
            </>
          )}
          {shown.type === "grades" && grades && <GradeFacts g={grades} />}
        </div>
      )}
    </>
  );
}

type Item = { title?: string; text: string; evidence: Citation[] };

function Section({ kind, items, grades }: { kind: keyof typeof SECTION; items: Item[]; grades: GradeSummary | null }) {
  if (items.length === 0) return null;
  const { title, ink, tint } = SECTION[kind];
  return (
    <section className="mt-[26px]">
      <h3 className={cn(caption, "mb-2.5", ink)}>{title}</h3>
      <ul className="flex flex-col gap-2.5">
        {items.map((it, i) => (
          <li key={i} className={cn("rounded-[18px] px-4 py-3.5", tint)}>
            {it.title && <p className="mb-1 text-[15px] font-extrabold">{it.title}</p>}
            <p className="text-[14.5px] leading-relaxed">{it.text}</p>
            <Evidence evidence={it.evidence} grades={grades} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// One gap, with a button to answer its question out loud. The voice note is saved and tagged
// like any other; if the teacher did not say the student's name, the student is added to it
// with the whole transcript as the quote, since the note was recorded about them.
function GapItem({ gap, studentId, classId, onRecorded }: { gap: Gap; studentId: string; classId: string; onRecorded: () => void }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRecorder({
    maxMs: MAX_ANSWER_MS,
    onStop: async ({ audio }) => {
      setSaving(true);
      try {
        const note = await api<TaggedNoteResponse>(`/api/notes/voice?classId=${classId}`, fileInit(audio));
        if (!note.students.some((s) => s.studentId === studentId)) {
          await api(`/api/notes/${note.id}/students`, jsonInit("POST", { studentId, quotes: [note.body] }));
        }
        setSaved(true);
        onRecorded();
      } catch (e) {
        setError(messageOf(e));
      } finally {
        setSaving(false);
      }
    },
  });

  const elapsedMs = useElapsed(recorder.startedAt);

  async function record() {
    setError(null);
    setSaved(false);
    try {
      await recorder.start();
    } catch (e) {
      setError(`Could not start recording: ${messageOf(e)}`);
    }
  }

  return (
    <li className="mt-3.5 border-t border-border pt-3.5">
      <p className="text-[13px]">
        <span className="font-extrabold">{gap.area}</span>
        {gap.why && <span className="text-muted-foreground"> · {gap.why}</span>}
      </p>
      <p className="mt-1 text-[15px] leading-normal font-semibold">{gap.ask}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
        {saved ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-mint px-3 py-1.5 text-[13px] font-bold text-mint-foreground">
            <Check className="size-4" aria-hidden />
            Saved as a voice note
          </span>
        ) : (
          recorder.supported && (
            <Button
              type="button"
              variant={recorder.recording ? "default" : "soft"}
              className={cn(recorder.recording && "bg-recording hover:bg-recording/90")}
              disabled={saving}
              onClick={recorder.recording ? recorder.stop : record}
            >
              {recorder.recording ? <span className="size-2.5 animate-pulse rounded-full bg-white" aria-hidden /> : <Mic aria-hidden />}
              {saving ? "Saving…" : recorder.recording ? `Stop (${mmss(elapsedMs)})` : "Record answer"}
            </Button>
          )
        )}
        {error && <span className={errorText}>{error}</span>}
      </div>
    </li>
  );
}

export default function Summary({
  synthesis,
  firstName,
  classId,
  stale,
  newNotes,
  regenerating,
  onRegenerate,
  onRecorded,
}: {
  synthesis: SynthesisView;
  firstName: string;
  classId: string;
  stale: boolean;
  newNotes: number;
  regenerating: boolean;
  onRegenerate: () => void;
  onRecorded: () => void;
}) {
  const s = synthesis.json;
  const label = LABEL[s.coverage.label];
  const made = dateFormat.format(new Date(synthesis.createdAt));
  return (
    <>
      {stale && (
        <div className="mt-[18px] flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-2xl border border-sunny-line bg-sunny-soft py-3 pr-3 pl-4">
          <p className="min-w-[160px] flex-1 text-sm font-bold text-sunny-ink">
            {newNotes > 0 ? `${plural(newNotes, "new note")} since ${made}.` : `The evidence has changed since ${made}.`}
          </p>
          <Button type="button" size="sm" className="bg-foreground text-background hover:bg-foreground/90" disabled={regenerating} onClick={onRegenerate}>
            {regenerating && <span className="size-3 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
            {regenerating ? "Regenerating…" : "Regenerate"}
          </Button>
        </div>
      )}

      <p className="mt-[18px] flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-extrabold", label.style)}>{label.text}</span>
        {coverageLine(s.coverage)}
      </p>

      {s.overview && <p className="mt-[18px] text-[16.5px] leading-[1.7] whitespace-pre-line">{s.overview}</p>}

      <Section kind="highlights" items={s.highlights.map((h) => ({ title: h.title, text: h.story, evidence: h.evidence }))} grades={s.grades} />
      <Section kind="strengths" items={s.strengths.map((p) => ({ text: p.point, evidence: p.evidence }))} grades={s.grades} />
      <Section kind="growth" items={s.growth.map((p) => ({ text: p.point, evidence: p.evidence }))} grades={s.grades} />
      <Section kind="change" items={s.change.map((p) => ({ text: p.point, evidence: p.evidence }))} grades={s.grades} />

      {s.goals.length > 0 && (
        <section className="mt-[26px]">
          <h3 className={cn(caption, "mb-2.5")}>Course goals</h3>
          <ul>
            {s.goals.map((g, i) => (
              <li key={i} className="flex gap-3 border-t border-muted py-3">
                <span className={cn("inline-flex h-[26px] min-w-[86px] flex-none items-center justify-center rounded-full px-2.5 text-xs font-extrabold", GOAL_LABEL[g.status].style)}>
                  {GOAL_LABEL[g.status].text}
                </span>
                <div className="min-w-0">
                  <p className="mt-0.5 text-[14.5px] font-bold">{g.goal}</p>
                  {g.point && <p className="mt-1 text-[13.5px] leading-normal text-secondary-foreground">{g.point}</p>}
                  {g.evidence.length > 0 && <Evidence evidence={g.evidence} grades={s.grades} />}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.gaps.length > 0 && (
        <section className="mt-[26px] rounded-[20px] border-2 border-ring/50 bg-field p-[18px]">
          <h3 className="text-base font-extrabold">Where more context would help</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">Answer out loud. It's saved as a voice note about {firstName}; then regenerate.</p>
          <ul>
            {s.gaps.map((g, i) => (
              <GapItem key={i} gap={g} studentId={synthesis.studentId} classId={classId} onRecorded={onRecorded} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
