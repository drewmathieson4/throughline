import type { GradeImportResult } from "../../worker/api-types";
import { api, jsonInit } from "../api";
import { plural } from "../ui";
import { useAction } from "../useAction";
import GridImport, { SkippedLines } from "./GridImport";

// Pick a grade book export, or paste its cells, and the scores are imported on the spot,
// matched to this class's roster by name. Importing again updates the same scores.
export default function ImportGrades({ classId, onImported }: { classId: string; onImported: (result: GradeImportResult) => void }) {
  const { run, busy, error } = useAction(async (read: () => Promise<string[][]>) => {
    const grid = await read();
    const r = await api<GradeImportResult>("/api/grades/import", jsonInit("POST", { classId, grid }));
    if (r.shape === "none") {
      throw new Error("Couldn't find a grade table in that. Expected one row per student with a column per assignment, or one row per score with student, assignment and score columns.");
    }
    onImported(r);
  });

  return (
    <GridImport
      fileLabel="Choose a grade book file"
      placeholder={"One row per student, one column per assignment:\nLast Name\tFirst Name\tQuiz 1\tUnit 1 Test\nQuill\tAvery\t17\t34"}
      busy={busy}
      error={error}
      onGrid={run}
    />
  );
}

export function GradesSummary({ result }: { result: GradeImportResult }) {
  const notOnRoster = result.skipped.filter((s) => s.reason === "not on the roster").length;
  return (
    <>
      <p className="font-bold">
        Added {plural(result.entries, "score")} for {plural(result.students, "student")} across {plural(result.assignments, "assignment")}
        {result.missing > 0 && `, ${result.missing} missing`}
        {result.skipped.length > 0 && `; ${plural(result.skipped.length, "line")} skipped`}.
      </p>
      {notOnRoster > 0 && <p className="mt-1 text-secondary-foreground">Names not on the roster are skipped: import the roster first, or fix the name on the student's page.</p>}
      {result.guessedMax.length > 0 && <p className="mt-1 text-secondary-foreground">Points possible were not in the file; assumed for {result.guessedMax.join(", ")}.</p>}
      <SkippedLines skipped={result.skipped} />
    </>
  );
}
