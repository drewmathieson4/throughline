// Shared setup for route tests: a real D1 (Miniflare, in memory) built from the committed
// migrations, reset to the dev seed before every test, so tests exercise the actual schema
// and SQL. Each test file calls setupTestDb() once at module scope.
import { afterAll, beforeAll, beforeEach } from "vitest";
import { getPlatformProxy, unstable_splitSqlQuery as splitSql } from "wrangler";
import { drizzle } from "drizzle-orm/d1";
import { migrate } from "drizzle-orm/d1/migrator";
import app from "./index";
import seed from "../scripts/seed-dev.sql?raw";

export const SEED_CLASS_ID = "11111111-1111-4111-8111-111111111111";
export const SEED_STUDENT_IDS = Array.from({ length: 8 }, (_, i) => `22222222-2222-4222-8222-2222222222${String(i + 1).padStart(2, "0")}`);
export const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";
// Ids for notes a test inserts; the tagging lane will create these rows in production.
export const NOTE_ID = (n: number) => `33333333-3333-4333-8333-3333333333${String(n).padStart(2, "0")}`;

// Same splitter `wrangler d1 execute --file` uses, so the seed file has one loader contract.
const seedStatements = splitSql(seed);

export function setupTestDb() {
  let env: Env;
  let dispose = async () => {};
  const prepare = (query: string, ...binds: unknown[]) => env.DB.prepare(query).bind(...binds);

  beforeAll(async () => {
    // remoteBindings: false keeps the AI binding from dialing Cloudflare; voice tests swap it
    // for a fake anyway, so Whisper is never called and the suite runs offline.
    const proxy = await getPlatformProxy<Env>({ persist: false, remoteBindings: false });
    env = proxy.env;
    dispose = proxy.dispose;
    await migrate(drizzle(env.DB), { migrationsFolder: "drizzle" });
  });
  // Deleting classes cascades through students, notes and note_students; the seed is
  // INSERT OR IGNORE so it reruns cleanly. One place to keep in step with the schema.
  beforeEach(() => env.DB.batch([prepare("DELETE FROM classes"), ...seedStatements.map((s) => prepare(s))]));
  afterAll(() => dispose());

  const request = (url: string, init?: RequestInit) => app.request(url, init, env);
  return {
    get env() {
      return env;
    },
    request,
    json: async <T>(url: string, init?: RequestInit) => (await request(url, init)).json() as Promise<T>,
    // Raw inserts only for note_students, which has no write route yet; everything else
    // should go through the routes so the seed stays the one column list to maintain.
    insertNote: (id: string, classId: string, notedAt: string) =>
      prepare("INSERT INTO notes (id, class_id, kind, body, noted_at, created_at) VALUES (?, ?, 'text', ?, ?, ?)", id, classId, `note ${id.slice(-2)}`, notedAt, notedAt),
    tagNote: (noteId: string, studentId: string, confirmed: 0 | 1) =>
      prepare("INSERT INTO note_students (note_id, student_id, confirmed) VALUES (?, ?, ?)", noteId, studentId, confirmed),
  };
}

// Like src/api.ts jsonInit, except a string body is sent verbatim so tests can post
// malformed JSON. (Worker and browser code live in different tsconfigs, hence two copies.)
export const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
