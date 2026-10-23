import { expect, test } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { CourseSummary } from "./db/schema";
import { buildEvidence, type EvidenceRows } from "./evidence";
import { ModelError } from "./model";
import { synthesise, tidy } from "./synthesis-model";
import { fakeParseClient } from "./test-roster";

const syllabus: CourseSummary = { description: "", goals: ["Read a primary source", "Write an argument"], grading: [], units: [], policies: [] };
const rows: EvidenceRows = {
  student: { firstName: "Avery", lastName: "Quill" },
  className: "Period 3",
  range: { from: "2026-09-01", to: "2026-12-19" },
  notes: [
    { id: "n1", kind: "text", sourceName: null, notedAt: "2026-09-14T15:00:00.000Z", createdAt: "2026-09-14T15:00:00.000Z", quotes: ["Avery led the seminar."] },
    { id: "n2", kind: "voice", sourceName: null, notedAt: "2026-10-01T15:00:00.000Z", createdAt: "2026-10-01T15:00:00.000Z", quotes: ["Avery rewrote the thesis."] },
  ],
  grades: [{ id: "g1", studentId: "avery", assignment: "Quiz 1", category: "Quizzes", score: 9, maxScore: 10, dueDate: "2026-09-12", position: 0 }],
  classGrades: [],
  materials: [{ summary: syllabus }],
  context: [],
};
const evidence = buildEvidence(rows, "2026-10-23");

const raw = {
  overview: "  Avery found her voice in discussion; writing is catching up.  ",
  highlights: [
    { title: "Led the seminar", story: "Ran the Hammurabi seminar on 14 September.", evidence: ["N1", "N1"] },
    { title: "Uncited", story: "No evidence.", evidence: [] },
    ...Array.from({ length: 6 }, (_, i) => ({ title: `Moment ${i}`, story: "Something specific.", evidence: ["N2"] })),
  ],
  strengths: [
    { point: "Leads discussion", evidence: ["N1"] },
    { point: "Strong quiz score", evidence: ["G1", "GRADES"] },
    { point: "Unsupported", evidence: [] },
  ],
  growth: [{ point: "   ", evidence: ["N2"] }],
  change: [{ point: "Thesis writing improved in October", evidence: ["N2"] }],
  goals: [
    { goal: "GOAL1", status: "met" as const, point: "Reads sources closely", evidence: [] },
    { goal: "GOAL1", status: "partly" as const, point: "duplicate", evidence: ["N1"] },
  ],
  gaps: [
    { area: "Group work", why: "No notes on collaboration", ask: "How does Avery work in a group?" },
    { area: "", why: "blank", ask: "dropped" },
  ],
};

test("tidy resolves citations, drops uncited points and highlights, caps highlights, and fills skipped goals", () => {
  const s = tidy(raw, evidence);
  expect(s.overview).toBe("Avery found her voice in discussion; writing is catching up.");
  expect(s.highlights).toHaveLength(5);
  expect(s.highlights[0]).toEqual({
    title: "Led the seminar",
    story: "Ran the Hammurabi seminar on 14 September.",
    evidence: [{ type: "note", noteId: "n1", notedAt: "2026-09-14T15:00:00.000Z", kind: "text", sourceName: null, quotes: ["Avery led the seminar."] }],
  });
  expect(s.strengths.map((p) => p.point)).toEqual(["Leads discussion", "Strong quiz score"]);
  expect(s.strengths[1]!.evidence).toEqual([expect.objectContaining({ type: "grade", assignment: "Quiz 1", pct: 90 }), { type: "grades" }]);
  expect(s.growth).toEqual([]);
  expect(s.change).toHaveLength(1);
  // A rating with no evidence becomes no_evidence; a goal the model skipped is filled in.
  expect(s.goals).toEqual([
    { goal: "Read a primary source", status: "no_evidence", point: "Reads sources closely", evidence: [] },
    { goal: "Write an argument", status: "no_evidence", point: "", evidence: [] },
  ]);
  expect(s.gaps).toEqual([{ area: "Group work", why: "No notes on collaboration", ask: "How does Avery work in a group?" }]);
  expect(s.coverage).toBe(evidence.coverage);
  expect(s.grades).toBe(evidence.grades);
});

test("a goal rated on real evidence keeps its status and citations", () => {
  const s = tidy({ ...raw, goals: [{ goal: "GOAL2", status: "partly", point: "Thesis improving", evidence: ["N2"] }] }, evidence);
  expect(s.goals[1]).toMatchObject({ goal: "Write an argument", status: "partly", evidence: [expect.objectContaining({ noteId: "n2" })] });
});

test("synthesise asks Opus with structured output and the server-side fallback, and returns the tidied answer", async () => {
  const { client, parse } = fakeParseClient(raw);
  const { summary, model } = await synthesise({ evidence, client });
  const params = parse.mock.calls[0]![0] as unknown as Anthropic.Beta.MessageCreateParams;
  expect(params.model).toBe("claude-opus-5-5");
  expect(params.output_config?.effort).toBe("medium");
  expect(params.output_config?.format?.type).toBe("json_schema");
  expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
  expect(params.fallbacks).toBe("default");
  expect(params.system).toContain("You do not write the report");
  expect(params.messages[0]!.content).toBe(evidence.message);
  expect(model).toBe("claude-opus-5-5");
  expect(summary.strengths).toHaveLength(2);
});

test("with no syllabus goals the schema has no goals field and the summary has none", async () => {
  const bare = buildEvidence({ ...rows, materials: [] }, "2026-10-23");
  const { client, parse } = fakeParseClient({ ...raw, goals: undefined });
  const { summary } = await synthesise({ evidence: bare, client });
  const schema = (parse.mock.calls[0]![0] as unknown as Anthropic.Beta.MessageCreateParams).output_config?.format as unknown as { schema: { properties: object } };
  expect(Object.keys(schema.schema.properties)).not.toContain("goals");
  expect(summary.goals).toEqual([]);
});

test("an unusable answer is a ModelError", async () => {
  await expect(synthesise({ evidence, client: fakeParseClient(raw, "refusal").client })).rejects.toThrow(ModelError);
  await expect(synthesise({ evidence, client: fakeParseClient(raw, "max_tokens").client })).rejects.toThrow(ModelError);
});
