import { beforeEach, expect, test, vi } from "vitest";
import app from "../index";
import type { GradeImportResult, StudentDetail } from "../api-types";
import { categoriseAssignments } from "../gradebook-model";
import { CLASS_B_ID, SEED_CLASS_ID, STUDENT, UNKNOWN_ID, jsonInit, quietErrors, setupTestDb } from "../test-db";

// The category fallback is mocked: no network, and each test says what it answers.
vi.mock(import("../gradebook-model"), async (importOriginal) => ({ ...(await importOriginal()), categoriseAssignments: vi.fn() }));
const categoriseMock = vi.mocked(categoriseAssignments);
beforeEach(() => categoriseMock.mockReset());

const db = setupTestDb();
const keyed = (): Env => ({ ...db.env, ANTHROPIC_API_KEY: "test-key" });
const MATERIAL_ID = (n: number) => `55555555-5555-4555-8555-5555555555${String(n).padStart(2, "0")}`;

const importGrid = (grid: string[][], opts: { classId?: string; env?: Env } = {}) =>
  app.request("/api/grades/import", jsonInit("POST", { classId: opts.classId ?? SEED_CLASS_ID, grid }), opts.env ?? db.env);
const importJson = async (grid: string[][], opts: { classId?: string; env?: Env } = {}) => (await importGrid(grid, opts)).json() as Promise<GradeImportResult>;
const rows = () =>
  db.env.DB.prepare("SELECT student_id, assignment, category, score, max_score, due_date, position FROM grade_entries ORDER BY student_id, position")
    .all<{ student_id: string; assignment: string; category: string | null; score: number | null; max_score: number; due_date: string | null; position: number }>()
    .then((r) => r.results);
const detail = (id: string) => db.json<StudentDetail>(`/api/students/${id}`);

const wide = [
  ["Last Name", "First Name", "Email Address", "Quiz 1", "Fertile Crescent Map", "Unit 1 Test"],
  ["", "Points", "", "20", "10", "40"],
  ["Quill", "Avery", "avery@example.test", "17", "9", "34"],
  ["Marsh", "Alex", "alex@example.test", "Missing", "6", "20"],
  ["Ruiz", "Alex", "", "15", "8", "30"], // B Block: not on this roster
];

test("POST /api/grades/import writes one row per student per assignment and reports what it skipped", async () => {
  const res = await importGrid(wide);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    shape: "wide",
    students: 2,
    assignments: 3,
    entries: 6,
    missing: 1,
    skipped: [{ line: 5, cells: ["Alex", "Ruiz"], reason: "not on the roster" }],
    guessedMax: [],
  } satisfies GradeImportResult);
  const stored = await rows();
  expect(stored.filter((r) => r.student_id === STUDENT.avery)).toEqual([
    { student_id: STUDENT.avery, assignment: "Quiz 1", category: "quiz", score: 17, max_score: 20, due_date: null, position: 0 },
    // No key: the title the rules cannot place is "other".
    { student_id: STUDENT.avery, assignment: "Fertile Crescent Map", category: "other", score: 9, max_score: 10, due_date: null, position: 1 },
    { student_id: STUDENT.avery, assignment: "Unit 1 Test", category: "test", score: 34, max_score: 40, due_date: null, position: 2 },
  ]);
  expect(stored.find((r) => r.student_id === STUDENT.alexMarsh && r.assignment === "Quiz 1")?.score).toBeNull();
  expect(categoriseMock).not.toHaveBeenCalled();
});

test("importing the same file twice changes nothing; a changed score is updated; entries missing from a later file stay", async () => {
  await importGrid(wide);
  const first = await rows();
  await importGrid(wide);
  expect(await rows()).toEqual(first);

  const corrected = [wide[0]!.slice(0, 4), wide[1]!.slice(0, 4), ["Quill", "Avery", "", "19"]];
  const r = await importJson(corrected);
  expect(r).toMatchObject({ students: 1, entries: 1 });
  const after = await rows();
  expect(after).toHaveLength(first.length);
  expect(after.find((x) => x.student_id === STUDENT.avery && x.assignment === "Quiz 1")?.score).toBe(19);
});

