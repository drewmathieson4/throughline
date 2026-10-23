import { expect, test } from "vitest";
import type { Student } from "../db/schema";
import type { RosterStudent, StudentDetail } from "../api-types";
import { NOTE_ID, SEED_CLASS_ID, SEED_STUDENT_IDS, UNKNOWN_ID, jsonInit, setupTestDb } from "../test-db";

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
    db.tagNote(NOTE_ID(1), SEED_STUDENT_IDS[0], 1),
    db.tagNote(NOTE_ID(2), SEED_STUDENT_IDS[0], 0),
    db.tagNote(NOTE_ID(3), SEED_STUDENT_IDS[0], 0),
  ]);
  const res = await roster(SEED_CLASS_ID);
  expect(res.status).toBe(200);
  const rows = (await res.json()) as RosterStudent[];
  expect(rows).toHaveLength(9);
  expect(rows.map((r) => r.lastName)).toEqual([...rows.map((r) => r.lastName)].sort());
  expect(rows.find((r) => r.id === SEED_STUDENT_IDS[0])).toMatchObject({ noteCount: 1, pendingCount: 2 });
  expect(rows.filter((r) => r.noteCount === 0 && r.pendingCount === 0)).toHaveLength(8);
});

test("GET /api/students sorts by last name ignoring case and accents", async () => {
  await post({ classId: SEED_CLASS_ID, firstName: "ana", lastName: "de la cruz" });
  await post({ classId: SEED_CLASS_ID, firstName: "Luis", lastName: "Álvarez" });
  const rows = await rosterJson();
  expect(rows.map((r) => r.lastName).slice(0, 4)).toEqual(["Álvarez", "Ashby", "Castellane", "de la cruz"]);
});

test("GET /api/students keeps students who left, with leftAt set", async () => {
  await patch(SEED_STUDENT_IDS[0], { leftAt: "2026-10-15" });
  const rows = await rosterJson();
  expect(rows).toHaveLength(9);
  expect(rows.find((r) => r.id === SEED_STUDENT_IDS[0])?.leftAt).toBe("2026-10-15");
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
    db.tagNote(older, SEED_STUDENT_IDS[0], 1),
    db.tagNote(newer, SEED_STUDENT_IDS[0], 0),
    db.tagNote(other, SEED_STUDENT_IDS[1], 1),
  ]);
  const res = await get(SEED_STUDENT_IDS[0]);
  expect(res.status).toBe(200);
  const body = (await res.json()) as StudentDetail;
  expect(body.student.id).toBe(SEED_STUDENT_IDS[0]);
  expect(body.notes.map((n) => [n.id, n.confirmed])).toEqual([[newer, 0], [older, 1]]);
});

test("GET /api/students/:id 404s for an unknown id", async () => {
  expect((await get(UNKNOWN_ID)).status).toBe(404);
  expect((await get("nope")).status).toBe(400);
});

test("PATCH /api/students/:id renames, marks as left, and reactivates", async () => {
  const id = SEED_STUDENT_IDS[0];
  let row = await patchJson(id, { lastName: " Quill-Smith " });
  expect(row).toMatchObject({ firstName: "Avery", lastName: "Quill-Smith" });

  row = await patchJson(id, { leftAt: "2026-10-15" });
  expect(row.leftAt).toBe("2026-10-15");

  row = await patchJson(id, { leftAt: null });
  expect(row.leftAt).toBeNull();
});

test("PATCH /api/students/:id rejects empty patches, bad dates, and unknown ids", async () => {
  expect((await patch(SEED_STUDENT_IDS[0], {})).status).toBe(400);
  expect((await patch(SEED_STUDENT_IDS[0], { leftAt: "soon" })).status).toBe(400);
  const typo = await patch(SEED_STUDENT_IDS[0], { leftAt: "2062-10-22" });
  expect(typo.status).toBe(400);
  expect(await typo.json()).toEqual({ error: "leftAt is in the future" });
  expect((await patch(SEED_STUDENT_IDS[0], { firstName: "" })).status).toBe(400);
  expect((await patch(UNKNOWN_ID, { firstName: "X" })).status).toBe(404);
});
