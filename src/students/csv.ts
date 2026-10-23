import Papa from "papaparse";

// Pasted or uploaded text → rows of cells. The Worker interprets the cells; this only splits
// them. papaparse guesses the delimiter, so a tab-separated paste from a spreadsheet and a
// comma- or semicolon-separated export all work. Cells are capped at what the API accepts.
const CELL_CHARS = 200;
// A character no roster contains, so "parsing" with it keeps each line whole.
const NO_DELIMITER = "\u001f";

export function csvToGrid(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  let { data, meta } = Papa.parse<string[]>(clean, { skipEmptyLines: "greedy" });
  // Plain lines of "Pell, Rowan" look like two comma-separated columns. A CSV writer never
  // puts a space after its delimiter; a person always does. Keep those lines whole so the
  // Worker reads them as one Last, First column.
  if (meta.delimiter === "," && !clean.includes('"') && data.every((r) => r.length === 2 && r[1]!.startsWith(" "))) {
    data = Papa.parse<string[]>(clean, { skipEmptyLines: "greedy", delimiter: NO_DELIMITER }).data;
  }
  return data.map((row) => row.map((cell) => (cell ?? "").slice(0, CELL_CHARS)));
}
