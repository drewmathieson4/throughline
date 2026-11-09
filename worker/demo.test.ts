import { describe, expect, test } from "vitest";
import type { NoteWithTags, Synthesis, SynthesisRosterRow, SynthesisView } from "./api-types";
import type { ClassRow, Student, User } from "./db/schema";
import { DEMO_LIMITS, refund, reserve, shiftDates, shiftFor, template as bundled } from "./demo";
import { daysBetween, shiftDay, todayUtc } from "./evidence";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import { TEMPLATE_QUERIES } from "../scripts/demo/template-sql.ts";
import { CLASS_C_ID, DEV_USER_ID, MENTION_ID, NOTE_ID, PERIOD_3_COUNT, SEED_CLASS_ID as CLASS_ID, STUDENT, setupTestDb } from "./test-db";

const db = setupTestDb();
const RANGE = { from: "2026-09-01", to: "2027-06-15" };
const MATERIAL_ID = "55555555-5555-4555-8555-555555555501";
const GRADE_ID = (n: number) => `66666666-6666-4666-8666-6666666666${String(n).padStart(2, "0")}`;
const SYNTHESIS_ID = (n: number) => `77777777-7777-4777-8777-7777777777${String(n).padStart(2, "0")}`;
const at = (day: string) => `${day}T15:00:00.000Z`;
const count = async (sql: string, ...binds: unknown[]) => (await db.env.DB.prepare(sql).bind(...binds).first<{ n: number }>())!.n;

// A saved summary whose one point cites `noteId`.
const summary = (noteId: string): Synthesis => ({
  overview: "Steady term.",
  highlights: [],
  strengths: [{ point: "Leads discussion", evidence: [{ type: "note", noteId, notedAt: at("2026-09-11"), kind: "text", sourceName: null, quotes: ["note 02"] }] }],
  growth: [],
  change: [],
  goals: [],
  gaps: [],
  coverage: { label: "very_thin", notes: 1, bySource: { text: 1 }, lastNotedAt: at("2026-09-11"), daysSinceLastNote: 0, longestSilenceDays: 10, emptyMonths: [], grades: 1, missing: 0, undatedGrades: true },
  grades: null,
});

// A template owner's rows for the snapshot's SQL to choose from. Each note's number says what
// it is for. (The clone itself reads the bundled file, not these.)
function template() {
  return db.env.DB.batch([
    db.insertNote(NOTE_ID(1), CLASS_ID, at("2026-09-10")), // Period 3, class-level: copied
    db.insertNote(NOTE_ID(2), CLASS_ID, at("2026-09-11")), // Period 3, Rowan: copied
    db.tagNote(NOTE_ID(2), STUDENT.rowan),
    db.insertNote(NOTE_ID(3), CLASS_ID, at("2026-09-12")), // Period 3, Avery only: left out
    db.tagNote(NOTE_ID(3), STUDENT.avery),
    db.insertNote(NOTE_ID(4), CLASS_ID, at("2026-09-13")), // Period 3, Rowan and Avery: copied with one tag
    db.tagNote(NOTE_ID(4), STUDENT.rowan),
    db.tagNote(NOTE_ID(4), STUDENT.avery),
    db.insertNote(NOTE_ID(5), null, at("2026-09-14")), // unassigned, "Alex" could be either: copied with both candidates
    db.mentionNote(MENTION_ID(1), NOTE_ID(5), [STUDENT.alexMarsh, STUDENT.alexRuiz]),
    db.insertNote(NOTE_ID(6), null, at("2026-09-15")), // unassigned, Rowan and Theo across classes: copied, still unassigned
    db.tagNote(NOTE_ID(6), STUDENT.rowan),
    db.tagNote(NOTE_ID(6), STUDENT.theo),
    db.insertNote(NOTE_ID(7), null, at("2026-09-16")), // unassigned, Ember only: copied into Period 3
    db.tagNote(NOTE_ID(7), STUDENT.ember),
    db.insertNote(NOTE_ID(8), null, at("2026-09-17")), // unassigned, Juniper only: left out
    db.tagNote(NOTE_ID(8), STUDENT.juniper),
    db.insertNote(NOTE_ID(9), CLASS_C_ID, at("2026-09-18")), // Period 5, class-level: left out
    db.insertMaterial(MATERIAL_ID, CLASS_ID, [{ category: "Homework", weight: 100 }]),
    db.insertGrade(GRADE_ID(1), STUDENT.rowan, "Quiz 1", 8, 1),
    db.insertGrade(GRADE_ID(2), STUDENT.avery, "Quiz 1", 9, 1),
    db.insertSynthesis(SYNTHESIS_ID(1), STUDENT.rowan, RANGE, summary(NOTE_ID(2))), // newest for Rowan: copied
    db.insertSynthesis(SYNTHESIS_ID(2), STUDENT.rowan, RANGE, summary(NOTE_ID(2)), "older", "2026-10-01T00:00:00.000Z"), // an earlier run: left out
    db.insertSynthesis(SYNTHESIS_ID(3), STUDENT.avery, RANGE, summary(NOTE_ID(3))), // Avery's: left out
  ]);
}