test("the syllabus's categories are used once the class has one; Haiku places the rest, titles only", async () => {
  await db.env.DB.batch([
    db.insertMaterial(MATERIAL_ID(1), SEED_CLASS_ID, [
      { category: "Quizzes", weight: 20 },
      { category: "Projects", weight: 40 },
      { category: "Tests", weight: 40 },
    ]),
    // A newer material with no weights does not hide the syllabus.
    db.insertMaterial(MATERIAL_ID(2), SEED_CLASS_ID, [], "2026-10-05T00:00:00.000Z"),
  ]);
  categoriseMock.mockResolvedValueOnce(new Map([["Fertile Crescent Map", "Projects"]]));
  await importGrid(wide, { env: keyed() });
  expect(categoriseMock).toHaveBeenCalledOnce();
  expect(categoriseMock.mock.calls[0]![0]).toMatchObject({ titles: ["Fertile Crescent Map"], categories: ["Quizzes", "Projects", "Tests"] });
  const avery = (await rows()).filter((r) => r.student_id === STUDENT.avery).map((r) => r.category);
  expect(avery).toEqual(["Quizzes", "Projects", "Tests"]);
});

test("a failed category call still imports, with the unplaced titles as other", async () => {
  categoriseMock.mockRejectedValueOnce(new Error("rate limited"));
  const r = await quietErrors(() => importJson(wide, { env: keyed() }));
  expect(r.entries).toBe(6);
  expect((await rows()).find((x) => x.assignment === "Fertile Crescent Map")?.category).toBe("other");
});

test("a long file keeps its own categories and dates", async () => {
  const r = await importJson(
    [
      ["Student", "Assignment", "Category", "Score", "Out of", "Due date"],
      ["Ruiz, Alex", "Sparta Podcast", "Projects", "47", "50", "2026-10-15"],
      ["Fairweather, Nola", "Sparta Podcast", "Projects", "50", "50", "2026-10-15"],
    ],
    { classId: CLASS_B_ID },
  );
  expect(r).toMatchObject({ shape: "long", students: 2, entries: 2, skipped: [] });
  expect((await rows()).find((x) => x.student_id === STUDENT.alexRuiz)).toMatchObject({ category: "Projects", score: 47, max_score: 50, due_date: "2026-10-15" });
});

test("a file with no grade table writes nothing and says so", async () => {
  const r = await importJson([
    ["Last", "First"],
    ["Quill", "Avery"],
  ]);
  expect(r).toEqual({ shape: "none", students: 0, assignments: 0, entries: 0, missing: 0, skipped: [], guessedMax: [] });
  expect(await rows()).toEqual([]);
});

test("POST /api/grades/import 404s an unknown class and 400s bad input", async () => {
  expect((await importGrid(wide, { classId: UNKNOWN_ID })).status).toBe(404);
  expect((await importGrid([])).status).toBe(400);
  expect((await importGrid([["x".repeat(201)]])).status).toBe(400);
  expect((await importGrid(Array.from({ length: 601 }, () => ["a"]))).status).toBe(400);
  expect((await importGrid([Array.from({ length: 201 }, () => "a")])).status).toBe(400);
});

test("GET /api/students/:id returns null grades until a grade book names the student", async () => {
  expect((await detail(STUDENT.avery)).grades).toBeNull();
});

test("GET /api/students/:id returns the grade summary, plain mean without a syllabus", async () => {
  await importGrid(wide);
  const g = (await detail(STUDENT.avery)).grades!;
  expect(g).toMatchObject({ weighted: false, overall: 86.7, count: 3, missing: 0 });
  expect(g.entries.map((e) => [e.assignment, e.category, e.pct])).toEqual([
    ["Quiz 1", "quiz", 85],
    ["Fertile Crescent Map", "other", 90],
    ["Unit 1 Test", "test", 85],
  ]);
  expect((await detail(STUDENT.alexMarsh)).grades).toMatchObject({ count: 2, missing: 1 });
  expect((await detail(STUDENT.alexRuiz)).grades).toBeNull();
});

test("GET /api/students/:id weights the overall by the syllabus when it covers every category, with the class mean on standouts", async () => {
  await db.env.DB.batch([
    db.insertMaterial(MATERIAL_ID(1), SEED_CLASS_ID, [
      { category: "Quizzes", weight: 20 },
      { category: "Tests", weight: 80 },
    ]),
  ]);
  const noMap = (r: string[]) => r.filter((_, i) => i !== 4);
  await importGrid(wide.map(noMap));
  const avery = (await detail(STUDENT.avery)).grades!;
  expect(avery).toMatchObject({ weighted: true, overall: 85 });
  expect(avery.byCategory.map((c) => [c.category, c.weight])).toEqual([
    ["Quizzes", 20],
    ["Tests", 80],
  ]);
  // Alex Marsh's quiz is missing, so his overall is his test alone; still weighted.
  const marsh = (await detail(STUDENT.alexMarsh)).grades!;
  expect(marsh).toMatchObject({ weighted: true, overall: 50, missing: 1 });
});
