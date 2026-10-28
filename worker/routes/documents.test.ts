import { beforeEach, expect, test, vi } from "vitest";
import app from "../index";
import type { CourseSummary } from "../db/schema";
import type { DocumentImportResult, DocumentKind, DocumentProgress, MaterialRow, NoteWithTags, SessionUser } from "../api-types";
import { sortDocument } from "../document-kind";
import { splitDocument, type SplitResult } from "../documents";
import { summariseMaterial } from "../materials-model";
import { CLASS_B_ID, CLASS_C_ID, OTHER_CLASS_ID, SEED_CLASS_ID as CLASS_ID, STUDENT, UNKNOWN_ID, NOTE_ID, fakeAi, quietErrors, setupTestDb, signedIn } from "../test-db";
import { MAX_UPLOAD_BYTES } from "../upload";

// The sorter, the splitter and the summariser are stubbed: route tests never call the API.
// (wrangler's proxy reads .dev.vars, so once a real key exists an un-stubbed run would make
// real, billable calls.)
vi.mock(import("../document-kind"), async (importOriginal) => ({ ...(await importOriginal()), sortDocument: vi.fn() }));
vi.mock(import("../documents"), async (importOriginal) => ({ ...(await importOriginal()), splitDocument: vi.fn() }));
vi.mock(import("../materials-model"), async (importOriginal) => ({ ...(await importOriginal()), summariseMaterial: vi.fn() }));
const sortMock = vi.mocked(sortDocument);
const splitMock = vi.mocked(splitDocument);
const summariseMock = vi.mocked(summariseMaterial);

const SYLLABUS = "# Humanities syllabus\n\nHomework 20%, Quizzes 20%, Projects 30%, Tests 30%.";
const summary: CourseSummary = {
  description: "Humanities syllabus",
  goals: ["Read a primary source"],
  grading: [
    { category: "Homework", weight: 20 },
    { category: "Tests", weight: 80 },
  ],
  units: [{ name: "The Fertile Crescent", when: "September" }],
  policies: ["Late homework accepted for one week"],
};

// Most tests are about a document of reports, so that is the default guess; the summariser
// answers whenever it is asked.
beforeEach(() => {
  sortMock.mockReset().mockResolvedValue("students");
  splitMock.mockReset();
  summariseMock.mockReset().mockResolvedValue(summary);
});

const db = setupTestDb();
// Same bindings plus an API key, so the model calls are attempted.
const keyed = (): Env => ({ ...db.env, ANTHROPIC_API_KEY: "test-key" });

const listNotes = () => db.json<NoteWithTags[]>("/api/notes");
const listMaterials = (classId: string) => db.json<MaterialRow[]>(`/api/materials?classId=${classId}`);

type PostOpts = { classIds?: string[]; as?: DocumentKind; ai?: ReturnType<typeof fakeAi>; modified?: string; headers?: Record<string, string>; env?: Env };
// An import streams its steps and then its outcome; this reads the stream back into an
// ordinary response with the outcome's status and body, plus the steps it reported.
async function postDocument(name: string, body: BodyInit, opts: PostOpts = {}): Promise<Response & { steps: string[] }> {
  const query = new URLSearchParams({ name, classIds: (opts.classIds ?? [CLASS_ID]).join(",") });
  if (opts.modified) query.set("modified", opts.modified);
  if (opts.as) query.set("as", opts.as);
  const res = await app.request(
    `/api/documents?${query}`,
    signedIn({ method: "POST", headers: { "content-type": "application/octet-stream", ...opts.headers }, body }),
    { ...(opts.env ?? keyed()), AI: (opts.ai ?? fakeAi("")) as unknown as Ai },
  );
  if (res.headers.get("content-type") !== "application/x-ndjson") return Object.assign(res, { steps: [] });
  const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as DocumentProgress);
  const steps = lines.flatMap((l) => ("step" in l ? [l.done ? `${l.step} done` : l.step] : []));
  const last = lines.at(-1)!;
  if ("step" in last) throw new Error("the stream ended without an outcome");
  const outcome = "result" in last ? last.result : { error: last.error };
  return Object.assign(new Response(JSON.stringify(outcome), { status: last.status }), { steps });
}
const imported = async (res: Response | Promise<Response>) => (await (await res).json()) as DocumentImportResult;

