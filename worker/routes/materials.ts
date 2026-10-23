// Course materials: the syllabus and similar documents, one list per class. A file is read
// the way a progress report is (worker/upload.ts), summarised by Haiku into goals, grading
// weights, units and policies, and stored whole. Unlike a document of student reports, the
// raw text is worth keeping on its own (the synthesis prompt can quote it), so a failed
// summary still stores the file, with summary null. See DECISIONS.md.
import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import { desc, eq, getTableColumns } from "drizzle-orm";
import * as schema from "../db/schema";
import type { CourseSummary } from "../db/schema";
import type { AppEnv } from "../db/client";
import type { MaterialRow } from "../api-types";
import { notFound, requireClass } from "../db/helpers";
import { classIdQuery, idParam } from "../fields";
import { summariseMaterial } from "../materials-model";
import { readUpload, uploadLimit, uploadName } from "../upload";
import { validate } from "../validate";

const uploadQuery = classIdQuery.extend({ name: uploadName });

// What the API hands out: every column but the text, which only the synthesis will read.
const { text: _text, ...listed } = getTableColumns(schema.classMaterials);

// The structured reading of the text, or null when the model could not be asked or did not
// answer usably (logged). Null never blocks the upload.
async function summarise(apiKey: string | undefined, name: string, text: string): Promise<CourseSummary | null> {
  if (!apiKey) {
    console.warn("ANTHROPIC_API_KEY is not set; material stored without a summary", name);
    return null;
  }
  try {
    return await summariseMaterial({ text, client: new Anthropic({ apiKey }) });
  } catch (err) {
    console.error("summarising failed for material", name, err);
    return null;
  }
}

const materials = new Hono<AppEnv>();

// GET /api/materials?classId=… → the class's materials, newest first, without their text.
materials.get("/", validate("query", classIdQuery), async (c) => {
  const { classId } = c.req.valid("query");
  await requireClass(c.var.db, classId);
  const rows = await c.var.db.select(listed).from(schema.classMaterials).where(eq(schema.classMaterials.classId, classId)).orderBy(desc(schema.classMaterials.createdAt));
  return c.json(rows satisfies MaterialRow[]);
});

// POST /api/materials?classId=…&name=… with the file as the body → reads it, summarises it,
// stores it; 201 with the row as GET lists it. 400 when the file cannot be read. Uploading
// the same file twice stores it twice; the teacher deletes the one they do not want.
materials.post("/", validate("query", uploadQuery), uploadLimit, async (c) => {
  const { classId, name } = c.req.valid("query");
  const [, text] = await Promise.all([requireClass(c.var.db, classId), readUpload(c, name)]);
  const summary = await summarise(c.env.ANTHROPIC_API_KEY, name, text);
  const row = await c.var.db
    .insert(schema.classMaterials)
    .values({ id: crypto.randomUUID(), classId, name, text, summary, createdAt: new Date().toISOString() })
    .returning(listed)
    .get();
  return c.json(row satisfies MaterialRow, 201);
});

// DELETE /api/materials/:id → 200 { id }, or 404.
materials.delete("/:id", validate("param", idParam), async (c) => {
  const { id } = c.req.valid("param");
  const deleted = await c.var.db.delete(schema.classMaterials).where(eq(schema.classMaterials.id, id)).returning({ id: schema.classMaterials.id }).get();
  if (!deleted) throw notFound("material");
  return c.json(deleted);
});

export default materials;
