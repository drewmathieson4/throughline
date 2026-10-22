// Worker entry point. Hono routes every /api/* request; static assets (the React
// app) are served by Cloudflare before this code runs, so non-API paths 404 here.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { withDb, type AppEnv } from "./db/client";
import classes from "./routes/classes";
import notes from "./routes/notes";

const app = new Hono<AppEnv>();

app.use("/api/*", withDb);

app.get("/api/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));
app.route("/api/classes", classes);
app.route("/api/notes", notes);

app.notFound((c) => c.json({ error: "not found" }, 404));
// Every /api error is { error: string }. Routes and middleware throw HTTPException for the
// expected ones (400, 404); anything else (D1 failures, FK violations) is logged, not leaked.
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export default app;
