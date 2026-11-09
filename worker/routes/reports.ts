// Reports: the parent-facing comment written by Opus from one saved evidence summary
// (routes/syntheses.ts), stored with the teacher's edit beside it. A report belongs to one
// synthesis row: regenerate the evidence and there is no report until one is written again.
// Every write is a fresh row (the newest is shown), so "Write again" costs a call and keeps
// nothing from the old one. See DECISIONS.md.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../db/schema";
import type { UserEnv } from "../db/client";
import type { ReportView } from "../api-types";
import { notFound, ownedReport } from "../db/helpers";
import { reserved } from "../demo";
import { idParam } from "../fields";
import { ModelError } from "../model";
import { writeReport } from "../report-model";
import { modelAccess } from "../spend";
import { validate } from "../validate";

// Room for a comment rewritten by hand; well past what the model is bounded to.
export const MAX_EDIT_CHARS = 5000;

const createBody = z.object({ synthesisId: z.uuid() });
const patchBody = z.object({ editedText: z.string().max(MAX_EDIT_CHARS, "the report is too long").nullable() });

const reports = new Hono<UserEnv>();

// POST /api/reports { synthesisId } → 201 with the report. 503 without an API key, 502 when
// the model fails (nothing stored), 403 for a demo visitor out of reports or an account over
// its AI spend cap.
reports.post("/", validate("json", createBody), async (c) => {
  const { synthesisId } = c.req.valid("json");
  const db = c.var.db;
  const found = await db
    .select({
      synthesis: schema.syntheses,
      firstName: schema.students.firstName,
      classId: schema.students.classId,
      className: schema.classes.name,
      rules: schema.settings.reportRules,
      samples: schema.settings.styleSamples,
    })
    .from(schema.syntheses)
    .innerJoin(schema.students, eq(schema.students.id, schema.syntheses.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, schema.students.classId))
    .leftJoin(schema.settings, eq(schema.settings.classId, schema.classes.id))
    .where(and(eq(schema.syntheses.id, synthesisId), eq(schema.classes.ownerId, c.var.user.id)))
    .get();
  if (!found) throw notFound("summary");

  const access = await modelAccess(c);
  if (!access.client) throw access.denied;
  const client = access.client;
  const report = {
    firstName: found.firstName,
    className: found.className,
    period: { from: found.synthesis.periodStart, to: found.synthesis.periodEnd },
    synthesis: found.synthesis.json,
    rules: found.rules,
    samples: found.samples,
  };
  let result: Awaited<ReturnType<typeof writeReport>>;
  try {
    result = await reserved(db, c.var.user, "reports", 1, () => writeReport({ report, client }));
  } catch (err) {
    if (err instanceof HTTPException) throw err; // a demo visitor with no reports left
    if (!(err instanceof ModelError)) console.error("report failed for summary", synthesisId, err);
    throw new HTTPException(502, { message: "the report could not be written; try again" });
  }
  const row = await db
    .insert(schema.reports)
    .values({ id: crypto.randomUUID(), synthesisId, model: result.model, generatedText: result.text, editedText: null, createdAt: new Date().toISOString() })
    .returning()
    .get();
  return c.json(row satisfies ReportView, 201);
});

// GET /api/reports/:id → one report.
reports.get("/:id", validate("param", idParam), async (c) => {
  const { id } = c.req.valid("param");
  const row = await c.var.db.select().from(schema.reports).where(ownedReport(c.var.db, c.var.user.id, id)).get();
  if (!row) throw notFound("report");
  return c.json(row satisfies ReportView);
});

// PATCH /api/reports/:id { editedText } → the report with the teacher's text saved; null puts
// it back to what was generated. The generated text is never changed.
reports.patch("/:id", validate("param", idParam), validate("json", patchBody), async (c) => {
  const { id } = c.req.valid("param");
  const row = await c.var.db
    .update(schema.reports)
    .set({ editedText: c.req.valid("json").editedText })
    .where(ownedReport(c.var.db, c.var.user.id, id))
    .returning()
    .get();
  if (!row) throw notFound("report");
  return c.json(row satisfies ReportView);
});

export default reports;
