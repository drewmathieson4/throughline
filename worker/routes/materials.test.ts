import { beforeEach, expect, test, vi } from "vitest";
import app from "../index";
import type { CourseSummary } from "../db/schema";
import type { MaterialRow } from "../api-types";
import { summariseMaterial } from "../materials-model";
import { CLASS_B_ID, SEED_CLASS_ID as CLASS_ID, UNKNOWN_ID, fakeAi, quietErrors, setupTestDb } from "../test-db";

// The summariser is stubbed: route tests never call the API.
vi.mock(import("../materials-model"), async (importOriginal) => ({ ...(await importOriginal()), summariseMaterial: vi.fn() }));
const summariseMock = vi.mocked(summariseMaterial);
beforeEach(() => summariseMock.mockReset());

const db = setupTestDb();
const keyed = (): Env => ({ ...db.env, ANTHROPIC_API_KEY: "test-key" });

const SYLLABUS = "# Humanities syllabus\n\nHomework 20%, Quizzes 20%, Projects 30%, Tests 30%.";
const summary: CourseSummary = {
  description: "Humanities syllabus",
  goals: ["Read a primary source"],
  grading: [
    { category: "Homework", weight: 20 },
    { category: "Quizzes", weight: 20 },
    { category: "Projects", weight: 30 },
    { category: "Tests", weight: 30 },
  ],
  units: [{ name: "The Fertile Crescent", when: "September" }],
  policies: ["Late homework accepted for one week"],
};

function upload(classId: string, name: string, body: BodyInit, opts: { ai?: ReturnType<typeof fakeAi>; env?: Env; headers?: Record<string, string> } = {}) {
  const query = new URLSearchParams({ classId, name });
  return app.request(
    `/api/materials?${query}`,
    { method: "POST", headers: { "content-type": "application/octet-stream", ...opts.headers }, body },
    { ...(opts.env ?? keyed()), AI: (opts.ai ?? fakeAi("")) as unknown as Ai },
  );
}
const list = (classId: string) => db.request(`/api/materials?classId=${classId}`);
const listJson = (classId: string) => db.json<MaterialRow[]>(`/api/materials?classId=${classId}`);

test("POST /api/materials reads a text file, summarises it, stores it, and GET lists it without the text", async () => {
  summariseMock.mockResolvedValueOnce(summary);
  const res = await upload(CLASS_ID, "syllabus.md", SYLLABUS);
  expect(res.status).toBe(201);
  const row = (await res.json()) as MaterialRow;
  expect(row).toMatchObject({ classId: CLASS_ID, name: "syllabus.md", summary });
  expect(row).not.toHaveProperty("text");
  expect(summariseMock.mock.calls[0]![0].text).toBe(SYLLABUS);

  const rows = await listJson(CLASS_ID);
  expect(rows).toEqual([row]);
  expect(await listJson(CLASS_B_ID)).toEqual([]);

  // The text itself is kept whole.
  const stored = await db.env.DB.prepare("SELECT text FROM class_materials WHERE id = ?").bind(row.id).first<{ text: string }>();
  expect(stored?.text).toBe(SYLLABUS);
});

test("GET /api/materials lists newest first and 404s an unknown class", async () => {
  summariseMock.mockResolvedValue(summary);
  // Only Date is faked, so the two uploads cannot share a millisecond.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-23T10:00:00Z") });
  try {
    await upload(CLASS_ID, "first.md", "one");
    vi.setSystemTime(new Date("2026-10-23T10:00:01Z"));
    await upload(CLASS_ID, "second.md", "two");
  } finally {
    vi.useRealTimers();
  }
  expect((await listJson(CLASS_ID)).map((m) => m.name)).toEqual(["second.md", "first.md"]);
  expect((await list(UNKNOWN_ID)).status).toBe(404);
  expect((await list("nope")).status).toBe(400);
});

test("POST /api/materials converts a PDF through toMarkdown", async () => {
  const ai = fakeAi("", `  ${SYLLABUS}  `);
  summariseMock.mockResolvedValueOnce(summary);
  const res = await upload(CLASS_ID, "syllabus.pdf", new Uint8Array([37, 80, 68, 70]), { ai });
  expect(res.status).toBe(201);
  expect(ai.toMarkdown).toHaveBeenCalledTimes(1);
  expect(summariseMock.mock.calls[0]![0].text).toBe(SYLLABUS);
});

test("POST /api/materials stores the file with no summary when there is no key or the model fails", async () => {
  const unkeyed = await upload(CLASS_ID, "syllabus.md", SYLLABUS, { env: db.env });
  expect(unkeyed.status).toBe(201);
  expect(((await unkeyed.json()) as MaterialRow).summary).toBeNull();
  expect(summariseMock).not.toHaveBeenCalled();

  summariseMock.mockRejectedValueOnce(new Error("rate limited"));
  const failed = await quietErrors(() => upload(CLASS_ID, "syllabus.md", SYLLABUS));
  expect(failed.status).toBe(201);
  expect(((await failed.json()) as MaterialRow).summary).toBeNull();
  expect(await listJson(CLASS_ID)).toHaveLength(2);
});

test("POST /api/materials rejects an unknown class, an unreadable file, an empty one, one that is too long, and a bad type", async () => {
  expect((await upload(UNKNOWN_ID, "syllabus.md", SYLLABUS)).status).toBe(404);
  const unreadable = await quietErrors(() => upload(CLASS_ID, "scan.pdf", new Uint8Array([1]), { ai: fakeAi("", new Error("no text")) }));
  expect(unreadable.status).toBe(400);
  expect(await unreadable.json()).toEqual({ error: "could not read that file" });
  expect((await upload(CLASS_ID, "syllabus.md", new Uint8Array(0))).status).toBe(400);
  expect((await upload(CLASS_ID, "syllabus.md", "x".repeat(60_001))).status).toBe(400);
  expect((await upload(CLASS_ID, "syllabus.xlsx", "x")).status).toBe(400);
  expect(summariseMock).not.toHaveBeenCalled();
  expect(await listJson(CLASS_ID)).toEqual([]);
});

test("DELETE /api/materials/:id removes one material; deleting the class removes the rest", async () => {
  summariseMock.mockResolvedValue(summary);
  const a = (await (await upload(CLASS_ID, "a.md", "a")).json()) as MaterialRow;
  const b = (await (await upload(CLASS_ID, "b.md", "b")).json()) as MaterialRow;
  const res = await db.request(`/api/materials/${a.id}`, { method: "DELETE" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: a.id });
  expect((await db.request(`/api/materials/${a.id}`, { method: "DELETE" })).status).toBe(404);
  expect((await listJson(CLASS_ID)).map((m) => m.id)).toEqual([b.id]);

  await db.env.DB.prepare("DELETE FROM classes WHERE id = ?").bind(CLASS_ID).run();
  const left = await db.env.DB.prepare("SELECT count(*) AS n FROM class_materials").first<{ n: number }>();
  expect(left?.n).toBe(0);
});
