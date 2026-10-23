import { expect, test, vi } from "vitest";
import app from "../index";
import { CLASS_B_ID, SEED_CLASS_ID as CLASS_ID, SEED_CLASS_NAMES, SEED_STUDENT_COUNT, STUDENT, UNKNOWN_ID, jsonInit, quietErrors, setupTestDb } from "../test-db";
import { tagNote, type TagResult } from "../tagging";
import type { NoteWithTags, TaggedNoteResponse as Created } from "../api-types";

// The tagger is stubbed: route tests never call the API. (wrangler's proxy reads .dev.vars,
// so once a real key exists an un-stubbed run would make real, billable calls.)
vi.mock(import("../tagging"), async (importOriginal) => ({ ...(await importOriginal()), tagNote: vi.fn() }));
const tagNoteMock = vi.mocked(tagNote);

const db = setupTestDb();
// Same bindings plus an API key, so tagging is attempted.
const keyed = (): Env => ({ ...db.env, ANTHROPIC_API_KEY: "test-key" });

const getNotes = (classId?: string) => db.request(classId ? `/api/notes?classId=${classId}` : "/api/notes");
const listOf = async (classId?: string) => (await getNotes(classId)).json() as Promise<NoteWithTags[]>;
// A string body is sent verbatim so tests can post malformed JSON.
const postNote = (body: unknown, env?: Env) => app.request("/api/notes", jsonInit("POST", body), env ?? db.env);

// Voice notes: the AI binding is replaced with a fake that returns `text`, or throws.
function fakeAi(text: string | Error) {
  return {
    run: vi.fn(async () => {
      if (text instanceof Error) throw text;
      return { text };
    }),
  };
}

