// Notes: what the teacher captured. This feature only handles kind="text";
// voice and AI tagging arrive later and plug into the same table.
import { Hono, type Context } from "hono";
import { desc, eq } from "drizzle-orm";
import { z, type ZodError } from "zod";
import * as schema from "../db/schema";
import type { AppEnv, Db } from "../db/client";

const listQuery = z.object({ classId: z.uuid() });

const createNote = z.object({
  classId: z.uuid(),
  body: z.string().trim().min(1, "body is required").max(5000, "body is too long"),
  // When the observation happened; defaults to now. Re-serialized so every stored
  // value has the same shape and ORDER BY noted_at sorts chronologically.
  notedAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s).toISOString()).optional(),
});

const invalid = (c: Context, err: ZodError) =>
  c.json({ error: err.issues[0]?.message ?? "invalid request" }, 400);

function classExists(db: Db, classId: string) {
  return db.select({ id: schema.classes.id }).from(schema.classes).where(eq(schema.classes.id, classId)).get();
}

const notes = new Hono<AppEnv>();

// GET /api/notes?classId=… → newest first
notes.get("/", async (c) => {
  const q = listQuery.safeParse(c.req.query());
  if (!q.success) return invalid(c, q.error);
  const { classId } = q.data;

  const rows = await c.var.db
    .select()
    .from(schema.notes)
    .where(eq(schema.notes.classId, classId))
    .orderBy(desc(schema.notes.notedAt), desc(schema.notes.createdAt));
  // Only an empty result is ambiguous between "no notes" and "no such class".
  if (rows.length === 0 && !(await classExists(c.var.db, classId))) {
    return c.json({ error: "class not found" }, 404);
  }
  return c.json(rows);
});

// POST /api/notes { classId, body, notedAt? } → 201 with the stored row
notes.post("/", async (c) => {
  const parsed = createNote.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return invalid(c, parsed.error);
  const { classId, body, notedAt } = parsed.data;
  if (!(await classExists(c.var.db, classId))) return c.json({ error: "class not found" }, 404);

  const now = new Date().toISOString();
  const row = await c.var.db
    .insert(schema.notes)
    .values({ id: crypto.randomUUID(), classId, kind: "text", body, notedAt: notedAt ?? now, createdAt: now })
    .returning()
    .get();
  return c.json(row, 201);
});

export default notes;
