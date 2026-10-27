// Course materials: the syllabus and similar documents, one list per class. They arrive as
// contextual documents (routes/documents.ts), which sorts each file and stores the course
// ones here with Haiku's summary; this route only lists and deletes them.
import { Hono } from "hono";
import { and, desc, eq, getTableColumns, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { UserEnv } from "../db/client";
import type { MaterialRow } from "../api-types";
import { notFound, ownedClasses, requireClass } from "../db/helpers";
import { classIdQuery, idParam } from "../fields";
import { validate } from "../validate";

// What the API hands out: every column but the text, which only the synthesis will read.
const { text: _text, ...listed } = getTableColumns(schema.classMaterials);

const materials = new Hono<UserEnv>();

// GET /api/materials?classId=… → the class's materials, newest first, without their text.
materials.get("/", validate("query", classIdQuery), async (c) => {
  const { classId } = c.req.valid("query");
  await requireClass(c.var.db, c.var.user.id, classId);
  const rows = await c.var.db.select(listed).from(schema.classMaterials).where(eq(schema.classMaterials.classId, classId)).orderBy(desc(schema.classMaterials.createdAt));
  return c.json(rows satisfies MaterialRow[]);
});

// DELETE /api/materials/:id → 200 { id }, or 404.
materials.delete("/:id", validate("param", idParam), async (c) => {
  const { id } = c.req.valid("param");
  const deleted = await c.var.db
    .delete(schema.classMaterials)
    .where(and(eq(schema.classMaterials.id, id), inArray(schema.classMaterials.classId, ownedClasses(c.var.db, c.var.user.id))))
    .returning({ id: schema.classMaterials.id })
    .get();
  if (!deleted) throw notFound("material");
  return c.json(deleted);
});

export default materials;
