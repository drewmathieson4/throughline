import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import app from "../index";
import { CLASS_ID, STUDENT, UNKNOWN_ID, quietErrors, testEnv } from "../test/db";
import { tagNote, type TagResult } from "../tagging";
import type { NoteWithTags, TaggedNoteResponse as Created } from "../api";

// The tagger is stubbed: route tests never call the API. (wrangler's proxy reads .dev.vars,
// so once a real key exists an un-stubbed run would make real, billable calls.)
vi.mock(import("../tagging"), async (importOriginal) => ({ ...(await importOriginal()), tagNote: vi.fn() }));
const tagNoteMock = vi.mocked(tagNote);

let env: Env;
let keyed: Env; // same bindings plus an API key, so tagging is attempted
let dispose = async () => {};

beforeAll(async () => {
  ({ env, dispose } = await testEnv());
  keyed = { ...env, ANTHROPIC_API_KEY: "test-key" };
});

beforeEach(async () => {
  tagNoteMock.mockReset();
  await env.DB.prepare("DELETE FROM notes").run(); // cascades to note_students and note_mentions
});

afterAll(() => dispose());

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

const getNotes = (classId: string) => app.request(`/api/notes?classId=${classId}`, {}, env);
// A string body is sent verbatim so tests can post malformed JSON.
const postNote = (body: unknown, e: Env = env) => app.request("/api/notes", json(body), e);

const result = (students: TagResult["students"], mentions: TagResult["mentions"] = []): TagResult => ({
  students,
  mentions,
  usage: { inputTokens: 1, outputTokens: 1 },
});

const BODY = "Avery nailed the quiz. Juni asked for help again. Alex was late.";

// Create a note whose tagger returns the given result; the default has one suggestion
// for Avery, one for Juniper, and an open mention for "Alex".
async function createTagged(
  r: TagResult = result(
    [
      { studentId: STUDENT.avery, quotes: ["Avery nailed the quiz."] },
      { studentId: STUDENT.juniper, quotes: ["Juni asked for help again."] },
    ],
    [{ mentionText: "Alex", quotes: ["Alex was late."], candidateIds: [STUDENT.alexMarsh, STUDENT.alexRuiz] }],
  ),
): Promise<Created> {
  tagNoteMock.mockResolvedValueOnce(r);
  const res = await postNote({ classId: CLASS_ID, body: BODY }, keyed);
  expect(res.status).toBe(201);
  return (await res.json()) as Created;
}

test("GET /api/notes requires a uuid classId", async () => {
  expect((await app.request("/api/notes", {}, env)).status).toBe(400);
  expect((await getNotes("not-a-uuid")).status).toBe(400);
});

test("GET /api/notes returns 404 for an unknown class", async () => {
  expect((await getNotes(UNKNOWN_ID)).status).toBe(404);
});

