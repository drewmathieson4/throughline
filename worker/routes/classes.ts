import { Hono } from "hono";
import { asc } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../db/schema";
import type { AppEnv } from "../db/client";
import { dateField, nameField } from "../fields";
import { validate } from "../validate";

const createClass = z
  .object({
    name: nameField("name"),
    termStart: dateField("termStart").optional(),
    termEnd: dateField("termEnd").optional(),
  })
  .refine((c) => !c.termStart || !c.termEnd || c.termEnd >= c.termStart, "termEnd is before termStart");

const classes = new Hono<AppEnv>();

// GET /api/classes
classes.get("/", async (c) => c.json(await c.var.db.select().from(schema.classes).orderBy(asc(schema.classes.createdAt))));

// POST /api/classes { name, termStart?, termEnd? } → 201 with the stored row
classes.post("/", validate("json", createClass), async (c) => {
  const row = await c.var.db
    .insert(schema.classes)
    .values({ id: crypto.randomUUID(), ...c.req.valid("json"), createdAt: new Date().toISOString() })
    .returning()
    .get();
  return c.json(row, 201);
});

export default classes;
