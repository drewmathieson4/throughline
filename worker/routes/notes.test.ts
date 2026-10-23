import { beforeEach, expect, test, vi } from "vitest";
import app from "../index";
import { CLASS_B_ID, SEED_CLASS_ID as CLASS_ID, SEED_CLASS_NAMES, SEED_STUDENT_COUNT, STUDENT, UNKNOWN_ID, jsonInit, quietErrors, setupTestDb } from "../test-db";
import { tagNote, type TagResult } from "../tagging";
import { splitDocument, type SplitResult } from "../documents";
import type { DocumentImportResult, NoteWithTags, TaggedNoteResponse as Created } from "../api-types";
import { MAX_UPLOAD_BYTES } from "../upload";

// The tagger and the document splitter are stubbed: route tests never call the API.
// (wrangler's proxy reads .dev.vars, so once a real key exists an un-stubbed run would make
// real, billable calls.)
vi.mock(import("../tagging"), async (importOriginal) => ({ ...(await importOriginal()), tagNote: vi.fn() }));
vi.mock(import("../documents"), async (importOriginal) => ({ ...(await importOriginal()), splitDocument: vi.fn() }));
const tagNoteMock = vi.mocked(tagNote);
const splitMock = vi.mocked(splitDocument);
beforeEach(() => splitMock.mockReset());

const db = setupTestDb();
// Same bindings plus an API key, so tagging is attempted.
const keyed = (): Env => ({ ...db.env, ANTHROPIC_API_KEY: "test-key" });

const getNotes = (classId?: string) => db.request(classId ? `/api/notes?classId=${classId}` : "/api/notes");
const listOf = async (classId?: string) => (await getNotes(classId)).json() as Promise<NoteWithTags[]>;
// A string body is sent verbatim so tests can post malformed JSON.
const postNote = (body: unknown, env?: Env) => app.request("/api/notes", jsonInit("POST", body), env ?? db.env);

// The AI binding is replaced with a fake: Whisper returns `text` (or throws); toMarkdown
// returns `markdown` (or an error result, the way the real one reports an unreadable file).
function fakeAi(text: string | Error, markdown: string | Error = "") {
  return {
    run: vi.fn(async () => {
      if (text instanceof Error) throw text;
      return { text };
    }),
    toMarkdown: vi.fn(async (doc: { name: string }) =>
      markdown instanceof Error
        ? { id: "1", name: doc.name, mimeType: "application/pdf", format: "error", error: markdown.message }
        : { id: "1", name: doc.name, mimeType: "application/pdf", format: "markdown", tokens: 1, data: markdown },
    ),
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
  const res = await app.request(`/api/notes/${failed.id}/retag`, { method: "POST" }, keyed());
  expect(res.status).toBe(200);
  const retagged = (await res.json()) as Created;
  expect(retagged).toMatchObject({ tagging: "done", classId: CLASS_ID });
  expect(retagged.students).toEqual([{ studentId: STUDENT.avery, quotes: ["Avery nailed the quiz."] }]);

  // Now tagged: a second retag would replace what the teacher may have settled, so it is refused.
  expect((await app.request(`/api/notes/${failed.id}/retag`, { method: "POST" }, keyed())).status).toBe(409);
  expect((await app.request(`/api/notes/${(await createTagged()).id}/retag`, { method: "POST" }, keyed())).status).toBe(409);

  // A retag that finds nothing does not clear a class the note already had.
  const classNote = (await (await postNote({ classId: CLASS_ID, body: "Rowdy today." })).json()) as Created;
  tagNoteMock.mockResolvedValueOnce(result([]));
  const again = (await (await app.request(`/api/notes/${classNote.id}/retag`, { method: "POST" }, keyed())).json()) as Created;
  expect(again).toMatchObject({ tagging: "done", classId: CLASS_ID, students: [] });
});

