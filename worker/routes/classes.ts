import { Hono } from "hono";
import * as schema from "../db/schema";
import type { AppEnv } from "../db/client";

const classes = new Hono<AppEnv>();

// GET /api/classes
classes.get("/", async (c) => c.json(await c.var.db.select().from(schema.classes)));

export default classes;
