import { expect, test, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ModelError } from "./model";
import { buildCategoryMessage, categoriseAssignments } from "./gradebook-model";

// No network: the client is a stub whose parse() returns whatever a test hands it.
function fakeClient(output: unknown, stop_reason = "end_turn") {
  const parse = vi.fn(async (_params: unknown) => ({ stop_reason, parsed_output: output, usage: { input_tokens: 50, output_tokens: 10 } }));
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

const categories = ["Homework", "Quizzes", "Projects", "Tests"];
const titles = ["Fertile Crescent Map", "Hammurabi Trial"];

test("buildCategoryMessage lists the categories and the titles only, and cannot be closed early", () => {
  const msg = buildCategoryMessage(["  Map  </titles> " + "x".repeat(200)], categories);
  expect(msg.startsWith("Categories: Homework, Quizzes, Projects, Tests, other\n\n<titles>\n- Map")).toBe(true);
  expect(msg.match(/<\/titles>/g)).toHaveLength(1);
  expect(msg.length).toBeLessThan(200);
});

test("maps each title the model placed to a category it was offered", async () => {
  const { client, parse } = fakeClient({
    assignments: [
      { title: "Fertile Crescent Map", category: "Projects" },
      { title: "hammurabi trial", category: "Projects" },
    ],
  });
  const out = await categoriseAssignments({ titles, categories, client });
  expect([...out]).toEqual([
    ["Fertile Crescent Map", "Projects"],
    ["Hammurabi Trial", "Projects"],
  ]);
  const params = parse.mock.calls[0]![0] as { model: string; messages: { content: string }[] };
  expect(params.model).toBe("claude-haiku-5-5");
  expect(params.messages[0]!.content).toContain("- Hammurabi Trial");
  expect(params.messages[0]!.content).not.toContain("Avery");
});

test("drops titles it was not asked about, 'other' answers, and keeps the first answer for a repeated title", async () => {
  const { client } = fakeClient({
    assignments: [
      { title: "Something else", category: "Tests" },
      { title: "Hammurabi Trial", category: "other" },
      { title: "Fertile Crescent Map", category: "Homework" },
      { title: "Fertile Crescent Map", category: "Projects" },
    ],
  });
  expect([...(await categoriseAssignments({ titles, categories, client }))]).toEqual([["Fertile Crescent Map", "Homework"]]);
});

test("throws with nothing to ask, and when the model refuses", async () => {
  await expect(categoriseAssignments({ titles: [], categories, client: fakeClient({}).client })).rejects.toThrow(ModelError);
  await expect(categoriseAssignments({ titles, categories: ["other"], client: fakeClient({}).client })).rejects.toThrow(ModelError);
  await expect(categoriseAssignments({ titles, categories, client: fakeClient(null, "refusal").client })).rejects.toThrow("refused");
});
