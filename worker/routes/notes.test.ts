import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { getPlatformProxy, unstable_splitSqlQuery as splitSql } from "wrangler";
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
let dispose = async () => {};

beforeAll(async () => {
  const proxy = await getPlatformProxy<Env>({ persist: false });
  env = proxy.env;
  dispose = proxy.dispose;
  await migrate(drizzle(env.DB), { migrationsFolder: "drizzle" });
  // Same splitter `wrangler d1 execute --file` uses, so the seed file has one loader contract.
  await env.DB.batch(splitSql(seed).map((s) => env.DB.prepare(s)));
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM notes").run();
});

afterAll(() => dispose());

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

test("POST /api/notes rejects a notedAt more than a day in the future", async () => {
  const res = await postNote({ classId: CLASS_ID, body: "x", notedAt: "9999-12-31T00:00:00Z" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "notedAt is in the future" });
});

test("POST /api/notes rejects malformed JSON", async () => {
  const res = await postNote("{not json");
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Malformed JSON in request body" });
});

test("POST /api/notes returns 404 for an unknown class", async () => {
  expect((await postNote({ classId: UNKNOWN_CLASS_ID, body: "x" })).status).toBe(404);
});
