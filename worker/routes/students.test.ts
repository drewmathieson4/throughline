import { beforeEach, expect, test, vi } from "vitest";
import app from "../index";
import type { Student } from "../db/schema";
import type { ClassRow } from "../db/schema";
import type { RosterImportResult, RosterStudent, StudentDetail } from "../api-types";
import { suggestMapping } from "../roster-model";
import { CLASS_B_ID, NOTE_ID, PERIOD_3_COUNT, SEED_CLASS_ID, SEED_CLASS_NAMES, STUDENT, UNKNOWN_ID, jsonInit, quietErrors, setupTestDb } from "../test-db";

// The model fallback for column mapping is mocked: no network, and each test says what it answers.
vi.mock(import("../roster-model"), async (importOriginal) => ({ ...(await importOriginal()), suggestMapping: vi.fn() }));
const suggestMock = vi.mocked(suggestMapping);

const db = setupTestDb();

const rosterUrl = (classId: string) => `/api/students?classId=${classId}`;
const roster = (classId: string) => db.request(rosterUrl(classId));
const rosterJson = () => db.json<RosterStudent[]>(rosterUrl(SEED_CLASS_ID));
const post = (body: unknown) => db.request("/api/students", jsonInit("POST", body));
const patch = (id: string, body: unknown) => db.request(`/api/students/${id}`, jsonInit("PATCH", body));
const patchJson = (id: string, body: unknown) => db.json<Student>(`/api/students/${id}`, jsonInit("PATCH", body));
const get = (id: string) => db.request(`/api/students/${id}`);

test("GET /api/students lists the roster by last name, counting confirmed and pending tags apart", async () => {
  await db.env.DB.batch([
    db.insertNote(NOTE_ID(1), SEED_CLASS_ID, "2026-10-01T00:00:00.000Z"),
    db.insertNote(NOTE_ID(2), SEED_CLASS_ID, "2026-10-02T00:00:00.000Z"),
    db.insertNote(NOTE_ID(3), SEED_CLASS_ID, "2026-10-03T00:00:00.000Z"),
    db.tagNote(NOTE_ID(1), STUDENT.avery, 1),
    db.tagNote(NOTE_ID(2), STUDENT.avery, 0),
    db.tagNote(NOTE_ID(3), STUDENT.avery, 0),
  ]);
  const res = await roster(SEED_CLASS_ID);
  expect(res.status).toBe(200);
  const rows = (await res.json()) as RosterStudent[];
  expect(rows).toHaveLength(PERIOD_3_COUNT);
  expect(rows.map((r) => r.lastName)).toEqual([...rows.map((r) => r.lastName)].sort());
  expect(rows.find((r) => r.id === STUDENT.avery)).toMatchObject({ noteCount: 1, pendingCount: 2 });
  expect(rows.filter((r) => r.noteCount === 0 && r.pendingCount === 0)).toHaveLength(PERIOD_3_COUNT - 1);
});

test("GET /api/students sorts by last name ignoring case and accents", async () => {
  await post({ classId: SEED_CLASS_ID, firstName: "ana", lastName: "de la cruz" });
  await post({ classId: SEED_CLASS_ID, firstName: "Luis", lastName: "Álvarez" });
  const rows = await rosterJson();
  expect(rows.map((r) => r.lastName).slice(0, 4)).toEqual(["Álvarez", "Castellane", "de la cruz", "Finchley"]);
});

test("GET /api/students keeps students who left, with leftAt set", async () => {
  await patch(STUDENT.avery, { leftAt: "2026-10-15" });
  const rows = await rosterJson();
  expect(rows).toHaveLength(PERIOD_3_COUNT);
  expect(rows.find((r) => r.id === STUDENT.avery)?.leftAt).toBe("2026-10-15");
});

test("GET /api/students 404s for an unknown class and 400s without a uuid", async () => {
  expect((await roster(UNKNOWN_ID)).status).toBe(404);
  expect((await roster("nope")).status).toBe(400);
  expect((await db.request("/api/students")).status).toBe(400);
});