const names = (students: Student[]) => students.map((s) => s.firstName).sort();

test("a visitor gets their own two classes of four, invisible to the template's owner and vice versa", async () => {
  const demo = await db.startDemo();
  const classes = await demo.json<ClassRow[]>("/api/classes");
  expect(classes.map((c) => c.name)).toEqual(["Period 3 Humanities", "B Block Humanities"]);
  expect(classes.map((c) => c.id)).not.toContain(CLASS_ID);
  expect(classes.every((c) => c.ownerId === demo.userId)).toBe(true);
  const [p3, bb] = classes;
  expect(names(await demo.json<Student[]>(`/api/students?classId=${p3!.id}`))).toEqual(["Alex", "Ember", "Marlowe", "Rowan"]);
  expect(names(await demo.json<Student[]>(`/api/students?classId=${bb!.id}`))).toEqual(["Alex", "Imogen", "Ronan", "Theo"]);
  expect((await demo.json<Student[]>(`/api/students?classId=${p3!.id}`)).map((s) => s.id)).not.toContain(STUDENT.rowan);

  expect((await demo.request(`/api/students?classId=${CLASS_ID}`)).status).toBe(404);
  expect((await db.request(`/api/students?classId=${p3!.id}`)).status).toBe(404);
  expect((await db.json<ClassRow[]>("/api/classes")).map((c) => c.id)).not.toContain(p3!.id);
  expect(await db.json<Student[]>(`/api/students?classId=${CLASS_ID}`)).toHaveLength(PERIOD_3_COUNT);
});

test("the snapshot takes the class-level notes and those about kept students, tags to kept students, and the newest summary per student", async () => {
  await template();
  const rows = async <T>(sql: string) => (await db.env.DB.prepare(sql).all<T>()).results;
  expect((await rows<{ body: string }>(TEMPLATE_QUERIES.notes)).map((n) => n.body).sort()).toEqual(["note 01", "note 02", "note 04", "note 05", "note 06", "note 07"]);
  const tags = await rows<{ note_id: string; student_id: string }>(TEMPLATE_QUERIES.tags);
  expect(tags.filter((t) => t.note_id === NOTE_ID(4)).map((t) => t.student_id)).toEqual([STUDENT.rowan]);
  expect(tags.some((t) => t.student_id === STUDENT.avery || t.student_id === STUDENT.juniper)).toBe(false);
  expect(tags.filter((t) => t.note_id === NOTE_ID(6)).map((t) => t.student_id).sort()).toEqual([STUDENT.rowan, STUDENT.theo].sort());
  expect((await rows<{ id: string }>(TEMPLATE_QUERIES.mentions)).map((m) => m.id)).toEqual([MENTION_ID(1)]);
  expect((await rows<{ id: string }>(TEMPLATE_QUERIES.syntheses)).map((r) => r.id)).toEqual([SYNTHESIS_ID(1)]);
  expect((await rows<{ id: string }>(TEMPLATE_QUERIES.grades)).map((r) => r.id)).toEqual([GRADE_ID(1)]);
  expect(await rows(TEMPLATE_QUERIES.materials)).toHaveLength(1);
  expect((await rows<{ id: string }>(TEMPLATE_QUERIES.classes)).map((c) => c.id)).toEqual(["11111111-1111-4111-8111-111111111111", "11111111-1111-4111-8111-111111112222"]);
  expect(await rows(TEMPLATE_QUERIES.students)).toHaveLength(8);
});