function postVoice(
  classId: string | undefined,
  audio: BodyInit,
  opts: { ai?: ReturnType<typeof fakeAi>; type?: string; headers?: Record<string, string>; env?: Env } = {},
) {
  const ai = opts.ai ?? fakeAi("Transcribed.");
  return app.request(
    classId ? `/api/notes/voice?classId=${classId}` : "/api/notes/voice",
    { method: "POST", headers: { "content-type": opts.type ?? "audio/webm;codecs=opus", ...opts.headers }, body: audio },
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
    stmts.push(db.insertNote(id, CLASS_ID, now), db.tagNote(id, STUDENT.avery, 0));
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

test("POST /api/notes rejects malformed JSON", async () => {
  const res = await postNote("{not json");
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Malformed JSON in request body" });
});

test("POST /api/notes returns 404 for an unknown class when one is given", async () => {
  expect((await postNote({ classId: UNKNOWN_ID, body: "x" })).status).toBe(404);
});

test("POST /api/notes stores suggestions as unconfirmed with quotes, open mentions, and the inferred class", async () => {
  const created = await createTagged();
  expect(created.tagging).toBe("done");
  expect(created.classId).toBe(CLASS_ID);
  expect(created.students).toEqual([
    { studentId: STUDENT.avery, confirmed: 0, quotes: ["Avery nailed the quiz."] },
    { studentId: STUDENT.juniper, confirmed: 0, quotes: ["Juni asked for help again."] },
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

test("POST /api/notes/:noteId/retag replaces suggestions and mentions but keeps confirmed tags and the class", async () => {
  const note = await createTagged();
  expect((await db.request(`/api/notes/${note.id}/students/${STUDENT.avery}/confirm`, { method: "POST" })).status).toBe(200);

  tagNoteMock.mockResolvedValueOnce(
    result([
      { studentId: STUDENT.avery, quotes: ["Avery nailed the quiz.", "Alex was late."] },
      { studentId: STUDENT.rowan, quotes: [] },
    ]),
  );
  const res = await app.request(`/api/notes/${note.id}/retag`, { method: "POST" }, keyed());
  expect(res.status).toBe(200);
  const retagged = (await res.json()) as Created;
  expect(retagged.tagging).toBe("done");
  expect(retagged.classId).toBe(CLASS_ID);
  expect(retagged.students).toEqual([
    { studentId: STUDENT.avery, confirmed: 1, quotes: ["Avery nailed the quiz.", "Alex was late."] },
    { studentId: STUDENT.rowan, confirmed: 0, quotes: [] },
  ]);
  expect(retagged.mentions).toEqual([]);

  // A retag that finds nothing does not clear the class either.
  tagNoteMock.mockResolvedValueOnce(result([]));
  const again = (await (await app.request(`/api/notes/${note.id}/retag`, { method: "POST" }, keyed())).json()) as Created;
  expect(again.classId).toBe(CLASS_ID);
});

test("POST /api/notes/:noteId/retag keeps existing suggestions when tagging fails", async () => {
  const note = await createTagged();
  tagNoteMock.mockRejectedValueOnce(new Error("rate limited"));
  const res = await quietErrors(() => app.request(`/api/notes/${note.id}/retag`, { method: "POST" }, keyed()));
  expect(res.status).toBe(200);
  const after = (await res.json()) as Created;
  expect(after.tagging).toBe("failed");
  expect(after.students).toEqual(note.students);
  expect(after.mentions).toEqual(note.mentions);
});

test("POST /api/notes/:noteId/retag returns 404 for an unknown note and 400 for a bad id", async () => {
  expect((await db.request(`/api/notes/${UNKNOWN_ID}/retag`, { method: "POST" })).status).toBe(404);
  expect((await db.request(`/api/notes/nope/retag`, { method: "POST" })).status).toBe(400);
});

test("POST /api/notes/:noteId/students adds a confirmed tag with verified quotes and settles the class", async () => {
  const note = await createTagged(result([]));
  expect(note.classId).toBeNull();
  const res = await db.request(`/api/notes/${note.id}/students`, jsonInit("POST", { studentId: STUDENT.rowan, quotes: ["  alex was late.  ", "Alex was late."] }));
  expect(res.status).toBe(201);
  const updated = (await res.json()) as NoteWithTags;
  expect(updated.classId).toBe(CLASS_ID);
  expect(updated.students).toEqual([{ studentId: STUDENT.rowan, confirmed: 1, quotes: ["Alex was late."] }]);

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

test("confirm flips the flag and settles the class; delete removes the tag; both 404 when missing", async () => {
  // Avery and Nola span two classes, so the note starts unassigned.
  const note = await createTagged(result([{ studentId: STUDENT.avery, quotes: [] }, { studentId: STUDENT.nola, quotes: [] }]));
  expect(note.classId).toBeNull();
  const path = `/api/notes/${note.id}/students/${STUDENT.avery}`;

  const confirmed = await db.request(`${path}/confirm`, { method: "POST" });
  expect(confirmed.status).toBe(200);
  const after = (await confirmed.json()) as NoteWithTags;
  expect(after.classId).toBe(CLASS_ID);
  expect(after.students.find((s) => s.studentId === STUDENT.avery)?.confirmed).toBe(1);

  expect((await db.request(path, { method: "DELETE" })).status).toBe(204);
  const [listed] = await listOf(CLASS_ID);
  expect(listed!.students.map((s) => s.studentId)).toEqual([STUDENT.nola]);

  expect((await db.request(`${path}/confirm`, { method: "POST" })).status).toBe(404);
  expect((await db.request(path, { method: "DELETE" })).status).toBe(404);
  expect((await db.request(`/api/notes/${UNKNOWN_ID}/students/${STUDENT.avery}/confirm`, { method: "POST" })).status).toBe(404);
  expect((await db.request(`/api/notes/${note.id}/students/nope/confirm`, { method: "POST" })).status).toBe(400);
});

test("assigning a mention creates a confirmed tag with its quotes, closes the mention, and settles the class", async () => {
  const note = await createTagged(result([], [{ mentionText: "Alex", quotes: ["Alex was late."], candidateIds: [STUDENT.alexMarsh, STUDENT.alexRuiz] }]));
  expect(note.classId).toBeNull();
  const mention = note.mentions[0]!;
  const res = await db.request(`/api/notes/${note.id}/mentions/${mention.id}/assign`, jsonInit("POST", { studentId: STUDENT.alexRuiz }));
  expect(res.status).toBe(200);
  const updated = (await res.json()) as NoteWithTags;
  expect(updated.classId).toBe(CLASS_B_ID);
  expect(updated.mentions).toEqual([]);
  expect(updated.students).toContainEqual({ studentId: STUDENT.alexRuiz, confirmed: 1, quotes: ["Alex was late."] });

  expect((await db.request(`/api/notes/${note.id}/mentions/${mention.id}/assign`, jsonInit("POST", { studentId: STUDENT.alexRuiz }))).status).toBe(404);
});

test("assigning a mention to an unknown student is rejected and keeps the mention", async () => {
  const note = await createTagged();
  const mention = note.mentions[0]!;
  expect((await db.request(`/api/notes/${note.id}/mentions/${mention.id}/assign`, jsonInit("POST", { studentId: UNKNOWN_ID }))).status).toBe(404);
  const [listed] = await listOf(CLASS_ID);
  expect(listed!.mentions).toHaveLength(1);
});

test("dismissing a mention deletes it; a second dismiss is 404", async () => {
  const note = await createTagged();
  const path = `/api/notes/${note.id}/mentions/${note.mentions[0]!.id}`;
  expect((await db.request(path, { method: "DELETE" })).status).toBe(204);
  expect((await db.request(path, { method: "DELETE" })).status).toBe(404);
  const [listed] = await listOf(CLASS_ID);
  expect(listed!.mentions).toEqual([]);
  expect(listed!.students).toHaveLength(2);
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
  expect(created.students).toEqual([{ studentId: STUDENT.avery, confirmed: 0, quotes: ["Avery finished the lab early."] }]);
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
