import { useState, type ReactNode } from "react";
import type { SynthesisResult } from "../../worker/api-types";
import { api, jsonInit } from "../api";
import { ReportsContext, runBusy, runQueue, wholeYear, type ClassRun, type Range, type ReportsStore } from "./reportsStore";

// Summary runs live above the routes, so a "Generate for class" run keeps going and keeps its
// progress when the teacher switches tab or class. The picked period lives here too, since
// the Reports screen unmounts whenever another tab shows.

// Two at a time: quick enough for a class of thirty, gentle on the API's rate limits.
const CONCURRENCY = 2;

export function ReportsProvider({ children }: { children: ReactNode }) {
  const [ranges, setRanges] = useState<Map<string, Range>>(new Map());
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [runs, setRuns] = useState<Map<string, ClassRun>>(new Map());
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  const mark = (id: string, on: boolean) =>
    setRunning((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // Refreshes after each one, so the roster and an open report catch up as a run goes.
  async function generate(studentId: string, range: Range) {
    mark(studentId, true);
    try {
      return await api<SynthesisResult>("/api/syntheses", jsonInit("POST", { studentId, ...range }));
    } finally {
      mark(studentId, false);
      refresh();
    }
  }

  function generateClass(classId: string, range: Range, studentIds: string[]) {
    setRuns((prev) => new Map(prev).set(classId, { range, done: 0, total: studentIds.length, failed: 0 }));
    // However the queue ends, close the run out (anyone not counted is a failure) so the
    // class never stays busy with its Generate button disabled.
    const finish = () =>
      setRuns((prev) => {
        const run = prev.get(classId);
        return run && runBusy(run) ? new Map(prev).set(classId, { ...run, done: run.total, failed: run.failed + run.total - run.done }) : prev;
      });
    runQueue(
      studentIds,
      CONCURRENCY,
      (id) => generate(id, range),
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
    runOf: (classId) => runs.get(classId) ?? null,
    version,
    refresh,
    generate,
    generateClass,
  };
  return <ReportsContext.Provider value={store}>{children}</ReportsContext.Provider>;
}