const REPORT = ["Mid-term report, 14 November 2025", "", "Avery Quill", "Avery reads widely.", "", "Alex", "Alex was late."].join("\n");

const splitResult = (students: SplitResult["students"], mentions: SplitResult["mentions"] = [], documentDate: string | null = null): SplitResult => ({
  students,
  mentions,
  documentDate,
  usage: { inputTokens: 1, outputTokens: 1 },
});
const averySection = { studentId: STUDENT.avery, classId: CLASS_ID, quotes: ["Avery Quill", "Avery reads widely."] };
const nolaSection = { studentId: STUDENT.nola, classId: CLASS_B_ID, quotes: ["Nola"] };
const alexMention = { mentionText: "Alex", quotes: ["Alex was late."], candidateIds: [STUDENT.alexMarsh, STUDENT.alexRuiz] };

test("POST /api/documents streams each step as it starts and ends, then the outcome", async () => {
  splitMock.mockResolvedValueOnce(splitResult([averySection]));
  const students = await postDocument("report.txt", REPORT);
  expect(students.steps).toEqual(["read", "read done", "sort", "sort done", "split", "split done", "save", "save done"]);

  // Both kinds summarise and split side by side; a given kind skips the sorting call.
  splitMock.mockResolvedValueOnce(splitResult([averySection]));
  const both = await postDocument("letter.md", REPORT, { as: "both" });
  expect(both.steps.slice(0, 4)).toEqual(["read", "read done", "summarise", "split"]);
  expect(both.steps.slice(-2)).toEqual(["save", "save done"]);
  expect(sortMock).toHaveBeenCalledTimes(1);

  // A failure after the stream starts arrives as the last line, with nothing saved.
  const empty = await postDocument("report.txt", new Uint8Array(0));
  expect(empty.steps).toEqual(["read"]);
  expect(empty.status).toBe(400);
});

// Documents of students: one note per student, plus one per unsettled name.

test("POST /api/documents sorts a report pack as students and stores one dated note per student, plus one per unsettled name", async () => {
  const ai = fakeAi("");
  splitMock.mockResolvedValueOnce(splitResult([averySection], [alexMention], "2025-11-14"));
  const res = await postDocument("report.txt", REPORT, { ai, modified: "2026-01-05T10:00:00Z" });
  expect(res.status).toBe(201);
  const { name, kind, classIds, materials, notes, replaced } = await imported(res);
  expect({ name, kind, classIds, materials, replaced }).toEqual({ name: "report.txt", kind: "students", classIds: [CLASS_ID], materials: [], replaced: [] });
  expect(ai.toMarkdown).not.toHaveBeenCalled();
  expect(sortMock.mock.calls[0]![0].text).toBe(REPORT);
  expect(splitMock.mock.calls[0]![0].text).toBe(REPORT);
  expect(summariseMock).not.toHaveBeenCalled();

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

  // Both are in the list like any other note, and nothing became course material.
  expect((await listNotes()).map((n) => n.id).sort()).toEqual(notes.map((n) => n.id).sort());
  expect(await listMaterials(CLASS_ID)).toEqual([]);
});

test("POST /api/documents converts a PDF through toMarkdown and dates notes from the file when the document has no date", async () => {
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
  const { notes } = await imported(res);
  expect(notes[0]!.notedAt).toBe("2026-01-05T10:00:00.000Z");
});

test("POST /api/documents dates notes now when neither the document nor the file says", async () => {
  splitMock.mockResolvedValueOnce(splitResult([averySection]));
  const before = Date.now();
  const res = await postDocument("report.md", REPORT);
  expect(res.status).toBe(201);
  const { notes } = await imported(res);
  expect(Date.parse(notes[0]!.notedAt)).toBeGreaterThanOrEqual(before);
});

test("POST /api/documents writes nothing when a document of students names nobody, or only names without verifiable passages", async () => {
  splitMock.mockResolvedValueOnce(splitResult([]));
  const empty = await postDocument("report.txt", REPORT);
  expect(empty.status).toBe(200);
  expect(await empty.json()).toEqual({ name: "report.txt", kind: "students", classIds: [CLASS_ID], materials: [], notes: [], replaced: [] });

  splitMock.mockResolvedValueOnce(splitResult([{ studentId: STUDENT.avery, classId: CLASS_ID, quotes: [] }]));
  const unverified = await postDocument("report.txt", REPORT);
  expect(unverified.status).toBe(200);
  expect(await listNotes()).toEqual([]);
});

