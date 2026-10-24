import { Link } from "react-router";
import type { ImportedClass, RosterImportResult } from "../../worker/api-types";
import { api, jsonInit } from "../api";
import { plural } from "../ui";
import { useAction } from "../useAction";
import GridImport, { SkippedLines } from "./GridImport";
import { rosterCounts } from "./importText";

// Pick a roster file, or paste names, and they are imported on the spot: no preview, no
// column form. The Worker finds the students; the summary says what it did, and anything it
// got wrong is fixed on the student's page.
export default function ImportRoster({ classId, onImported }: { classId: string; onImported: (result: RosterImportResult) => void }) {
  const { run, busy, error } = useAction(async (read: () => Promise<string[][]>) => {
    const grid = await read();
    const r = await api<RosterImportResult>("/api/students/import", jsonInit("POST", { classId, grid }));
    if (r.source === "none") throw new Error("Couldn't find student names in that. Paste names one per line, or add students one at a time.");
    onImported(r);
  });

  return (
    <GridImport
      fileLabel="Choose a roster file"
      placeholder={"One student per line, or cells from a spreadsheet:\nTamsin Brook\nQuill, Avery"}
      busy={busy}
      error={error}
      onGrid={run}
    />
  );
}

export function RosterSummary({ result, classId }: { result: RosterImportResult; classId: string }) {
  const { added, existing } = rosterCounts(result);
  return (
    <>
      <p className="font-bold">
        Added {plural(added, "student")}
        {existing > 0 && `, ${existing} already enrolled`}
        {result.skipped.length > 0 && `, ${plural(result.skipped.length, "line")} skipped`}.
      </p>
      {result.classes.map((k) => (
        <ClassSummary key={k.id} cls={k} elsewhere={result.classes.length > 1 || k.id !== classId} />
      ))}
      <SkippedLines skipped={result.skipped} />
    </>
  );
}

// A file that names other classes splits across them; those get a link and their name.
function ClassSummary({ cls, elsewhere }: { cls: ImportedClass; elsewhere: boolean }) {
  if (cls.added.length === 0) return null;
  return (
    <div className="mt-2">
      {elsewhere && (
        <p className="font-semibold">
          <Link to={`/classes/${cls.id}`} className="text-accent-foreground hover:underline">
            {cls.name}
          </Link>
          {cls.created && <span className="font-normal text-muted-foreground"> (new class)</span>}
        </p>
      )}
      <ul className="mt-1 ml-4 list-disc text-secondary-foreground">
        {cls.added.map((s) => (
          <li key={`${s.firstName} ${s.lastName}`}>
            {s.firstName} {s.lastName}
            {s.aliases.length > 0 && <span className="text-muted-foreground"> (goes by {s.aliases.join(", ")})</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
