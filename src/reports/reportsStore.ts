import { createContext, useContext } from "react";
// Type-only imports: nothing from the Worker ends up in the browser bundle.
import type { ClassRow } from "../../worker/db/schema";
import type { ReportView, SynthesisResult, SynthesisRosterRow } from "../../worker/api-types";

export type Range = { from: string; to: string };
export const sameRange = (a: Range, b: Range) => a.from === b.from && a.to === b.to;
export const validRange = (r: Range) => /^\d{4}-\d{2}-\d{2}$/.test(r.from) && /^\d{4}-\d{2}-\d{2}$/.test(r.to) && r.from <= r.to;

export const needsRun = (r: SynthesisRosterRow) => r.status === "none" || r.status === "stale";
// Has evidence but no report written from it (a remade summary reads as none).
export const needsReport = (r: SynthesisRosterRow) => r.synthesisId !== null && r.reportId === null;

// The class's term, or September to June of the school year we are in.
export function wholeYear(cls: Pick<ClassRow, "termStart" | "termEnd">, now = new Date()): Range {
  if (cls.termStart && cls.termEnd) return { from: cls.termStart, to: cls.termEnd };
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: cls.termStart ?? `${start}-09-01`, to: cls.termEnd ?? `${start + 1}-06-30` };
}

// A class run: evidence for every student who needs it, or reports for every summary without
// one. Kept after it finishes so the failures can still be reported.
export type RunKind = "evidence" | "reports";
export type ClassRun = { kind: RunKind; range: Range; done: number; total: number; failed: number };
export const runBusy = (run: ClassRun | null) => run !== null && run.done < run.total;

export type ReportsStore = {
  /** The period picked for a class, or its whole year. */
  rangeOf: (cls: ClassRow) => Range;
  setRange: (classId: string, range: Range) => void;
  /** Students with an evidence request in flight. */
  running: Set<string>;
  /** Students with a report being written. */
  writing: Set<string>;
  runOf: (classId: string) => ClassRun | null;
  /** Bumped after anything that changes a status (a summary made, an answer recorded). */
  version: number;
  refresh: () => void;
  /** One evidence summary. Throws on failure so the caller decides how to show it. */
  generate: (studentId: string, range: Range) => Promise<SynthesisResult>;
  generateClass: (classId: string, range: Range, studentIds: string[]) => void;
  /** One report, from the student's saved summary. Throws on failure. */
  writeReport: (studentId: string, synthesisId: string) => Promise<ReportView>;
  writeClass: (classId: string, range: Range, targets: { studentId: string; synthesisId: string }[]) => void;
};

// Runs `task` over every item, `concurrency` at a time, telling `onSettled` as each one ends.
export async function runQueue<T>(items: T[], concurrency: number, task: (item: T) => Promise<unknown>, onSettled: (ok: boolean) => void) {
  const queue = [...items];
  const worker = async () => {
    while (queue.length > 0) {
      let ok = true;
      try {
        await task(queue.shift()!);
      } catch {
        ok = false;
      }
      onSettled(ok);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

export const ReportsContext = createContext<ReportsStore | null>(null);

export function useReports() {
  const store = useContext(ReportsContext);
  if (!store) throw new Error("useReports needs a ReportsProvider");
  return store;
}