test("POST /api/documents keeps a student's note under the body cap: later passages dropped, a lone oversized one cut", async () => {
  const long = "x".repeat(29_000);
  splitMock.mockResolvedValueOnce(splitResult([{ studentId: STUDENT.avery, classId: CLASS_ID, quotes: [long, long] }]));
  const res = await postDocument("report.txt", `${long}\n${long}`);
  expect(res.status).toBe(201);
  const { notes } = await imported(res);
  expect(notes[0]!.body).toHaveLength(29_000);
  expect(notes[0]!.students[0]!.quotes).toHaveLength(1);

  const huge = "y".repeat(55_000);
  splitMock.mockResolvedValueOnce(splitResult([{ studentId: STUDENT.avery, classId: CLASS_ID, quotes: [huge] }]));
  const made = (await imported(postDocument("long.txt", huge))).notes[0]!;
  expect(made.body).toHaveLength(50_000);
  expect(made.students[0]!.quotes).toEqual([made.body]);
});

test("POST /api/documents shows the splitter only the picked classes' roster", async () => {
  splitMock.mockResolvedValueOnce(splitResult([]));
  await postDocument("report.txt", REPORT, { classIds: [CLASS_ID, CLASS_C_ID] });
  const { roster, classes } = splitMock.mock.calls[0]![0];
  const enrolled = await db.env.DB.prepare("SELECT count(*) AS n FROM students WHERE class_id IN (?, ?)").bind(CLASS_ID, CLASS_C_ID).first<{ n: number }>();
  expect(roster).toHaveLength(enrolled!.n);
  expect(new Set(roster.map((s) => s.classId))).toEqual(new Set([CLASS_ID, CLASS_C_ID]));
  expect(roster.map((s) => s.id)).not.toContain(STUDENT.nola);
  expect(classes.map((k) => k.id).sort()).toEqual([CLASS_ID, CLASS_C_ID].sort());
});

// Course documents: one material per picked class.

test("POST /api/documents stores a course document as one material per picked class, summarised once", async () => {
  sortMock.mockResolvedValueOnce("course");
  const res = await postDocument("syllabus.md", SYLLABUS, { classIds: [CLASS_ID, CLASS_C_ID, CLASS_ID] });
  expect(res.status).toBe(201);
  const result = await imported(res);
  expect(result).toMatchObject({ name: "syllabus.md", kind: "course", classIds: [CLASS_ID, CLASS_C_ID], notes: [], replaced: [] });
  expect(result.splitFailed).toBeUndefined();
  expect(result.materials.map((m) => m.classId)).toEqual([CLASS_ID, CLASS_C_ID]);
  for (const m of result.materials) {
    expect(m).toMatchObject({ name: "syllabus.md", summary });
    expect(m).not.toHaveProperty("text");
  }
  expect(summariseMock).toHaveBeenCalledTimes(1);
  expect(summariseMock.mock.calls[0]![0].text).toBe(SYLLABUS);
  expect(splitMock).not.toHaveBeenCalled();

  // Each class lists its own copy, without the text; the text itself is kept whole.
  expect(await listMaterials(CLASS_ID)).toEqual([result.materials[0]]);
  expect(await listMaterials(CLASS_C_ID)).toEqual([result.materials[1]]);
  expect(await listMaterials(CLASS_B_ID)).toEqual([]);
  const stored = await db.env.DB.prepare("SELECT text FROM class_materials WHERE id = ?").bind(result.materials[0]!.id).first<{ text: string }>();
  expect(stored?.text).toBe(SYLLABUS);
  expect(await listNotes()).toEqual([]);
});

test("POST /api/documents sorts on the start of the text and converts a PDF course document too", async () => {
  sortMock.mockResolvedValueOnce("course");
  const ai = fakeAi("", `  ${SYLLABUS}  `);
  const res = await postDocument("syllabus.pdf", new Uint8Array([37, 80, 68, 70]), { ai });
  expect(res.status).toBe(201);
  expect(ai.toMarkdown).toHaveBeenCalledTimes(1);
  expect(sortMock.mock.calls[0]![0].text).toBe(SYLLABUS);
  expect(summariseMock.mock.calls[0]![0].text).toBe(SYLLABUS);
});

