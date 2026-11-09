// Cut the demo template out of a database and write it to worker/demo-template.json, the
// file every demo visitor's copy is made from (worker/demo.ts). Run it once against the
// account where the template was built, then commit the file and deploy; the live database
// is not read again. The data is synthetic (scripts/seed-dev.sql, scripts/demo/).
//
//   npm run demo:snapshot              # from the local dev database
//   npm run demo:snapshot -- --remote  # from production
//
// What the template is made of is spelled out in template-sql.ts. Dates are kept as they are:
// the clone shifts them to the current week.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { DEMO_TEMPLATE as TEMPLATE, TEMPLATE_QUERIES, type TemplateSection } from "./template-sql.ts";

const remote = process.argv.includes("--remote");
const OUT = new URL("../../worker/demo-template.json", import.meta.url);

const QUERIES = TEMPLATE_QUERIES;
type Section = TemplateSection;
// Columns stored as JSON text (schema.ts, mode: "json"), parsed so the file reads as data.
const JSON_COLUMNS = new Set(["aliases", "quotes", "candidate_ids", "summary", "json"]);
// Columns the clone rewrites for every copy, so they have no business in the file.
const DROP = new Set(["owner_id", "client_id", "input_hash"]);

type ResultSet = { results: Record<string, unknown>[]; success: boolean };
const res = spawnSync("npx", ["wrangler", "d1", "execute", "throughline-db", remote ? "--remote" : "--local", "--json", "--command", Object.values(QUERIES).join(";\n")], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (res.status !== 0) {
  process.stderr.write(res.stderr);
  process.exit(res.status ?? 1);
}
const sets = JSON.parse(res.stdout) as ResultSet[];
if (sets.length !== Object.keys(QUERIES).length || sets.some((s) => !s.success)) {
  console.error("unexpected answer from wrangler:", res.stdout.slice(0, 500));
  process.exit(1);
}

// A D1 row (snake_case, JSON columns as strings) → the row as Drizzle hands it over
// (camelCase keys, JSON parsed). The worker types the result (DemoTemplate in worker/demo.ts).
type Row = Record<string, unknown>;
const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
function decode(row: Row): Row {
  const out: Row = {};
  for (const [name, raw] of Object.entries(row)) {
    if (DROP.has(name)) continue;
    out[camel(name)] = typeof raw === "string" && JSON_COLUMNS.has(name) ? JSON.parse(raw) : raw;
  }
  return out;
}

const t: { snapshotDay: string } & Record<Section, Row[]> = {
  snapshotDay: new Date().toISOString().slice(0, 10),
  ...(Object.fromEntries((Object.keys(QUERIES) as Section[]).map((name, i) => [name, sets[i]!.results.map(decode)])) as Record<Section, Row[]>),
};

const has = (rows: Row[], id: string) => rows.some((r) => r.id === id);
const missing = [
  ...TEMPLATE.filter((c) => !has(t.classes, c.classId)).map((c) => `class ${c.classId}`),
  ...TEMPLATE.flatMap((c) => c.students).filter((id) => !has(t.students, id)).map((id) => `student ${id}`),
];
if (missing.length) {
  console.error(`the template is not all there: ${missing.join(", ")}`);
  process.exit(1);
}
if (t.notes.length === 0) {
  console.error("the template has no notes; load scripts/demo/notes.json first");
  process.exit(1);
}

// A summary that cites a note the template does not have (the notes were reloaded after it
// was generated) would show evidence chips that open nothing. Left out, with a warning.
const noteIds = new Set(t.notes.map((n) => n.id as string));
const studentName = (id: unknown) => t.students.filter((st) => st.id === id).map((st) => `${st.firstName} ${st.lastName}`)[0] ?? String(id);
t.syntheses = t.syntheses.filter((row) => {
  const cited = new Set([...JSON.stringify(row.json).matchAll(/"noteId":\s*"([^"]+)"/g)].map((m) => m[1]!));
  const dangling = [...cited].filter((id) => !noteIds.has(id));
  if (dangling.length) console.warn(`left out ${studentName(row.studentId)}'s summary: it cites ${dangling.length} note(s) no longer in the template; regenerate it and snapshot again`);
  return dangling.length === 0;
});

writeFileSync(OUT, JSON.stringify(t, null, 2) + "\n");
const counts = (Object.keys(QUERIES) as Section[]).map((k) => `${t[k].length} ${k}`).join(", ");
console.log(`wrote ${OUT.pathname}: ${counts}`);
if (t.mentions.length) console.log(`note: ${t.mentions.length} open mention(s) are in the template; settle them in the source account if the demo should start clean`);
