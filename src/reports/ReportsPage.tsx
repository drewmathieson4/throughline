import { useEffect, useState } from "react";
import type { ClassRow } from "../../worker/db/schema";
import type { SynthesisResult, SynthesisRosterRow, SynthesisView } from "../../worker/api-types";
import { api, jsonInit, messageOf } from "../api";
import { button, dateFormat, errorText, fieldLabel, input, plural, subtleButton } from "../ui";
import Summary from "./Summary";

// Reports: pick a period, see which students have a summary for it and whether it is still
// current, and make the ones that are missing or out of date. Each summary is an Opus call,
// so Generate only appears where the evidence has changed; the count on "Generate for class"
// is the only warning, per the no-confirm rule.

type Range = { from: string; to: string };
const sameRange = (a: Range, b: Range) => a.from === b.from && a.to === b.to;

// The class's term, or September to June of the school year we are in.
function wholeYear(cls: ClassRow): Range {
  if (cls.termStart && cls.termEnd) return { from: cls.termStart, to: cls.termEnd };
  const now = new Date();
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: cls.termStart ?? `${start}-09-01`, to: cls.termEnd ?? `${start + 1}-06-30` };
}

// Two at a time: quick enough for a class of thirty, gentle on the API's rate limits.
const CONCURRENCY = 2;

const STATUS: Record<SynthesisRosterRow["status"], string> = { none: "Not yet", current: "Up to date", stale: "Out of date", empty: "No evidence in this period" };
const needsRun = (r: SynthesisRosterRow) => r.status === "none" || r.status === "stale";

function statusText(r: SynthesisRosterRow): string {
  const made = r.createdAt ? dateFormat.format(new Date(r.createdAt)) : "";
  if (r.status === "current") return `Up to date · ${made}`;
  if (r.status === "stale") return r.newNotes > 0 ? `${plural(r.newNotes, "new note")} since ${made}` : `Evidence changed since ${made}`;
  return STATUS[r.status];
}

