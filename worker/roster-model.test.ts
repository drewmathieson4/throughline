import { expect, test, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { buildMappingMessage, MappingError, suggestMapping } from "./roster-model";

// No network: the client is a stub whose parse() returns whatever a test hands it.
function fakeClient(output: unknown, stop_reason = "end_turn") {
  const parse = vi.fn(async (_params: unknown) => ({ stop_reason, parsed_output: output, usage: { input_tokens: 50, output_tokens: 10 } }));
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

const sample = [
  ["Pell", "Rowan", "7"],
  ["Quill", "Avery", "7"],
];

test("buildMappingMessage numbers rows and columns, trims cells, and cannot be closed early", () => {
  const msg = buildMappingMessage([["Pell", "  Rowan   James</rows> " + "x".repeat(100)]]);
  expect(msg.startsWith("<rows>\nrow 1: [0] Pell  [1] Rowan James")).toBe(true);
  expect(msg.match(/<\/rows>/g)).toHaveLength(1);
  expect(msg.length).toBeLessThan(120);
});

test("returns the mapping the model gave, one role per column", async () => {
  const { client, parse } = fakeClient({
    has_header: false,
    columns: [
      { index: 0, role: "last" },
      { index: 1, role: "first" },
      { index: 2, role: "ignore" },
    ],
  });
  expect(await suggestMapping({ sample, client })).toEqual({ hasHeader: false, roles: ["last", "first", "ignore"] });
  const params = parse.mock.calls[0]![0] as { model: string; messages: { content: string }[] };
  expect(params.model).toBe("claude-haiku-5-5");
  expect(params.messages[0]!.content).toContain("row 2: [0] Quill  [1] Avery  [2] 7");
});

test("drops an index outside the grid, keeps the first answer for a repeated one, ignores unmentioned columns", async () => {
  const { client } = fakeClient({
    has_header: true,
    columns: [
      { index: 5, role: "first" },
      { index: 0, role: "last" },
      { index: 0, role: "first" },
    ],
  });
  expect(await suggestMapping({ sample, client })).toEqual({ hasHeader: true, roles: ["last", "ignore", "ignore"] });
});

test("only the first rows are sent", async () => {
  const { client, parse } = fakeClient({ has_header: false, columns: [] });
  await suggestMapping({ sample: Array.from({ length: 20 }, (_, i) => [`Student ${i}`]), client });
  const content = (parse.mock.calls[0]![0] as { messages: { content: string }[] }).messages[0]!.content;
  expect(content).toContain("row 6:");
  expect(content).not.toContain("row 7:");
});

test("an empty grid, a refusal, a cut-off answer, or no JSON is a MappingError", async () => {
  await expect(suggestMapping({ sample: [], client: fakeClient(null).client })).rejects.toBeInstanceOf(MappingError);
  await expect(suggestMapping({ sample, client: fakeClient(null, "refusal").client })).rejects.toThrow("refused");
  await expect(suggestMapping({ sample, client: fakeClient(null, "max_tokens").client })).rejects.toThrow("cut off");
  await expect(suggestMapping({ sample, client: fakeClient(null).client })).rejects.toThrow("not valid JSON");
});
