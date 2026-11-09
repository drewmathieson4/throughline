// Worker entry point. Hono routes every /api/* request; static assets (the React
// app) are served by Cloudflare before this code runs, so non-API paths 404 here.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireUser, withUser } from "./auth";
import { withDb, type AppEnv } from "./db/client";
import auth from "./routes/auth";
import classes from "./routes/classes";
import documents from "./routes/documents";
import grades from "./routes/grades";
import materials from "./routes/materials";
import notes from "./routes/notes";
import reports from "./routes/reports";
import students from "./routes/students";
import syntheses from "./routes/syntheses";

const app = new Hono<AppEnv>();

app.use("/api/*", withDb, withUser);

app.get("/api/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));
app.route("/api/auth", auth);
// Hono runs what matches in registration order: health and auth answer above without a
// session; everything registered below this line needs one (401 otherwise).
app.use("/api/*", requireUser);
app.route("/api/classes", classes);
app.route("/api/documents", documents);
app.route("/api/grades", grades);
app.route("/api/materials", materials);
app.route("/api/notes", notes);
app.route("/api/reports", reports);
app.route("/api/students", students);
app.route("/api/syntheses", syntheses);

app.notFound((c) => c.json({ error: "not found" }, 404));
// Every /api error is { error: string }. Routes and middleware throw HTTPException for the
// expected ones (400, 404); anything else (D1 failures, FK violations) is logged, not leaked.
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export default app;
