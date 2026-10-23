import { useState } from "react";
import type { GradeImportResult } from "../../worker/api-types";
import { api, jsonInit } from "../api";
import { errorText, plural } from "../ui";
import { useAction } from "../useAction";
import GridImport, { SkippedLines } from "./GridImport";

// Pick a grade book export, or paste its cells, and the scores are imported on the spot,
// matched to this class's roster by name. Importing again updates the same scores.
export default function ImportGrades({ classId }: { classId: string }) {
  const [result, setResult] = useState<GradeImportResult | null>(null);
  const { run, busy, error } = useAction(async (read: () => Promise<string[][]>) => {
    const grid = await read();
    setResult(await api<GradeImportResult>("/api/grades/import", jsonInit("POST", { classId, grid })));
  });

  return (
    <div className="mt-4">
      <GridImport
        label="Import grade book"
        pasteLabel="or paste scores"
        placeholder={"A grade book export: one row per student, one column per assignment.\nLast Name\tFirst Name\tQuiz 1\tUnit 1 Test\nQuill\tAvery\t17\t34"}
        busy={busy}
        onGrid={run}
      />
      {error && <p className={`mt-2 ${errorText}`}>{error}</p>}
      {result && <Summary result={result} />}
    </div>
  );
}

function Summary({ result }: { result: GradeImportResult }) {
  if (result.shape === "none") {
    return (
      <p className="mt-3 text-sm text-amber-700">
        Couldn't find a grade table in that. Expected one row per student with a column per assignment, or one row per score with student, assignment and score columns.
      </p>
    );
  }
  const notOnRoster = result.skipped.filter((s) => s.reason === "not on the roster").length;
  return (
    <section role="status" className="mt-3 text-sm">
      <p>
        Added {plural(result.entries, "score")} for {plural(result.students, "student")} across {plural(result.assignments, "assignment")}
        {result.missing > 0 && `, ${result.missing} missing`}
        {result.skipped.length > 0 && `; ${plural(result.skipped.length, "line")} skipped`}.
        {notOnRoster > 0 && " Names not on the roster are skipped: import the roster first, or fix the name on the students page."}
      </p>
      {result.guessedMax.length > 0 && <p className="mt-1 text-gray-600">Points possible were not in the file; assumed for {result.guessedMax.join(", ")}.</p>}
      <SkippedLines skipped={result.skipped} />
    </section>
  );
}
