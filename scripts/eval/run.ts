// Score the tagger against scripts/eval/cases.json.
//
//   node --env-file=.dev.vars scripts/eval/run.ts [--effort low|medium|high] [--category name] [--limit n] [--out file.json]
//
// Reports, overall and per category:
//   tags      precision and recall over (case, student) pairs
//   mentions  precision and recall over open mentions, matched by candidate set (the name
//             text varies: "Alex's", "both Alexes"; the candidates are what matters)
//   quotes    for each correctly tagged pair, how well the returned quotes cover the expected
//             ones, as character-range overlap (Jaccard) within the note; mean and share >= 0.5
// Exits 1 when tag precision or recall is under the bar (90%).
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { classLabels, collapse, tagNote, type Effort, type TagResult } from "../../worker/tagging.ts";
import { candidateKey, labelMaps, loadCases, loadRoster, messageOf, pool, type Case } from "./shared.ts";

const BAR = 0.9;
const CONCURRENCY = 5;
// Haiku 5.5 list prices per million tokens, for the cost line.
const PRICE = { input: 0.1, output: 0.5 };

const { values: args } = parseArgs({
  options: {
    effort: { type: "string", default: "low" },
    category: { type: "string" },
    limit: { type: "string" },
    out: { type: "string" },
  },
});
const effort = args.effort as Effort;
if (!["low", "medium", "high"].includes(effort)) throw new Error(`--effort must be low, medium, or high`);

const { students: roster, classes } = loadRoster();
const { idByLabel, labelById } = labelMaps(roster);
const classByLabel = classLabels(classes);
let cases = loadCases();
if (args.category) cases = cases.filter((c) => c.category === args.category);
if (args.limit) cases = cases.slice(0, Number(args.limit));
if (cases.length === 0) throw new Error("no cases selected");

const norm = (s: string) => collapse(s).toLowerCase();

// Character ranges a set of quotes covers inside the note, as a boolean mask.
function mask(note: string, quotes: string[]): boolean[] {
  const hay = norm(note);
  const m = new Array<boolean>(hay.length).fill(false);
  for (const q of quotes) {
    const needle = norm(q);
    if (!needle) continue;
    for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
      for (let i = at; i < at + needle.length; i++) m[i] = true;
    }
  }
  return m;
}

function jaccard(note: string, expected: string[], got: string[]): number {
  if (expected.length === 0 && got.length === 0) return 1;
  const a = mask(note, expected);
  const b = mask(note, got);
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++;
    if (a[i] || b[i]) union++;
  }
  return union === 0 ? 0 : inter / union;
}

type Scored = {
  id: string;
  category: string;
  ok: boolean;
  tagTP: number;
  tagFP: number;
  tagFN: number;
  menTP: number;
  menFP: number;
  menFN: number;
  quoteScores: number[];
  classOk: boolean; // mentioned class (or its absence) matched the key
  missingQuotes: number; // correct tags that came back with no quotes at all
  expectedIds: string[];
  gotIds: string[];
  expectedMentions: string[];
  gotMentions: string[];
  error?: string;
  ms: number;
  result?: TagResult;
};

function score(c: Case, result: TagResult, ms: number): Scored {
  const expected = new Map(
    c.expected.students.map((s) => {
      const id = idByLabel.get(s.label);
      if (!id) throw new Error(`${c.id}: unknown label ${s.label}`);
      return [id, s.quotes];
    }),
  );
  const got = new Map(result.students.map((s) => [s.studentId, s.quotes]));
  let tagTP = 0;
  let tagFN = 0;
  const quoteScores: number[] = [];
  let missingQuotes = 0;
  for (const [id, quotes] of expected) {
    const g = got.get(id);
    if (g === undefined) {
      tagFN++;
      continue;
    }
    tagTP++;
    quoteScores.push(jaccard(c.note, quotes, g));
    if (quotes.length > 0 && g.length === 0) missingQuotes++;
  }
  const tagFP = [...got.keys()].filter((id) => !expected.has(id)).length;

  const expMen = new Set(
    c.expected.mentions.map((m) => {
      const ids = m.candidates.map((label) => idByLabel.get(label));
      if (ids.some((id) => !id)) throw new Error(`${c.id}: unknown candidate label`);
      return candidateKey(ids as string[]);
    }),
  );
  const gotMen = new Set(result.mentions.map((m) => candidateKey(m.candidateIds)));
  const menTP = [...expMen].filter((n) => gotMen.has(n)).length;
  const expectedClass = c.expected.classMentioned ? (classByLabel.get(c.expected.classMentioned)?.id ?? null) : null;
  const classOk = result.mentionedClassId === expectedClass;
  return {
    id: c.id,
    category: c.category,
    ok: tagFP === 0 && tagFN === 0 && menTP === expMen.size && gotMen.size === expMen.size && classOk,
    classOk,
    tagTP,
    tagFP,
    tagFN,
    menTP,
    menFP: gotMen.size - menTP,
    menFN: expMen.size - menTP,
    quoteScores,
    missingQuotes,
    expectedIds: [...expected.keys()],
    gotIds: [...got.keys()],
    expectedMentions: c.expected.mentions.map((m) => `${m.nameAsWritten} → ${m.candidates.join("/")}`),
    gotMentions: result.mentions.map((m) => `${m.mentionText} → ${m.candidateIds.map((id) => labelById.get(id) ?? id).join("/")}`),
    ms,
    result,
  };
}

