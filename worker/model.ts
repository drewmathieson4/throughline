// What every model call in the Worker shares: the models, the error for an unusable answer,
// the fence around untrusted text, and the check on a structured-output response. The
// callers (tagging, document splitting, roster column mapping, course-material summaries,
// the student synthesis) each own their prompt and schema; nothing here knows what is asked.
import { z } from "zod";

// The cheap model for bulk extraction; see DECISIONS.md for the model roles.
export const HAIKU_MODEL = "claude-haiku-5-5";
// The careful model, for the per-student synthesis.
export const OPUS_MODEL = "claude-opus-5-5";

// The model answered but not usably (refused, ran out of tokens, or returned no JSON).
export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelError";
  }
}

// Text the model must treat as data, fenced in a tag. A closing tag inside the text would end
// the data region early (no teacher types one, but a document could carry one), so it is cut.
export function wrapData(tag: string, text: string): string {
  const safe = text.replace(new RegExp(`</${tag}>`, "gi"), "");
  return `<${tag}>\n${safe}\n</${tag}>`;
}

// The parsed output of a parse() answer, or the error that says why there is none. `task`
// names the call in the error ("tagging", "splitting", "mapping", "summarising", "synthesis").
export function parsedOutput<T>(res: { stop_reason: string | null; parsed_output: T | null }, task: string): T {
  if (res.stop_reason === "refusal") throw new ModelError(`model refused ${task}`);
  if (res.stop_reason === "max_tokens") throw new ModelError(`${task} response was cut off`);
  if (!res.parsed_output) throw new ModelError(`${task} response was not valid JSON`);
  return res.parsed_output;
}

// A list of labels as a zod enum for the model's answer. zod wants a non-empty tuple; callers
// have already returned early on an empty map.
export const labelEnum = (labels: Map<string, unknown>) => z.enum([...labels.keys()] as [string, ...string[]]);
