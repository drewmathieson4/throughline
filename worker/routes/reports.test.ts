import { beforeEach, expect, test, vi } from "vitest";
import app from "../index";
import type { ClassSettingsView, ReportView, SessionUser, Synthesis, SynthesisRosterRow } from "../api-types";
import { ModelError } from "../model";
import { writeReport } from "../report-model";
import { ACCOUNT_CAP_MICRO, TOTAL_CAP_MICRO } from "../spend";
import { DEV_EMAIL, DEV_USER_ID, OTHER_CLASS_ID, OTHER_STUDENT_ID, OTHER_USER_ID, SEED_CLASS_ID as CLASS_ID, STUDENT, UNKNOWN_ID, jsonInit, quietErrors, setupTestDb, signedIn } from "../test-db";

// The Opus call is stubbed: route tests never call the API.
vi.mock(import("../report-model"), async (importOriginal) => ({ ...(await importOriginal()), writeReport: vi.fn() }));
const writeMock = vi.mocked(writeReport);
beforeEach(() => {
  writeMock.mockReset();
  writeMock.mockResolvedValue({ text: "Avery has found her voice this term.", model: "claude-opus-5-5" });
});

const db = setupTestDb();
const keyed = (): Env => ({ ...db.env, ANTHROPIC_API_KEY: "test-key" });

const RANGE = { from: "2026-09-01", to: "2026-12-19" };
const SYNTHESIS_ID = (n: number) => `77777777-7777-4777-8777-7777777777${String(n).padStart(2, "0")}`;
const REPORT_ID = (n: number) => `88888888-8888-4888-8888-8888888888${String(n).padStart(2, "0")}`;
const summary: Synthesis = {
  overview: "Steady term.",
  highlights: [],
  strengths: [{ point: "Leads discussion", evidence: [{ type: "note", noteId: UNKNOWN_ID, notedAt: "2026-09-15T15:00:00.000Z", kind: "text", sourceName: null, quotes: ["Avery led the seminar."] }] }],
  growth: [],
  change: [],
  goals: [],
  gaps: [],
  coverage: { label: "very_thin", notes: 1, bySource: { text: 1 }, lastNotedAt: "2026-09-15T15:00:00.000Z", daysSinceLastNote: 0, longestSilenceDays: 0, emptyMonths: [], grades: 0, missing: 0, undatedGrades: false },
  grades: null,
};

const post = (env: Env, body: object, who?: Parameters<typeof signedIn>[1]) => app.request("/api/reports", signedIn(jsonInit("POST", body), who), env);
const patch = (id: string, body: unknown, who?: Parameters<typeof signedIn>[1]) => db.request(`/api/reports/${id}`, jsonInit("PATCH", body), who);
const roster = () => db.json<SynthesisRosterRow[]>(`/api/syntheses?${new URLSearchParams({ classId: CLASS_ID, ...RANGE })}`);
const storedCount = async () => (await db.env.DB.prepare("SELECT count(*) AS n FROM reports").first<{ n: number }>())!.n;

test("POST /api/reports writes and stores a report from a summary, GET /:id returns it, and the roster points at it", async () => {
  await db.insertSynthesis(SYNTHESIS_ID(1), STUDENT.avery, RANGE, summary).run();
  const res = await post(keyed(), { synthesisId: SYNTHESIS_ID(1) });
  expect(res.status).toBe(201);
  const made = (await res.json()) as ReportView;
  expect(made).toMatchObject({ synthesisId: SYNTHESIS_ID(1), model: "claude-opus-5-5", generatedText: "Avery has found her voice this term.", editedText: null });
  expect(await db.json<ReportView>(`/api/reports/${made.id}`)).toEqual(made);
  expect((await db.request(`/api/reports/${UNKNOWN_ID}`)).status).toBe(404);

  // The model read the summary, the student's first name, the class and the period, with no settings yet.
  const { report } = writeMock.mock.calls[0]![0];
  expect(report).toMatchObject({ firstName: "Avery", className: "Period 3 Humanities", period: RANGE, rules: null, samples: null });
  expect(report.synthesis.overview).toBe("Steady term.");

  expect((await roster()).find((r) => r.studentId === STUDENT.avery)).toMatchObject({ synthesisId: SYNTHESIS_ID(1), reportId: made.id });
  expect((await roster()).find((r) => r.studentId === STUDENT.rowan)).toMatchObject({ synthesisId: null, reportId: null });
});

