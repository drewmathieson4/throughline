import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";
import { drizzle } from "drizzle-orm/d1";
import { migrate } from "drizzle-orm/d1/migrator";
import app from "../index";
import type { Note } from "../db/schema";
import seed from "../../scripts/seed-dev.sql?raw";

// Real D1 (Miniflare, in memory) built from the committed migrations plus the dev seed,
// so these tests exercise the actual schema and SQL rather than a mock.
const CLASS_ID = "11111111-1111-4111-8111-111111111111";
const UNKNOWN_CLASS_ID = "99999999-9999-4999-8999-999999999999";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const proxy = await getPlatformProxy<Env>({ persist: false });
  env = proxy.env;
  dispose = proxy.dispose;
  await migrate(drizzle(env.DB), { migrationsFolder: "drizzle" });
  // exec() runs one statement per line and rejects comment-only lines.
  await env.DB.exec(seed.split("\n").filter((line) => !line.startsWith("--")).join("\n"));
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM notes").run();
});

afterAll(async () => {
  await dispose();
});

function getNotes(classId: string) {
  return app.request(`/api/notes?classId=${classId}`, {}, env);
}

// A string body is sent verbatim so tests can post malformed JSON.
function postNote(body: unknown) {
  return app.request(
    "/api/notes",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env,
  );
}

test("GET /api/notes requires a uuid classId", async () => {
  expect((await app.request("/api/notes", {}, env)).status).toBe(400);
  expect((await getNotes("not-a-uuid")).status).toBe(400);
});

test("GET /api/notes returns 404 for an unknown class", async () => {
  expect((await getNotes(UNKNOWN_CLASS_ID)).status).toBe(404);
});

test("GET /api/notes returns an empty list for the seeded class", async () => {
  const res = await getNotes(CLASS_ID);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test("POST /api/notes stores a text note and GET lists it newest first", async () => {
  const first = await postNote({ classId: CLASS_ID, body: "Older note", notedAt: "2026-10-01T09:00:00Z" });
  expect(first.status).toBe(201);
  expect(((await first.json()) as Note).notedAt).toBe("2026-10-01T09:00:00.000Z");

  const second = await postNote({ classId: CLASS_ID, body: "  Newer note  " });
  expect(second.status).toBe(201);
  const created = (await second.json()) as Note;
  expect(created).toMatchObject({ classId: CLASS_ID, kind: "text", body: "Newer note" });
  expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

  const list = (await (await getNotes(CLASS_ID)).json()) as Note[];
  expect(list.map((n) => n.body)).toEqual(["Newer note", "Older note"]);
});

test("POST /api/notes rejects an empty body with a message", async () => {
  const res = await postNote({ classId: CLASS_ID, body: "   " });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "body is required" });
});

test("POST /api/notes rejects malformed JSON", async () => {
  expect((await postNote("{not json")).status).toBe(400);
});

test("POST /api/notes returns 404 for an unknown class", async () => {
  expect((await postNote({ classId: UNKNOWN_CLASS_ID, body: "x" })).status).toBe(404);
});