test("GET /api/notes returns an empty list for the seeded class", async () => {
  const res = await getNotes(CLASS_ID);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test("POST /api/notes stores a text note and GET lists it newest first", async () => {
  const first = await postNote({ classId: CLASS_ID, body: "Older note", notedAt: "2026-10-01T09:00:00Z" });
  expect(first.status).toBe(201);
  expect(((await first.json()) as Created).notedAt).toBe("2026-10-01T09:00:00.000Z");

  const second = await postNote({ classId: CLASS_ID, body: "  Newer note  " });
  expect(second.status).toBe(201);
  const created = (await second.json()) as Created;
  expect(created).toMatchObject({ classId: CLASS_ID, kind: "text", body: "Newer note", students: [], mentions: [] });
  expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

  const list = (await (await getNotes(CLASS_ID)).json()) as NoteWithTags[];
  expect(list.map((n) => n.body)).toEqual(["Newer note", "Older note"]);
});

test("GET /api/notes lists tags for more than 100 notes (D1 binds at most 100 parameters)", async () => {
  const now = "2026-10-01T09:00:00.000Z";
  const stmts = [];
  for (let i = 0; i < 101; i++) {
    const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`;
    stmts.push(
      env.DB.prepare("INSERT INTO notes (id, class_id, kind, body, noted_at, created_at) VALUES (?, ?, 'text', ?, ?, ?)").bind(id, CLASS_ID, `n${i}`, now, now),
      env.DB.prepare("INSERT INTO note_students (note_id, student_id, confirmed, quotes) VALUES (?, ?, 0, '[]')").bind(id, STUDENT.avery),
    );
  }
  await env.DB.batch(stmts);
  const res = await getNotes(CLASS_ID);
  expect(res.status).toBe(200);
  const list = (await res.json()) as NoteWithTags[];
  expect(list).toHaveLength(101);
  expect(list.every((n) => n.students.length === 1)).toBe(true);
});

test("POST /api/notes rejects an empty body with a message", async () => {
  const res = await postNote({ classId: CLASS_ID, body: "   " });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "body is required" });
});

test("POST /api/notes rejects a notedAt more than a day in the future", async () => {
  const res = await postNote({ classId: CLASS_ID, body: "x", notedAt: "9999-12-31T00:00:00Z" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "notedAt is in the future" });
});

test("POST /api/notes rejects malformed JSON", async () => {
  const res = await postNote("{not json");
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Malformed JSON in request body" });
});

test("POST /api/notes returns 404 for an unknown class", async () => {
  expect((await postNote({ classId: UNKNOWN_ID, body: "x" })).status).toBe(404);
});

test("POST /api/notes without an API key saves the note untagged", async () => {
  const res = await postNote({ classId: CLASS_ID, body: BODY });
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ students: [], mentions: [], tagging: "failed" });
  expect(tagNoteMock).not.toHaveBeenCalled();
});

test("POST /api/notes stores suggestions as unconfirmed with quotes, and open mentions", async () => {
  const created = await createTagged();
  expect(created.tagging).toBe("done");
  expect(created.students).toEqual([
    { studentId: STUDENT.avery, confirmed: 0, quotes: ["Avery nailed the quiz."] },
    { studentId: STUDENT.juniper, confirmed: 0, quotes: ["Juni asked for help again."] },
  ]);
  expect(created.mentions).toEqual([
    expect.objectContaining({ mentionText: "Alex", quotes: ["Alex was late."], candidateIds: [STUDENT.alexMarsh, STUDENT.alexRuiz] }),
  ]);
  // The tagger saw the class roster, aliases included.
  const call = tagNoteMock.mock.calls[0]![0];
  expect(call.body).toBe(BODY);
  expect(call.roster).toHaveLength(10);
  expect(call.roster.find((s) => s.id === STUDENT.juniper)?.aliases).toEqual(["Juni"]);

  const [listed] = (await (await getNotes(CLASS_ID)).json()) as NoteWithTags[];
  expect(listed).toMatchObject({ students: created.students, mentions: created.mentions });
});

test("POST /api/notes still saves the note when tagging throws", async () => {
  tagNoteMock.mockRejectedValueOnce(new Error("rate limited"));
  const res = await quietErrors(() => postNote({ classId: CLASS_ID, body: BODY }, keyed));
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ body: BODY, students: [], mentions: [], tagging: "failed" });
  expect((await (await getNotes(CLASS_ID)).json()) as NoteWithTags[]).toHaveLength(1);
});

test("POST /api/notes/:noteId/retag replaces suggestions and mentions but keeps confirmed tags", async () => {
  const note = await createTagged();
  expect((await app.request(`/api/notes/${note.id}/students/${STUDENT.avery}/confirm`, { method: "POST" }, env)).status).toBe(200);

  tagNoteMock.mockResolvedValueOnce(
    result([
      { studentId: STUDENT.avery, quotes: ["Avery nailed the quiz.", "Alex was late."] },
      { studentId: STUDENT.rowan, quotes: [] },
    ]),
  );
  const res = await app.request(`/api/notes/${note.id}/retag`, { method: "POST" }, keyed);
  expect(res.status).toBe(200);
  const retagged = (await res.json()) as Created;
  expect(retagged.tagging).toBe("done");
  expect(retagged.students).toEqual([
    { studentId: STUDENT.avery, confirmed: 1, quotes: ["Avery nailed the quiz.", "Alex was late."] },
    { studentId: STUDENT.rowan, confirmed: 0, quotes: [] },
  ]);
  expect(retagged.mentions).toEqual([]);
});

test("POST /api/notes/:noteId/retag keeps existing suggestions when tagging fails", async () => {
  const note = await createTagged();
  tagNoteMock.mockRejectedValueOnce(new Error("rate limited"));
  const res = await quietErrors(() => app.request(`/api/notes/${note.id}/retag`, { method: "POST" }, keyed));
  expect(res.status).toBe(200);
  const after = (await res.json()) as Created;
  expect(after.tagging).toBe("failed");
  expect(after.students).toEqual(note.students);
  expect(after.mentions).toEqual(note.mentions);
});

test("POST /api/notes/:noteId/retag returns 404 for an unknown note and 400 for a bad id", async () => {
  expect((await app.request(`/api/notes/${UNKNOWN_ID}/retag`, { method: "POST" }, env)).status).toBe(404);
  expect((await app.request(`/api/notes/nope/retag`, { method: "POST" }, env)).status).toBe(400);
});

test("POST /api/notes/:noteId/students adds a confirmed tag with verified quotes", async () => {
  const note = await createTagged(result([]));
  const res = await app.request(
    `/api/notes/${note.id}/students`,
    json({ studentId: STUDENT.rowan, quotes: ["  alex was late.  ", "Alex was late."] }),
    env,
  );
  expect(res.status).toBe(201);
  const updated = (await res.json()) as NoteWithTags;
  expect(updated.students).toEqual([{ studentId: STUDENT.rowan, confirmed: 1, quotes: ["Alex was late."] }]);

  // Adding again merges quotes rather than failing on the primary key.
  const again = await app.request(`/api/notes/${note.id}/students`, json({ studentId: STUDENT.rowan, quotes: ["Avery nailed"] }), env);
  expect(again.status).toBe(201);
  expect(((await again.json()) as NoteWithTags).students[0]?.quotes).toEqual(["Alex was late.", "Avery nailed"]);
});

test("POST /api/notes/:noteId/students rejects quotes not in the note, unknown and foreign students", async () => {
  const note = await createTagged(result([]));
  const bad = await app.request(`/api/notes/${note.id}/students`, json({ studentId: STUDENT.rowan, quotes: ["never said"] }), env);
  expect(bad.status).toBe(400);
  expect(((await bad.json()) as { error: string }).error).toMatch(/quote not found/);

  expect((await app.request(`/api/notes/${note.id}/students`, json({ studentId: UNKNOWN_ID }), env)).status).toBe(404);

  const otherClass = "33333333-3333-4333-8333-333333333333";
  const otherStudent = "44444444-4444-4444-8444-444444444444";
  await env.DB.batch([
    env.DB.prepare("INSERT INTO classes (id, name, created_at) VALUES (?, 'Other', '2026-09-01T08:00:00.000Z')").bind(otherClass),
    env.DB.prepare(
      "INSERT INTO students (id, class_id, first_name, last_name, created_at) VALUES (?, ?, 'Pat', 'Else', '2026-09-01T08:00:00.000Z')",
    ).bind(otherStudent, otherClass),
  ]);
  const foreign = await app.request(`/api/notes/${note.id}/students`, json({ studentId: otherStudent }), env);
  expect(foreign.status).toBe(400);
  expect(await foreign.json()).toEqual({ error: "student is not in this class" });
  await env.DB.prepare("DELETE FROM classes WHERE id = ?").bind(otherClass).run();
});

test("confirm flips the flag; delete removes the tag; both 404 when the tag is missing", async () => {
  const note = await createTagged();
  const path = `/api/notes/${note.id}/students/${STUDENT.avery}`;

  const confirmed = await app.request(`${path}/confirm`, { method: "POST" }, env);
  expect(confirmed.status).toBe(200);
  expect(((await confirmed.json()) as NoteWithTags).students.find((s) => s.studentId === STUDENT.avery)?.confirmed).toBe(1);

  expect((await app.request(path, { method: "DELETE" }, env)).status).toBe(204);
  const [listed] = (await (await getNotes(CLASS_ID)).json()) as NoteWithTags[];
  expect(listed!.students.map((s) => s.studentId)).toEqual([STUDENT.juniper]);

  expect((await app.request(`${path}/confirm`, { method: "POST" }, env)).status).toBe(404);
  expect((await app.request(path, { method: "DELETE" }, env)).status).toBe(404);
  expect((await app.request(`/api/notes/${UNKNOWN_ID}/students/${STUDENT.avery}/confirm`, { method: "POST" }, env)).status).toBe(404);
  expect((await app.request(`/api/notes/${note.id}/students/nope/confirm`, { method: "POST" }, env)).status).toBe(400);
});

test("assigning a mention creates a confirmed tag with its quotes and closes the mention", async () => {
  const note = await createTagged();
  const mention = note.mentions[0]!;
  const res = await app.request(`/api/notes/${note.id}/mentions/${mention.id}/assign`, json({ studentId: STUDENT.alexRuiz }), env);
  expect(res.status).toBe(200);
  const updated = (await res.json()) as NoteWithTags;
  expect(updated.mentions).toEqual([]);
  expect(updated.students).toContainEqual({ studentId: STUDENT.alexRuiz, confirmed: 1, quotes: ["Alex was late."] });

  expect((await app.request(`/api/notes/${note.id}/mentions/${mention.id}/assign`, json({ studentId: STUDENT.alexRuiz }), env)).status).toBe(404);
});

test("assigning a mention to a student outside the class is rejected and keeps the mention", async () => {
  const note = await createTagged();
  const mention = note.mentions[0]!;
  expect((await app.request(`/api/notes/${note.id}/mentions/${mention.id}/assign`, json({ studentId: UNKNOWN_ID }), env)).status).toBe(404);
  const [listed] = (await (await getNotes(CLASS_ID)).json()) as NoteWithTags[];
  expect(listed!.mentions).toHaveLength(1);
});

test("dismissing a mention deletes it; a second dismiss is 404", async () => {
  const note = await createTagged();
  const path = `/api/notes/${note.id}/mentions/${note.mentions[0]!.id}`;
  expect((await app.request(path, { method: "DELETE" }, env)).status).toBe(204);
  expect((await app.request(path, { method: "DELETE" }, env)).status).toBe(404);
  const [listed] = (await (await getNotes(CLASS_ID)).json()) as NoteWithTags[];
  expect(listed!.mentions).toEqual([]);
  expect(listed!.students).toHaveLength(2);
});
