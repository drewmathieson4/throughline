import { expect, test, vi } from "vitest";
import app from "../index";
import { CLASS_B_ID, DEV_USER_ID, NOTE_ID, OTHER_CLASS_ID, OTHER_STUDENT_ID, OTHER_USER_ID, SEED_CLASS_ID as CLASS_ID, SEED_CLASS_NAMES, SEED_STUDENT_COUNT, STUDENT, UNKNOWN_ID, fakeAi, jsonInit, quietErrors, setupTestDb, signedIn } from "../test-db";
import { ACCOUNT_CAP_MICRO } from "../spend";
import { tagNote, type TagResult } from "../tagging";
import type { NoteWithTags, SessionUser, TaggedNoteResponse as Created } from "../api-types";

// The tagger is stubbed: route tests never call the API.
// (wrangler's proxy reads .dev.vars, so once a real key exists an un-stubbed run would make
// real, billable calls.)
vi.mock(import("../tagging"), async (importOriginal) => ({ ...(await importOriginal()), tagNote: vi.fn() }));
const tagNoteMock = vi.mocked(tagNote);

const db = setupTestDb();
// Same bindings plus an API key, so tagging is attempted.
const keyed = (): Env => ({ ...db.env, ANTHROPIC_API_KEY: "test-key" });

const getNotes = (classId?: string) => db.request(classId ? `/api/notes?classId=${classId}` : "/api/notes");
const listOf = async (classId?: string) => (await getNotes(classId)).json() as Promise<NoteWithTags[]>;
// A string body is sent verbatim so tests can post malformed JSON.
const postNote = (body: unknown, env?: Env) => app.request("/api/notes", signedIn(jsonInit("POST", body)), env ?? db.env);

function postVoice(
  classId: string | undefined,
  audio: BodyInit,
  opts: { ai?: ReturnType<typeof fakeAi>; type?: string; headers?: Record<string, string>; env?: Env; query?: Record<string, string> } = {},
) {
  const ai = opts.ai ?? fakeAi("Transcribed.");
  const query = new URLSearchParams({ ...(classId && { classId }), ...opts.query });
  return app.request(
    query.size > 0 ? `/api/notes/voice?${query}` : "/api/notes/voice",
    signedIn({ method: "POST", headers: { "content-type": opts.type ?? "audio/webm;codecs=opus", ...opts.headers }, body: audio }),
    { ...(opts.env ?? db.env), AI: ai as unknown as Ai },
  );
}

// Seeded students' classes, so fixtures can name a student and get the class the tagger would attach.
const CLASS_OF: Record<string, string> = {
  [STUDENT.avery]: CLASS_ID,
  [STUDENT.rowan]: CLASS_ID,
  [STUDENT.juniper]: CLASS_ID,
  [STUDENT.alexMarsh]: CLASS_ID,
  [STUDENT.alexRuiz]: CLASS_B_ID,
  [STUDENT.nola]: CLASS_B_ID,
  [STUDENT.cassius]: CLASS_B_ID,
};
const result = (
  students: { studentId: string; quotes: string[] }[],
  mentions: TagResult["mentions"] = [],
  mentionedClassId: string | null = null,
): TagResult => ({
  students: students.map((s) => ({ ...s, classId: CLASS_OF[s.studentId]! })),
  mentions,
  mentionedClassId,
  usage: { inputTokens: 1, outputTokens: 1 },
});

const BODY = "Avery nailed the quiz. Juni asked for help again. Alex was late.";

// Create a note (no class given) whose tagger returns the given result; the default has one
// suggestion for Avery, one for Juniper (both Period 3), and an open mention for "Alex".
async function createTagged(
  r: TagResult = result(
    [
      { studentId: STUDENT.avery, quotes: ["Avery nailed the quiz."] },
      { studentId: STUDENT.juniper, quotes: ["Juni asked for help again."] },
    ],
    [{ mentionText: "Alex", quotes: ["Alex was late."], candidateIds: [STUDENT.alexMarsh, STUDENT.alexRuiz] }],
  ),
  notedAt?: string,
): Promise<Created> {
  tagNoteMock.mockReset();
  tagNoteMock.mockResolvedValueOnce(r);
  const res = await postNote({ body: BODY, notedAt }, keyed());
  expect(res.status).toBe(201);
  return (await res.json()) as Created;
}

