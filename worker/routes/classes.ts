import { Hono } from "hono";
import { z } from "zod";
import * as schema from "../db/schema";
import { requireClass, selectRoster } from "../db/queries";
import type { AppEnv } from "../db/client";
import { validate } from "../validate";

const classParam = z.object({ classId: z.uuid() });

const classes = new Hono<AppEnv>();

// GET /api/classes
classes.get("/", async (c) => c.json(await c.var.db.select().from(schema.classes)));

// GET /api/classes/:classId/students → the roster, by last name
classes.get("/:classId/students", validate("param", classParam), async (c) => {
  const { classId } = c.req.valid("param");
  await requireClass(c.var.db, classId);
  return c.json(await selectRoster(c.var.db, classId));
});

export default classes;
