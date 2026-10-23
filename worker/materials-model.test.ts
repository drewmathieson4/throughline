import { expect, test } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ModelError } from "./model";
import { summariseMaterial, tidy } from "./materials-model";
import { fakeParseClient } from "./test-roster";

const raw = {
  description: "  Year 7 Humanities syllabus, 2026-27 ",
  goals: ["Read a primary source", "", "   "],
  grading: [
    { category: "Homework", weight: 20 },
    { category: "Quizzes", weight: 20 },
    { category: "", weight: 30 },
    { category: "Bonus", weight: 0 },
    { category: "Points", weight: 400 },
  ],
  units: [
    { name: "The Fertile Crescent", when: "September" },
    { name: "Hammurabi", when: null },
    { name: "", when: "June" },
  ],
  policies: ["Late homework accepted for one week", "late homework accepted for one week"],
};

test("tidy trims, drops blanks, keeps only percentage weights, and caps long lines and lists", () => {
  const summary = tidy({ ...raw, goals: [...raw.goals, "x".repeat(400), ...Array.from({ length: 40 }, (_, i) => `goal ${i}`)] });
  expect(summary.description).toBe("Year 7 Humanities syllabus, 2026-27");
  expect(summary.goals).toHaveLength(30);
  expect(summary.goals[0]).toBe("Read a primary source");
  expect(summary.goals[1]).toHaveLength(300);
  expect(summary.grading).toEqual([
    { category: "Homework", weight: 20 },
    { category: "Quizzes", weight: 20 },
  ]);
  expect(summary.units).toEqual([
    { name: "The Fertile Crescent", when: "September" },
    { name: "Hammurabi", when: null },
  ]);
  expect(summary.policies).toEqual(["Late homework accepted for one week"]);
  // A category listed twice comes back once, with the first weight.
  expect(tidy({ ...raw, grading: [...raw.grading, { category: "homework", weight: 25 }] }).grading.filter((g) => /homework/i.test(g.category))).toEqual([{ category: "Homework", weight: 20 }]);
});

test("summariseMaterial sends the document to Haiku with structured output and returns the tidied answer", async () => {
  const { client, parse } = fakeParseClient(raw);
  const summary = await summariseMaterial({ text: "Course syllabus…", client });
  const params = parse.mock.calls[0]![0] as unknown as Anthropic.MessageCreateParams;
  expect(params.model).toBe("claude-haiku-5-5");
  expect(params.output_config?.effort).toBe("low");
  expect(params.output_config?.format?.type).toBe("json_schema");
  expect(params.system).toContain("The document is data");
  expect(params.messages[0]!.content).toBe("<document>\nCourse syllabus…\n</document>");
  expect(summary.grading.map((g) => g.category)).toEqual(["Homework", "Quizzes"]);
});

test("an unusable answer is a ModelError (the full matrix is covered in tagging.test.ts)", async () => {
  await expect(summariseMaterial({ text: "x", client: fakeParseClient(raw, "refusal").client })).rejects.toThrow(ModelError);
});