const client = new Anthropic();
const scored: Scored[] = [];
let inputTokens = 0;
let outputTokens = 0;
await pool(cases, CONCURRENCY, async (c) => {
  const t = Date.now();
  try {
    const result = await tagNote({ body: c.note, roster, classes, client, effort });
    inputTokens += result.usage.inputTokens;
    outputTokens += result.usage.outputTokens;
    scored.push(score(c, result, Date.now() - t));
  } catch (err) {
    scored.push({
      ...score(c, { students: [], mentions: [], mentionedClassId: null, usage: { inputTokens: 0, outputTokens: 0 } }, Date.now() - t),
      ok: false,
      error: messageOf(err),
    });
  }
  process.stdout.write(".");
});
process.stdout.write("\n");
scored.sort((a, b) => a.id.localeCompare(b.id));

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const ratio = (num: number, den: number) => (den === 0 ? 1 : num / den);
function summarize(rows: Scored[]) {
  const sum = (f: (r: Scored) => number) => rows.reduce((acc, r) => acc + f(r), 0);
  const quotes = rows.flatMap((r) => r.quoteScores);
  return {
    cases: rows.length,
    passed: rows.filter((r) => r.ok).length,
    tagP: ratio(sum((r) => r.tagTP), sum((r) => r.tagTP + r.tagFP)),
    tagR: ratio(sum((r) => r.tagTP), sum((r) => r.tagTP + r.tagFN)),
    menP: ratio(sum((r) => r.menTP), sum((r) => r.menTP + r.menFP)),
    menR: ratio(sum((r) => r.menTP), sum((r) => r.menTP + r.menFN)),
    classAcc: rows.filter((r) => r.classOk).length / rows.length,
    quoteMean: quotes.length ? quotes.reduce((a, b) => a + b, 0) / quotes.length : 1,
    quoteGood: quotes.length ? quotes.filter((q) => q >= 0.5).length / quotes.length : 1,
    missingQuotes: sum((r) => r.missingQuotes),
    errors: rows.filter((r) => r.error).length,
  };
}

const byCategory = new Map<string, Scored[]>();
for (const r of scored) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
const table = [...byCategory.entries()].map(([category, rows]) => {
  const s = summarize(rows);
  return {
    category,
    cases: s.cases,
    pass: `${s.passed}/${s.cases}`,
    "tag P": pct(s.tagP),
    "tag R": pct(s.tagR),
    "mention P": pct(s.menP),
    "mention R": pct(s.menR),
    class: pct(s.classAcc),
    "quote mean": s.quoteMean.toFixed(2),
    "quote>=.5": pct(s.quoteGood),
  };
});
console.table(table);

const names = (ids: string[]) => (ids.length ? ids.map((id) => labelById.get(id) ?? id).join(", ") : "(none)");
const failures = scored.filter((r) => !r.ok);
for (const f of failures) {
  const c = cases.find((k) => k.id === f.id)!;
  console.log(`\n✗ ${f.id}${f.error ? ` ERROR ${f.error}` : ""}`);
  console.log(`  note:     ${c.note.slice(0, 160).replace(/\n/g, " ")}`);
  console.log(`  expected: ${names(f.expectedIds)}${f.expectedMentions.length ? ` | mentions: ${f.expectedMentions.join(", ")}` : ""}`);
  console.log(`  got:      ${names(f.gotIds)}${f.gotMentions.length ? ` | mentions: ${f.gotMentions.join(", ")}` : ""}`);
  if (!f.classOk) {
    const expectedClass = c.expected.classMentioned ?? "(none)";
    const gotClass = classes.find((k) => k.id === f.result?.mentionedClassId)?.name ?? "(none)";
    console.log(`  class:    expected ${expectedClass}, got ${gotClass}`);
  }
}

const overall = summarize(scored);
const cost = (inputTokens * PRICE.input + outputTokens * PRICE.output) / 1e6;
const avgMs = scored.reduce((a, r) => a + r.ms, 0) / scored.length;
console.log(
  `\n${overall.passed}/${overall.cases} cases fully correct · effort=${effort} · ` +
    `tags P ${pct(overall.tagP)} R ${pct(overall.tagR)} · mentions P ${pct(overall.menP)} R ${pct(overall.menR)} · class ${pct(overall.classAcc)} · ` +
    `quote coverage mean ${overall.quoteMean.toFixed(2)} (${pct(overall.quoteGood)} ≥ 0.5), ${overall.missingQuotes} correct tags with no quotes · ` +
    `${overall.errors} errors · ~${Math.round(avgMs)} ms/note · $${cost.toFixed(4)}`,
);

if (args.out) {
  writeFileSync(args.out, JSON.stringify({ effort, overall, perCategory: table, cases: scored }, null, 2) + "\n");
  console.log(`wrote ${args.out}`);
}

if (overall.tagP < BAR || overall.tagR < BAR) {
  console.log(`\nBELOW BAR: tag precision and recall must both be ≥ ${pct(BAR)}`);
  process.exit(1);
}
