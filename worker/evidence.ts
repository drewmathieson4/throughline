// One student's evidence for a date range, shaped for the synthesis (worker/synthesis-model.ts):
// the passages of notes about them, their grades with the computed summary, the course's
// goals, the class-level notes that explain them, and counts of how much there is to go on.
//
// loadEvidence reads a whole class in one batch (the Reports tab needs every student, and a
// single student's class means need the classmates anyway); buildEvidence is pure, so the
// unit tests need no database. Each piece of evidence gets a short id (N1, G1, GRADES) that
// the model cites and that maps back to a copy of what it cites.
import { and, asc, desc, eq, gte, inArray, lt, notExists } from "drizzle-orm";
import * as schema from "./db/schema";
import type { CourseSummary, GradeEntry, Note, NoteKind, SynthesisRow } from "./db/schema";
import type { Db } from "./db/client";
import type { Citation, Coverage, GradeSummary } from "./api-types";
import { summarise } from "./grades";
import { gradingWeights, selectMaterialSummaries } from "./materials";
import { wrapData } from "./model";

export type Range = { from: string; to: string }; // YYYY-MM-DD, both inclusive

export type EvidenceNote = Pick<Note, "id" | "kind" | "sourceName" | "notedAt" | "createdAt"> & { quotes: string[] };
export type ContextNote = Pick<Note, "id" | "notedAt" | "body">;
export type EvidenceRows = {
  student: { firstName: string; lastName: string };
  className: string;
  range: Range;
  notes: EvidenceNote[]; // tagged to the student, noted in the range, oldest first
  grades: GradeEntry[]; // the student's entries, any date (filtered here)
  classGrades: GradeEntry[]; // every classmate's entries, for the class means
  materials: { summary: CourseSummary | null }[]; // newest first
  context: ContextNote[]; // class-level notes in the range, oldest first
};

export type Evidence = {
  citations: Map<string, Citation>; // N1…, G1…, GRADES
  goals: Map<string, string>; // GOAL1… → the goal as the syllabus words it
  grades: GradeSummary | null;
  coverage: Coverage;
  message: string; // what the model reads
  key: string; // everything the model reads but today's date, hashed into input_hash
  empty: boolean; // no notes and no grades: nothing to summarise
};

// Class notes are context, not evidence: the newest few, each cut short, are enough to say
// "the whole class found this unit hard".
const MAX_CONTEXT_NOTES = 30;
const MAX_CONTEXT_CHARS = 2000;
const MAX_COURSE_ITEMS = 30;

// Coverage labels. Very thin: under 3 notes, or nothing in the last month of the range. Thin:
// under 6 notes, or a month-long silence somewhere in it.
const VERY_THIN_NOTES = 3;
const THIN_NOTES = 6;
const QUIET_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (iso: string) => iso.slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
export const dayAfter = (day: string) => new Date(Date.parse(day) + DAY_MS).toISOString().slice(0, 10);
const inRange = (day: string, r: Range) => day >= r.from && day <= r.to;
// Undated grades (wide grade-book exports rarely carry dates) belong to every range.
const gradeInRange = (e: GradeEntry, r: Range) => e.dueDate === null || inRange(e.dueDate, r);

// Map.groupBy, which the worker's lib setting predates.
function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

const round = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => `${Math.round(n)}%`;

const KIND_LABEL: Record<NoteKind, string> = { text: "typed note", voice: "voice note", student_form: "student form", progress_report: "progress report" };

// Every list in the course summaries, merged across materials and de-duplicated.
function merged(materials: { summary: CourseSummary | null }[], pick: (s: CourseSummary) => string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of materials) {
    for (const item of m.summary ? pick(m.summary) : []) {
      const k = item.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(item.trim());
    }
  }
  return out.slice(0, MAX_COURSE_ITEMS);
}

