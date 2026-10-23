// Grade book import: reading the scores out of a pasted or uploaded grade book.
//
// Pure, like roster.ts: no database, no Hono, no model. Two shapes are read. Wide is what
// every grade book exports: one row per student, one column per assignment, often a points
// row under the header and sometimes a date row. Long is one row per score, with student,
// assignment, score and perhaps max, category and date columns. Rules decide everything
// here; the only thing left to the model (gradebook-model.ts) is which category an
// assignment title belongs to when its name does not say.
import type { GradebookShape, SkippedRow } from "./api-types";
import { cleanName } from "./fields";
import { classifyColumn, headerRole, nameKey, splitFullName, titleCaseIfShouting, type Grid } from "./roster";
import type { RosterEntry } from "./tagging";

export type ParsedEntry = {
  line: number;
  firstName: string;
  lastName: string;
  assignment: string;
  category: string | null;
  score: number | null; // null = missing work
  maxScore: number;
  dueDate: string | null;
  position: number;
};
export type ParsedGradebook = { shape: GradebookShape; entries: ParsedEntry[]; skipped: SkippedRow[]; guessedMax: string[] };

const MAX_ASSIGNMENT = 200;
const DEFAULT_MAX = 100;

// ---- Cells -----------------------------------------------------------------------------

// What one score cell says. "other" is text the import cannot read (a letter grade, a
// comment); the row is reported so the teacher knows that column was not imported.
export type ScoreCell = { kind: "score"; value: number; max: number | null; percent: boolean } | { kind: "missing" } | { kind: "excused" } | { kind: "other" };
const MISSING = /^(missing|m|mi|-|—|–|not submitted|n\/s)$/i;
const EXCUSED = /^(excused|ex|x|n\/a|na|exempt)$/i;
const SCORE = /^(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?)|(%))?$/;

export function readCell(raw: string): ScoreCell {
  const s = raw.trim();
  if (!s || MISSING.test(s)) return { kind: "missing" };
  if (EXCUSED.test(s)) return { kind: "excused" };
  const m = SCORE.exec(s);
  if (!m) return { kind: "other" };
  return { kind: "score", value: Number(m[1]), max: m[2] ? Number(m[2]) : null, percent: m[3] !== undefined };
}

// A cell's score against the column's points possible. "17/20" carries its own max; "85%"
// is a share of the column's; "17" is out of the column's.
function resolve(cell: Extract<ScoreCell, { kind: "score" }>, columnMax: number): { score: number; maxScore: number } {
  if (cell.max !== null && cell.max > 0) return { score: cell.value, maxScore: cell.max };
  if (cell.percent) return { score: (cell.value * columnMax) / 100, maxScore: columnMax };
  return { score: cell.value, maxScore: columnMax };
}

const asNumber = (s: string) => (/^\d+(?:\.\d+)?$/.test(s.trim()) ? Number(s.trim()) : null);

// Points possible for a column whose file did not say: the max most of its "x/y" cells name,
// else 100 when every score fits under it, else the highest score seen. The caller reports
// the last two as guesses.
function guessMax(cells: ScoreCell[]): { max: number; guessed: boolean } {
  const scores = cells.flatMap((c) => (c.kind === "score" ? [c] : []));
  const named = new Map<number, number>();
  for (const c of scores) if (c.max !== null && c.max > 0) named.set(c.max, (named.get(c.max) ?? 0) + 1);
  if (named.size > 0) return { max: [...named.entries()].sort((a, b) => b[1] - a[1])[0]![0], guessed: false };
  const plain = scores.filter((c) => !c.percent).map((c) => c.value);
  const top = Math.max(0, ...plain);
  return { max: top <= DEFAULT_MAX ? DEFAULT_MAX : top, guessed: true };
}

// ---- Dates -----------------------------------------------------------------------------