test("a demo visitor's notes are counted and stop at 30; a repeat send and a refused recording cost nothing", async () => {
  const demo = await db.startDemo();
  const left = async () => (await demo.json<SessionUser>("/api/auth/me")).demo!.notesLeft;
  const as = { token: demo.token };
  await db.setUsed(demo.userId, { notes: 29 });
  const clientId = crypto.randomUUID();
  expect((await app.request("/api/notes", signedIn(jsonInit("POST", { body: "Last one.", clientId }), as), db.env)).status).toBe(201);
  expect(await left()).toBe(0);

  const refused = await app.request("/api/notes", signedIn(jsonInit("POST", { body: "One more." }), as), db.env);
  expect(refused.status).toBe(403);
  expect(await refused.json()).toEqual({ error: "The demo allows 30 notes; sign in with Google to use your own classes" });
  expect((await app.request("/api/notes", signedIn(jsonInit("POST", { body: "Last one.", clientId }), as), db.env)).status).toBe(200);

  const ai = fakeAi("Transcribed.");
  const voice = await app.request("/api/notes/voice", signedIn({ method: "POST", headers: { "content-type": "audio/webm" }, body: "audio" }, as), { ...db.env, AI: ai as unknown as Ai });
  expect(voice.status).toBe(403);
  expect(ai.run).not.toHaveBeenCalled();
  expect(await demo.json<NoteWithTags[]>("/api/notes")).toHaveLength((await demo.json<NoteWithTags[]>("/api/notes")).length);
  expect(await left()).toBe(0);
});

test("GET /api/notes rejects a malformed classId and 404s an unknown one", async () => {
  expect((await getNotes("not-a-uuid")).status).toBe(400);
  expect((await getNotes(UNKNOWN_ID)).status).toBe(404);
});

test("GET /api/notes returns an empty list with and without a class filter", async () => {
  expect(await listOf()).toEqual([]);
  expect(await listOf(CLASS_ID)).toEqual([]);
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

  expect((await listOf(CLASS_ID)).map((n) => n.body)).toEqual(["Newer note", "Older note"]);
});

test("an account over its AI spend cap still saves its notes, untagged", async () => {
  tagNoteMock.mockReset();
  await db.setSpent(DEV_USER_ID, ACCOUNT_CAP_MICRO);
  const res = await postNote({ body: BODY, classId: CLASS_ID }, keyed());
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ classId: CLASS_ID, students: [], mentions: [], tagging: "failed" });
  expect(tagNoteMock).not.toHaveBeenCalled();
});

test("POST /api/notes without a class saves it unassigned when nothing is inferable", async () => {
  tagNoteMock.mockReset();
  const unkeyed = await postNote({ body: BODY });
  expect(unkeyed.status).toBe(201);
  expect(await unkeyed.json()).toMatchObject({ classId: null, students: [], mentions: [], tagging: "failed" });
  expect(tagNoteMock).not.toHaveBeenCalled();

  const empty = await createTagged(result([]));
  expect(empty).toMatchObject({ classId: null, tagging: "done" });
  expect((await listOf()).map((n) => n.classId)).toEqual([null, null]);
});

test("GET /api/notes without a filter lists every note; with classId it filters", async () => {
  // Explicit times: two notes saved in the same millisecond would otherwise sort arbitrarily.
  await createTagged(undefined, "2026-10-01T09:00:00Z"); // Period 3 via Avery and Juniper
  await createTagged(result([{ studentId: STUDENT.nola, quotes: [] }]), "2026-10-01T10:00:00Z"); // B Block
  await createTagged(result([]), "2026-10-01T11:00:00Z"); // unassigned
  expect((await listOf()).map((n) => n.classId)).toEqual([null, CLASS_B_ID, CLASS_ID]);
  expect((await listOf(CLASS_B_ID)).map((n) => n.classId)).toEqual([CLASS_B_ID]);
  expect(await listOf(CLASS_ID)).toHaveLength(1);
});