// Both, the as= override, and re-imports.

test("POST /api/documents does both for a document of both kinds", async () => {
  sortMock.mockResolvedValueOnce("both");
  splitMock.mockResolvedValueOnce(splitResult([averySection]));
  const res = await postDocument("letter.md", REPORT);
  expect(res.status).toBe(201);
  const result = await imported(res);
  expect(result.kind).toBe("both");
  expect(result.materials).toHaveLength(1);
  expect(result.notes).toHaveLength(1);
  expect(summariseMock).toHaveBeenCalledTimes(1);
  expect(splitMock).toHaveBeenCalledTimes(1);
  expect(await listMaterials(CLASS_ID)).toHaveLength(1);
  expect(await listNotes()).toHaveLength(1);
});

test("POST /api/documents with as= skips the sorting call", async () => {
  const course = await imported(postDocument("syllabus.md", SYLLABUS, { as: "course" }));
  expect(course.kind).toBe("course");
  splitMock.mockResolvedValueOnce(splitResult([averySection]));
  const students = await imported(postDocument("report.md", REPORT, { as: "students" }));
  expect(students.kind).toBe("students");
  expect(sortMock).not.toHaveBeenCalled();
  expect(summariseMock).toHaveBeenCalledTimes(1);
});

test("POST /api/documents imported again with the other kind replaces what the file made before, in the picked classes only", async () => {
  // A syllabus guessed as course material, in two classes; another file's material beside it.
  sortMock.mockResolvedValueOnce("course");
  const first = await imported(postDocument("unit.md", SYLLABUS, { classIds: [CLASS_ID, CLASS_C_ID] }));
  sortMock.mockResolvedValueOnce("course");
  const other = await imported(postDocument("other.md", SYLLABUS));

  // Switched to student notes in Period 3: its material there goes; Period 5's stays.
  splitMock.mockResolvedValueOnce(splitResult([averySection], [alexMention]));
  const asNotes = await imported(postDocument("unit.md", REPORT, { as: "students" }));
  expect(asNotes.replaced).toEqual([]);
  expect(asNotes.notes).toHaveLength(2);
  expect((await listMaterials(CLASS_ID)).map((m) => m.id)).toEqual([other.materials[0]!.id]);
  expect((await listMaterials(CLASS_C_ID)).map((m) => m.id)).toEqual([first.materials[1]!.id]);

  // And back: the notes go, the unsettled-name note included, and the material returns.
  const asCourse = await imported(postDocument("unit.md", SYLLABUS, { as: "course" }));
  expect(asCourse.replaced.sort()).toEqual(asNotes.notes.map((n) => n.id).sort());
  expect(await listNotes()).toEqual([]);
  expect((await listMaterials(CLASS_ID)).map((m) => m.name).sort()).toEqual(["other.md", "unit.md"]);
});

test("POST /api/documents imported again replaces its notes in the picked classes and leaves other notes alone", async () => {
  // The same file in Period 3 and in B Block, each with a name it could not settle among
  // that class's students (the roster the splitter saw).
  const p3Only = { mentionText: "J", quotes: ["Alex was late."], candidateIds: [STUDENT.juniper, STUDENT.alexMarsh] };
  const bOnly = { mentionText: "Cass", quotes: ["Alex was late."], candidateIds: [STUDENT.cassius, STUDENT.alexRuiz] };
  splitMock.mockResolvedValueOnce(splitResult([averySection], [p3Only]));
  const p3 = await imported(postDocument("report.txt", REPORT));
  splitMock.mockResolvedValueOnce(splitResult([nolaSection], [bOnly]));
  const b = await imported(postDocument("report.txt", REPORT, { classIds: [CLASS_B_ID] }));
  // A note of another kind with the same source name is not touched; neither is another file's.
  await db.insertNote(NOTE_ID(1), CLASS_ID, "2026-10-01T00:00:00.000Z").run();
  await db.env.DB.prepare("UPDATE notes SET source_name = 'report.txt' WHERE id = ?").bind(NOTE_ID(1)).run();
  splitMock.mockResolvedValueOnce(splitResult([averySection]));
  const other = await imported(postDocument("other.txt", REPORT));

  splitMock.mockResolvedValueOnce(splitResult([averySection]));
  const res = await postDocument("report.txt", REPORT);
  expect(res.status).toBe(201);
  const again = await imported(res);
  expect(again.replaced.sort()).toEqual(p3.notes.map((n) => n.id).sort());
  const left = (await listNotes()).map((n) => n.id).sort();
  expect(left).toEqual([...[...again.notes, ...b.notes, ...other.notes].map((n) => n.id), NOTE_ID(1)].sort());
});