test("a copy is the bundled template moved to the week before today, weekdays kept, summaries current and citing copied notes, the same for every visitor", async () => {
  const demo = await db.startDemo();
  const notes = await demo.json<NoteWithTags[]>("/api/notes"); // newest first
  expect(notes).toHaveLength(bundled.notes.length);
  const today = todayUtc();
  const age = daysBetween(notes[0]!.notedAt.slice(0, 10), today);
  expect(age).toBeGreaterThanOrEqual(1);
  expect(age).toBeLessThanOrEqual(7);
  const weekdays = (rows: { notedAt: string }[]) => rows.map((n) => new Date(n.notedAt).getUTCDay()).sort();
  expect(weekdays(notes)).toEqual(weekdays(bundled.notes));
  for (const n of notes) {
    expect(n.ownerId).toBe(demo.userId);
    expect(n.clientId).toBeNull();
  }
  expect(bundled.notes.map((n) => n.id)).not.toContain(notes[0]!.id);
  // Nothing was read from or written to anyone else's rows.
  expect(await count("SELECT count(*) AS n FROM notes WHERE owner_id = ?", DEV_USER_ID)).toBe(0);

  // Every summary in the template reads as current for its (moved) period, and its citations
  // name the copied notes.
  const days = shiftFor(bundled.notes.map((n) => n.notedAt.slice(0, 10)).sort().at(-1)!, today);
  const classes = await demo.json<ClassRow[]>("/api/classes");
  const classIdByName = new Map(classes.map((c) => [c.name, c.id]));
  const templateClassName = new Map(bundled.classes.map((c) => [c.id, c.name]));
  const noteIds = new Set(notes.map((n) => n.id));
  expect(bundled.syntheses.length).toBeGreaterThan(0);
  for (const saved of bundled.syntheses) {
    const student = bundled.students.find((st) => st.id === saved.studentId)!;
    const classId = classIdByName.get(templateClassName.get(student.classId)!)!;
    const range = { from: shiftDay(saved.periodStart, days), to: shiftDay(saved.periodEnd, days) };
    const roster = await demo.json<SynthesisRosterRow[]>(`/api/syntheses?${new URLSearchParams({ classId, ...range })}`);
    const row = roster.find((r) => r.firstName === student.firstName && r.lastName === student.lastName)!;
    expect(row.status).toBe("current");
    const view = await demo.json<SynthesisView>(`/api/syntheses/${row.synthesisId}`);
    const cited = [...view.json.highlights, ...view.json.strengths, ...view.json.growth, ...view.json.change, ...view.json.goals].flatMap((p) => p.evidence);
    for (const c of cited) if (c.type === "note") expect(noteIds.has(c.noteId)).toBe(true);
    expect(view.periodStart).toBe(range.from);
  }
  expect(classes.every((c) => c.termEnd! >= today)).toBe(true);

  // A second visitor gets exactly the same notes.
  const other = await db.startDemo();
  const bodies = (rows: { body: string }[]) => rows.map((n) => n.body).sort();
  expect(bodies(await other.json<NoteWithTags[]>("/api/notes"))).toEqual(bodies(notes));
});

test("starting a demo removes visitors whose sessions have all expired, and nothing else", async () => {
  await template();
  const gone = await db.startDemo();
  const out = await db.startDemo();
  const kept = await db.startDemo();
  const [goneClass] = await gone.json<ClassRow[]>("/api/classes");
  await db.env.DB.prepare("UPDATE sessions SET expires_at = '2026-01-01T00:00:00.000Z' WHERE user_id = ?").bind(gone.userId).run();
  expect((await out.request("/api/auth/signout", { method: "POST" })).status).toBe(200);

  await db.startDemo();
  const users = (await db.env.DB.prepare("SELECT id FROM users").all<{ id: string }>()).results.map((r) => r.id);
  expect(users).not.toContain(gone.userId);
  expect(users).not.toContain(out.userId);
  expect(users).toContain(kept.userId);
  expect(users).toContain(DEV_USER_ID);
  expect(await db.env.DB.prepare("SELECT id FROM classes WHERE id = ?").bind(goneClass!.id).first()).toBeNull();
  expect(await count("SELECT count(*) AS n FROM notes WHERE owner_id = ?", gone.userId)).toBe(0);
  expect(await count("SELECT count(*) AS n FROM sessions WHERE user_id = ?", gone.userId)).toBe(0);
  expect(await count("SELECT count(*) AS n FROM notes WHERE owner_id = ?", DEV_USER_ID)).toBe(9);
  expect(await db.json<ClassRow[]>("/api/classes")).toHaveLength(3);
  expect((await kept.request("/api/auth/me")).status).toBe(200);
});