test("POST /api/students adds a student with a cleaned name", async () => {
  const res = await post({ classId: SEED_CLASS_ID, firstName: "  Mary\tAnn ", lastName: "Lee\u0007" });
  expect(res.status).toBe(201);
  const row = (await res.json()) as Student;
  expect(row).toMatchObject({ classId: SEED_CLASS_ID, firstName: "Mary Ann", lastName: "Lee", leftAt: null });
  expect((await get(row.id)).status).toBe(200);
});

test("POST /api/students validates names and the class", async () => {
  expect((await post({ classId: SEED_CLASS_ID, firstName: " ", lastName: "Lee" })).status).toBe(400);
  expect((await post({ classId: SEED_CLASS_ID, firstName: "a".repeat(101), lastName: "Lee" })).status).toBe(400);
  expect((await post({ classId: UNKNOWN_ID, firstName: "Mary", lastName: "Lee" })).status).toBe(404);
});

test("GET /api/students/:id returns the student and the notes tagged to them, newest first", async () => {
  const [older, newer, other] = [NOTE_ID(1), NOTE_ID(2), NOTE_ID(3)];
  await db.env.DB.batch([
    db.insertNote(older, SEED_CLASS_ID, "2026-10-01T00:00:00.000Z"),
    db.insertNote(newer, SEED_CLASS_ID, "2026-10-05T00:00:00.000Z"),
    db.insertNote(other, SEED_CLASS_ID, "2026-10-06T00:00:00.000Z"),
    db.tagNote(older, STUDENT.avery, 1),
    db.tagNote(newer, STUDENT.avery, 0),
    db.tagNote(other, STUDENT.rowan, 1),
  ]);
  const res = await get(STUDENT.avery);
  expect(res.status).toBe(200);
  const body = (await res.json()) as StudentDetail;
  expect(body.student.id).toBe(STUDENT.avery);
  expect(body.notes.map((n) => [n.id, n.confirmed])).toEqual([[newer, 0], [older, 1]]);
});

test("GET /api/students/:id 404s for an unknown id", async () => {
  expect((await get(UNKNOWN_ID)).status).toBe(404);
  expect((await get("nope")).status).toBe(400);
});

test("PATCH /api/students/:id renames, marks as left, and reactivates", async () => {
  const id = STUDENT.avery;
  let row = await patchJson(id, { lastName: " Quill-Smith " });
  expect(row).toMatchObject({ firstName: "Avery", lastName: "Quill-Smith" });

  row = await patchJson(id, { leftAt: "2026-10-15" });
  expect(row.leftAt).toBe("2026-10-15");

  row = await patchJson(id, { leftAt: null });
  expect(row.leftAt).toBeNull();
});

test("PATCH /api/students/:id rejects empty patches, bad dates, and unknown ids", async () => {
  expect((await patch(STUDENT.avery, {})).status).toBe(400);
  expect((await patch(STUDENT.avery, { leftAt: "soon" })).status).toBe(400);
  const typo = await patch(STUDENT.avery, { leftAt: "2062-10-22" });
  expect(typo.status).toBe(400);
  expect(await typo.json()).toEqual({ error: "leftAt is in the future" });
  expect((await patch(STUDENT.avery, { firstName: "" })).status).toBe(400);
  expect((await patch(UNKNOWN_ID, { firstName: "X" })).status).toBe(404);
});

// ---- POST /api/students/import ----------------------------------------------------------

const keyed = (): Env => ({ ...db.env, ANTHROPIC_API_KEY: "test-key" });
const importRoster = (body: unknown, env?: Env) => app.request("/api/students/import", jsonInit("POST", body), env ?? db.env);
const importJson = async (grid: string[][], env?: Env, classId = SEED_CLASS_ID) => (await importRoster({ classId, grid }, env)).json() as Promise<RosterImportResult>;
const names = (rows: { firstName: string; lastName: string }[]) => rows.map((r) => `${r.firstName} ${r.lastName}`);
// The one class a file without sections lands in.
const only = (out: RosterImportResult) => {
  expect(out.classes).toHaveLength(1);
  return out.classes[0]!;
};
const headered = [
  ["First Name", "Last Name", "Goes by"],
  ["Tamsin", "Brook", "Tam"], // new
  ["Avery", "QUILL", ""], // seeded already; all caps gets re-cased
  ["Sable", "Thorncroft", "Sable"], // seeded; preferred equal to first is no alias
  ["Mira", "Holloway", ""], // new
];

beforeEach(() => suggestMock.mockReset());

