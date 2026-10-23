// Load scripts/demo/notes.json into a running Throughline through its API, so every note is
// tagged live by the real tagger, then list the notes where the tagger and the answer key
// disagree. A viewer aid, not a gate: the eval (npm run eval:tagging) guards the tagger.
//
//   npm run demo:load                     # wipes the LOCAL database's notes, then loads into localhost
//   node scripts/demo/load.ts [--limit n] [--base-url https://…]   # appends; no wipe, any server
import { parseArgs } from "node:util";
import { candidateKey, labelMaps, messageOf, pool } from "../eval/shared.ts";
import { baseUrlOption, fetchRoster, loadNotes, type DemoNote } from "./shared.ts";

const { values: args } = parseArgs({ options: { limit: { type: "string" }, "base-url": baseUrlOption } });
const baseUrl = args["base-url"];
const CONCURRENCY = 4;

const { students } = await fetchRoster(baseUrl);
const { idByLabel, labelById } = labelMaps(students);
const idOf = (label: string) => {
  const id = idByLabel.get(label);
  if (!id) throw new Error(`notes.json names ${label}, who is not on the roster; regenerate or reseed`);
  return id;
};

// Oldest first, so created_at follows noted_at and ties sort the same way everywhere.
let notes = loadNotes().sort((a, b) => a.notedAt.localeCompare(b.notedAt));
if (args.limit) notes = notes.slice(0, Number(args.limit));

// The answer key in ids, resolved before anything is posted so a stale file fails up front.
const mentionSig = (candidateSets: string[][]) => candidateSets.map(candidateKey).sort().join(" ");
const keys = new Map(
  notes.map((n) => [n.id, { students: new Set(n.expected.students.map((s) => idOf(s.label))), mentions: mentionSig(n.expected.mentions.map((m) => m.candidates.map(idOf))) }]),
);

// What POST /api/notes returns, as far as the comparison needs.
type Tagged = { tagging: "done" | "failed"; students: { studentId: string }[]; mentions: { mentionText: string; candidateIds: string[] }[] };
type Outcome = { note: DemoNote; got?: Tagged; error?: string };

const outcomes: Outcome[] = notes.map((note) => ({ note }));
await pool([...outcomes.keys()], CONCURRENCY, async (i) => {
  const outcome = outcomes[i]!;
  try {
    const res = await fetch(`${baseUrl}/api/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: outcome.note.note, notedAt: outcome.note.notedAt }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    outcome.got = (await res.json()) as Tagged;
  } catch (err) {
    outcome.error = messageOf(err);
  }
  process.stdout.write(".");
});
process.stdout.write("\n");

const line = (ids: Iterable<string>, unsure: string[]) => {
  const names = [...ids].map((id) => labelById.get(id) ?? id);
  return (names.length ? names.join(", ") : "(none)") + (unsure.length ? ` | unsure: ${unsure.join(", ")}` : "");
};
let differ = 0;
for (const { note, got, error } of outcomes) {
  if (!got) {
    console.log(`\n✗ ${note.id} FAILED TO SAVE: ${error}`);
    continue;
  }
  const key = keys.get(note.id)!;
  const actual = new Set(got.students.map((s) => s.studentId));
  const sameStudents = actual.size === key.students.size && [...key.students].every((id) => actual.has(id));
  const sameMentions = mentionSig(got.mentions.map((m) => m.candidateIds)) === key.mentions;
  if (sameStudents && sameMentions && got.tagging === "done") continue;
  differ++;
  console.log(`\n✗ ${note.id} (${note.notedAt.slice(0, 10)})${got.tagging === "failed" ? " TAGGING FAILED" : ""}`);
  console.log(`  note:     ${note.note.slice(0, 160).replace(/\n/g, " ")}`);
  console.log(`  expected: ${line(key.students, note.expected.mentions.map((m) => m.nameAsWritten))}`);
  console.log(`  got:      ${line(actual, got.mentions.map((m) => m.mentionText))}`);
}

const saved = outcomes.filter((o) => o.got);
const failedTagging = saved.filter((o) => o.got!.tagging === "failed").length;
console.log(`\nloaded ${saved.length}/${outcomes.length} notes into ${baseUrl}; ${differ} differ from the key; ${failedTagging} where tagging failed`);
if (saved.length < outcomes.length) {
  console.error(`${outcomes.length - saved.length} notes were not saved`);
  process.exit(1);
}