// Failure rules.

test("POST /api/documents without an API key stores the file as course material with no summary", async () => {
  const res = await postDocument("syllabus.md", SYLLABUS, { env: db.env });
  expect(res.status).toBe(201);
  const result = await imported(res);
  expect(result.kind).toBe("course");
  expect(result.materials[0]!.summary).toBeNull();
  expect(sortMock).not.toHaveBeenCalled();
  expect(summariseMock).not.toHaveBeenCalled();
});

test("POST /api/documents falls back to course material when sorting fails, and stores it when the summary fails", async () => {
  sortMock.mockRejectedValueOnce(new Error("rate limited"));
  summariseMock.mockRejectedValueOnce(new Error("rate limited"));
  const res = await quietErrors(() => postDocument("syllabus.md", SYLLABUS));
  expect(res.status).toBe(201);
  const result = await imported(res);
  expect(result.kind).toBe("course");
  expect(result.materials[0]!.summary).toBeNull();
  expect(splitMock).not.toHaveBeenCalled();
  expect(await listMaterials(CLASS_ID)).toHaveLength(1);
});

test("POST /api/documents of students is a 502 without an API key or when the split fails, and writes or removes nothing", async () => {
  await imported(postDocument("report.txt", SYLLABUS, { as: "course" }));
  const ai = fakeAi("", REPORT);
  const unkeyed = await postDocument("report.pdf", new Uint8Array([1]), { env: db.env, ai, as: "students" });
  expect(unkeyed.status).toBe(502);
  expect(await unkeyed.json()).toEqual({ error: "could not read the students out of that document" });
  expect(ai.toMarkdown).not.toHaveBeenCalled();

  splitMock.mockRejectedValueOnce(new Error("rate limited"));
  const failed = await quietErrors(() => postDocument("report.txt", REPORT));
  expect(failed.status).toBe(502);
  expect(await listNotes()).toEqual([]);
  // The earlier material of the same name is still there.
  expect(await listMaterials(CLASS_ID)).toHaveLength(1);
});

test("POST /api/documents of both kinds keeps the material and the earlier notes when the split fails", async () => {
  splitMock.mockResolvedValueOnce(splitResult([averySection]));
  const first = await imported(postDocument("letter.md", REPORT, { as: "both" }));

  splitMock.mockRejectedValueOnce(new Error("rate limited"));
  const res = await quietErrors(() => postDocument("letter.md", REPORT, { as: "both" }));
  expect(res.status).toBe(201);
  const again = await imported(res);
  expect(again).toMatchObject({ kind: "both", notes: [], replaced: [], splitFailed: true });
  expect(again.materials).toHaveLength(1);
  expect((await listMaterials(CLASS_ID)).map((m) => m.id)).toEqual([again.materials[0]!.id]);
  expect((await listNotes()).map((n) => n.id)).toEqual([first.notes[0]!.id]);
});

test("POST /api/documents rejects a file it cannot read, an empty one, and one that is too long", async () => {
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
  expect(sortMock).not.toHaveBeenCalled();
  expect(splitMock).not.toHaveBeenCalled();
  expect(summariseMock).not.toHaveBeenCalled();
});

