// Roster import: finding the students in a pasted or uploaded spreadsheet.
//
// Pure: no database, no Hono, no model. Real exports are messy: a block of metadata before the
// table, summary rows after it, ids and emails between the names, a "Section" column naming
// several classes, no header row at all. detectTable() tries every row that looks like a
// header and keeps the one with the most real names beneath it, then falls back to the shape
// of the data. When neither is confident it returns null and the route may ask the model
// (roster-model.ts). The teacher sees the result, not a form: a wrong guess is fixed on the
// students page.
import type { ColumnRole, MappingSource, NameRow, SkippedRow } from "./api-types";
import { cleanName } from "./fields";

export type Grid = string[][];
export const columnRoles = ["first", "last", "full_first_last", "full_last_first", "preferred", "class", "ignore"] as const satisfies readonly ColumnRole[];

// Where the students are in the grid: which column holds what, and the rows that are data.
export type Table = { roles: ColumnRole[]; start: number; end: number; source: MappingSource };

const MAX_NAME = 100; // matches nameField in fields.ts

// ---- Header rules ----------------------------------------------------------------------

// What a header cell says the column holds. "full" is a whole name whose order (First Last or
// Last, First) is read from the data underneath. Checked in this order so a compound title
// resolves the right way: "Preferred First Name" is a nickname, "Student First Name" is a
// first name, "Class Name" is the class, "Student Name" is a full name, "Student ID" is nothing.
export type HeaderRole = "preferred" | "first" | "last" | "class" | "full";
// Titles that hold something about the student rather than their name, whatever else they say.
const notAName = /\b(id|number|no|num|code|email|mail|username|login|password)\b/;
const headerRules: [HeaderRole, RegExp][] = [
  ["preferred", /\b(preferred|nick|goes by|known as|chosen)/],
  ["first", /\b(first|given|forename)/],
  ["last", /\b(last|surname|family)/],
  ["class", /\b(class|section|period|block|homeroom|course)/],
  ["full", /\b(name|student|pupil|learner)/],
];
const MAX_HEADER_WORDS = 5;

// "FirstName", "first_name", "First-Name" all become "first name".
const headerWords = (cell: string) =>
  cell
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^\p{L}]+/gu, " ")
    .trim();

// A sentence that happens to contain "student" is not a column title.
export function headerRole(cell: string): HeaderRole | null {
  const words = headerWords(cell);
  if (!words || words.split(" ").length > MAX_HEADER_WORDS || notAName.test(words)) return null;
  return headerRules.find(([, re]) => re.test(words))?.[0] ?? null;
}

const isNameRole = (r: HeaderRole | ColumnRole | null) => r === "first" || r === "last" || r === "full" || r === "full_first_last" || r === "full_last_first";
export const hasNameColumn = (roles: (ColumnRole | null)[]) => roles.some(isNameRole);

// ---- Content rules ---------------------------------------------------------------------

