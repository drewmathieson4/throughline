// Syntheses: one student's structured summary for one date range, made by Opus from their
// notes, grades and the course's goals (worker/evidence.ts, worker/synthesis-model.ts). The
// screens call it the evidence; the report written from it lives in routes/reports.ts. An
// Opus call costs real money, so a saved summary is served again until the evidence it read
// changes; the Reports tab only offers Generate when it has. See DECISIONS.md.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, getTableColumns, inArray } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../db/schema";
import type { SynthesisRow } from "../db/schema";
import type { Db, UserEnv } from "../db/client";
import type { SynthesisResult, SynthesisRosterRow, SynthesisStatus, SynthesisView } from "../api-types";
import { notFound, ownedClasses, requireClass, requireStudent } from "../db/helpers";
import { reserved } from "../demo";
import { buildEvidence, loadEvidence, todayUtc, type Range } from "../evidence";
import { dateField, idParam } from "../fields";
import { modelAccess } from "../spend";
import { SYNTHESIS_VERSION, inputHash, synthesise } from "../synthesis-model";
import { validate } from "../validate";

const range = { from: dateField("from"), to: dateField("to") };
const ordered = (r: Range) => r.from <= r.to;
const listQuery = z.object({ classId: z.uuid(), ...range }).refine(ordered, "from is after to");
const createBody = z.object({ studentId: z.uuid(), ...range }).refine(ordered, "from is after to");

// What the API hands out: everything but the hash and the prompt version.
const { inputHash: _hash, version: _version, ...listed } = getTableColumns(schema.syntheses);
const view = ({ inputHash: _h, version: _v, ...row }: SynthesisRow): SynthesisView => row;

const byName = new Intl.Collator("en");

const syntheses = new Hono<UserEnv>();

// The newest report written from each of the given summaries.
async function newestReports(db: Db, synthesisIds: string[]): Promise<Map<string, string>> {
  if (synthesisIds.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.reports.id, synthesisId: schema.reports.synthesisId })
    .from(schema.reports)
    .where(inArray(schema.reports.synthesisId, synthesisIds))
    .orderBy(desc(schema.reports.createdAt));
  const newest = new Map<string, string>();
  for (const r of rows) if (!newest.has(r.synthesisId)) newest.set(r.synthesisId, r.id);
  return newest;
}

// GET /api/syntheses?classId=…&from=…&to=… → one row per student still in the class: whether
// a summary exists for exactly this range, whether the evidence has changed since, and the
// report written from it. Hashing every student's evidence is a few dozen small JSON
// strings; no model is called.
syntheses.get("/", validate("query", listQuery), async (c) => {
  const { classId, from, to } = c.req.valid("query");
  await requireClass(c.var.db, c.var.user.id, classId);
  const loaded = await loadEvidence(c.var.db, classId, { from, to });
  const day = todayUtc();
  const students = loaded.students.filter((s) => !s.leftAt);
  const reports = await newestReports(
    c.var.db,
    students.flatMap((s) => loaded.latest(s.id)?.id ?? []),
  );
  const rows = await Promise.all(
    students.map(async (s): Promise<SynthesisRosterRow> => {
      const rows = loaded.rowsFor(s);
      const evidence = buildEvidence(rows, day);
      const saved = loaded.latest(s.id);
      const status: SynthesisStatus = evidence.empty ? "empty" : !saved ? "none" : saved.inputHash === (await inputHash(evidence)) ? "current" : "stale";
      return {
        studentId: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        status,
        synthesisId: saved?.id ?? null,
        createdAt: saved?.createdAt ?? null,
        newNotes: saved ? rows.notes.filter((n) => n.createdAt > saved.createdAt).length : 0,
        reportId: saved ? (reports.get(saved.id) ?? null) : null,
      };
    }),
  );
  rows.sort((a, b) => byName.compare(a.lastName, b.lastName) || byName.compare(a.firstName, b.firstName));
  return c.json(rows satisfies SynthesisRosterRow[]);
});

// POST /api/syntheses { studentId, from, to } → the summary. 200 with cached: true when the
// newest one for this range read exactly the evidence there is now (no model call); otherwise
// Opus is asked and the new one is stored, 201. 422 when the range holds no notes and no
// grades, 503 without an API key, 502 when the model fails; nothing is stored on a failure.
// 403 for a demo visitor who has used their summaries, or an account (or the whole app) over
// its AI spend cap; a cached one is still served to both.
syntheses.post("/", validate("json", createBody), async (c) => {
  const { studentId, from, to } = c.req.valid("json");
  const db = c.var.db;
  const student = await requireStudent(db, c.var.user.id, studentId);
  const loaded = await loadEvidence(db, student.classId, { from, to });
  const s = loaded.students.find((x) => x.id === studentId)!;
  const evidence = buildEvidence(loaded.rowsFor(s), todayUtc());
  if (evidence.empty) throw new HTTPException(422, { message: "nothing to summarise: no notes or grades for this student in that period" });

  const hash = await inputHash(evidence);
  const saved = loaded.latest(studentId);
  if (saved?.inputHash === hash) return c.json({ ...view(saved), cached: true } satisfies SynthesisResult);

  const access = await modelAccess(c);
  if (!access.client) throw access.denied;
  const client = access.client;
  let result: Awaited<ReturnType<typeof synthesise>>;
  try {
    result = await reserved(db, c.var.user, "evidence", 1, () => synthesise({ evidence, client }));
  } catch (err) {
    if (err instanceof HTTPException) throw err; // a demo visitor with no summaries left
    console.error("synthesis failed for student", studentId, err);
    throw new HTTPException(502, { message: "the summary could not be made; try again" });
  }
  const row = await db
    .insert(schema.syntheses)
    .values({
      id: crypto.randomUUID(),
      studentId,
      periodStart: from,
      periodEnd: to,
      version: SYNTHESIS_VERSION,
      inputHash: hash,
      model: result.model,
      json: result.summary,
      createdAt: new Date().toISOString(),
    })
    .returning(listed)
    .get();
  return c.json({ ...row, cached: false } satisfies SynthesisResult, 201);
});

// GET /api/syntheses/:id → one stored summary.
syntheses.get("/:id", validate("param", idParam), async (c) => {
  const row = await c.var.db
    .select(listed)
    .from(schema.syntheses)
    .innerJoin(schema.students, eq(schema.students.id, schema.syntheses.studentId))
    .where(and(eq(schema.syntheses.id, c.req.valid("param").id), inArray(schema.students.classId, ownedClasses(c.var.db, c.var.user.id))))
    .get();
  if (!row) throw notFound("summary");
  return c.json(row satisfies SynthesisView);
});

export default syntheses;