test("POST /api/documents rejects an unsupported type, a missing name, a future modified date, a bad kind, and an oversized file", async () => {
  const ai = fakeAi("");
  expect((await postDocument("notes.xlsx", "x", { ai })).status).toBe(400);
  expect(await (await postDocument("notes.xlsx", "x", { ai })).json()).toEqual({ error: "unsupported file type (use pdf, docx, txt, md)" });
  expect((await app.request(`/api/documents?classIds=${CLASS_ID}`, signedIn({ method: "POST", body: "x" }), keyed())).status).toBe(400);
  expect((await postDocument("report.txt", "x", { ai, modified: "2999-01-01T00:00:00Z" })).status).toBe(400);
  expect((await app.request(`/api/documents?name=a.txt&classIds=${CLASS_ID}&as=grades`, signedIn({ method: "POST", body: "x" }), keyed())).status).toBe(400);

  const tooBig = await postDocument("report.txt", new Uint8Array(MAX_UPLOAD_BYTES + 1), { ai });
  expect(tooBig.status).toBe(413);
  expect(await tooBig.json()).toEqual({ error: "file is too large" });
  const declared = await postDocument("report.txt", "x", { ai, headers: { "content-length": "99999999" } });
  expect(declared.status).toBe(413);
  expect(ai.toMarkdown).not.toHaveBeenCalled();
});

test("POST /api/documents needs at least one known class, and checks them before reading the file", async () => {
  const ai = fakeAi("", REPORT);
  const none = await postDocument("report.pdf", new Uint8Array([1]), { ai, classIds: [] });
  expect(none.status).toBe(400);
  expect(await none.json()).toEqual({ error: "pick a class" });
  const bad = await postDocument("report.pdf", new Uint8Array([1]), { ai, classIds: [CLASS_ID, "nope"] });
  expect(bad.status).toBe(400);
  expect(await bad.json()).toEqual({ error: "classIds must be class ids" });
  const unknown = await postDocument("report.pdf", new Uint8Array([1]), { ai, classIds: [CLASS_ID, UNKNOWN_ID] });
  expect(unknown.status).toBe(404);
  expect(ai.toMarkdown).not.toHaveBeenCalled();
  expect(await listMaterials(CLASS_ID)).toEqual([]);
});

test("a demo visitor's import pays for the notes it writes; at the limit nothing is read, and one that would go over writes nothing", async () => {
  const demo = await db.startDemo();
  const [cls] = await demo.json<{ id: string }[]>("/api/classes");
  const [first, second] = await demo.json<{ id: string }[]>(`/api/students?classId=${cls!.id}`);
  const section = (s: { id: string }) => ({ studentId: s.id, classId: cls!.id, quotes: ["Reads widely."] });
  const left = async () => (await demo.json<SessionUser>("/api/auth/me")).demo!.notesLeft;
  const post = (name: string) =>
    app.request(`/api/documents?${new URLSearchParams({ name, classIds: cls!.id })}`, signedIn({ method: "POST", headers: { "content-type": "application/octet-stream" }, body: "Reads widely." }, { token: demo.token }), {
      ...keyed(),
      AI: fakeAi("") as unknown as Ai,
    });
  const outcome = async (res: Response) => JSON.parse((await res.text()).trim().split("\n").at(-1)!) as { status: number };
  const before = (await demo.json<NoteWithTags[]>("/api/notes")).length;

  await db.setUsed(demo.userId, { notes: 28 });
  splitMock.mockResolvedValueOnce(splitResult([section(first!), section(second!)]));
  expect((await outcome(await post("term-1.txt"))).status).toBe(201);
  expect(await left()).toBe(0);
  expect(await demo.json<NoteWithTags[]>("/api/notes")).toHaveLength(before + 2);

  const refused = await post("term-2.txt");
  expect(refused.status).toBe(403);
  expect(refused.headers.get("content-type")).not.toBe("application/x-ndjson");
  expect(splitMock).toHaveBeenCalledTimes(1);

  await db.setUsed(demo.userId, { notes: 29 });
  splitMock.mockResolvedValueOnce(splitResult([section(first!), section(second!)]));
  expect(await outcome(await post("term-3.txt"))).toEqual({ status: 403, error: "The demo allows 30 notes; sign in with Google to use your own classes" });
  expect(await demo.json<NoteWithTags[]>("/api/notes")).toHaveLength(before + 2);
  expect(await left()).toBe(1);
});

test("a document cannot be imported into another teacher's class", async () => {
  expect((await postDocument("syllabus.md", "# Course", { classIds: [CLASS_ID, OTHER_CLASS_ID] })).status).toBe(404);
});