test("GET /api/notes lists tags for more than 100 notes (D1 binds at most 100 parameters)", async () => {
  const now = "2026-10-01T09:00:00.000Z";
  const stmts = [];
  for (let i = 0; i < 101; i++) {
    const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`;
    stmts.push(db.insertNote(id, CLASS_ID, now), db.tagNote(id, STUDENT.avery));
  }
  await db.env.DB.batch(stmts);
  const list = await listOf(CLASS_ID);
  expect(list).toHaveLength(101);
  expect(list.every((n) => n.students.length === 1)).toBe(true);
});

test("POST /api/notes rejects an empty body with a message", async () => {
  const res = await postNote({ body: "   " });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "body is required" });
});

test("POST /api/notes rejects a body over 50,000 characters", async () => {
  expect((await postNote({ body: "x".repeat(50_000) })).status).toBe(201);
  const res = await postNote({ body: "x".repeat(50_001) });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "body is too long" });
});

test("POST /api/notes rejects a notedAt more than a day in the future", async () => {
  const res = await postNote({ body: "x", notedAt: "9999-12-31T00:00:00Z" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "notedAt is in the future" });
});

// The id the browser mints for a captured note, so a resend finds it.
const CLIENT_ID = "55555555-5555-4555-8555-555555555501";

test("POST /api/notes with a seen clientId returns the stored note with a 200 and tags nothing", async () => {
  const created = await createTagged(undefined, "2026-10-01T09:00:00Z");
  expect(created.clientId).toBeNull();
  tagNoteMock.mockReset();
  tagNoteMock.mockResolvedValue(result([{ studentId: STUDENT.avery, quotes: ["Avery nailed the quiz."] }]));

  const first = await postNote({ body: BODY, notedAt: "2026-10-02T09:00:00Z", clientId: CLIENT_ID }, keyed());
  expect(first.status).toBe(201);
  const stored = (await first.json()) as Created;
  expect(stored).toMatchObject({ clientId: CLIENT_ID, notedAt: "2026-10-02T09:00:00.000Z" });

  // A resend after a lost response, even with a different body, changes nothing.
  const again = await postNote({ body: "Something else", clientId: CLIENT_ID }, keyed());
  expect(again.status).toBe(200);
  expect(await again.json()).toEqual({ ...stored, tagging: "done" });
  expect(tagNoteMock).toHaveBeenCalledTimes(1);
  expect((await listOf()).map((n) => n.id)).toEqual([stored.id, created.id]);
});

test("two sends of one clientId at once make one note", async () => {
  const sends = await Promise.all([postNote({ body: "x", clientId: CLIENT_ID }), postNote({ body: "x", clientId: CLIENT_ID })]);
  expect(sends.map((r) => r.status).sort()).toEqual([200, 201]);
  const [a, b] = (await Promise.all(sends.map((r) => r.json()))) as Created[];
  expect(a!.id).toBe(b!.id);
  expect(await listOf()).toHaveLength(1);
});

test("POST /api/notes rejects a clientId that is not a UUID", async () => {
  expect((await postNote({ body: "x", clientId: "abc" })).status).toBe(400);
});

test("POST /api/notes rejects malformed JSON", async () => {
  const res = await postNote("{not json");
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Malformed JSON in request body" });
});

test("POST /api/notes returns 404 for an unknown class when one is given", async () => {
  expect((await postNote({ classId: UNKNOWN_ID, body: "x" })).status).toBe(404);
});

test("POST /api/notes stores tags with quotes, open mentions, and the inferred class", async () => {
  const created = await createTagged();
  expect(created.tagging).toBe("done");
  expect(created.classId).toBe(CLASS_ID);
  expect(created.students).toEqual([
    { studentId: STUDENT.avery, quotes: ["Avery nailed the quiz."] },
    { studentId: STUDENT.juniper, quotes: ["Juni asked for help again."] },
  ]);
  expect(created.mentions).toEqual([
    expect.objectContaining({ mentionText: "Alex", quotes: ["Alex was late."], candidateIds: [STUDENT.alexMarsh, STUDENT.alexRuiz] }),
  ]);
  // The tagger saw every student in every class, aliases included, and the class list.
  const call = tagNoteMock.mock.calls[0]![0];
  expect(call.body).toBe(BODY);
  expect(call.roster).toHaveLength(SEED_STUDENT_COUNT);
  expect(call.roster.find((s) => s.id === STUDENT.juniper)).toMatchObject({ classId: CLASS_ID, aliases: ["Juni"] });
  expect(call.roster.find((s) => s.id === STUDENT.alexRuiz)?.classId).toBe(CLASS_B_ID);
  expect(call.classes.map((c) => c.name).sort()).toEqual(SEED_CLASS_NAMES);

  const [listed] = await listOf(CLASS_ID);
  expect(listed).toMatchObject({ classId: CLASS_ID, students: created.students, mentions: created.mentions });
});

test("suggestions spanning two classes leave the note unassigned", async () => {
  const created = await createTagged(result([{ studentId: STUDENT.avery, quotes: [] }, { studentId: STUDENT.nola, quotes: [] }]));
  expect(created.classId).toBeNull();
  expect(created.students).toHaveLength(2);
});

test("a class named in the note sets it when no student does, and never overrides students", async () => {
  expect((await createTagged(result([], [], CLASS_B_ID))).classId).toBe(CLASS_B_ID);
  expect((await createTagged(result([{ studentId: STUDENT.avery, quotes: [] }], [], CLASS_B_ID))).classId).toBe(CLASS_ID);
});

test("a class given on create is kept even when tags point elsewhere", async () => {
  tagNoteMock.mockReset();
  tagNoteMock.mockResolvedValueOnce(result([{ studentId: STUDENT.nola, quotes: [] }]));
  const res = await postNote({ classId: CLASS_ID, body: BODY }, keyed());
  expect(((await res.json()) as Created).classId).toBe(CLASS_ID);
});

test("POST /api/notes still saves the note when tagging throws", async () => {
  tagNoteMock.mockReset();
  tagNoteMock.mockRejectedValueOnce(new Error("rate limited"));
  const res = await quietErrors(() => postNote({ body: BODY }, keyed()));
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ body: BODY, classId: null, students: [], mentions: [], tagging: "failed" });
  expect(await listOf()).toHaveLength(1);
});

test("POST /api/notes/:noteId/retag tags a note whose tagging failed, keeps a set class, and refuses a tagged note", async () => {
  tagNoteMock.mockReset();
  tagNoteMock.mockRejectedValueOnce(new Error("rate limited"));
  const failed = (await (await quietErrors(() => postNote({ body: BODY }, keyed()))).json()) as Created;
  expect(failed.tagging).toBe("failed");

  tagNoteMock.mockResolvedValueOnce(result([{ studentId: STUDENT.avery, quotes: ["Avery nailed the quiz."] }]));
  const res = await app.request(`/api/notes/${failed.id}/retag`, signedIn({ method: "POST" }), keyed());
  expect(res.status).toBe(200);
  const retagged = (await res.json()) as Created;
  expect(retagged).toMatchObject({ tagging: "done", classId: CLASS_ID });
  expect(retagged.students).toEqual([{ studentId: STUDENT.avery, quotes: ["Avery nailed the quiz."] }]);

  // Now tagged: a second retag would replace what the teacher may have settled, so it is refused.
  expect((await app.request(`/api/notes/${failed.id}/retag`, signedIn({ method: "POST" }), keyed())).status).toBe(409);
  expect((await app.request(`/api/notes/${(await createTagged()).id}/retag`, signedIn({ method: "POST" }), keyed())).status).toBe(409);

  // A retag that finds nothing does not clear a class the note already had.
  const classNote = (await (await postNote({ classId: CLASS_ID, body: "Rowdy today." })).json()) as Created;
  tagNoteMock.mockResolvedValueOnce(result([]));
  const again = (await (await app.request(`/api/notes/${classNote.id}/retag`, signedIn({ method: "POST" }), keyed())).json()) as Created;
  expect(again).toMatchObject({ tagging: "done", classId: CLASS_ID, students: [] });
});

test("POST /api/notes/:noteId/retag reports failure and leaves the note untagged when tagging fails again", async () => {
  tagNoteMock.mockReset();
  const note = (await (await postNote({ body: BODY })).json()) as Created; // no key: untagged
  tagNoteMock.mockRejectedValueOnce(new Error("rate limited"));
  const res = await quietErrors(() => app.request(`/api/notes/${note.id}/retag`, signedIn({ method: "POST" }), keyed()));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ tagging: "failed", students: [], mentions: [] });
});

test("POST /api/notes/:noteId/retag returns 404 for an unknown note and 400 for a bad id", async () => {
  expect((await db.request(`/api/notes/${UNKNOWN_ID}/retag`, { method: "POST" })).status).toBe(404);
  expect((await db.request(`/api/notes/nope/retag`, { method: "POST" })).status).toBe(400);
});

test("POST /api/notes/:noteId/students adds a tag with verified quotes and settles the class", async () => {
  const note = await createTagged(result([]));
  expect(note.classId).toBeNull();
  const res = await db.request(`/api/notes/${note.id}/students`, jsonInit("POST", { studentId: STUDENT.rowan, quotes: ["  alex was late.  ", "Alex was late."] }));
  expect(res.status).toBe(201);
  const updated = (await res.json()) as NoteWithTags;
  expect(updated.classId).toBe(CLASS_ID);
  expect(updated.students).toEqual([{ studentId: STUDENT.rowan, quotes: ["Alex was late."] }]);

  // Adding again merges quotes rather than failing on the primary key.
  const again = await db.request(`/api/notes/${note.id}/students`, jsonInit("POST", { studentId: STUDENT.rowan, quotes: ["Avery nailed"] }));
  expect(again.status).toBe(201);
  expect(((await again.json()) as NoteWithTags).students[0]?.quotes).toEqual(["Alex was late.", "Avery nailed"]);

  // A student from another class is allowed (the note spans classes); the class stays.
  const other = await db.request(`/api/notes/${note.id}/students`, jsonInit("POST", { studentId: STUDENT.nola }));
  expect(other.status).toBe(201);
  expect(((await other.json()) as NoteWithTags).classId).toBe(CLASS_ID);
});

test("POST /api/notes/:noteId/students rejects quotes not in the note and unknown students", async () => {
  const note = await createTagged(result([]));
  const bad = await db.request(`/api/notes/${note.id}/students`, jsonInit("POST", { studentId: STUDENT.rowan, quotes: ["never said"] }));
  expect(bad.status).toBe(400);
  expect(((await bad.json()) as { error: string }).error).toMatch(/quote not found/);
  expect((await db.request(`/api/notes/${note.id}/students`, jsonInit("POST", { studentId: UNKNOWN_ID }))).status).toBe(404);
});

test("DELETE /api/notes/:noteId/students/:studentId removes the tag and returns the note; a second delete is 404", async () => {
  const note = await createTagged(result([{ studentId: STUDENT.avery, quotes: [] }, { studentId: STUDENT.nola, quotes: [] }]));
  const path = `/api/notes/${note.id}/students/${STUDENT.avery}`;
  const res = await db.request(path, { method: "DELETE" });
  expect(res.status).toBe(200);
  expect(((await res.json()) as NoteWithTags).students.map((s) => s.studentId)).toEqual([STUDENT.nola]);
  expect((await listOf())[0]!.students.map((s) => s.studentId)).toEqual([STUDENT.nola]);

  expect((await db.request(path, { method: "DELETE" })).status).toBe(404);
  expect((await db.request(`/api/notes/${UNKNOWN_ID}/students/${STUDENT.avery}`, { method: "DELETE" })).status).toBe(404);
  expect((await db.request(`/api/notes/${note.id}/students/nope`, { method: "DELETE" })).status).toBe(400);
});

test("assigning a mention creates a tag with its quotes, closes the mention, and settles the class", async () => {
  const note = await createTagged(result([], [{ mentionText: "Alex", quotes: ["Alex was late."], candidateIds: [STUDENT.alexMarsh, STUDENT.alexRuiz] }]));
  expect(note.classId).toBeNull();
  const mention = note.mentions[0]!;
  const res = await db.request(`/api/notes/${note.id}/mentions/${mention.id}/assign`, jsonInit("POST", { studentId: STUDENT.alexRuiz }));
  expect(res.status).toBe(200);
  const updated = (await res.json()) as NoteWithTags;
  expect(updated.classId).toBe(CLASS_B_ID);
  expect(updated.mentions).toEqual([]);
  expect(updated.students).toContainEqual({ studentId: STUDENT.alexRuiz, quotes: ["Alex was late."] });

  expect((await db.request(`/api/notes/${note.id}/mentions/${mention.id}/assign`, jsonInit("POST", { studentId: STUDENT.alexRuiz }))).status).toBe(404);
});

test("assigning a mention to an unknown student is rejected and keeps the mention", async () => {
  const note = await createTagged();
  const mention = note.mentions[0]!;
  expect((await db.request(`/api/notes/${note.id}/mentions/${mention.id}/assign`, jsonInit("POST", { studentId: UNKNOWN_ID }))).status).toBe(404);
  const [listed] = await listOf(CLASS_ID);
  expect(listed!.mentions).toHaveLength(1);
});

test("dismissing a mention deletes it and returns the note; a second dismiss is 404", async () => {
  const note = await createTagged();
  const path = `/api/notes/${note.id}/mentions/${note.mentions[0]!.id}`;
  const res = await db.request(path, { method: "DELETE" });
  expect(res.status).toBe(200);
  const after = (await res.json()) as NoteWithTags;
  expect(after.mentions).toEqual([]);
  expect(after.students).toHaveLength(2);
  expect((await db.request(path, { method: "DELETE" })).status).toBe(404);
});

// Voice notes: transcription is faked; the route is otherwise the text path.

test("POST /api/notes/voice transcribes the audio, stores a voice note, tags it, and infers the class", async () => {
  const bytes = new Uint8Array([1, 2, 3, 250, 251, 252]);
  const ai = fakeAi("  Avery finished the lab early.  ");
  tagNoteMock.mockReset();
  tagNoteMock.mockResolvedValueOnce(result([{ studentId: STUDENT.avery, quotes: ["Avery finished the lab early."] }]));
  const res = await postVoice(undefined, bytes, { ai, env: keyed() });
  expect(res.status).toBe(201);
  const created = (await res.json()) as Created;
  expect(created).toMatchObject({ classId: CLASS_ID, kind: "voice", body: "Avery finished the lab early.", audioKey: null, tagging: "done" });
  expect(created.students).toEqual([{ studentId: STUDENT.avery, quotes: ["Avery finished the lab early."] }]);
  expect(tagNoteMock.mock.calls[0]![0].body).toBe("Avery finished the lab early.");

  // Whisper got the right model and the exact bytes, base64-encoded.
  expect(ai.run).toHaveBeenCalledTimes(1);
  const [model, input] = ai.run.mock.calls[0] as unknown as [string, { audio: string }];
  expect(model).toBe("@cf/openai/whisper-large-v3-turbo");
  expect(Uint8Array.fromBase64(input.audio)).toEqual(bytes);

  expect((await listOf()).map((n) => n.kind)).toEqual(["voice"]);
});

test("POST /api/notes/voice accepts Safari's audio/mp4 and an explicit class", async () => {
  const res = await postVoice(CLASS_B_ID, new Uint8Array([1]), { type: "audio/mp4" });
  expect(res.status).toBe(201);
  expect(((await res.json()) as Created).classId).toBe(CLASS_B_ID);
});

test("POST /api/notes/voice dates the note from notedAt, and a seen clientId skips Whisper and tagging", async () => {
  const ai = fakeAi("Avery finished the lab early.");
  tagNoteMock.mockReset();
  tagNoteMock.mockResolvedValue(result([{ studentId: STUDENT.avery, quotes: ["Avery finished the lab early."] }]));
  const query = { notedAt: "2026-10-02T09:00:00+01:00", clientId: CLIENT_ID };
  const first = await postVoice(undefined, new Uint8Array([1]), { ai, env: keyed(), query });
  expect(first.status).toBe(201);
  const stored = (await first.json()) as Created;
  expect(stored).toMatchObject({ kind: "voice", notedAt: "2026-10-02T08:00:00.000Z", clientId: CLIENT_ID });

  const again = await postVoice(undefined, new Uint8Array([1]), { ai, env: keyed(), query });
  expect(again.status).toBe(200);
  expect(await again.json()).toEqual({ ...stored, tagging: "done" });
  expect(ai.run).toHaveBeenCalledTimes(1);
  expect(tagNoteMock).toHaveBeenCalledTimes(1);
  expect(await listOf()).toHaveLength(1);
});

test("POST /api/notes/voice rejects a notedAt in the future without calling Whisper", async () => {
  const ai = fakeAi("x");
  const res = await postVoice(undefined, new Uint8Array([1]), { ai, query: { notedAt: "9999-12-31T00:00:00Z" } });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "notedAt is in the future" });
  expect(ai.run).not.toHaveBeenCalled();
});

test("POST /api/notes/voice rejects an empty transcript and writes nothing", async () => {
  const res = await postVoice(undefined, new Uint8Array([1]), { ai: fakeAi("   ") });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "nothing was heard" });
  expect(await listOf()).toEqual([]);
});

test("POST /api/notes/voice rejects an over-long transcript and writes nothing", async () => {
  const res = await postVoice(undefined, new Uint8Array([1]), { ai: fakeAi("x".repeat(50_001)) });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "transcript is too long" });
  expect(await listOf()).toEqual([]);
});

test("POST /api/notes/voice rejects an empty body without calling Whisper", async () => {
  const ai = fakeAi("x");
  const res = await postVoice(undefined, new Uint8Array(0), { ai });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "nothing was heard" });
  expect(ai.run).not.toHaveBeenCalled();
});

test("POST /api/notes/voice rejects a non-audio content type", async () => {
  const res = await postVoice(undefined, "hello", { type: "text/plain" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "unsupported audio type" });
});

test("POST /api/notes/voice rejects an oversized recording", async () => {
  const ai = fakeAi("x");
  const tooBig = new Uint8Array(10 * 1024 * 1024 + 1);
  const res = await postVoice(undefined, tooBig, { ai });
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: "recording is too large" });
  expect(ai.run).not.toHaveBeenCalled();

  // A lying content-length is caught before the body is read.
  const declared = await postVoice(undefined, new Uint8Array([1]), { ai, headers: { "content-length": "99999999" } });
  expect(declared.status).toBe(413);
});

test("POST /api/notes/voice returns 404 for an unknown class without calling Whisper", async () => {
  const ai = fakeAi("x");
  const res = await postVoice(UNKNOWN_ID, new Uint8Array([1]), { ai });
  expect(res.status).toBe(404);
  expect(ai.run).not.toHaveBeenCalled();
});

test("POST /api/notes/voice returns 502 when Whisper fails and writes nothing", async () => {
  const res = await quietErrors(() => postVoice(undefined, new Uint8Array([1]), { ai: fakeAi(new Error("model unavailable")) }));
  expect(res.status).toBe(502);
  expect(await res.json()).toEqual({ error: "transcription failed" });
  expect(await listOf()).toEqual([]);
});

test("another teacher's notes, classes and students are not found, and a clientId is unique per teacher", async () => {
  await db.insertNote(NOTE_ID(1), OTHER_CLASS_ID, "2026-10-01T00:00:00.000Z", OTHER_USER_ID).run();
  expect((await listOf()).map((n) => n.id)).not.toContain(NOTE_ID(1));
  expect((await db.json<NoteWithTags[]>("/api/notes", undefined, "other")).map((n) => n.id)).toEqual([NOTE_ID(1)]);
  expect((await getNotes(OTHER_CLASS_ID)).status).toBe(404);
  expect((await db.request(`/api/notes/${NOTE_ID(1)}/retag`, { method: "POST" })).status).toBe(404);
  expect((await db.request(`/api/notes/${NOTE_ID(1)}/students`, jsonInit("POST", { studentId: STUDENT.avery }))).status).toBe(404);
  expect((await db.request(`/api/notes/${NOTE_ID(1)}/students/${OTHER_STUDENT_ID}`, { method: "DELETE" })).status).toBe(404);

  const mine = (await (await postNote({ body: "A note of mine." })).json()) as Created;
  expect((await db.request(`/api/notes/${mine.id}/students`, jsonInit("POST", { studentId: OTHER_STUDENT_ID }))).status).toBe(404);
  expect((await db.request(`/api/notes/${mine.id}/retag`, { method: "POST" }, "other")).status).toBe(404);

  // Two browsers can mint the same id; each teacher gets their own note.
  const clientId = "66666666-6666-4666-8666-666666666666";
  const a = await db.request("/api/notes", jsonInit("POST", { body: "Mine.", clientId }));
  const b = await db.request("/api/notes", jsonInit("POST", { body: "Theirs.", clientId }), "other");
  expect([a.status, b.status]).toEqual([201, 201]);
  expect(((await a.json()) as Created).id).not.toBe(((await b.json()) as Created).id);
});