// What a column looks like from its cells: a whole name in one of two orders, a bare word
// (one half of a name, order unknown), or something to ignore (ids, emails, dates, blanks).
export type ColumnKind = "full_last_first" | "full_first_last" | "part" | "ignore";
const nameLike = /^[\p{L}\p{M}'’.\-\s,]+$/u;

export function classifyColumn(cells: string[]): ColumnKind {
  const filled = cells.map((c) => c.trim()).filter(Boolean);
  const majority = (test: (c: string) => boolean) => filled.filter(test).length * 2 > filled.length;
  if (filled.length === 0 || !majority((c) => nameLike.test(c))) return "ignore";
  if (majority((c) => c.includes(","))) return "full_last_first";
  if (majority((c) => c.split(/\s+/).length > 1)) return "full_first_last";
  return "part";
}

const width = (grid: Grid) => Math.max(0, ...grid.map((r) => r.length));
const column = (grid: Grid, i: number, from: number, to: number) => grid.slice(from, to).map((r) => r[i] ?? "");
const isBlank = (row: string[]) => row.every((c) => !c.trim());

// The table under a header runs until a row that is narrower than the header and has
// nothing in the name columns: the "Totals" line, the next section's title, the generator's
// sign-off. Blank rows are skipped, not ends, and a ragged line that still names someone
// stays in.
function tableEnd(grid: Grid, header: number, nameCols: number[]): number {
  const headerWidth = grid[header]?.length ?? 0;
  let end = header + 1;
  for (let r = header + 1; r < grid.length; r++) {
    const row = grid[r]!;
    if (isBlank(row)) continue;
    if (row.length < headerWidth && nameCols.every((i) => !(row[i] ?? "").trim())) break;
    end = r + 1;
  }
  return end;
}

function rolesFromHeader(grid: Grid, header: (HeaderRole | null)[], h: number, end: number): ColumnRole[] {
  return Array.from({ length: width(grid.slice(h, end)) }, (_, i): ColumnRole => {
    const r = header[i] ?? null;
    if (r === "full") return classifyColumn(column(grid, i, h + 1, end)) === "full_last_first" ? "full_last_first" : "full_first_last";
    return r ?? "ignore";
  });
}

export function detectTable(grid: Grid): Table | null {
  // Every row that names a name column is a candidate header; the one whose rows are most
  // nearly all names is the table. "Students","8" in a metadata block reads a few titles
  // below it as names ("First roll") but far more non-names, so the real header wins.
  let best: { table: Table; score: number } | null = null;
  for (let h = 0; h < grid.length; h++) {
    const header = grid[h]!.map(headerRole);
    const nameCols = header.flatMap((r, i) => (isNameRole(r) ? [i] : []));
    if (nameCols.length === 0) continue;
    const end = tableEnd(grid, h, nameCols);
    const table: Table = { roles: rolesFromHeader(grid, header, h, end), start: h + 1, end, source: "header" };
    const { rows, skipped } = applyMapping(grid, table);
    const score = rows.length - skipped.length;
    if (rows.length > 0 && (!best || score > best.score)) best = { table, score };
  }
  if (best) return best.table;

  // No header: confident only when exactly one column holds whole names and nothing else
  // looks like a name. Two bare-word columns could be first/last in either order; that is
  // the model's call.
  const kinds = Array.from({ length: width(grid) }, (_, i) => classifyColumn(column(grid, i, 0, grid.length)));
  const fulls = kinds.filter((k) => k === "full_last_first" || k === "full_first_last");
  if (fulls.length === 1 && !kinds.includes("part")) {
    const roles = kinds.map((k): ColumnRole => (k === "part" || k === "ignore" ? "ignore" : k));
    return { roles, start: 0, end: grid.length, source: "content" };
  }
  return null;
}

// ---- Names -----------------------------------------------------------------------------

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
// Lowercase words that belong to the surname: "Ana de la Cruz" is Ana / de la Cruz.
const PARTICLES = new Set(["de", "la", "del", "della", "di", "da", "du", "le", "les", "van", "von", "der", "den", "ter", "st", "san", "santa", "bin", "binti", "ibn", "al", "el"]);
const norm = (t: string) => t.toLowerCase().replace(/\.$/, "");
const tokens = (s: string) => s.split(/[\s,]+/).filter((t) => t && !SUFFIXES.has(norm(t)));

export type Split = { firstName: string; lastName: string } | { error: string };

// Middle names are dropped: the tagger matches on first and last, and a teacher says "Rowan",
// not "Rowan James". A "Last, First" cell without a comma is read as "First Last".
export function splitFullName(raw: string, format: "first_last" | "last_first"): Split {
  const s = cleanName(raw);
  if (!s) return { error: "no name" };
  const comma = s.indexOf(",");
  if (format === "last_first" && comma !== -1) {
    const last = tokens(s.slice(0, comma));
    const first = tokens(s.slice(comma + 1));
    if (last.length === 0 || first.length === 0) return { error: "only one name" };
    return { firstName: first[0]!, lastName: last.join(" ") };
  }
  const t = tokens(s);
  if (t.length < 2) return { error: "only one name" };
  let i = t.length - 1;
  while (i > 1 && PARTICLES.has(norm(t[i - 1]!))) i--;
  return { firstName: t[0]!, lastName: t.slice(i).join(" ") };
}

// "PELL" → "Pell", "O'BRIEN" → "O'Brien", "SMITH-JONES" → "Smith-Jones". Mixed case is left
// alone so "McBride" and "van Beethoven" survive.
export function titleCaseIfShouting(s: string): string {
  if (/\p{Ll}/u.test(s)) return s;
  return s.toLowerCase().replace(/(^|[\s\-'’.])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

// ---- Applying a table ------------------------------------------------------------------

export type ParsedRow = NameRow & { line: number; className: string | null };

// One row per student-looking line; everything else goes to skipped with a reason. First and
// last columns win over a full-name column when a table has both. A preferred name becomes
// an alias when it is not just the first name again. Names with digits or symbols ("Grade 7
// - A", "n/a") are not names, which is also what keeps a metadata row from becoming a student.
export function applyMapping(grid: Grid, table: Table): { rows: ParsedRow[]; skipped: SkippedRow[] } {
  const col = (...roles: ColumnRole[]) => table.roles.findIndex((r) => roles.includes(r));
  const firstCol = col("first");
  const lastCol = col("last");
  const fullCol = col("full_first_last", "full_last_first");
  const prefCol = col("preferred");
  const classCol = col("class");
  const rows: ParsedRow[] = [];
  const skipped: SkippedRow[] = [];

  for (let r = table.start; r < table.end; r++) {
    const cells = (grid[r] ?? []).map((c) => c.trim());
    if (isBlank(cells)) continue;
    const line = r + 1;
    const skip = (reason: string) => skipped.push({ line, cells, reason });
    const cell = (i: number) => (i >= 0 ? cleanName(cells[i] ?? "") : "");
    const useFull = fullCol >= 0 && (firstCol < 0 || lastCol < 0);
    // Checked on the whole cell, before splitting, so "Grade 7 - A" cannot shed its digit as
    // a middle name and come out as Grade A.
    if ((useFull ? [cell(fullCol)] : [cell(firstCol), cell(lastCol)]).some((c) => c && !nameLike.test(c))) {
      skip("not a name");
      continue;
    }
    const split: Split = useFull
      ? splitFullName(cells[fullCol] ?? "", table.roles[fullCol] === "full_last_first" ? "last_first" : "first_last")
      : { firstName: cell(firstCol), lastName: cell(lastCol) };
    if ("error" in split) {
      skip(split.error);
      continue;
    }
    const firstName = titleCaseIfShouting(split.firstName);
    const lastName = titleCaseIfShouting(split.lastName);
    if (!firstName) {
      skip("no first name");
      continue;
    }
    if (!lastName) {
      skip("no last name");
      continue;
    }
    if (firstName.length > MAX_NAME || lastName.length > MAX_NAME) {
      skip("name too long");
      continue;
    }
    const preferred = titleCaseIfShouting(cell(prefCol));
    const aliases = preferred && preferred.length <= MAX_NAME && preferred.toLocaleLowerCase() !== firstName.toLocaleLowerCase() ? [preferred] : [];
    const className = cell(classCol).slice(0, MAX_NAME) || null;
    rows.push({ line, firstName, lastName, aliases, className });
  }
  return { rows, skipped };
}

// ---- Matching against the class -------------------------------------------------------

// Shared with the grade book import, which matches its rows to the roster the same way.
export const nameKey = (s: { firstName: string; lastName: string }) => `${cleanName(s.firstName)}\u0000${cleanName(s.lastName)}`.toLocaleLowerCase();

// Who is new, who is already enrolled (students who have left included: the teacher can
// reactivate them), and lines that repeat an earlier line.
export function planImport(rows: ParsedRow[], roster: { firstName: string; lastName: string }[]): { added: NameRow[]; existing: NameRow[]; skipped: SkippedRow[] } {
  const enrolled = new Set(roster.map(nameKey));
  const seen = new Map<string, number>();
  const added: NameRow[] = [];
  const existing: NameRow[] = [];
  const skipped: SkippedRow[] = [];
  for (const { line, className: _class, ...row } of rows) {
    const key = nameKey(row);
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      skipped.push({ line, cells: [row.firstName, row.lastName], reason: `same as line ${earlier}` });
      continue;
    }
    seen.set(key, line);
    (enrolled.has(key) ? existing : added).push(row);
  }
  return { added, existing, skipped };
}
