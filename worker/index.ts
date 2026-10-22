// Worker entry point. Hono routes every /api/* request; static assets (the React
// app) are served by Cloudflare before this code runs, so non-API paths 404 here.
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.get("/api/classes", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const rows = await db.select().from(schema.classes);
  return c.json(rows);
});

app.notFound((c) => c.json({ error: "not found" }, 404));

export default app;