test("import: reads the header, adds the new students with aliases, skips the enrolled; a rerun adds nobody", async () => {
  const out = await importJson(headered);
  expect(out.source).toBe("header");
  const cls = only(out);
  expect(cls).toMatchObject({ id: SEED_CLASS_ID, name: "Period 3 Humanities", created: false });
  expect(names(cls.added)).toEqual(["Tamsin Brook", "Mira Holloway"]);
  expect(names(cls.existing)).toEqual(["Avery Quill", "Sable Thorncroft"]);
  expect(out.skipped).toEqual([]);
  const rows = await rosterJson();
  expect(rows).toHaveLength(PERIOD_3_COUNT + 2);
  expect(rows.find((r) => r.lastName === "Brook")).toMatchObject({ firstName: "Tamsin", aliases: ["Tam"], classId: SEED_CLASS_ID, leftAt: null });
  expect(rows.find((r) => r.lastName === "Holloway")?.aliases).toEqual([]);

  const again = only(await importJson(headered));
  expect(again.added).toEqual([]);
  expect(again.existing).toHaveLength(4);
  expect(await rosterJson()).toHaveLength(PERIOD_3_COUNT + 2);
});

test("import: a student who left still counts as enrolled", async () => {
  await patch(STUDENT.avery, { leftAt: "2026-10-15" });
  const cls = only(await importJson([["Name"], ["Avery Quill"]]));
  expect(cls.added).toEqual([]);
  expect(names(cls.existing)).toEqual(["Avery Quill"]);
});

test("import: more rows than one insert statement can hold all land", async () => {
  const grid = [["First", "Last"], ...Array.from({ length: 40 }, (_, i) => ["Tamsin", `Brook${"e".repeat(i)}`])];
  expect(only(await importJson(grid)).added).toHaveLength(40);
  expect(await rosterJson()).toHaveLength(PERIOD_3_COUNT + 40);
});

test("import: a lone Last, First column needs no header and no model", async () => {
  const out = await importJson([["Brook, Tamsin James"], ["Quill, Avery"], ["Holloway"]]);
  expect(out.source).toBe("content");
  const cls = only(out);
  expect(names(cls.added)).toEqual(["Tamsin Brook"]);
  expect(names(cls.existing)).toEqual(["Avery Quill"]);
  expect(out.skipped).toEqual([{ line: 3, cells: ["Holloway"], reason: "only one name" }]);
  expect(suggestMock).not.toHaveBeenCalled();
});

// A generator-style export: metadata rows, then the table with a Section column, then a
// summary. Every name is invented.
const sectioned = [
  ["Tool", "Classroom Roster Generator"],
  ["Explanation", "Generated 4 roster rows across 2 sections, using each section's own student list."],
  [""],
  ["Metrics", ""],
  ["Students", "4"],
  ["Sections", "2"],
  ["First roll", "1"],
  [""],
  ["Output rows", ""],
  ["Section", "Roll", "Name", "Student ID", "Gender", "Notes"],
  ["Grade 7 - A", "1", "Tamsin Brook", "STU-0001", "", "Attendance / support notes"],
  ["Grade 7 - A", "2", "Mira Holloway", "STU-0002", "", ""],
  ["Grade 7 - B", "1", "Avery Quill", "STU-0001", "", ""],
  ["Grade 7 - B", "2", "Fenwick Dale", "STU-0002", "", ""],
  [""],
  ["Roster diff", ""],
  ["Added", "Tamsin Brook; Fenwick Dale"],
  ["Generated by a roster tool", ""],
];

