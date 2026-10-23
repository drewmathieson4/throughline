// Shared setup for route tests: a real D1 (Miniflare, in memory) built from the committed
// migrations, reset to the dev seed before every test, so tests exercise the actual schema
// and SQL. Each test file calls setupTestDb() once at module scope.
import { afterAll, beforeAll, beforeEach, vi } from "vitest";
import { getPlatformProxy, unstable_splitSqlQuery as splitSql } from "wrangler";
import { drizzle } from "drizzle-orm/d1";
import { migrate } from "drizzle-orm/d1/migrator";
import app from "./index";
import seed from "../scripts/seed-dev.sql?raw";

export const SEED_CLASS_ID = "11111111-1111-4111-8111-111111111111"; // Period 3 Humanities, 9 students
export const CLASS_B_ID = "11111111-1111-4111-8111-111111112222"; // B Block Humanities, 3 students
export const SEED_STUDENT_IDS = Array.from({ length: 8 }, (_, i) => `22222222-2222-4222-8222-2222222222${String(i + 1).padStart(2, "0")}`);
// Seeded students by first name (see scripts/seed-dev.sql). Alex Ruiz, Nola, Cassius are in B Block.
export const STUDENT = {
  avery: "22222222-2222-4222-8222-222222222201",
  rowan: "22222222-2222-4222-8222-222222222202",
  juniper: "22222222-2222-4222-8222-222222222204",
  alexMarsh: "22222222-2222-4222-8222-222222222209",
  alexRuiz: "22222222-2222-4222-8222-222222222210",
  nola: "22222222-2222-4222-8222-222222222211",
  cassius: "22222222-2222-4222-8222-222222222212",
} as const;
export const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";
// Ids for notes a test inserts directly.
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
    // The proxy also loads .dev.vars. Tests must behave the same with or without a real
    // Anthropic key there, so it is stripped; a test that wants tagging attempted adds one.
    env = { ...proxy.env };
    delete (env as Partial<Env>).ANTHROPIC_API_KEY;
    dispose = proxy.dispose;
    await migrate(drizzle(env.DB), { migrationsFolder: "drizzle" });
  });
  // Deleting classes cascades through students, notes, note_students and note_mentions; the
  // seed is INSERT OR IGNORE so it reruns cleanly. One place to keep in step with the schema.
  beforeEach(() => env.DB.batch([prepare("DELETE FROM classes"), prepare("DELETE FROM notes"), ...seedStatements.map((s) => prepare(s))]));
  afterAll(() => dispose());

  const request = (url: string, init?: RequestInit) => app.request(url, init, env);
  return {
    get env() {
      return env;
    },
    request,
    json: async <T>(url: string, init?: RequestInit) => (await request(url, init)).json() as Promise<T>,
    // Raw inserts for tests that need rows without going through tagging.
    insertNote: (id: string, classId: string | null, notedAt: string) =>
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

// Run a request whose failure path logs with console.error, without the noise in test output.
export async function quietErrors<T>(fn: () => T | Promise<T>): Promise<T> {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}
