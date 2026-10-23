import { beforeEach, expect, test, vi } from "vitest";
import app from "../index";
import type { SynthesisResult, SynthesisRosterRow, SynthesisView } from "../api-types";
import { synthesise, tidy } from "../synthesis-model";
import { ModelError } from "../model";
import { NOTE_ID, PERIOD_3_COUNT, SEED_CLASS_ID as CLASS_ID, STUDENT, UNKNOWN_ID, jsonInit, quietErrors, setupTestDb } from "../test-db";

// The Opus call is stubbed: route tests never call the API. The stub answers through the real
// tidy(), so what is stored has the shape a real answer would.
vi.mock(import("../synthesis-model"), async (importOriginal) => ({ ...(await importOriginal()), synthesise: vi.fn() }));
const synthesiseMock = vi.mocked(synthesise);
beforeEach(() => {
  synthesiseMock.mockReset();
  synthesiseMock.mockImplementation(async ({ evidence }) => ({
    summary: tidy(
      { overview: "Steady term.", highlights: [], strengths: [{ point: "Leads discussion", evidence: ["N1"] }], growth: [], change: [], gaps: [{ area: "Writing", why: "No notes", ask: "How is Avery's writing?" }] },
      evidence,
    ),
    model: "claude-opus-5-5",
  }));
});

const db = setupTestDb();
const keyed = (): Env => ({ ...db.env, ANTHROPIC_API_KEY: "test-key" });

const RANGE = { from: "2026-09-01", to: "2026-12-19" };
// POST with a chosen env: keyed() for a normal run, db.env to have no API key.
const requestWith = async (env: Env, body: object) => app.request("/api/syntheses", jsonInit("POST", body), env);
const roster = (from = RANGE.from, to = RANGE.to) => db.json<SynthesisRosterRow[]>(`/api/syntheses?${new URLSearchParams({ classId: CLASS_ID, from, to })}`);

// A note tagged to a student with a quote, noted on `day` and written at `createdAt`.
async function quoteNote(n: number, studentId: string, day: string, quote: string, createdAt = `${day}T15:00:00.000Z`) {
  await db.env.DB.batch([
    db.env.DB.prepare("INSERT INTO notes (id, class_id, kind, body, noted_at, created_at) VALUES (?, ?, 'text', ?, ?, ?)").bind(NOTE_ID(n), CLASS_ID, quote, `${day}T15:00:00.000Z`, createdAt),
    db.env.DB.prepare("INSERT INTO note_students (note_id, student_id, quotes) VALUES (?, ?, ?)").bind(NOTE_ID(n), studentId, JSON.stringify([quote])),
  ]);
}
const storedCount = async () => (await db.env.DB.prepare("SELECT count(*) AS n FROM syntheses").first<{ n: number }>())!.n;

test("POST /api/syntheses makes and stores a summary, GET /:id returns it, and the roster shows it as current", async () => {
  await quoteNote(1, STUDENT.avery, "2026-09-15", "Avery led the seminar.");
  const res = await requestWith(keyed(), { studentId: STUDENT.avery, ...RANGE });
  expect(res.status).toBe(201);
  const made = (await res.json()) as SynthesisResult;
  expect(made).toMatchObject({ studentId: STUDENT.avery, periodStart: RANGE.from, periodEnd: RANGE.to, model: "claude-opus-5-5", cached: false });
  expect(made).not.toHaveProperty("inputHash");
  expect(made.json.strengths[0]!.evidence[0]).toMatchObject({ type: "note", noteId: NOTE_ID(1), quotes: ["Avery led the seminar."] });
  expect(made.json.coverage.notes).toBe(1);

  const fetched = await db.json<SynthesisView>(`/api/syntheses/${made.id}`);
  expect(fetched.json).toEqual(made.json);
  expect((await db.request(`/api/syntheses/${UNKNOWN_ID}`)).status).toBe(404);

  const rows = await roster();
  expect(rows).toHaveLength(PERIOD_3_COUNT);
  expect(rows.find((r) => r.studentId === STUDENT.avery)).toMatchObject({ status: "current", synthesisId: made.id, newNotes: 0 });
  expect(rows.find((r) => r.studentId === STUDENT.rowan)).toMatchObject({ status: "empty", synthesisId: null });
  // A different range has its own summaries.
  expect((await roster("2026-09-01", "2026-09-30")).find((r) => r.studentId === STUDENT.avery)!.status).toBe("none");
});

