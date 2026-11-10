import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../db/schema";
import type { UserEnv } from "../db/client";
import type { ClassSettingsView, ReportRules } from "../api-types";
import { pruneMentions, requireClass } from "../db/helpers";
import { dateField, idParam, nameField } from "../fields";
import { validate } from "../validate";

const createClass = z
  .object({
    name: nameField("name"),
    termStart: dateField("termStart").optional(),
    termEnd: dateField("termEnd").optional(),
  })
  .refine((c) => !c.termStart || !c.termEnd || c.termEnd >= c.termStart, "termEnd is before termStart");

// How the class's reports should read (worker/report-model.ts). Bounded so a pasted novel
// cannot become the prompt; the model reads all of it.
const rules = z
  .object({
    sentences: z.int().min(2).max(12).optional(),
    avoid: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();
const settingsBody = z.object({
  reportRules: rules.nullable(),
  styleSamples: z.string().trim().max(10_000).nullable(),
});

const classes = new Hono<UserEnv>();

// GET /api/classes → the signed-in teacher's classes
classes.get("/", async (c) =>
  c.json(await c.var.db.select().from(schema.classes).where(eq(schema.classes.ownerId, c.var.user.id)).orderBy(asc(schema.classes.createdAt))),
);

// POST /api/classes { name, termStart?, termEnd? } → 201 with the stored row
classes.post("/", validate("json", createClass), async (c) => {
  const row = await c.var.db
    .insert(schema.classes)
    .values({ id: crypto.randomUUID(), ownerId: c.var.user.id, ...c.req.valid("json"), createdAt: new Date().toISOString() })
    .returning()
    .get();
  return c.json(row, 201);
});

const settingsView = (row: { reportRules: ReportRules | null; styleSamples: string | null } | undefined): ClassSettingsView => ({
  reportRules: row?.reportRules ?? null,
  styleSamples: row?.styleSamples || null,
});

// GET /api/classes/:id/settings → the report rules and style samples, null where unset.
classes.get("/:id/settings", validate("param", idParam), async (c) => {
  const { id } = c.req.valid("param");
  await requireClass(c.var.db, c.var.user.id, id);
  const row = await c.var.db.select().from(schema.settings).where(eq(schema.settings.classId, id)).get();
  return c.json(settingsView(row));
});

// PUT /api/classes/:id/settings { reportRules, styleSamples } → the stored settings. One row
// per class, written whole: the form sends everything it holds each time.
classes.put("/:id/settings", validate("param", idParam), validate("json", settingsBody), async (c) => {
  const { id } = c.req.valid("param");
  await requireClass(c.var.db, c.var.user.id, id);
  const { reportRules, styleSamples } = c.req.valid("json");
  const values = { reportRules, styleSamples: styleSamples || null };
  const row = await c.var.db
    .insert(schema.settings)
    .values({ classId: id, ...values })
    .onConflictDoUpdate({ target: schema.settings.classId, set: values })
    .returning()
    .get();
  return c.json(settingsView(row));
});

// DELETE /api/classes/:id → 204. One row delete; the foreign keys cascade through the
// students (and their tags, grades, evidence and reports), every note filed under the class
// (with its tags and mentions), the materials and the settings. A note with no class that
// was tagged to one of its students stays, untagged: notes hang off the owner, not the class.
// Open mentions on such notes stop offering the class's students.
classes.delete("/:id", validate("param", idParam), async (c) => {
  const { id } = c.req.valid("param");
  const db = c.var.db;
  const uid = c.var.user.id;
  await requireClass(db, uid, id);
  await db.batch([db.delete(schema.classes).where(eq(schema.classes.id, id)), ...pruneMentions(db, uid)]);
  return c.body(null, 204);
});

export default classes;
