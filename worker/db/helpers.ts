// Lookups shared by several route files.
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import type { Db } from "./client";

export const notFound = (what: string) => new HTTPException(404, { message: `${what} not found` });

export async function requireClass(db: Db, classId: string) {
  const row = await db.select({ id: schema.classes.id }).from(schema.classes).where(eq(schema.classes.id, classId)).get();
  if (!row) throw notFound("class");
}