test("reserve lets exactly one of two requests at the limit through, refund gives it back, and a teacher is never counted", async () => {
  const demo = await db.startDemo();
  const client = drizzle(db.env.DB, { schema });
  const visitor = { id: demo.userId, demo: 1 } as User;
  await db.setUsed(demo.userId, { reports: DEMO_LIMITS.reports - 1 });
  const results = await Promise.allSettled([reserve(client, visitor, "reports"), reserve(client, visitor, "reports")]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await count("SELECT demo_reports_used AS n FROM users WHERE id = ?", demo.userId)).toBe(DEMO_LIMITS.reports);
  await refund(client, visitor, "reports");
  await expect(reserve(client, visitor, "reports")).resolves.toBeUndefined();
  await expect(reserve(client, visitor, "reports")).rejects.toMatchObject({ status: 403 });

  const teacher = { id: DEV_USER_ID, demo: 0 } as User;
  await reserve(client, teacher, "notes", 1000);
  expect(await count("SELECT demo_notes_used AS n FROM users WHERE id = ?", DEV_USER_ID)).toBe(0);
});

describe("shiftFor", () => {
  test("moves the newest note into the week before today by whole weeks, never backwards", () => {
    // Newest Wednesday 2026-10-21; today Monday 2026-11-09: 19 days to yesterday, so two weeks.
    expect(shiftFor("2026-10-21", "2026-11-09")).toBe(14);
    expect(shiftFor("2026-10-21", "2026-10-29")).toBe(7);
    expect(shiftFor("2026-10-21", "2026-10-22")).toBe(0);
    expect(shiftFor("2026-10-21", "2026-10-21")).toBe(0);
    expect(shiftFor("2026-10-21", "2025-01-01")).toBe(0);
  });

  test("lands the newest note 1–7 days ago whatever the day", () => {
    const DAY = 86_400_000;
    for (let i = 0; i < 400; i++) {
      const today = new Date(Date.UTC(2026, 10, 9) + i * DAY).toISOString().slice(0, 10);
      const days = shiftFor("2026-10-21", today);
      const age = Math.round((Date.parse(today) - (Date.UTC(2026, 9, 21) + days * DAY)) / DAY);
      expect(days % 7).toBe(0);
      expect(age).toBeGreaterThanOrEqual(1);
      expect(age).toBeLessThanOrEqual(7);
    }
  });
});

test("shiftDates moves the dated fields inside a summary and nothing else", () => {
  const json = {
    overview: "On 14 October Rowan led the seminar.",
    highlights: [{ title: "Seminar", story: "…", evidence: [{ type: "note", noteId: "n1", notedAt: "2026-10-14T15:30:00.000Z", kind: "text", sourceName: null, quotes: ["led"] }] }],
    grades: { entries: [{ assignment: "Map", dueDate: "2026-09-10" }, { assignment: "Quiz", dueDate: null }] },
    coverage: { lastNotedAt: "2026-10-14T15:30:00.000Z", daysSinceLastNote: 3 },
  };
  expect(shiftDates(json, 14)).toEqual({
    overview: "On 14 October Rowan led the seminar.",
    highlights: [{ title: "Seminar", story: "…", evidence: [{ type: "note", noteId: "n1", notedAt: "2026-10-28T15:30:00.000Z", kind: "text", sourceName: null, quotes: ["led"] }] }],
    grades: { entries: [{ assignment: "Map", dueDate: "2026-09-24" }, { assignment: "Quiz", dueDate: null }] },
    coverage: { lastNotedAt: "2026-10-28T15:30:00.000Z", daysSinceLastNote: 3 },
  });
});

test("the bundled template is two classes of four, with tags and summaries only for them", () => {
  expect(bundled.classes).toHaveLength(2);
  expect(bundled.students).toHaveLength(8);
  const studentIds = new Set(bundled.students.map((s) => s.id));
  expect(bundled.tags.every((t) => studentIds.has(t.studentId))).toBe(true);
  expect(bundled.grades.every((g) => studentIds.has(g.studentId))).toBe(true);
  expect(bundled.syntheses.every((s) => studentIds.has(s.studentId))).toBe(true);
  const noteIds = new Set(bundled.notes.map((n) => n.id));
  expect(bundled.tags.every((t) => noteIds.has(t.noteId))).toBe(true);
});