// YYYY-MM-DD (an ISO datetime's date part too), M/D/YYYY, M/D/YY. Anything else is no date:
// a wrong guess at a date order would put scores on the wrong half of the timeline.
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) [m, d, y] = [Number(us[1]), Number(us[2]), us[3]!.length === 2 ? 2000 + Number(us[3]) : Number(us[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

// ---- Headers ---------------------------------------------------------------------------

const words = (cell: string) =>
  cell
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// Long-shape column titles. A score title must not also be a max title ("Points" is a
// score, "Points possible" is a max).
const ASSIGNMENT_HEADER = /\b(assignment|task|title|item|activity)\b/;
const SCORE_HEADER = /\b(score|points?|grade|marks?|result|earned)\b/;
const MAX_HEADER = /\b(out of|possible|max|maximum|total)\b/;
const CATEGORY_HEADER = /\b(category|type|kind|group)\b/;
const DATE_HEADER = /\b(date|due)\b/;

// Wide-shape columns that are about the student or the term, not an assignment: ids and
// emails, the grade book's own averages, a year-group "Grade" column, free text.
const SKIP_COLUMN = /\b(email|e mail|id|number|username|login|overall|average|avg|mean|median|total|cumulative|letter grade|comments?|notes?|year group|grade level|form)\b/;
const BARE_SKIP = /^(grade|year|yr|level|section|class|period|homeroom)$/;
// Rows under a wide header that are not students.
const POINTS_LABEL = /^(points|possible|max(imum)?|out of|total points)\b/i;
const DATE_LABEL = /^(due|date)\b/i;
const SUMMARY_ROW = /\b(average|mean|median|total|class|points|possible|max|out of|due|date)\b/i;

type NameCols = { first: number; last: number; full: number };
const nameColumns = (roles: (ReturnType<typeof headerRole> | null)[]): NameCols | null => {
  const cols = { first: roles.indexOf("first"), last: roles.indexOf("last"), full: roles.indexOf("full") };
  return cols.full >= 0 || (cols.first >= 0 && cols.last >= 0) ? cols : null;
};
const isNameCol = (cols: NameCols, i: number) => i === cols.first || i === cols.last || i === cols.full;

const isBlank = (row: string[]) => row.every((c) => !c.trim());
const column = (grid: Grid, i: number, from: number) => grid.slice(from).map((r) => (r[i] ?? "").trim());

// ---- Names -----------------------------------------------------------------------------

type Named = { firstName: string; lastName: string } | { error: string };

// The student a row names, read the way the roster import reads it, so the same cleaning
// applies on both sides of the match.
function readName(cells: string[], cols: NameCols, fullFormat: "first_last" | "last_first"): Named {
  const useFull = cols.full >= 0 && (cols.first < 0 || cols.last < 0);
  const split: Named = useFull
    ? splitFullName(cells[cols.full] ?? "", fullFormat)
    : { firstName: cleanName(cells[cols.first] ?? ""), lastName: cleanName(cells[cols.last] ?? "") };
  if ("error" in split) return split;
  const firstName = titleCaseIfShouting(split.firstName);
  const lastName = titleCaseIfShouting(split.lastName);
  if (!/\p{L}/u.test(firstName) || !/\p{L}/u.test(lastName)) return { error: "no name" };
  return { firstName, lastName };
}

const fullFormatOf = (grid: Grid, cols: NameCols, from: number) => (cols.full >= 0 && classifyColumn(column(grid, cols.full, from)) === "full_last_first" ? "last_first" : "first_last");

// ---- Long shape ------------------------------------------------------------------------

type LongTable = { header: number; cols: NameCols; assignment: number; score: number; max: number; category: number; date: number };

// The first header row naming a student, an assignment and a score column, where the
// assignment column holds text and the score column holds scores (so a wide file whose
// titles happen to say "Assignment 1" is not mistaken for it).
function findLong(grid: Grid): LongTable | null {
  for (let h = 0; h < grid.length; h++) {
    const header = grid[h]!.map((c) => c.trim());
    const cols = nameColumns(header.map(headerRole));
    if (!cols) continue;
    const titled = header.map(words);
    const find = (re: RegExp, not?: RegExp) => titled.findIndex((w, i) => !isNameCol(cols, i) && re.test(w) && !(not && not.test(w)));
    const assignment = find(ASSIGNMENT_HEADER);
    const score = find(SCORE_HEADER, MAX_HEADER);
    if (assignment < 0 || score < 0 || assignment === score) continue;
    const texty = column(grid, assignment, h + 1).filter(Boolean);
    const scores = column(grid, score, h + 1).filter(Boolean);
    if (texty.length === 0 || texty.filter((c) => asNumber(c) === null).length * 2 <= texty.length) continue;
    const kinds = scores.map((c) => readCell(c).kind);
    const scored = kinds.filter((k) => k === "score").length;
    if (scored === 0 || scored < kinds.filter((k) => k === "other").length) continue;
    return { header: h, cols, assignment, score, max: find(MAX_HEADER), category: find(CATEGORY_HEADER), date: find(DATE_HEADER) };
  }
  return null;
}

function readLong(grid: Grid, t: LongTable): ParsedGradebook {
  const entries: ParsedEntry[] = [];
  const skipped: SkippedRow[] = [];
  const guessed = new Set<string>();
  const positions = new Map<string, number>();
  const fullFormat = fullFormatOf(grid, t.cols, t.header + 1);
  for (let r = t.header + 1; r < grid.length; r++) {
    const cells = (grid[r] ?? []).map((c) => c.trim());
    if (isBlank(cells)) continue;
    const line = r + 1;
    const skip = (reason: string, shown = cells) => skipped.push({ line, cells: shown, reason });
    const name = readName(cells, t.cols, fullFormat);
    if ("error" in name) {
      skip(name.error);
      continue;
    }
    const assignment = cleanName(cells[t.assignment] ?? "").slice(0, MAX_ASSIGNMENT);
    if (!assignment) {
      skip("no assignment");
      continue;
    }
    const cell = readCell(cells[t.score] ?? "");
    if (cell.kind === "excused") continue;
    if (cell.kind === "other") {
      skip("not a score", [assignment, cells[t.score] ?? ""]);
      continue;
    }
    let position = positions.get(assignment);
    if (position === undefined) positions.set(assignment, (position = positions.size));
    const stated = t.max >= 0 ? asNumber(cells[t.max] ?? "") : null;
    let maxScore = stated !== null && stated > 0 ? stated : DEFAULT_MAX;
    let score: number | null = null;
    if (cell.kind === "score") ({ score, maxScore } = resolve(cell, maxScore));
    if (stated === null && (cell.kind !== "score" || cell.max === null)) guessed.add(assignment);
    const category = t.category >= 0 ? cleanName(cells[t.category] ?? "").slice(0, 100) || null : null;
    const dueDate = t.date >= 0 ? parseDate(cells[t.date] ?? "") : null;
    entries.push({ line, ...name, assignment, category, score, maxScore, dueDate, position });
  }
  return { shape: "long", entries, skipped, guessedMax: [...guessed] };
}

// ---- Wide shape ------------------------------------------------------------------------

type WideTable = { header: number; cols: NameCols; start: number; assignments: number[]; points: string[] | null; dates: string[] | null };

const isPointsRow = (row: string[]) => row.some((c) => POINTS_LABEL.test(c)) && row.every((c) => !c || POINTS_LABEL.test(c) || asNumber(c) !== null);
const isDateRow = (row: string[]) => row.some((c) => DATE_LABEL.test(c)) && row.every((c) => !c || DATE_LABEL.test(c) || parseDate(c) !== null);

// The first header row naming a student where some other titled column holds scores. The
// points row and the date row, when present, sit directly under the header in either order.
function findWide(grid: Grid): WideTable | null {
  for (let h = 0; h < grid.length; h++) {
    const header = grid[h]!.map((c) => c.trim());
    const cols = nameColumns(header.map(headerRole));
    if (!cols) continue;
    let start = h + 1;
    let points: string[] | null = null;
    let dates: string[] | null = null;
    for (let k = 0; k < 2 && start < grid.length; k++) {
      const row = grid[start]!.map((c) => c.trim());
      if (!points && isPointsRow(row)) points = row;
      else if (!dates && isDateRow(row)) dates = row;
      else break;
      start++;
    }
    const assignments = header.flatMap((title, i) => {
      if (isNameCol(cols, i) || !title) return [];
      const w = words(title);
      if (SKIP_COLUMN.test(w) || BARE_SKIP.test(w)) return [];
      const kinds = column(grid, i, start)
        .filter(Boolean)
        .map((c) => readCell(c).kind);
      const scores = kinds.filter((k) => k === "score").length;
      return scores > 0 && scores >= kinds.filter((k) => k === "other").length ? [i] : [];
    });
    if (assignments.length === 0) continue;
    return { header: h, cols, start, assignments, points, dates };
  }
  return null;
}

function readWide(grid: Grid, t: WideTable): ParsedGradebook {
  const header = grid[t.header]!.map((c) => c.trim());
  const entries: ParsedEntry[] = [];
  const skipped: SkippedRow[] = [];
  const guessedMax: string[] = [];
  const fullFormat = fullFormatOf(grid, t.cols, t.start);
  const headerWidth = header.length;
  const nameCells = (cells: string[]) => [t.cols.first, t.cols.last, t.cols.full].filter((i) => i >= 0).map((i) => cells[i] ?? "");

  // Each assignment column: its title, points possible, due date, and the column's position
  // in the file, which is the timeline when there are no dates.
  const columns = t.assignments.map((i, position) => {
    const assignment = cleanName(header[i]!).slice(0, MAX_ASSIGNMENT);
    const stated = t.points ? asNumber(t.points[i] ?? "") : null;
    let max = stated !== null && stated > 0 ? stated : null;
    if (max === null) {
      const g = guessMax(column(grid, i, t.start).map(readCell));
      max = g.max;
      if (g.guessed) guessedMax.push(assignment);
    }
    return { i, assignment, max, dueDate: t.dates ? parseDate(t.dates[i] ?? "") : null, position };
  });

  for (let r = t.start; r < grid.length; r++) {
    const cells = (grid[r] ?? []).map((c) => c.trim());
    if (isBlank(cells)) continue;
    // A line narrower than the header with nothing under the assignments ends the table
    // (the export's footer); a "Class average" line is skipped.
    if (cells.length < headerWidth && columns.every((col) => !(cells[col.i] ?? ""))) break;
    if (nameCells(cells).some((c) => SUMMARY_ROW.test(c))) continue;
    const line = r + 1;
    const name = readName(cells, t.cols, fullFormat);
    if ("error" in name) {
      skipped.push({ line, cells, reason: name.error });
      continue;
    }
    for (const col of columns) {
      const raw = cells[col.i] ?? "";
      const cell = readCell(raw);
      if (cell.kind === "excused") continue;
      if (cell.kind === "other") {
        skipped.push({ line, cells: [col.assignment, raw], reason: "not a score" });
        continue;
      }
      const scored = cell.kind === "score" ? resolve(cell, col.max) : { score: null, maxScore: col.max };
      entries.push({ line, ...name, assignment: col.assignment, category: null, ...scored, dueDate: col.dueDate, position: col.position });
    }
  }
  return { shape: "wide", entries, skipped, guessedMax };
}

// ---- Entry point -----------------------------------------------------------------------

export function parseGradebook(grid: Grid): ParsedGradebook {
  const long = findLong(grid);
  if (long) return readLong(grid, long);
  const wide = findWide(grid);
  if (wide) return readWide(grid, wide);
  return { shape: "none", entries: [], skipped: [], guessedMax: [] };
}

// ---- Categories ------------------------------------------------------------------------

// What an assignment title says about its kind. The default set is the categories when the
// class has no syllabus; OTHER is where titles the rules and the model cannot place go.
export const defaultCategories = ["homework", "quiz", "test", "project", "classwork"];
export const OTHER = "other";
const KIND_RULES: [string, RegExp][] = [
  ["homework", /\b(hw|homework|home ?work)\b/],
  ["quiz", /\bquiz/],
  ["test", /\b(test|exam|midterm|final)\b/],
  ["project", /\bproject/],
  ["classwork", /\b(classwork|class ?work|participation|warm.?ups?|exit tickets?|do now)\b/],
];
const kindOf = (title: string) => KIND_RULES.find(([, re]) => re.test(title.toLowerCase()))?.[0] ?? null;

// "Quizzes" → "quizze" is wrong, but the kind rule catches it first; this is for the
// syllabus's own words ("Essays", "Labs", "Formative assessments") against a title.
const stem = (w: string) => w.replace(/ies$/, "y").replace(/(?<!s)s$/, "");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The category an assignment belongs to, or null when its title does not say. With a
// syllabus, the answer is one of its category names, spelt as the syllabus spells it, so
// the weights line up: by the kind the rules read from the name ("Quiz 3" → "Quizzes"),
// else by a word of the category appearing in the title ("Formative 2" → "Formative tasks").
export function categorise(assignment: string, syllabus: string[] | null): string | null {
  const kind = kindOf(assignment);
  if (!syllabus) return kind;
  if (kind) {
    const byKind = syllabus.find((c) => kindOf(c) === kind);
    if (byKind) return byKind;
  }
  const title = assignment.toLowerCase();
  return (
    syllabus.find((c) =>
      c
        .toLowerCase()
        .split(/[^\p{L}]+/u)
        .filter((w) => w.length >= 4)
        .some((w) => new RegExp(`\\b${escape(stem(w))}`).test(title)),
    ) ?? null
  );
}

// ---- Students --------------------------------------------------------------------------

export type MatchedEntry = ParsedEntry & { studentId: string };

// Rows matched to the class roster on first and last name, then on an alias and last name;
// students who have left still match (the scores are theirs). The grade book never adds a
// student: an unmatched name is reported once per line.
export function matchStudents(entries: ParsedEntry[], roster: RosterEntry[]): { matched: MatchedEntry[]; skipped: SkippedRow[] } {
  const ids = new Map<string, string>();
  const claim = (key: string, id: string) => {
    if (!ids.has(key)) ids.set(key, id);
  };
  for (const s of roster) claim(nameKey(s), s.id);
  for (const s of roster) for (const alias of s.aliases) claim(nameKey({ firstName: alias, lastName: s.lastName }), s.id);
  const matched: MatchedEntry[] = [];
  const skipped: SkippedRow[] = [];
  const reported = new Set<number>();
  for (const e of entries) {
    const studentId = ids.get(nameKey(e));
    if (studentId) {
      matched.push({ ...e, studentId });
    } else if (!reported.has(e.line)) {
      reported.add(e.line);
      skipped.push({ line: e.line, cells: [e.firstName, e.lastName], reason: "not on the roster" });
    }
  }
  return { matched, skipped };
}