test("the class's settings reach the model, and writing again makes a newer row the roster points at", async () => {
  await db.insertSynthesis(SYNTHESIS_ID(1), STUDENT.avery, RANGE, summary).run();
  const settings = { reportRules: { sentences: 3, avoid: ["always"], notes: "Mention the trip." }, styleSamples: "Rowan has had a strong term." };
  expect(await db.json<ClassSettingsView>(`/api/classes/${CLASS_ID}/settings`, jsonInit("PUT", settings))).toEqual(settings);
  const first = (await (await post(keyed(), { synthesisId: SYNTHESIS_ID(1) })).json()) as ReportView;
  expect(writeMock.mock.calls[0]![0].report).toMatchObject({ rules: settings.reportRules, samples: settings.styleSamples });

  writeMock.mockResolvedValueOnce({ text: "Avery has grown this term.", model: "claude-opus-5-5" });
  const second = (await (await post(keyed(), { synthesisId: SYNTHESIS_ID(1) })).json()) as ReportView;
  expect(second.id).not.toBe(first.id);
  expect(await storedCount()).toBe(2);
  expect((await roster()).find((r) => r.studentId === STUDENT.avery)!.reportId).toBe(second.id);
  // The older one is still there to read.
  expect((await db.json<ReportView>(`/api/reports/${first.id}`)).generatedText).toBe("Avery has found her voice this term.");
});

test("PATCH saves the teacher's edit and null puts it back; the generated text never changes", async () => {
  await db.insertSynthesis(SYNTHESIS_ID(1), STUDENT.avery, RANGE, summary).run();
  await db.insertReport(REPORT_ID(1), SYNTHESIS_ID(1), "Generated.").run();
  const edited = await patch(REPORT_ID(1), { editedText: "Edited by hand." });
  expect(edited.status).toBe(200);
  expect(await edited.json()).toMatchObject({ id: REPORT_ID(1), generatedText: "Generated.", editedText: "Edited by hand." });
  expect((await db.json<ReportView>(`/api/reports/${REPORT_ID(1)}`)).editedText).toBe("Edited by hand.");
  expect(await (await patch(REPORT_ID(1), { editedText: null })).json()).toMatchObject({ generatedText: "Generated.", editedText: null });

  for (const body of [{}, { editedText: 5 }, { editedText: "x".repeat(5001) }, "{nope"]) {
    expect((await patch(REPORT_ID(1), body)).status).toBe(400);
  }
  expect((await patch(UNKNOWN_ID, { editedText: "x" })).status).toBe(404);
  expect((await patch("nope", { editedText: "x" })).status).toBe(400);
});

test("no API key is a 503 and a model failure a 502; nothing is stored either way", async () => {
  await db.insertSynthesis(SYNTHESIS_ID(1), STUDENT.avery, RANGE, summary).run();
  expect((await post(db.env, { synthesisId: SYNTHESIS_ID(1) })).status).toBe(503);
  writeMock.mockRejectedValueOnce(new ModelError("model refused report"));
  expect((await post(keyed(), { synthesisId: SYNTHESIS_ID(1) })).status).toBe(502);
  writeMock.mockRejectedValueOnce(new Error("network"));
  expect((await quietErrors(() => post(keyed(), { synthesisId: SYNTHESIS_ID(1) }))).status).toBe(502);
  expect(await storedCount()).toBe(0);
  expect((await post(keyed(), { synthesisId: "nope" })).status).toBe(400);
  expect((await post(keyed(), { synthesisId: UNKNOWN_ID })).status).toBe(404);
});