// App keeps this page mounted while another tab is showing, so a class run keeps going and
// its progress is still here on return. `active` is false while hidden: no roster fetches
// then, and a fresh one on return, since notes may have changed meanwhile.
export default function ReportsPage({ cls, active }: { cls: ClassRow; active: boolean }) {
  const [range, setRange] = useState<Range>(() => wholeYear(cls));
  // The roster with the range it was loaded for. Generating uses that range, not the date
  // boxes, so the students queued and the period they are generated for always match.
  const [roster, setRoster] = useState<{ range: Range; rows: SynthesisRosterRow[] } | null>(null);
  const rows = roster?.rows ?? null;
  const [error, setError] = useState<string | null>(null);
  // Bumped after anything that changes a status (a run, a recorded answer).
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  // Students with a request in flight, and the class run's progress.
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  // The summary on screen.
  const [open, setOpen] = useState<{ studentId: string; synthesis: SynthesisView } | null>(null);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(range.from) && /^\d{4}-\d{2}-\d{2}$/.test(range.to) && range.from <= range.to;

  useEffect(() => {
    if (!valid || !active) return;
    // Typing a date fires a fetch per keystroke; only the newest may land.
    let latest = true;
    api<SynthesisRosterRow[]>(`/api/syntheses?${new URLSearchParams({ classId: cls.id, ...range })}`)
      .then((r) => {
        if (!latest) return;
        setRoster({ range, rows: r });
        setError(null);
      })
      .catch((e) => latest && setError(messageOf(e)));
    return () => {
      latest = false;
    };
  }, [cls.id, range, valid, version, active]);

  const mark = (id: string, on: boolean) =>
    setRunning((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // One summary. Throws on failure so the caller decides how to show it.
  async function run(studentId: string, period: Range): Promise<SynthesisResult> {
    mark(studentId, true);
    try {
      return await api<SynthesisResult>("/api/syntheses", jsonInit("POST", { studentId, ...period }));
    } finally {
      mark(studentId, false);
    }
  }

  // A single student: make it and open it.
  async function generateOne(studentId: string, period: Range) {
    setError(null);
    try {
      const made = await run(studentId, period);
      setOpen({ studentId, synthesis: made });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      refresh();
    }
  }

  async function generateClass() {
    if (!roster) return;
    const period = roster.range;
    const queue = roster.rows.filter(needsRun).map((r) => r.studentId);
    setError(null);
    setProgress({ done: 0, total: queue.length, failed: 0 });
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        let failed = 0;
        try {
          await run(id, period);
        } catch {
          failed = 1;
        }
        setProgress((p) => p && { ...p, done: p.done + 1, failed: p.failed + failed });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    refresh();
  }

  async function show(r: SynthesisRosterRow) {
    if (!r.synthesisId) return;
    try {
      setOpen({ studentId: r.studentId, synthesis: await api<SynthesisView>(`/api/syntheses/${r.synthesisId}`) });
    } catch (e) {
      setError(messageOf(e));
    }
  }

  if (open) {
    const row = rows?.find((r) => r.studentId === open.studentId);
    return (
      <section className="mt-4">
        <button type="button" onClick={() => setOpen(null)} className="text-sm text-gray-500 hover:underline">
          ← All students
        </button>
        {error && <p className={`mt-2 ${errorText}`}>{error}</p>}
        <Summary
          synthesis={open.synthesis}
          name={row ? `${row.firstName} ${row.lastName}` : ""}
          classId={cls.id}
          stale={row?.status === "stale" && row.synthesisId === open.synthesis.id}
          newNotes={row?.newNotes ?? 0}
          regenerating={running.has(open.studentId)}
          onRegenerate={() => generateOne(open.studentId, { from: open.synthesis.periodStart, to: open.synthesis.periodEnd })}
          onRecorded={refresh}
        />
      </section>
    );
  }

  const pending = (rows ?? []).filter(needsRun);
  // Between a date change and its roster arriving, the table shows the old range.
  const loading = !roster || !sameRange(roster.range, range);
  const classBusy = progress !== null && progress.done < progress.total;
  const year = wholeYear(cls);
  return (
    <section className="mt-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className={fieldLabel}>
          From
          <input type="date" className={input} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </label>
        <label className={fieldLabel}>
          To
          <input type="date" className={input} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </label>
        <button type="button" className={subtleButton} disabled={range.from === year.from && range.to === year.to} onClick={() => setRange(year)}>
          Whole year
        </button>
        <button type="button" className={`ml-auto ${button}`} disabled={!valid || loading || classBusy || pending.length === 0} onClick={generateClass}>
          {classBusy ? `Generating ${progress.done} of ${progress.total}…` : `Generate for class (${pending.length})`}
        </button>
      </div>
      {!valid && <p className={`mt-2 ${errorText}`}>Pick a start date on or before the end date.</p>}
      {progress && !classBusy && progress.failed > 0 && <p className={`mt-2 ${errorText}`}>{plural(progress.failed, "summary")} could not be made; try those again.</p>}
      {error && <p className={`mt-2 ${errorText}`}>{error}</p>}

      <table className="mt-4 w-full text-sm">
        <thead className="text-left text-xs text-gray-500">
          <tr>
            <th className="py-1 font-medium">Name</th>
            <th className="py-1 font-medium">Summary</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rows?.map((r) => (
            <tr key={r.studentId} className="hover:bg-gray-50">
              <td className="py-2">
                {r.synthesisId ? (
                  <button type="button" onClick={() => show(r)} className="text-left hover:underline">
                    {r.lastName}, {r.firstName}
                  </button>
                ) : (
                  `${r.lastName}, ${r.firstName}`
                )}
              </td>
              <td className={`py-2 ${r.status === "stale" ? "text-amber-700" : "text-gray-600"}`}>{statusText(r)}</td>
              <td className="py-2 text-right">
                {needsRun(r) && (
                  <button type="button" className={subtleButton} disabled={running.has(r.studentId) || classBusy || loading} onClick={() => roster && generateOne(r.studentId, roster.range)}>
                    {running.has(r.studentId) ? "Generating…" : "Generate"}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rows?.length === 0 && (
            <tr>
              <td colSpan={3} className="py-3 text-gray-500">
                No students in this class yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
