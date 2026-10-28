import { expect, test } from "vitest";
import type { NoteWithTags, StudentDetail, Synthesis, SynthesisRosterRow, SynthesisView } from "./api-types";
import type { ClassRow, Student, User } from "./db/schema";
import { DEMO_LIMITS, refund, reserve } from "./demo";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
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

// The template owner's rows the clone has to choose from. Each note's number says what it is for.
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

test("the copy takes the class-level notes and those about kept students, with new ids and tags only to kept students", async () => {
  await template();
  const demo = await db.startDemo();
  const [p3, bb] = await demo.json<ClassRow[]>("/api/classes");
  const roster = await demo.json<Student[]>(`/api/students?classId=${p3!.id}`);
  const idOf = (first: string) => roster.find((s) => s.firstName === first)!.id;
  const bbAlex = (await demo.json<Student[]>(`/api/students?classId=${bb!.id}`)).find((s) => s.firstName === "Alex")!.id;
  const notes = await demo.json<NoteWithTags[]>("/api/notes");
  const byBody = new Map(notes.map((n) => [n.body, n]));
  expect([...byBody.keys()].sort()).toEqual(["note 01", "note 02", "note 04", "note 05", "note 06", "note 07"]);

  expect(byBody.get("note 01")).toMatchObject({ classId: p3!.id, students: [], mentions: [] });
  expect(byBody.get("note 02")!.students).toEqual([{ studentId: idOf("Rowan"), quotes: [] }]);
  expect(byBody.get("note 04")!.students).toEqual([{ studentId: idOf("Rowan"), quotes: [] }]);
  expect(byBody.get("note 05")).toMatchObject({ classId: null, students: [] });
  expect(byBody.get("note 05")!.mentions[0]!.candidateIds.sort()).toEqual([idOf("Alex"), bbAlex].sort());
  expect(byBody.get("note 05")!.mentions[0]!.id).not.toBe(MENTION_ID(1));
  expect(byBody.get("note 06")!.classId).toBeNull();
  expect(byBody.get("note 06")!.students).toHaveLength(2);
  expect(byBody.get("note 07")).toMatchObject({ classId: p3!.id, students: [{ studentId: idOf("Ember"), quotes: [] }] });

  for (const n of notes) {
    expect(n.ownerId).toBe(demo.userId);
    expect(n.clientId).toBeNull();
    expect(n.id.startsWith("33333333")).toBe(false);
    expect(n.createdAt).toBe(n.notedAt); // kept as the template had it
  }
  // The template is as it was.
  expect(await count("SELECT count(*) AS n FROM notes WHERE owner_id = ?", DEV_USER_ID)).toBe(9);
  expect(await count("SELECT count(*) AS n FROM note_students WHERE note_id = ?", NOTE_ID(4))).toBe(2);
});

test("the copy's saved summary reads as current, cites the copied note, and comes with the grades and material", async () => {
  await template();
  const demo = await db.startDemo();
  const [p3] = await demo.json<ClassRow[]>("/api/classes");
  const roster = await demo.json<SynthesisRosterRow[]>(`/api/syntheses?${new URLSearchParams({ classId: p3!.id, ...RANGE })}`);
  const rowan = roster.find((r) => r.firstName === "Rowan")!;
  expect(rowan.status).toBe("current");
  expect(roster.filter((r) => r.firstName !== "Rowan").every((r) => r.status === "empty" || r.status === "none")).toBe(true);
  expect(await count("SELECT count(*) AS n FROM syntheses WHERE student_id = ?", rowan.studentId)).toBe(1);

  const saved = await demo.json<SynthesisView>(`/api/syntheses/${rowan.synthesisId}`);
  const note02 = (await demo.json<NoteWithTags[]>("/api/notes")).find((n) => n.body === "note 02")!;
  expect(saved.json.strengths[0]!.evidence[0]).toMatchObject({ type: "note", noteId: note02.id });
  expect(saved.createdAt).toBe("2026-10-20T00:00:00.000Z");

  const detail = await demo.json<StudentDetail>(`/api/students/${rowan.studentId}`);
  expect(detail.grades?.count).toBe(1);
  expect(await demo.json<unknown[]>(`/api/materials?classId=${p3!.id}`)).toHaveLength(1);
  expect(await count("SELECT count(*) AS n FROM syntheses")).toBe(4);
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
