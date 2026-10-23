// Write a term's worth of synthetic teacher notes with Claude Opus 5.5, with answer keys,
// to scripts/demo/notes.json. Read the file before loading it: the notes are the demo.
//
//   npm run demo:generate -- [--class "Period 3 Humanities"] [--per 45] [--base-url http://localhost:5173]
//
// One call per class. Each batch plans an arc per student first (a struggle, a turn, a win,
// a steady drift) and then writes the notes in date order so the arcs read coherently.
// The roster comes from the running dev server so the labels match the database exactly.
// Answer keys follow the tagger's own rules (its system prompt is embedded), and expected
// quotes are checked against the note the same way production checks the model's.
import { parseArgs } from "node:util";
import { existsSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { SYSTEM_PROMPT, locateQuote, rosterLabels, rosterLines, type TagClass } from "../../worker/tagging.ts";
import { messageOf, pool } from "../eval/shared.ts";
import { NOTES_PATH, baseUrlOption, classSlug, fetchRoster, loadNotes, type DemoNote } from "./shared.ts";

const { values: args } = parseArgs({
  options: { class: { type: "string" }, per: { type: "string", default: "45" }, "base-url": baseUrlOption },
});
const perClass = Number(args.per);
const TERM_START = "2026-09-01";
const today = new Date();
const TERM_END = today.toLocaleDateString("en-CA"); // local YYYY-MM-DD; a note dated tomorrow is rejected on load

const { students, classes } = await fetchRoster(args["base-url"]);
const wanted = args.class ? classes.filter((c) => c.name === args.class) : classes;
if (wanted.length === 0) throw new Error(`no class named ${args.class}; have: ${classes.map((c) => c.name).join(", ")}`);

const labels = rosterLabels(students);
const Label = z.enum([...labels.keys()] as [string, ...string[]]);
const ClassName = z.enum(classes.map((c) => c.name) as [string, ...string[]]);
const Output = z.object({
  arcs: z.array(z.object({ label: Label, arc: z.string().describe("One or two sentences: this student's story across the term") })),
  notes: z.array(
    z.object({
      noted_at: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
        .describe("Local date and time, YYYY-MM-DDTHH:MM, on a school day during or just after school hours"),
      note: z.string().describe("The teacher's note, exactly as the teacher wrote or spoke it"),
      expected_students: z.array(z.object({ label: Label, quotes: z.array(z.string()).describe("Exact substrings of the note about this student") })),
      expected_mentions: z.array(z.object({ name_as_written: z.string(), candidates: z.array(Label).min(2) })),
      class_mentioned: ClassName.nullable().describe("A class the note names in any way, or null; never inferred from the students"),
      rationale: z.string().describe("One sentence on why this is the right answer"),
    }),
  ),
});

const rosterText = rosterLines(labels, classes);

const generatorSystem = `You write a term of realistic notes for a demo of a note-tagging app used by one teacher. The app's own tagging instructions are below, between the markers; the answer key you attach to each note must follow exactly those rules, because the app is scored against it.

<tagging-instructions>
${SYSTEM_PROMPT}
</tagging-instructions>

Rules for the notes you write:
- They read like one real teacher wrote them in a hurry over a term: specific, varied in length (one line to a paragraph) and tone, with classroom detail (units, assignments, behaviour, small wins, to-dos). No two notes should share a structure.
- Each batch is for one class. First plan an arc for every student in that class (a struggle, a turn, a win, a quiet drift, a steady strength), then write the notes in date order so each student's notes tell that story. Every student in the class appears in at least four notes; two or three appear in ten or more. Later notes may refer back to earlier ones.
- Mix, roughly: half the notes about one student; a fifth about two or three students with different sentiments, each in their own clearly separable passage; a tenth about the whole class or an unnamed group with no roster student named (some naming the class, some not); a few that also name a student from another class (the roster shows every class); two or three that say a first name shared by two students with nothing to settle which; a couple about contact with a student's family or an adult (a co-teacher, the principal) who is not a student; several written as speech-to-text transcripts (lowercase, little punctuation, filler words, a misheard name).
- Dates fall on weekdays between the term start and end given in the message, spread across the whole range, with more than one note on some days and none on others. Times are during or just after the school day.
- Every expected quote must be an exact, contiguous substring of the note, copied character for character. Do not clean up spelling or punctuation inside quotes.
- Use only the roster below. Any adults you invent must not be on the roster. All names are fictional; invent nothing that could point at a real person. Keep the content ordinary classroom life: no medical, legal, or safeguarding matters.`;

const client = new Anthropic();
const existing = existsSync(NOTES_PATH) ? loadNotes() : [];

async function generate(cls: TagClass): Promise<DemoNote[]> {
  const members = [...labels.entries()].filter(([, s]) => s.classId === cls.id).map(([label]) => label);
  const res = await client.messages
    .stream({
      model: "claude-opus-5-5",
      max_tokens: 32_000,
      output_config: { effort: "high", format: zodOutputFormat(Output) },
      system: generatorSystem,
      messages: [
        {
          role: "user",
          content: `Roster:\n${rosterText}\n\nThis batch is for the class: ${cls.name}\nIts students: ${members.join(", ")}\nTerm: ${TERM_START} to ${TERM_END}\n\nWrite ${perClass} notes.`,
        },
      ],
    })
    .finalMessage();
  if (res.stop_reason !== "end_turn") throw new Error(`${cls.name}: stopped with ${res.stop_reason}`);
  const text = res.content.find((b) => b.type === "text")?.text ?? "";
  const parsed = Output.parse(JSON.parse(text));
  const slug = classSlug(cls.name);
  const out: DemoNote[] = [];
  for (const n of parsed.notes) {
    // No offset in the string, so it parses as local time, the time the teacher lived it.
    const at = new Date(n.noted_at);
    if (Number.isNaN(at.getTime()) || n.noted_at < TERM_START || at > today) {
      console.warn(`[${cls.name}] dropped: ${n.noted_at} is outside the term`);
      continue;
    }
    const badQuote = n.expected_students.flatMap((s) => s.quotes).find((q) => !locateQuote(n.note, q));
    if (badQuote !== undefined) {
      console.warn(`[${cls.name}] dropped: expected quote not in note: "${badQuote.slice(0, 60)}"`);
      continue;
    }
    out.push({
      id: `${slug}-${String(out.length + 1).padStart(2, "0")}`,
      batch: cls.name,
      notedAt: at.toISOString(),
      note: n.note,
      expected: {
        students: n.expected_students,
        mentions: n.expected_mentions.map((m) => ({ nameAsWritten: m.name_as_written, candidates: m.candidates })),
        classMentioned: n.class_mentioned,
      },
      rationale: n.rationale,
    });
  }
  console.log(`${cls.name}: ${out.length} notes (${res.usage.input_tokens} in, ${res.usage.output_tokens} out)`);
  for (const a of parsed.arcs) console.log(`  ${a.label}: ${a.arc}`);
  return out;
}

// One class failing (cut off, refused, bad JSON) must not throw away the others; that class
// keeps whatever notes.json already had and is reported at the end.
const results = new Map<string, DemoNote[]>();
const failed: string[] = [];
await pool(wanted, 3, async (c) => {
  try {
    results.set(c.name, await generate(c));
  } catch (err) {
    failed.push(c.name);
    console.error(`${c.name}: FAILED, kept previous notes if any —`, messageOf(err));
  }
});

// Notes for a class that no longer exists (renamed, reseeded) would never load; drop them.
const stale = existing.filter((n) => !classes.some((c) => c.name === n.batch));
if (stale.length) console.warn(`dropped ${stale.length} notes for classes no longer on the roster: ${[...new Set(stale.map((n) => n.batch))].join(", ")}`);
const kept = existing.filter((n) => !results.has(n.batch) && !stale.includes(n));
const all = [...kept, ...[...results.values()].flat()].sort((a, b) => a.notedAt.localeCompare(b.notedAt) || a.id.localeCompare(b.id));
writeFileSync(NOTES_PATH, JSON.stringify(all, null, 2) + "\n");
console.log(`wrote ${all.length} notes to ${NOTES_PATH.pathname}`);
if (failed.length) {
  console.log(`rerun with --class for: ${failed.join(", ")}`);
  process.exit(1);
}
