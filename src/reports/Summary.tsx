import { useState } from "react";
import type { NoteKind } from "../../worker/db/schema";
import type { Citation, CitedPoint, Coverage, Gap, GoalStatus, GradeSummary, SynthesisView, TaggedNoteResponse } from "../../worker/api-types";
import { api, jsonInit, messageOf } from "../api";
import { button, dateFormat, errorText, mmss, plural, subtleButton } from "../ui";
import { useRecorder } from "../useRecorder";

// One student's structured summary: a short narrative of the period, then the highlights and
// themes, each point with its evidence folded away until asked for, and last the gaps, so the
// teacher reads the whole picture before adding context. The teacher writes the report; this
// is the brief.

const MAX_ANSWER_MS = 2 * 60 * 1000;

const pct = (n: number) => `${Math.round(n)}%`;
// A calendar day (YYYY-MM-DD) read as local midnight, so it shows as that day.
const day = (iso: string) => dateFormat.format(new Date(`${iso.slice(0, 10)}T00:00:00`));
const shortDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const monthFormat = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" });

const KIND_SHORT: Record<NoteKind, string> = { text: "note", voice: "voice note", student_form: "form", progress_report: "report" };

const LABEL = {
  well_supported: { text: "Well supported", style: "bg-green-100 text-green-800" },
  thin: { text: "Thin", style: "bg-amber-100 text-amber-900" },
  very_thin: { text: "Very thin", style: "bg-red-100 text-red-800" },
} as const;

const GOAL_LABEL: Record<GoalStatus, { text: string; style: string }> = {
  met: { text: "Met", style: "bg-green-100 text-green-800" },
  partly: { text: "Partly", style: "bg-amber-100 text-amber-900" },
  not_yet: { text: "Not yet", style: "bg-red-100 text-red-800" },
  no_evidence: { text: "No evidence", style: "bg-gray-100 text-gray-600" },
};

function coverageLine(c: Coverage): string {
  const sources = Object.entries(c.bySource).map(([k, n]) => `${n} ${KIND_SHORT[k as NoteKind]}${n === 1 ? "" : "s"}`);
  const parts = [`${plural(c.notes, "note")}${sources.length > 1 ? ` (${sources.join(", ")})` : ""}`];
  if (c.lastNotedAt) parts.push(`last ${day(c.lastNotedAt)}`);
  if (c.emptyMonths.length) parts.push(`nothing in ${c.emptyMonths.map((m) => monthFormat.format(new Date(`${m}-01T00:00:00`))).join(", ")}`);
  if (c.longestSilenceDays > 30) parts.push(`a ${c.longestSilenceDays}-day stretch with no note`);
  parts.push(c.grades + c.missing > 0 ? `${plural(c.grades, "grade")}${c.missing ? `, ${c.missing} missing` : ""}` : "no grades");
  return parts.join(" · ");
}

