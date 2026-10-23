// Shared by the tagger and document-splitter unit tests: a small synthetic roster with the
// traps both need (an alias, two Alexes in different classes), and a stub Anthropic client
// whose parse() answers with whatever a test hands it. No network anywhere.
import { vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { RosterEntry, TagClass } from "./tagging";

export const classes: TagClass[] = [
  { id: "c-p3", name: "Period 3" },
  { id: "c-b", name: "B Block" },
];
export const roster: RosterEntry[] = [
  { id: "s-avery", classId: "c-p3", firstName: "Avery", lastName: "Quill", aliases: [] },
  { id: "s-juniper", classId: "c-p3", firstName: "Juniper", lastName: "Vale", aliases: ["Juni"] },
  { id: "s-alex1", classId: "c-p3", firstName: "Alex", lastName: "Marsh", aliases: [] },
  { id: "s-alex2", classId: "c-b", firstName: "Alex", lastName: "Ruiz", aliases: [] },
];

// One entry of a tagger-shaped answer, as the model writes it.
export type Entry = { name_as_written: string; student: string | null; candidates: string[]; quotes: string[] };

// `parsed` is the parsed_output the stub returns (null for an answer that was not JSON). The
// same stub answers client.beta.messages.parse, which the synthesis uses for its fallback.
export function fakeParseClient(parsed: object | null, stop_reason = "end_turn") {
  const parse = vi.fn(async (_params: unknown, _options?: unknown) => ({
    stop_reason,
    parsed_output: parsed,
    usage: { input_tokens: 100, output_tokens: 20 },
    model: "claude-opus-5-5",
  }));
  return { client: { messages: { parse }, beta: { messages: { parse } } } as unknown as Anthropic, parse };
}
