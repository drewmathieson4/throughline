import { useState, type ReactNode } from "react";
import type { SkippedRow } from "../../worker/api-types";
import FilePicker from "../FilePicker";
import { input } from "../ui";
import { csvToGrid } from "./csv";
import { Button } from "@/components/ui/button";

const MAX_LINES = 600;
const ACCEPT = ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain";

// A file button and a paste box that both turn into a grid of cells: the roster and the
// grade book import share it. onGrid does the request; a thrown error is the caller's to
// show (it runs inside their useAction). The paste box closes after a successful import.
export default function GridImport({
  label,
  pasteLabel,
  placeholder,
  busy,
  onGrid,
}: {
  label: ReactNode;
  pasteLabel: string;
  placeholder: string;
  busy: boolean;
  onGrid: (read: () => Promise<string[][]>) => Promise<boolean>;
}) {
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");

  // Reading the file happens inside the caller's action so a failed read surfaces there too.
  const run = async (source: File | string) => {
    const read = async () => {
      const grid = csvToGrid(typeof source === "string" ? source : await source.text());
      if (grid.length === 0) throw new Error("Nothing to import.");
      if (grid.length > MAX_LINES) throw new Error(`That has ${grid.length} lines; the limit is ${MAX_LINES}.`);
      return grid;
    };
    if (await onGrid(read)) {
      setText("");
      setPasting(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <FilePicker accept={ACCEPT} disabled={busy} onFile={run}>
          {busy ? "Importing…" : label}
        </FilePicker>
        <button type="button" className="text-sm text-gray-500 hover:underline" onClick={() => setPasting((p) => !p)}>
          {pasting ? "Hide paste box" : pasteLabel}
        </button>
      </div>
      {pasting && (
        <div className="mt-2 flex flex-col gap-2">
          <textarea aria-label={pasteLabel} rows={5} className={`w-full font-mono ${input}`} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
          <div>
            <Button type="button" disabled={busy || !text.trim()} onClick={() => run(text)}>
              {busy ? "Importing…" : "Import"}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

// The lines an import did not use, with the reason, folded away under the summary. A grade
// book can skip several cells on one line, so the key is the position, not the line.
export function SkippedLines({ skipped }: { skipped: SkippedRow[] }) {
  if (skipped.length === 0) return null;
  return (
    <details className="mt-1 text-amber-700">
      <summary>Skipped lines</summary>
      <ul className="ml-4 list-disc">
        {skipped.map((s, i) => (
          <li key={i}>
            line {s.line}: {s.cells.filter(Boolean).join(", ") || "(blank)"} <span className="text-gray-500">({s.reason})</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