test("import: finds the table inside a metadata-laden export and creates a class per section", async () => {
  const out = await importJson(sectioned);
  expect(out.source).toBe("header");
  expect(out.classes.map((k) => [k.name, k.created, names(k.added), names(k.existing)])).toEqual([
    ["Grade 7 - A", true, ["Tamsin Brook", "Mira Holloway"], []],
    ["Grade 7 - B", true, ["Avery Quill", "Fenwick Dale"], []],
  ]);
  expect(out.skipped).toEqual([]);
  const classes = await db.json<ClassRow[]>("/api/classes");
  expect(classes.map((k) => k.name).sort()).toEqual([...SEED_CLASS_NAMES, "Grade 7 - A", "Grade 7 - B"].sort());
  const a = classes.find((k) => k.name === "Grade 7 - A")!;
  expect(names(await db.json<RosterStudent[]>(rosterUrl(a.id)))).toEqual(["Tamsin Brook", "Mira Holloway"]);
  expect(await rosterJson()).toHaveLength(PERIOD_3_COUNT); // the class on screen is untouched

  // Same file again: the classes are matched by name, nobody is added.
  const again = await importJson(sectioned);
  expect(again.classes.map((k) => [k.name, k.created, k.added.length, k.existing.length])).toEqual([
    ["Grade 7 - A", false, 0, 2],
    ["Grade 7 - B", false, 0, 2],
  ]);
  expect(await db.json<ClassRow[]>("/api/classes")).toHaveLength(SEED_CLASS_NAMES.length + 2);
});

test("import: a section column naming one class goes to the class on screen, and matches an existing class by name ignoring case", async () => {
  const one = await importJson([["Section", "Name"], ["Grade 7 - A", "Tamsin Brook"]]);
  expect(only(one)).toMatchObject({ id: SEED_CLASS_ID, created: false });
  // "7a" and "7A" are one class, not two, so this is still the class on screen.
  const cased = await importJson([["Section", "Name"], ["7A", "Orla Penhallow"], ["7a", "Jem Castellan"]]);
  expect(only(cased)).toMatchObject({ id: SEED_CLASS_ID, created: false });
  expect(names(only(cased).added)).toEqual(["Orla Penhallow", "Jem Castellan"]);
  const two = await importJson([["Class", "Name"], ["b block humanities", "Mira Holloway"], ["Period 3 Humanities", "Fenwick Dale"]]);
  expect(two.classes.map((k) => [k.id, k.created, names(k.added)])).toEqual([
    [CLASS_B_ID, false, ["Mira Holloway"]],
    [SEED_CLASS_ID, false, ["Fenwick Dale"]],
  ]);
});

const ambiguous = [
  ["Brook", "Tamsin"],
  ["Quill", "Avery"],
];

test("import: when the rules give up and there is no key, nothing is added", async () => {
  const out = await importJson(ambiguous);
  expect(out).toEqual({ source: "none", classes: [], skipped: [] });
  expect(suggestMock).not.toHaveBeenCalled();
  expect(await rosterJson()).toHaveLength(PERIOD_3_COUNT);
});

test("import: with a key the model is asked, and its mapping is used", async () => {
  suggestMock.mockResolvedValueOnce({ hasHeader: false, roles: ["last", "first"] });
  const out = await importJson(ambiguous, keyed());
  expect(out.source).toBe("model");
  const cls = only(out);
  expect(names(cls.added)).toEqual(["Tamsin Brook"]);
  expect(names(cls.existing)).toEqual(["Avery Quill"]);
  expect(suggestMock.mock.calls[0]![0].sample).toEqual(ambiguous);
  expect(await rosterJson()).toHaveLength(PERIOD_3_COUNT + 1);
});

test("import: a model failure, or a model answer without a name column, adds nothing", async () => {
  suggestMock.mockRejectedValueOnce(new Error("rate limited"));
  expect(await quietErrors(() => importJson(ambiguous, keyed()))).toMatchObject({ source: "none", classes: [] });
  suggestMock.mockResolvedValueOnce({ hasHeader: false, roles: ["ignore", "preferred"] });
  expect(await importJson(ambiguous, keyed())).toMatchObject({ source: "none", classes: [] });
  expect(await rosterJson()).toHaveLength(PERIOD_3_COUNT);
});

test("import: rejects a bad request shape and an unknown class", async () => {
  const tooMany = Array.from({ length: 601 }, () => ["a", "b"]);
  expect((await importRoster({ classId: SEED_CLASS_ID, grid: tooMany })).status).toBe(400);
  expect((await importRoster({ classId: SEED_CLASS_ID, grid: [] })).status).toBe(400);
  expect((await importRoster({ classId: SEED_CLASS_ID, grid: [[1]] })).status).toBe(400);
  expect((await importRoster({ classId: SEED_CLASS_ID })).status).toBe(400);
  expect((await importRoster({ classId: UNKNOWN_ID, grid: [["a"]] })).status).toBe(404);
});
