// Notes: what the teacher captured. This feature only handles kind="text";
// voice and AI tagging arrive later and plug into the same table.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../db/schema";
import type { AppEnv, Db } from "../db/client";
import { validate } from "../validate";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const listQuery = z.object({ classId: z.uuid() });

const createNote = z.object({
  classId: z.uuid(),
  body: z.string().trim().min(1, "body is required").max(5000, "body is too long"),
  // When the observation happened; defaults to now. Re-serialized so every stored
  // value has the same shape and ORDER BY noted_at sorts chronologically. Bounded so a
  // typo like 9999-… cannot sit at the top of the list for the rest of the term.
  notedAt: z.iso
    .datetime({ offset: true })
    .transform((s) => new Date(s).toISOString())
    .refine((s) => Date.parse(s) <= Date.now() + ONE_DAY_MS, "notedAt is in the future")
    .optional(),
});

async function requireClass(db: Db, classId: string) {
  const row = await db.select({ id: schema.classes.id }).from(schema.classes).where(eq(schema.classes.id, classId)).get();
  if (!row) throw new HTTPException(404, { message: "class not found" });
}

const notes = new Hono<AppEnv>();

// GET /api/notes?classId=… → newest first
notes.get("/", validate("query", listQuery), async (c) => {
  const { classId } = c.req.valid("query");
  await requireClass(c.var.db, classId);
  const rows = await c.var.db
    .select()
    .from(schema.notes)
    .where(eq(schema.notes.classId, classId))
    .orderBy(desc(schema.notes.notedAt), desc(schema.notes.createdAt));
  return c.json(rows);
});

// POST /api/notes { classId, body, notedAt? } → 201 with the stored row
notes.post("/", validate("json", createNote), async (c) => {
  const { classId, body, notedAt } = c.req.valid("json");
  await requireClass(c.var.db, classId);
  const now = new Date().toISOString();
  const row = await c.var.db
    .insert(schema.notes)
    .values({ id: crypto.randomUUID(), classId, kind: "text", body, notedAt: notedAt ?? now, createdAt: now })
    .returning()
    .get();
  return c.json(row, 201);
});

export default notes;