test("POST /api/notes/:noteId/retag reports failure and leaves the note untagged when tagging fails again", async () => {
  tagNoteMock.mockReset();
  const note = (await (await postNote({ body: BODY })).json()) as Created; // no key: untagged
  tagNoteMock.mockRejectedValueOnce(new Error("rate limited"));
  const res = await quietErrors(() => app.request(`/api/notes/${note.id}/retag`, { method: "POST" }, keyed()));
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

// Documents: the file is read (toMarkdown faked for PDFs), the split is stubbed, and the
// route writes one note per student.

const REPORT = ["Mid-term report, 14 November 2025", "", "Avery Quill", "Avery reads widely.", "", "Alex", "Alex was late."].join("\n");

function postDocument(name: string, body: BodyInit, opts: { ai?: ReturnType<typeof fakeAi>; modified?: string; headers?: Record<string, string>; env?: Env } = {}) {
  const query = new URLSearchParams({ name, ...(opts.modified ? { modified: opts.modified } : {}) });
  return app.request(
    `/api/notes/document?${query}`,
    { method: "POST", headers: { "content-type": "application/octet-stream", ...opts.headers }, body },
    { ...(opts.env ?? keyed()), AI: (opts.ai ?? fakeAi("")) as unknown as Ai },
  );
}

const splitResult = (students: SplitResult["students"], mentions: SplitResult["mentions"] = [], documentDate: string | null = null): SplitResult => ({
  students,
  mentions,
  documentDate,
  usage: { inputTokens: 1, outputTokens: 1 },
});
const averySection = { studentId: STUDENT.avery, classId: CLASS_ID, quotes: ["Avery Quill", "Avery reads widely."] };
const alexMention = { mentionText: "Alex", quotes: ["Alex was late."], candidateIds: [STUDENT.alexMarsh, STUDENT.alexRuiz] };

test("POST /api/notes/document reads a text file and stores one dated note per student, plus one per unsettled name", async () => {
  const ai = fakeAi("");
  splitMock.mockResolvedValueOnce(splitResult([averySection], [alexMention], "2025-11-14"));
  const res = await postDocument("report.txt", REPORT, { ai, modified: "2026-01-05T10:00:00Z" });
  expect(res.status).toBe(201);
  const { name, notes } = (await res.json()) as DocumentImportResult;
  expect(name).toBe("report.txt");
  expect(ai.toMarkdown).not.toHaveBeenCalled();
  expect(splitMock.mock.calls[0]![0].text).toBe(REPORT);

  expect(notes).toHaveLength(2);
  const avery = notes.find((n) => n.students.length > 0)!;
  expect(avery).toMatchObject({
    kind: "progress_report",
    classId: CLASS_ID,
    body: "Avery Quill\n\nAvery reads widely.",
    sourceName: "report.txt",
    notedAt: "2025-11-14T12:00:00.000Z",
    students: [{ studentId: STUDENT.avery, quotes: ["Avery Quill", "Avery reads widely."] }],
    mentions: [],
  });
  const alex = notes.find((n) => n.mentions.length > 0)!;
  expect(alex).toMatchObject({ kind: "progress_report", classId: null, body: "Alex was late.", sourceName: "report.txt", students: [] });
  expect(alex.mentions[0]).toMatchObject({ mentionText: "Alex", quotes: ["Alex was late."], candidateIds: [STUDENT.alexMarsh, STUDENT.alexRuiz] });

  // Both are in the list like any other note.
  expect((await listOf()).map((n) => n.id).sort()).toEqual(notes.map((n) => n.id).sort());
});

test("POST /api/notes/document converts a PDF through toMarkdown and dates notes from the file when the document has no date", async () => {
  const bytes = new Uint8Array([37, 80, 68, 70]);
  const ai = fakeAi("", `  ${REPORT}  `);
  splitMock.mockResolvedValueOnce(splitResult([averySection]));
  const res = await postDocument("Report.PDF", bytes, { ai, modified: "2026-01-05T10:00:00Z" });
  expect(res.status).toBe(201);
  expect(ai.toMarkdown).toHaveBeenCalledTimes(1);
  const [doc, options] = ai.toMarkdown.mock.calls[0] as unknown as [{ name: string; blob: Blob }, { conversionOptions: { pdf: { images: { convert: boolean } } } }];
  expect(doc.name).toBe("Report.PDF");
  expect(doc.blob.type).toBe("application/pdf");
  expect(new Uint8Array(await doc.blob.arrayBuffer())).toEqual(bytes);
  expect(options.conversionOptions.pdf.images.convert).toBe(false);
  expect(splitMock.mock.calls[0]![0].text).toBe(REPORT);
  const { notes } = (await res.json()) as DocumentImportResult;
  expect(notes[0]!.notedAt).toBe("2026-01-05T10:00:00.000Z");
});

test("POST /api/notes/document dates notes now when neither the document nor the file says", async () => {
  splitMock.mockResolvedValueOnce(splitResult([averySection]));
  const before = Date.now();
  const res = await postDocument("report.md", REPORT);
  expect(res.status).toBe(201);
  const { notes } = (await res.json()) as DocumentImportResult;
  expect(Date.parse(notes[0]!.notedAt)).toBeGreaterThanOrEqual(before);
});

test("POST /api/notes/document writes nothing when the document names nobody, or only names without verifiable passages", async () => {
  splitMock.mockResolvedValueOnce(splitResult([]));
  const empty = await postDocument("report.txt", REPORT);
  expect(empty.status).toBe(200);
  expect(await empty.json()).toEqual({ name: "report.txt", notes: [], replaced: [] });

  splitMock.mockResolvedValueOnce(splitResult([{ studentId: STUDENT.avery, classId: CLASS_ID, quotes: [] }]));
  const unverified = await postDocument("report.txt", REPORT);
  expect(unverified.status).toBe(200);
  expect(await listOf()).toEqual([]);
});

test("POST /api/notes/document keeps a student's note under the body cap: later passages dropped, a lone oversized one cut", async () => {
  const long = "x".repeat(29_000);
  splitMock.mockResolvedValueOnce(splitResult([{ studentId: STUDENT.avery, classId: CLASS_ID, quotes: [long, long] }]));
  const res = await postDocument("report.txt", `${long}\n${long}`);
  expect(res.status).toBe(201);
  const { notes } = (await res.json()) as DocumentImportResult;
  expect(notes[0]!.body).toHaveLength(29_000);
  expect(notes[0]!.students[0]!.quotes).toHaveLength(1);

  const huge = "y".repeat(55_000);
  splitMock.mockResolvedValueOnce(splitResult([{ studentId: STUDENT.avery, classId: CLASS_ID, quotes: [huge] }]));
  const cut = await postDocument("long.txt", huge);
  expect(cut.status).toBe(201);
  const made = ((await cut.json()) as DocumentImportResult).notes[0]!;
  expect(made.body).toHaveLength(50_000);
  expect(made.students[0]!.quotes).toEqual([made.body]);
});

test("POST /api/notes/document uploaded again replaces the notes made from the same file", async () => {
  splitMock.mockResolvedValueOnce(splitResult([averySection], [alexMention]));
  const first = (await (await postDocument("report.txt", REPORT)).json()) as DocumentImportResult;
  expect(first.replaced).toEqual([]);
  // A note of another kind with the same source name is not touched; neither is another file's.
  await db.env.DB.prepare("UPDATE notes SET source_name = 'report.txt' WHERE id = ?").bind((await createTagged()).id).run();
  splitMock.mockResolvedValueOnce(splitResult([averySection]));
  await postDocument("other.txt", REPORT);

  splitMock.mockResolvedValueOnce(splitResult([averySection]));
  const res = await postDocument("report.txt", REPORT);
  expect(res.status).toBe(201);
  const second = (await res.json()) as DocumentImportResult;
  expect(second.replaced.sort()).toEqual(first.notes.map((n) => n.id).sort());
  expect(second.notes).toHaveLength(1);
  const all = await listOf();
  expect(all.filter((n) => n.sourceName === "report.txt" && n.kind === "progress_report").map((n) => n.id)).toEqual([second.notes[0]!.id]);
  expect(all.filter((n) => n.sourceName === "report.txt" && n.kind === "text")).toHaveLength(1);
  expect(all.filter((n) => n.sourceName === "other.txt")).toHaveLength(1);
  expect(all).toHaveLength(3);
});

test("POST /api/notes/document is a 502 without an API key or when the split fails, and writes nothing", async () => {
  const ai = fakeAi("", REPORT);
  const unkeyed = await postDocument("report.pdf", new Uint8Array([1]), { env: db.env, ai });
  expect(unkeyed.status).toBe(502);
  expect(await unkeyed.json()).toEqual({ error: "could not read the students out of that document" });
  expect(splitMock).not.toHaveBeenCalled();
  expect(ai.toMarkdown).not.toHaveBeenCalled();

  splitMock.mockRejectedValueOnce(new Error("rate limited"));
  const failed = await quietErrors(() => postDocument("report.txt", REPORT));
  expect(failed.status).toBe(502);
  expect(await listOf()).toEqual([]);
});

test("POST /api/notes/document rejects a file it cannot read, an empty one, and one that is too long", async () => {
  const unreadable = await quietErrors(() => postDocument("scan.pdf", new Uint8Array([1]), { ai: fakeAi("", new Error("no text layer")) }));
  expect(unreadable.status).toBe(400);
  expect(await unreadable.json()).toEqual({ error: "could not read that file" });

  const blank = await postDocument("blank.pdf", new Uint8Array([1]), { ai: fakeAi("", "   ") });
  expect(blank.status).toBe(400);
  expect(await blank.json()).toEqual({ error: "could not read that file" });

  // The binding throws (rather than answering with an error result) on input it will not take.
  const throwing = fakeAi("");
  throwing.toMarkdown.mockRejectedValueOnce(new Error("Too small"));
  const refused = await quietErrors(() => postDocument("odd.docx", new Uint8Array([1]), { ai: throwing }));
  expect(refused.status).toBe(400);
  expect(await refused.json()).toEqual({ error: "could not read that file" });

  const empty = await postDocument("report.txt", new Uint8Array(0));
  expect(empty.status).toBe(400);
  expect(await empty.json()).toEqual({ error: "file is empty" });

  const long = await postDocument("report.txt", "x".repeat(60_001));
  expect(long.status).toBe(400);
  expect(await long.json()).toEqual({ error: "file is too long (over 60,000 characters)" });
  expect(splitMock).not.toHaveBeenCalled();
});

test("POST /api/notes/document rejects an unsupported type, a missing name, a future modified date, and an oversized file", async () => {
  const ai = fakeAi("");
  expect((await postDocument("notes.xlsx", "x", { ai })).status).toBe(400);
  expect(await (await postDocument("notes.xlsx", "x", { ai })).json()).toEqual({ error: "unsupported file type (use pdf, docx, txt, md)" });
  expect((await app.request("/api/notes/document", { method: "POST", body: "x" }, keyed())).status).toBe(400);
  expect((await postDocument("report.txt", "x", { ai, modified: "2999-01-01T00:00:00Z" })).status).toBe(400);

  const tooBig = await postDocument("report.txt", new Uint8Array(MAX_UPLOAD_BYTES + 1), { ai });
  expect(tooBig.status).toBe(413);
  expect(await tooBig.json()).toEqual({ error: "file is too large" });
  const declared = await postDocument("report.txt", "x", { ai, headers: { "content-length": "99999999" } });
  expect(declared.status).toBe(413);
  expect(ai.toMarkdown).not.toHaveBeenCalled();
});
