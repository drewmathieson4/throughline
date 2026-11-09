import { useState, type ReactNode } from "react";
import type { ReportView, SynthesisResult } from "../../worker/api-types";
import { api, jsonInit } from "../api";
import { ReportsContext, runBusy, runQueue, wholeYear, type ClassRun, type Range, type ReportsStore, type RunKind } from "./reportsStore";

// Evidence and report runs live above the routes, so a class run keeps going and keeps its
// progress when the teacher switches tab or class. The picked period lives here too, since
// the Reports screen unmounts whenever another tab shows.

// Two at a time: quick enough for a class of thirty, gentle on the API's rate limits.
const CONCURRENCY = 2;

export function ReportsProvider({ children }: { children: ReactNode }) {
  const [ranges, setRanges] = useState<Map<string, Range>>(new Map());
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [writing, setWriting] = useState<Set<string>>(new Set());
  const [runs, setRuns] = useState<Map<string, ClassRun>>(new Map());
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  const marker = (set: typeof setRunning) => (id: string, on: boolean) =>
    set((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const mark = marker(setRunning);
  const markWriting = marker(setWriting);

  // Refreshes after each one, so the roster and an open student catch up as a run goes.
  async function generate(studentId: string, range: Range) {
    mark(studentId, true);
    try {
      return await api<SynthesisResult>("/api/syntheses", jsonInit("POST", { studentId, ...range }));
    } finally {
      mark(studentId, false);
      refresh();
    }
  }

  async function writeReport(studentId: string, synthesisId: string) {
    markWriting(studentId, true);
    try {
      return await api<ReportView>("/api/reports", jsonInit("POST", { synthesisId }));
    } finally {
      markWriting(studentId, false);
      refresh();
    }
  }

  // One run per class at a time, of either kind. However the queue ends, the run is closed
  // out (anyone not counted is a failure) so the class never stays busy with its buttons off.
  function runClass<T>(classId: string, kind: RunKind, range: Range, items: T[], task: (item: T) => Promise<unknown>) {
    setRuns((prev) => new Map(prev).set(classId, { kind, range, done: 0, total: items.length, failed: 0 }));
    const finish = () =>
      setRuns((prev) => {
        const run = prev.get(classId);
        return run && runBusy(run) ? new Map(prev).set(classId, { ...run, done: run.total, failed: run.failed + run.total - run.done }) : prev;
      });
    runQueue(
      items,
      CONCURRENCY,
      task,
      (ok) =>
        setRuns((prev) => {
          const run = prev.get(classId);
          return run ? new Map(prev).set(classId, { ...run, done: run.done + 1, failed: run.failed + (ok ? 0 : 1) }) : prev;
        }),
    ).then(finish, finish);
  }

  const store: ReportsStore = {
    rangeOf: (cls) => ranges.get(cls.id) ?? wholeYear(cls),
    setRange: (classId, range) => setRanges((prev) => new Map(prev).set(classId, range)),
    running,
    writing,
    runOf: (classId) => runs.get(classId) ?? null,
    version,
    refresh,
    generate,
    generateClass: (classId, range, studentIds) => runClass(classId, "evidence", range, studentIds, (id) => generate(id, range)),
    writeReport,
    writeClass: (classId, range, targets) => runClass(classId, "reports", range, targets, (t) => writeReport(t.studentId, t.synthesisId)),
  };
  return <ReportsContext.Provider value={store}>{children}</ReportsContext.Provider>;
}
