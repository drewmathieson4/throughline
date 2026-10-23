import { useState } from "react";
import type { ImportedClass, RosterImportResult } from "../../worker/api-types";
import { api, jsonInit } from "../api";
import { button, errorText, input, plural, subtleButton } from "../ui";
import { useAction } from "../useAction";
import { csvToGrid } from "./csv";

const MAX_LINES = 600;

// Pick a roster file, or paste names, and they are imported on the spot: no preview, no
// column form. The Worker finds the students; the summary says what it did, and anything it
// got wrong is fixed on the students page.
export default function ImportRoster({ classId, onImported }: { classId: string; onImported: (result: RosterImportResult) => void }) {
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<RosterImportResult | null>(null);

  // Reading the file happens inside the action so a failed read surfaces as `error` too.
  const { run: importSource, busy, error } = useAction(async (source: File | string) => {
    const grid = csvToGrid(typeof source === "string" ? source : await source.text());
    if (grid.length === 0) throw new Error("Nothing to import.");
    if (grid.length > MAX_LINES) throw new Error(`That has ${grid.length} lines; the limit is ${MAX_LINES}.`);
    const r = await api<RosterImportResult>("/api/students/import", jsonInit("POST", { classId, grid }));
    setResult(r);
    setText("");
    setPasting(false);
    onImported(r);
  });

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className={`${subtleButton} cursor-pointer`}>
          {busy ? "Importing…" : "Import roster file"}
          <input
            type="file"
            className="sr-only"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // so picking the same file again fires onChange
              if (file) importSource(file);
            }}
          />
        </label>
        <button type="button" className="text-sm text-gray-500 hover:underline" onClick={() => setPasting((p) => !p)}>
          {pasting ? "Hide paste box" : "or paste names"}
        </button>
      </div>
      {pasting && (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            aria-label="Roster text"
            rows={5}
            className={`w-full font-mono ${input}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"One student per line, or paste cells from a spreadsheet:\nTamsin Brook\nQuill, Avery"}
          />
          <div>
            <button type="button" className={button} disabled={busy || !text.trim()} onClick={() => importSource(text)}>
              {busy ? "Importing…" : "Import"}
            </button>
          </div>
        </div>
      )}
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
      {result.skipped.length > 0 && (
        <details className="mt-1 text-amber-700">
          <summary>Skipped lines</summary>
          <ul className="ml-4 list-disc">
            {result.skipped.map((s) => (
              <li key={s.line}>
                line {s.line}: {s.cells.filter(Boolean).join(", ") || "(blank)"} <span className="text-gray-500">({s.reason})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
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