test("a demo visitor gets four reports, counted apart from their evidence summaries, and a failed one is given back", async () => {
  const demo = await db.startDemo();
  const [cls] = await demo.json<{ id: string }[]>("/api/classes");
  const [student] = await demo.json<{ id: string }[]>(`/api/students?classId=${cls!.id}`);
  await db.insertSynthesis(SYNTHESIS_ID(1), student!.id, RANGE, summary).run();
  const write = () => post(keyed(), { synthesisId: SYNTHESIS_ID(1) }, { token: demo.token });
  const me = () => demo.json<SessionUser>("/api/auth/me");

  await db.setUsed(demo.userId, { reports: 3, evidence: 1 });
  expect((await write()).status).toBe(201);
  expect((await me()).demo).toMatchObject({ reportsLeft: 0, evidenceLeft: 3 });
  const refused = await write();
  expect(refused.status).toBe(403);
  expect(await refused.json()).toEqual({ error: "The demo allows 4 reports; sign in with Google to use your own classes" });
  expect(writeMock).toHaveBeenCalledTimes(1);

  await db.setUsed(demo.userId, { reports: 3 });
  writeMock.mockRejectedValueOnce(new ModelError("model refused report"));
  expect((await write()).status).toBe(502);
  expect((await me()).demo!.reportsLeft).toBe(1);
});

test("an account over its AI spend cap is refused with the reason, an owner is not, and the app's total pauses everyone", async () => {
  await db.insertSynthesis(SYNTHESIS_ID(1), STUDENT.avery, RANGE, summary).run();
  await db.setSpent(DEV_USER_ID, ACCOUNT_CAP_MICRO);
  const refused = await post(keyed(), { synthesisId: SYNTHESIS_ID(1) });
  expect(refused.status).toBe(403);
  expect(await refused.json()).toEqual({ error: "This account has used its $10 of AI; ask Drew to reset it" });
  expect(writeMock).not.toHaveBeenCalled();

  const owners = (): Env => ({ ...keyed(), OWNER_EMAILS: DEV_EMAIL });
  expect((await post(owners(), { synthesisId: SYNTHESIS_ID(1) })).status).toBe(201);

  await db.setSpent(OTHER_USER_ID, TOTAL_CAP_MICRO);
  const paused = await post(owners(), { synthesisId: SYNTHESIS_ID(1) });
  expect(paused.status).toBe(403);
  expect(await paused.json()).toEqual({ error: "Throughline's AI budget is used up for now; ask Drew" });
  expect(writeMock).toHaveBeenCalledTimes(1);
});

test("a newer summary for the same period has no report until one is written", async () => {
  await db.insertSynthesis(SYNTHESIS_ID(1), STUDENT.avery, RANGE, summary).run();
  await db.insertReport(REPORT_ID(1), SYNTHESIS_ID(1), "Generated.").run();
  expect((await roster()).find((r) => r.studentId === STUDENT.avery)!.reportId).toBe(REPORT_ID(1));
  await db.insertSynthesis(SYNTHESIS_ID(2), STUDENT.avery, RANGE, summary, "another-hash", "2026-11-01T00:00:00.000Z").run();
  expect((await roster()).find((r) => r.studentId === STUDENT.avery)).toMatchObject({ synthesisId: SYNTHESIS_ID(2), reportId: null });
});

test("another teacher's summaries and reports are not found", async () => {
  await db.insertSynthesis(SYNTHESIS_ID(1), OTHER_STUDENT_ID, RANGE, summary).run();
  await db.insertReport(REPORT_ID(1), SYNTHESIS_ID(1), "Theirs.").run();
  expect((await post(keyed(), { synthesisId: SYNTHESIS_ID(1) })).status).toBe(404);
  expect(writeMock).not.toHaveBeenCalled();
  expect((await db.request(`/api/reports/${REPORT_ID(1)}`)).status).toBe(404);
  expect((await patch(REPORT_ID(1), { editedText: "mine now" })).status).toBe(404);
  expect((await db.request(`/api/reports/${REPORT_ID(1)}`, undefined, "other")).status).toBe(200);
  expect((await patch(REPORT_ID(1), { editedText: "ok" }, "other")).status).toBe(200);
  expect((await post(keyed(), { synthesisId: SYNTHESIS_ID(1) }, "other")).status).toBe(201);
  expect((await db.request(`/api/classes/${OTHER_CLASS_ID}/settings`)).status).toBe(404);
});