// How much the summary rests on. end is the last day there can be evidence for: the end of
// the range, or today when the range runs on into the future.
export function coverageOf(notes: EvidenceNote[], grades: GradeSummary | null, undatedGrades: boolean, range: Range, today: string): Coverage {
  const end = range.to < today ? range.to : today;
  const days = [...new Set(notes.map((n) => dayOf(n.notedAt)))].sort();
  const marks = [range.from, ...days, end];
  let longestSilenceDays = 0;
  for (let i = 1; i < marks.length; i++) longestSilenceDays = Math.max(longestSilenceDays, daysBetween(marks[i - 1]!, marks[i]!));

  const months: string[] = [];
  for (let m = range.from.slice(0, 7); m <= end.slice(0, 7); ) {
    months.push(m);
    const [y, mo] = m.split("-").map(Number) as [number, number];
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  const noted = new Set(days.map((d) => d.slice(0, 7)));

  const bySource: Partial<Record<NoteKind, number>> = {};
  for (const n of notes) bySource[n.kind] = (bySource[n.kind] ?? 0) + 1;
  const last = notes.length > 0 ? notes[notes.length - 1]!.notedAt : null;
  const daysSinceLastNote = last ? Math.max(0, daysBetween(dayOf(last), end)) : null;

  const label =
    notes.length < VERY_THIN_NOTES || daysSinceLastNote === null || daysSinceLastNote > QUIET_DAYS
      ? "very_thin"
      : notes.length < THIN_NOTES || longestSilenceDays > QUIET_DAYS
        ? "thin"
        : "well_supported";
  return {
    label,
    notes: notes.length,
    bySource,
    lastNotedAt: last,
    daysSinceLastNote,
    longestSilenceDays: Math.max(0, longestSilenceDays),
    emptyMonths: months.filter((m) => !noted.has(m)),
    grades: grades?.count ?? 0,
    missing: grades?.missing ?? 0,
    undatedGrades,
  };
}

function coverageLines(c: Coverage, name: string): string {
  const sources = Object.entries(c.bySource).map(([k, n]) => `${n} ${KIND_LABEL[k as NoteKind]}${n === 1 ? "" : "s"}`);
  return [
    `- ${c.notes} ${c.notes === 1 ? "note" : "notes"} about ${name}${sources.length ? ` (${sources.join(", ")})` : ""}` +
      (c.lastNotedAt ? `; the last on ${dayOf(c.lastNotedAt)}, ${c.daysSinceLastNote} days before the end of the evidence window` : ""),
    `- longest stretch with no note: ${c.longestSilenceDays} days; months with no note: ${c.emptyMonths.length ? c.emptyMonths.join(", ") : "none"}`,
    `- ${c.grades} scored ${c.grades === 1 ? "grade" : "grades"}, ${c.missing} missing${c.undatedGrades ? "; some grades have no due date and count in any period" : ""}`,
    `- overall: ${c.label.replace("_", " ")}`,
  ].join("\n");
}

function gradeSummaryLines(g: GradeSummary): string {
  const lines = [`- overall ${pct(g.overall)}, ${g.weighted ? "weighted as the syllabus says" : "a plain mean of the scores"}; ${g.count} scored, ${g.missing} missing`];
  lines.push(
    `- by category: ${g.byCategory
      .map((c) => `${c.category} ${c.mean === null ? "no scores" : pct(c.mean)}${c.weight !== null ? ` (weight ${c.weight}%)` : ""}, ${c.count} scored${c.missing ? `, ${c.missing} missing` : ""}`)
      .join("; ")}`,
  );
  if (g.trend) lines.push(`- trend: ${g.trend.label}, ${pct(g.trend.from)} over the first half of the scores to ${pct(g.trend.to)} over the second`);
  for (const [label, s] of [["biggest win", g.biggestWin], ["biggest loss", g.biggestLoss]] as const) {
    if (s) lines.push(`- ${label}: ${s.assignment} ${pct(s.pct)}${s.classMean !== null ? ` (class mean ${pct(s.classMean)})` : ""}`);
  }
  return lines.join("\n");
}

export function buildEvidence(rows: EvidenceRows, today: string): Evidence {
  const { student, range } = rows;
  const name = student.firstName;
  const citations = new Map<string, Citation>();

  rows.notes.forEach((n, i) =>
    citations.set(`N${i + 1}`, { type: "note", noteId: n.id, notedAt: n.notedAt, kind: n.kind, sourceName: n.sourceName, quotes: n.quotes }),
  );

  const own = rows.grades.filter((e) => gradeInRange(e, range));
  const classEntries = rows.classGrades.filter((e) => gradeInRange(e, range));
  const grades = summarise(own, classEntries, gradingWeights(rows.materials) ?? []);
  const classMean = new Map<string, number>();
  const scored = classEntries.filter((e) => e.score !== null && e.maxScore > 0);
  for (const [assignment, entries] of groupBy(scored, (e) => e.assignment)) {
    classMean.set(assignment, round(entries.reduce((sum, e) => sum + (e.score! / e.maxScore) * 100, 0) / entries.length));
  }
  grades?.entries.forEach((e, i) => citations.set(`G${i + 1}`, { type: "grade", ...e, classMean: classMean.get(e.assignment) ?? null }));
  if (grades) citations.set("GRADES", { type: "grades" });

  const goalList = merged(rows.materials, (s) => s.goals);
  const goals = new Map(goalList.map((g, i) => [`GOAL${i + 1}`, g]));
  const units = merged(rows.materials, (s) => s.units.map((u) => (u.when ? `${u.name} (${u.when})` : u.name)));
  const policies = merged(rows.materials, (s) => s.policies);

  const coverage = coverageOf(rows.notes, grades, own.some((e) => e.dueDate === null), range, today);

  // The parts of the message that do not depend on today. Their JSON is the cache key.
  const keyed = {
    student: `${student.firstName} ${student.lastName}`,
    className: rows.className,
    range,
    notes: rows.notes.map((n) => [n.id, n.notedAt, n.kind, n.sourceName, n.quotes]),
    grades: [...citations.entries()].filter(([, c]) => c.type === "grade"),
    gradeSummary: grades && { ...grades, entries: undefined },
    goals: goalList,
    units,
    policies,
    context: rows.context.map((c) => [c.id, c.notedAt, c.body]),
  };

  const sections = [
    `Student: ${keyed.student} (${rows.className})\nPeriod: ${range.from} to ${range.to}. Today is ${today}; nothing after today has happened yet.`,
    `How much evidence there is (counted, not estimated):\n${coverageLines(coverage, name)}`,
    goals.size > 0
      ? `Course goals (rate each by its id):\n${[...goals].map(([id, g]) => `${id}. ${g}`).join("\n")}`
      : "No course material states goals for this class; return no goals.",
  ];
  if (units.length) sections.push(`Units, in order: ${units.join("; ")}`);
  if (policies.length) sections.push(`Course policies:\n${policies.map((p) => `- ${p}`).join("\n")}`);
  if (grades) {
    const gradeLines = [...citations]
      .flatMap(([id, c]) => (c.type === "grade" ? [{ id, c }] : []))
      .map(
        ({ id, c }) =>
          `${id}. ${c.dueDate ?? "no due date"} · ${c.assignment}${c.category ? ` · ${c.category}` : ""} · ` +
          (c.score === null ? "missing" : `${c.score}/${c.maxScore} = ${pct(c.pct ?? 0)}`) +
          (c.classMean !== null ? ` · class mean ${pct(c.classMean)}` : ""),
      );
    sections.push(
      `Grade summary (cite as GRADES; these numbers are computed, quote them rather than working out new ones):\n${gradeSummaryLines(grades)}`,
      `Grades (cite by id):\n${gradeLines.join("\n")}`,
    );
  } else {
    sections.push("No grades in this period.");
  }
  if (rows.notes.length > 0) {
    const notes = rows.notes.map(
      (n, i) => `N${i + 1}. ${dayOf(n.notedAt)} · ${KIND_LABEL[n.kind]}${n.sourceName ? ` (${n.sourceName})` : ""}\n${n.quotes.map((q) => `- "${q}"`).join("\n")}`,
    );
    sections.push(`Notes about ${name} (cite by id; only the passages about ${name} are shown):\n${wrapData("evidence", notes.join("\n\n"))}`);
  } else {
    sections.push(`No notes about ${name} in this period.`);
  }
  if (rows.context.length > 0) {
    const context = rows.context.map((c, i) => `C${i + 1}. ${dayOf(c.notedAt)}\n${c.body.slice(0, MAX_CONTEXT_CHARS)}`);
    sections.push(
      `Class context: notes about the whole class in this period. Use them to read ${name}'s evidence fairly; never cite them:\n${wrapData("context", context.join("\n\n"))}`,
    );
  }

  return {
    citations,
    goals,
    grades,
    coverage,
    message: sections.join("\n\n"),
    key: JSON.stringify(keyed),
    empty: rows.notes.length === 0 && own.length === 0,
  };
}

// Everything the Reports tab and the synthesis route read about one class for one range, in
// one batch: the class, its students, the notes tagged to them, the class-level notes, every
// grade, the course summaries, and the saved summaries for exactly this range.
export async function loadEvidence(db: Db, classId: string, range: Range) {
  const s = schema.students;
  const n = schema.notes;
  const ns = schema.noteStudents;
  const g = schema.gradeEntries;
  const syn = schema.syntheses;
  const classmates = db.select({ id: s.id }).from(s).where(eq(s.classId, classId));
  // noted_at is a full timestamp; comparing it with day strings keeps the whole last day.
  const noted = and(gte(n.notedAt, range.from), lt(n.notedAt, dayAfter(range.to)));
  const [[cls], students, tagged, context, grades, materials, saved] = await db.batch([
    db.select({ name: schema.classes.name }).from(schema.classes).where(eq(schema.classes.id, classId)),
    db.select({ id: s.id, firstName: s.firstName, lastName: s.lastName, leftAt: s.leftAt }).from(s).where(eq(s.classId, classId)),
    db
      .select({ studentId: ns.studentId, quotes: ns.quotes, id: n.id, kind: n.kind, sourceName: n.sourceName, notedAt: n.notedAt, createdAt: n.createdAt })
      .from(ns)
      .innerJoin(n, eq(n.id, ns.noteId))
      .where(and(inArray(ns.studentId, classmates), noted))
      .orderBy(asc(n.notedAt), asc(n.createdAt)),
    db
      .select({ id: n.id, notedAt: n.notedAt, body: n.body })
      .from(n)
      .where(and(eq(n.classId, classId), noted, notExists(db.select({ one: ns.noteId }).from(ns).where(eq(ns.noteId, n.id)))))
      .orderBy(desc(n.notedAt))
      .limit(MAX_CONTEXT_NOTES),
    db.select().from(g).where(inArray(g.studentId, classmates)).orderBy(asc(g.position)),
    selectMaterialSummaries(db, classId),
    db
      .select()
      .from(syn)
      .where(and(inArray(syn.studentId, classmates), eq(syn.periodStart, range.from), eq(syn.periodEnd, range.to)))
      .orderBy(desc(syn.createdAt)),
  ]);

  const notesByStudent = groupBy(tagged, (t) => t.studentId);
  const latest = new Map<string, SynthesisRow>();
  for (const row of saved) if (!latest.has(row.studentId)) latest.set(row.studentId, row);
  context.reverse();

  return {
    className: cls?.name ?? null,
    students,
    // The newest summary of this student for exactly this range, if any.
    latest: (studentId: string) => latest.get(studentId) ?? null,
    rowsFor: (student: (typeof students)[number]): EvidenceRows => ({
      student,
      className: cls?.name ?? "",
      range,
      notes: notesByStudent.get(student.id) ?? [],
      grades: grades.filter((e) => e.studentId === student.id),
      classGrades: grades,
      materials,
      context,
    }),
  };
}
