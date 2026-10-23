import { useState } from "react";
import type { ImportedClass, RosterImportResult } from "../../worker/api-types";
import { api, jsonInit } from "../api";
import { errorText, plural } from "../ui";
import { useAction } from "../useAction";
import GridImport, { SkippedLines } from "./GridImport";

// Pick a roster file, or paste names, and they are imported on the spot: no preview, no
// column form. The Worker finds the students; the summary says what it did, and anything it
// got wrong is fixed on the students page.
export default function ImportRoster({ classId, onImported }: { classId: string; onImported: (result: RosterImportResult) => void }) {
  const [result, setResult] = useState<RosterImportResult | null>(null);
  const { run, busy, error } = useAction(async (read: () => Promise<string[][]>) => {
    const grid = await read();
    const r = await api<RosterImportResult>("/api/students/import", jsonInit("POST", { classId, grid }));
    setResult(r);
    onImported(r);
  });

  return (
    <div className="mt-6">
      <GridImport
        label="Import roster file"
        pasteLabel="or paste names"
        placeholder={"One student per line, or paste cells from a spreadsheet:\nTamsin Brook\nQuill, Avery"}
        busy={busy}
        onGrid={run}
      />
      {error && <p className={`mt-2 ${errorText}`}>{error}</p>}
      {result && <Summary result={result} classId={classId} />}
    </div>
  );
}

function Summary({ result, classId }: { result: RosterImportResult; classId: string }) {
  const added = result.classes.reduce((n, k) => n + k.added.length, 0);
  const existing = result.classes.reduce((n, k) => n + k.existing.length, 0);
  if (result.source === "none") {
    return <p className="mt-3 text-sm text-amber-700">Couldn't find student names in that. Add them below, or paste names one per line.</p>;
  }
  const elsewhere = result.classes.some((k) => k.id !== classId);
  return (
    <section role="status" className="mt-3 text-sm">
      <p>
        Added {plural(added, "student")}
        {existing > 0 && `, ${existing} already enrolled`}
        {result.skipped.length > 0 && `, ${plural(result.skipped.length, "line")} skipped`}.
        {elsewhere && " Pick a class at the top to see them."}
      </p>
      {result.classes.map((k) => (
        <ClassSummary key={k.id} cls={k} showName={result.classes.length > 1 || k.id !== classId} />
      ))}
      <SkippedLines skipped={result.skipped} />
    </section>
  );
}

function ClassSummary({ cls, showName }: { cls: ImportedClass; showName: boolean }) {
  if (cls.added.length === 0) return null;
  return (
    <div className="mt-1">
      {showName && (
        <p className="font-medium">
          {cls.name}
          {cls.created && <span className="font-normal text-gray-500"> (new class)</span>}
        </p>
      )}
      <ul className="ml-4 list-disc text-gray-700">
        {cls.added.map((s) => (
          <li key={`${s.firstName} ${s.lastName}`}>
            {s.firstName} {s.lastName}
            {s.aliases.length > 0 && <span className="text-gray-500"> (goes by {s.aliases.join(", ")})</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
