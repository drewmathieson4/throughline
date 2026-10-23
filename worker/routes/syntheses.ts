// Syntheses: one student's structured summary for one date range, made by Opus from their
// notes, grades and the course's goals (worker/evidence.ts, worker/synthesis-model.ts). An
// Opus call costs real money, so a saved summary is served again until the evidence it read
// changes; the Reports tab only offers Generate when it has. See DECISIONS.md.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import Anthropic from "@anthropic-ai/sdk";
import { eq, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../db/schema";
import type { SynthesisRow } from "../db/schema";
import type { AppEnv } from "../db/client";
import type { SynthesisResult, SynthesisRosterRow, SynthesisStatus, SynthesisView } from "../api-types";
import { notFound } from "../db/helpers";
import { buildEvidence, loadEvidence, type Range } from "../evidence";
import { dateField, idParam } from "../fields";
import { SYNTHESIS_VERSION, inputHash, synthesise } from "../synthesis-model";
import { validate } from "../validate";

const range = { from: dateField("from"), to: dateField("to") };
const ordered = (r: Range) => r.from <= r.to;
const listQuery = z.object({ classId: z.uuid(), ...range }).refine(ordered, "from is after to");
const createBody = z.object({ studentId: z.uuid(), ...range }).refine(ordered, "from is after to");

// What the API hands out: everything but the hash and the prompt version.
const { inputHash: _hash, version: _version, ...listed } = getTableColumns(schema.syntheses);
const view = ({ inputHash: _h, version: _v, ...row }: SynthesisRow): SynthesisView => row;

// The UTC calendar day: what coverage counts silence up to.
const today = () => new Date().toISOString().slice(0, 10);
const byName = new Intl.Collator("en");

const syntheses = new Hono<AppEnv>();

// GET /api/syntheses?classId=…&from=…&to=… → one row per student still in the class: whether
// a summary exists for exactly this range and whether the evidence has changed since.
// Hashing every student's evidence is a few dozen small JSON strings; no model is called.
syntheses.get("/", validate("query", listQuery), async (c) => {
  const { classId, from, to } = c.req.valid("query");
  const loaded = await loadEvidence(c.var.db, classId, { from, to });
  if (loaded.className === null) throw notFound("class");
  const day = today();
  const rows = await Promise.all(
    loaded.students
      .filter((s) => !s.leftAt)
      .map(async (s): Promise<SynthesisRosterRow> => {
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
syntheses.post("/", validate("json", createBody), async (c) => {
  const { studentId, from, to } = c.req.valid("json");
  const db = c.var.db;
  const student = await db.select({ classId: schema.students.classId }).from(schema.students).where(eq(schema.students.id, studentId)).get();
  if (!student) throw notFound("student");
  const loaded = await loadEvidence(db, student.classId, { from, to });
  const s = loaded.students.find((x) => x.id === studentId)!;
  const evidence = buildEvidence(loaded.rowsFor(s), today());
  if (evidence.empty) throw new HTTPException(422, { message: "nothing to summarise: no notes or grades for this student in that period" });

  const hash = await inputHash(evidence);
  const saved = loaded.latest(studentId);
  if (saved?.inputHash === hash) return c.json({ ...view(saved), cached: true } satisfies SynthesisResult);

  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new HTTPException(503, { message: "summaries need ANTHROPIC_API_KEY" });
  let result: Awaited<ReturnType<typeof synthesise>>;
  try {
    result = await synthesise({ evidence, client: new Anthropic({ apiKey }) });
  } catch (err) {
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
  const row = await c.var.db.select(listed).from(schema.syntheses).where(eq(schema.syntheses.id, c.req.valid("param").id)).get();
  if (!row) throw notFound("summary");
  return c.json(row satisfies SynthesisView);
});

export default syntheses;
