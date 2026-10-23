// Generate eval cases with Claude Opus 5.5 and write scripts/eval/cases.json.
//
// Run once (or per category to refresh a slice) and commit the output: eval runs must be
// repeatable, and the answer key is reviewed by a person before anything is tuned against it.
//
//   node --env-file=.dev.vars scripts/eval/generate-cases.ts [--category name] [--per 12]
//
// Each case carries a rationale so the reviewer can see why the generator chose that answer.
// Expected quotes are checked against the note the same way production checks the model's;
// a case whose expected quote is not really in its note is dropped with a warning.
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { SYSTEM_PROMPT, locateQuote, rosterLabels, rosterLines } from "../../worker/tagging.ts";
import { CASES_PATH, CATEGORIES, loadCases, loadRoster, messageOf, pool, type Case } from "./shared.ts";

const { values: args } = parseArgs({
  options: { category: { type: "string" }, per: { type: "string", default: "12" } },
});
const perCategory = Number(args.per);
const wanted = args.category ? [args.category] : Object.keys(CATEGORIES);
for (const c of wanted) if (!CATEGORIES[c]) throw new Error(`unknown category ${c}; known: ${Object.keys(CATEGORIES).join(", ")}`);

const { students: roster, classes } = loadRoster();
const labels = rosterLabels(roster);
const ClassName = z.enum(classes.map((c) => c.name) as [string, ...string[]]);
const Label = z.enum([...labels.keys()] as [string, ...string[]]);
const Output = z.object({
  cases: z.array(
    z.object({
      note: z.string().describe("The teacher's note, exactly as the teacher wrote or spoke it"),
      expected_students: z.array(
        z.object({
          label: Label,
          quotes: z.array(z.string()).describe("Exact substrings of the note about this student"),
        }),
      ),
      expected_mentions: z.array(
        z.object({
          name_as_written: z.string(),
          candidates: z.array(Label).min(2),
        }),
      ),
      class_mentioned: ClassName.nullable().describe("A class the note names in any way (as a whole, as a setting, or to locate a student), or null; never inferred from the students"),
      rationale: z.string().describe("One or two sentences on why this is the right answer and what makes the case hard"),
    }),
  ),
});

const rosterText = rosterLines(labels, classes);

const generatorSystem = `You write test cases for a note-tagging system used by one teacher. The system's own instructions are below, between the markers; your cases must be answered by exactly those rules, because the answer key you produce is what the system is scored against.

<tagging-instructions>
${SYSTEM_PROMPT}
</tagging-instructions>

Rules for the cases you write:
- Notes read like a real teacher wrote them in a hurry: specific, varied in length and tone, with classroom detail (units, assignments, behaviour, small wins). No two notes in a batch should share a structure.
- Every expected quote must be an exact, contiguous substring of the note, copied character for character. Do not clean up spelling or punctuation inside quotes.
- Use only the roster below. Any adults you invent must not be on the roster.
- All names are fictional. Do not reuse real people.
- Vary which roster students appear across the batch.`;

const client = new Anthropic();
const existing = (() => {
  try {
    return loadCases();
  } catch {
    return [] as Case[];
  }
})();

async function generate(category: string): Promise<Case[]> {
  // Streamed because a batch of long notes plus thinking can run past what a plain request
  // allows before the HTTP timeout; the final message is parsed against the same schema.
  const res = await client.messages
    .stream({
      model: "claude-opus-5-5",
      max_tokens: 32_000,
      output_config: { effort: "high", format: zodOutputFormat(Output) },
      system: generatorSystem,
      messages: [
        {
          role: "user",
          content: `Roster:\n${rosterText}\n\nCategory: ${category}\nBrief: ${CATEGORIES[category]}\n\nWrite ${perCategory} cases for this category.`,
        },
      ],
    })
    .finalMessage();
  if (res.stop_reason !== "end_turn") throw new Error(`${category}: stopped with ${res.stop_reason}`);
  const text = res.content.find((b) => b.type === "text")?.text ?? "";
  const parsed = Output.parse(JSON.parse(text));
  const out: Case[] = [];
  for (const c of parsed.cases) {
    let ok = true;
    for (const s of c.expected_students) {
      for (const q of s.quotes) {
        if (!locateQuote(c.note, q)) {
          console.warn(`[${category}] dropped: expected quote not in note: "${q.slice(0, 60)}"`);
          ok = false;
        }
      }
    }
    if (!ok) continue;
    out.push({
      id: `${category}-${String(out.length + 1).padStart(2, "0")}`,
      category,
      note: c.note,
      expected: {
        students: c.expected_students.map((s) => ({ label: s.label, quotes: s.quotes })),
        mentions: c.expected_mentions.map((m) => ({ nameAsWritten: m.name_as_written, candidates: m.candidates })),
        classMentioned: c.class_mentioned,
      },
      rationale: c.rationale,
    });
  }
  console.log(`${category}: ${out.length} cases (${res.usage.input_tokens} in, ${res.usage.output_tokens} out)`);
  return out;
}

// Four categories at a time: Opus with high effort takes a minute or so per batch. One
// category failing (cut off, refused, bad JSON) must not throw away the others, so failures
// are reported at the end and that category keeps whatever cases.json already had.
const results = new Map<string, Case[]>();
const failed: string[] = [];
await pool(wanted, 4, async (c) => {
  try {
    results.set(c, await generate(c));
  } catch (err) {
    failed.push(c);
    console.error(`${c}: FAILED, kept previous cases if any —`, messageOf(err));
  }
});

// Regenerated categories replace their old cases; the rest are kept in category order.
const kept = existing.filter((c) => !results.has(c.category));
const all = Object.keys(CATEGORIES).flatMap((c) => results.get(c) ?? kept.filter((k) => k.category === c));
writeFileSync(CASES_PATH, JSON.stringify(all, null, 2) + "\n");
console.log(`wrote ${all.length} cases to ${CASES_PATH.pathname}`);
if (failed.length) {
  console.log(`rerun with --category for: ${failed.join(", ")}`);
  process.exit(1);
}