function chipLabel(c: Citation): string {
  if (c.type === "note") return `${shortDay.format(new Date(c.notedAt))} ${KIND_SHORT[c.kind]}`;
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

// The evidence behind a point, folded to a "3 sources" toggle so the points read as a list.
// Unfolded, a note chip opens its quotes and the grade summary chip the headline numbers. A
// point resting on one source says so even folded.
function Evidence({ evidence, grades }: { evidence: Citation[]; grades: GradeSummary | null }) {
  const [unfolded, setUnfolded] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const shown = open === null ? null : evidence[open];
  return (
    <div className="mt-0.5">
      <button
        type="button"
        aria-expanded={unfolded}
        onClick={() => setUnfolded(!unfolded)}
        className={`text-xs hover:underline ${evidence.length === 1 ? "text-amber-700" : "text-gray-500"}`}
      >
        {unfolded ? "▾" : "▸"} {plural(evidence.length, "source")}
      </button>
      {unfolded && (
        <>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {evidence.map((c, i) => {
              const expandable = c.type === "note" || (c.type === "grades" && grades);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!expandable}
                  onClick={() => setOpen(open === i ? null : i)}
                  className={`rounded-full border px-2 py-0.5 text-xs ${open === i ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-gray-700"} disabled:cursor-default`}
                >
                  {chipLabel(c)}
                </button>
              );
            })}
          </div>
          {shown && (
            <div className="mt-1 rounded bg-gray-50 p-2 text-xs text-gray-700">
              {shown.type === "note" && (
                <>
                  <p className="text-gray-500">
                    {day(shown.notedAt)}
                    {shown.sourceName ? ` · ${shown.sourceName}` : ""}
                  </p>
                  {shown.quotes.map((q, i) => (
                    <blockquote key={i} className="mt-1 border-l-2 border-gray-300 pl-2 whitespace-pre-wrap">
                      {q}
                    </blockquote>
                  ))}
                </>
              )}
              {shown.type === "grades" && grades && <GradeFacts g={grades} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Points({ title, points, grades }: { title: string; points: CitedPoint[]; grades: GradeSummary | null }) {
  if (points.length === 0) return null;
  return (
    <section className="mt-5">
      <h4 className="text-sm font-medium text-gray-600">{title}</h4>
      <ul className="mt-1 space-y-3">
        {points.map((p, i) => (
          <li key={i} className="text-sm">
            {p.point}
            <Evidence evidence={p.evidence} grades={grades} />
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
        const note = await api<TaggedNoteResponse>(`/api/notes/voice?classId=${classId}`, { method: "POST", headers: { "content-type": audio.type }, body: audio });
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
    <li className="py-2 text-sm">
      <p>
        <span className="font-medium">{gap.area}</span>
        {gap.why && <span className="text-gray-500"> · {gap.why}</span>}
      </p>
      <p className="mt-0.5 text-gray-800">{gap.ask}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {recorder.supported && (
          <button type="button" className={subtleButton} disabled={saving} onClick={recorder.recording ? recorder.stop : record}>
            {saving ? "Saving…" : recorder.recording ? `Stop (${mmss(recorder.elapsedMs)})` : "Record answer"}
          </button>
        )}
        {saved && <span className="text-xs text-green-700">Saved as a voice note</span>}
        {error && <span className={errorText}>{error}</span>}
      </div>
    </li>
  );
}

export default function Summary({
  synthesis,
  name,
  classId,
  stale,
  newNotes,
  regenerating,
  onRegenerate,
  onRecorded,
}: {
  synthesis: SynthesisView;
  name: string;
  classId: string;
  stale: boolean;
  newNotes: number;
  regenerating: boolean;
  onRegenerate: () => void;
  onRecorded: () => void;
}) {
  const s = synthesis.json;
  const label = LABEL[s.coverage.label];
  return (
    <article className="mt-2">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">{name}</h2>
        <span className="text-sm text-gray-500">
          {day(synthesis.periodStart)} – {day(synthesis.periodEnd)} · made {dateFormat.format(new Date(synthesis.createdAt))}
        </span>
      </div>
      {stale && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
          {newNotes > 0 ? `${plural(newNotes, "new note")} since this was made.` : "The evidence has changed since this was made."}
          <button type="button" className={`ml-auto ${button}`} disabled={regenerating} onClick={onRegenerate}>
            {regenerating ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <span className={`rounded px-2 py-0.5 ${label.style}`}>{label.text}</span>
        {coverageLine(s.coverage)}
      </p>

      {s.overview && <p className="mt-4 whitespace-pre-line text-sm leading-relaxed">{s.overview}</p>}

      {s.highlights.length > 0 && (
        <section className="mt-5">
          <h4 className="text-sm font-medium text-gray-600">Highlights</h4>
          <ul className="mt-1 space-y-3">
            {s.highlights.map((h, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium">{h.title}.</span> {h.story}
                <Evidence evidence={h.evidence} grades={s.grades} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <Points title="Strengths" points={s.strengths} grades={s.grades} />
      <Points title="Areas to grow" points={s.growth} grades={s.grades} />
      <Points title="Over the period" points={s.change} grades={s.grades} />

      {s.goals.length > 0 && (
        <section className="mt-5">
          <h4 className="text-sm font-medium text-gray-600">Course goals</h4>
          <ul className="mt-1 space-y-3">
            {s.goals.map((g, i) => (
              <li key={i} className="text-sm">
                <span className={`mr-2 rounded px-1.5 py-0.5 text-xs ${GOAL_LABEL[g.status].style}`}>{GOAL_LABEL[g.status].text}</span>
                {g.goal}
                {g.point && <p className="mt-0.5 text-gray-700">{g.point}</p>}
                {g.evidence.length > 0 && <Evidence evidence={g.evidence} grades={s.grades} />}
              </li>
            ))}
          </ul>
        </section>
      )}
      {s.gaps.length > 0 && (
        <section className="mt-8 rounded border border-gray-200 p-3">
          <h3 className="text-sm font-medium">Where more context would help</h3>
          <p className="mt-0.5 text-xs text-gray-500">Answer out loud and it is saved as a voice note about {name.split(" ")[0]}; then regenerate.</p>
          <ul className="mt-1 divide-y divide-gray-100">
            {s.gaps.map((g, i) => (
              <GapItem key={i} gap={g} studentId={synthesis.studentId} classId={classId} onRecorded={onRecorded} />
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