test("a second POST with nothing changed returns the saved summary without calling the model", async () => {
  await quoteNote(1, STUDENT.avery, "2026-09-15", "Avery led the seminar.");
  const first = (await (await requestWith(keyed(), { studentId: STUDENT.avery, ...RANGE })).json()) as SynthesisResult;
  const again = await requestWith(keyed(), { studentId: STUDENT.avery, ...RANGE });
  expect(again.status).toBe(200);
  expect(await again.json()).toMatchObject({ id: first.id, cached: true });
  expect(synthesiseMock).toHaveBeenCalledTimes(1);
  expect(await storedCount()).toBe(1);
});

test("a new note makes the summary stale, counts it, and the next POST makes a new one", async () => {
  await quoteNote(1, STUDENT.avery, "2026-09-15", "Avery led the seminar.");
  await requestWith(keyed(), { studentId: STUDENT.avery, ...RANGE });
  await quoteNote(2, STUDENT.avery, "2026-10-01", "Avery rewrote the thesis.", new Date(Date.now() + 1000).toISOString());
  expect((await roster()).find((r) => r.studentId === STUDENT.avery)).toMatchObject({ status: "stale", newNotes: 1 });
  const res = await requestWith(keyed(), { studentId: STUDENT.avery, ...RANGE });
  expect(res.status).toBe(201);
  expect(synthesiseMock).toHaveBeenCalledTimes(2);
  expect(await storedCount()).toBe(2);
  expect((await roster()).find((r) => r.studentId === STUDENT.avery)!.status).toBe("current");
});

test("class notes reach the model as context it cannot cite; notes outside the range do not reach it", async () => {
  await quoteNote(1, STUDENT.avery, "2026-09-15", "Avery led the seminar.");
  await quoteNote(2, STUDENT.avery, "2026-08-15", "Avery's summer reading.");
  await db.env.DB.prepare("INSERT INTO notes (id, class_id, kind, body, noted_at, created_at) VALUES (?, ?, 'text', ?, ?, ?)")
    .bind(NOTE_ID(3), CLASS_ID, "The whole class found the rubric confusing.", "2026-09-20T15:00:00.000Z", "2026-09-20T15:00:00.000Z")
    .run();
  await requestWith(keyed(), { studentId: STUDENT.avery, ...RANGE });
  const { evidence } = synthesiseMock.mock.calls[0]![0];
  expect(evidence.message).toContain("<context>\nC1. 2026-09-20\nThe whole class found the rubric confusing.\n</context>");
  expect(evidence.message).not.toContain("summer reading");
  expect([...evidence.citations.keys()]).toEqual(["N1"]);
});

test("an empty range is a 422 and calls nothing", async () => {
  await quoteNote(1, STUDENT.avery, "2026-08-15", "Avery's summer reading.");
  const res = await requestWith(keyed(), { studentId: STUDENT.avery, ...RANGE });
  expect(res.status).toBe(422);
  expect(synthesiseMock).not.toHaveBeenCalled();
});

test("no API key is a 503 and a model failure a 502; nothing is stored either way", async () => {
  await quoteNote(1, STUDENT.avery, "2026-09-15", "Avery led the seminar.");
  expect((await requestWith(db.env, { studentId: STUDENT.avery, ...RANGE })).status).toBe(503);
  synthesiseMock.mockRejectedValueOnce(new ModelError("model refused synthesis"));
  const failed = await quietErrors(() => requestWith(keyed(), { studentId: STUDENT.avery, ...RANGE }));
  expect(failed.status).toBe(502);
  expect(await storedCount()).toBe(0);
});

test("bad ranges are 400s; an unknown student or class is a 404", async () => {
  for (const body of [{ studentId: STUDENT.avery, from: "2026-12-01", to: "2026-09-01" }, { studentId: STUDENT.avery, from: "Sept 1", to: "2026-12-01" }, { studentId: "nope", ...RANGE }]) {
    expect((await requestWith(keyed(), body)).status).toBe(400);
  }
  expect((await requestWith(keyed(), { studentId: UNKNOWN_ID, ...RANGE })).status).toBe(404);
  expect((await db.request(`/api/syntheses?${new URLSearchParams({ classId: UNKNOWN_ID, ...RANGE })}`)).status).toBe(404);
  expect((await db.request(`/api/syntheses?${new URLSearchParams({ classId: CLASS_ID, from: "2026-12-01", to: "2026-09-01" })}`)).status).toBe(400);
});

test("a student who has left is not listed", async () => {
  await db.env.DB.prepare("UPDATE students SET left_at = '2026-10-01' WHERE id = ?").bind(STUDENT.avery).run();
  const rows = await roster();
  expect(rows).toHaveLength(PERIOD_3_COUNT - 1);
  expect(rows.some((r) => r.studentId === STUDENT.avery)).toBe(false);
});
