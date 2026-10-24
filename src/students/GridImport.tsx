import { useState } from "react";
import { Upload } from "lucide-react";
import type { SkippedRow } from "../../worker/api-types";
import FilePicker from "../FilePicker";
import { errorText, plural } from "../ui";
import { csvToGrid } from "./csv";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const MAX_LINES = 600;
const ACCEPT = ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain";

// A file button and a paste box that both turn into a grid of cells: the roster and the
// grade book import share it, inside their Add window. onGrid does the request; a thrown
// error is the caller's to show (it runs inside their useAction), and lands under the box.
export default function GridImport({
  fileLabel,
  placeholder,
  busy,
  error,
  onGrid,
}: {
  fileLabel: string;
  placeholder: string;
  busy: boolean;
  error: string | null;
  onGrid: (read: () => Promise<string[][]>) => Promise<boolean>;
}) {
  const [text, setText] = useState("");

  // Reading the file happens inside the caller's action so a failed read surfaces there too.
  const run = async (source: File | string) => {
    const read = async () => {
      const grid = csvToGrid(typeof source === "string" ? source : await source.text());
      if (grid.length === 0) throw new Error("Nothing to import.");
      if (grid.length > MAX_LINES) throw new Error(`That has ${grid.length} lines; the limit is ${MAX_LINES}.`);
      return grid;
    };
    if (await onGrid(read)) setText("");
  };

  return (
    <div className="mt-4 flex flex-col gap-3">
      <FilePicker accept={ACCEPT} disabled={busy} onFile={run} className="justify-center px-3.5 text-[15px] font-bold">
        <Upload className="size-4" aria-hidden />
        {busy ? "Importing…" : fileLabel}
      </FilePicker>
      <Label>
        Or paste from a spreadsheet
        <Textarea rows={5} className="min-h-32 font-mono text-[13px] md:text-[13px]" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
      </Label>
      {error && <p className={errorText}>{error}</p>}
      <Button type="button" className="self-end" disabled={busy || !text.trim()} onClick={() => run(text)}>
        {busy ? "Importing…" : "Import"}
      </Button>
    </div>
  );
}

// The lines an import did not use, with the reason, folded away under the summary. A grade
// book can skip several cells on one line, so the key is the position, not the line.
export function SkippedLines({ skipped }: { skipped: SkippedRow[] }) {
  if (skipped.length === 0) return null;
  return (
    <details className="mt-2 text-[13.5px]">
      <summary className="cursor-pointer font-bold text-sunny-foreground">{plural(skipped.length, "skipped line")}</summary>
      <ul className="mt-1.5 ml-4 list-disc text-secondary-foreground">
        {skipped.map((s, i) => (
          <li key={i}>
            line {s.line}: {s.cells.filter(Boolean).join(", ") || "(blank)"} <span className="text-muted-foreground">({s.reason})</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
