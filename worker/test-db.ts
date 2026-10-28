// Shared setup for route tests: a real D1 (Miniflare, in memory) built from the committed
// migrations, reset to the dev seed before every test, so tests exercise the actual schema
// and SQL. Each test file calls setupTestDb() once at module scope.
import { afterAll, beforeAll, beforeEach, vi } from "vitest";
import { getPlatformProxy, unstable_splitSqlQuery as splitSql } from "wrangler";
import { drizzle } from "drizzle-orm/d1";
import { migrate } from "drizzle-orm/d1/migrator";
import app from "./index";
import type { SessionUser } from "./api-types";
import { hashToken } from "./auth";
import seed from "../scripts/seed-dev.sql?raw";

// Who is signed in. The seed's Dev Teacher owns the seeded classes; a second teacher with
// one class of their own is added before every test, so ownership tests have someone to
// be shut out of. A session for each is stored, and request() presents the dev one by default.
export const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";
export const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
export const OTHER_CLASS_ID = "11111111-1111-4111-8111-111111119999";
export const OTHER_STUDENT_ID = "22222222-2222-4222-8222-222222222299";
const TOKENS = { dev: "test-session-dev", other: "test-session-other" } as const;
// A named account, nobody, or a session token a test was given (a demo visitor's).
export type Who = keyof typeof TOKENS | "anon" | { token: string };

// The request as `who` would send it: with their session cookie, or none.
export function signedIn(init: RequestInit = {}, who: Who = "dev"): RequestInit {
  if (who === "anon") return init;
  const headers = new Headers(init.headers);
  headers.set("cookie", `session=${typeof who === "string" ? TOKENS[who] : who.token}`);
  return { ...init, headers };
}

// The seeded roster (scripts/seed-dev.sql): three classes, 20 students. Tests that count rows
// derive from these so a roster change is a one-line edit here.
export const SEED_CLASS_ID = "11111111-1111-4111-8111-111111111111"; // Period 3 Humanities
export const CLASS_B_ID = "11111111-1111-4111-8111-111111112222"; // B Block Humanities
export const CLASS_C_ID = "11111111-1111-4111-8111-111111113333"; // Period 5 Humanities
export const SEED_CLASS_NAMES = ["B Block Humanities", "Period 3 Humanities", "Period 5 Humanities"]; // sorted
export const PERIOD_3_COUNT = 7;
export const SEED_STUDENT_COUNT = 20;
// Seeded students by first name; the class of each is in the seed file.
export const STUDENT = {
  avery: "22222222-2222-4222-8222-222222222201",
  rowan: "22222222-2222-4222-8222-222222222202",
  juniper: "22222222-2222-4222-8222-222222222204",
  marlowe: "22222222-2222-4222-8222-222222222205",
  ember: "22222222-2222-4222-8222-222222222206",
  alexMarsh: "22222222-2222-4222-8222-222222222209",
  alexRuiz: "22222222-2222-4222-8222-222222222210",
  nola: "22222222-2222-4222-8222-222222222211",
  cassius: "22222222-2222-4222-8222-222222222212",
  ronan: "22222222-2222-4222-8222-222222222213",
  theo: "22222222-2222-4222-8222-222222222214",
  imogen: "22222222-2222-4222-8222-222222222215",
} as const;
export const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";
// Ids for notes and mentions a test inserts directly.
export const NOTE_ID = (n: number) => `33333333-3333-4333-8333-3333333333${String(n).padStart(2, "0")}`;
export const MENTION_ID = (n: number) => `44444444-4444-4444-8444-4444444444${String(n).padStart(2, "0")}`;

// Same splitter `wrangler d1 execute --file` uses, so the seed file has one loader contract.
const seedStatements = splitSql(seed);

export function setupTestDb() {
  let env: Env;
  let dispose = async () => {};
  let hashes: Record<keyof typeof TOKENS, string>;
  const prepare = (query: string, ...binds: unknown[]) => env.DB.prepare(query).bind(...binds);
  // The second teacher, their class and student, and both sessions.
  const accounts = () => {
    const at = "2026-09-01T08:00:00.000Z";
    const until = "2099-01-01T00:00:00.000Z";
    return [
      prepare("INSERT OR IGNORE INTO users (id, google_sub, email, name, created_at, last_signin_at) VALUES (?, 'other-google-sub', 'other@example.test', 'Other Teacher', ?, ?)", OTHER_USER_ID, at, at),
      prepare("INSERT OR IGNORE INTO classes (id, owner_id, name, created_at) VALUES (?, ?, 'Period 1 Science', ?)", OTHER_CLASS_ID, OTHER_USER_ID, at),
      prepare("INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES (?, ?, 'Orla', 'Nyx', ?)", OTHER_STUDENT_ID, OTHER_CLASS_ID, at),
      prepare("INSERT OR IGNORE INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", hashes.dev, DEV_USER_ID, at, until),
      prepare("INSERT OR IGNORE INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", hashes.other, OTHER_USER_ID, at, until),
    ];
  };

  beforeAll(async () => {
    // remoteBindings: false keeps the AI binding from dialing Cloudflare; voice tests swap it
    // for a fake anyway, so Whisper is never called and the suite runs offline.
    const proxy = await getPlatformProxy<Env>({ persist: false, remoteBindings: false });
    // The proxy also loads .dev.vars. Tests must behave the same with or without a real
    // Anthropic key there, so it is stripped; a test that wants tagging attempted adds one.
    env = { ...proxy.env };
    delete (env as Partial<Env>).ANTHROPIC_API_KEY;
    // Likewise the Google client: the auth tests set their own and mock the calls to Google.
    delete (env as Partial<Env>).GOOGLE_CLIENT_ID;
    delete (env as Partial<Env>).GOOGLE_CLIENT_SECRET;
    dispose = proxy.dispose;
    await migrate(drizzle(env.DB), { migrationsFolder: "drizzle" });
    hashes = { dev: await hashToken(TOKENS.dev), other: await hashToken(TOKENS.other) };
  });
  // Deleting classes cascades through students, notes, note_students and note_mentions, and
  // deleting users through sessions (classes and notes go first: they point at users). The
  // seed is INSERT OR IGNORE so it reruns cleanly. One place to keep in step with the schema.
  beforeEach(() =>
    env.DB.batch([prepare("DELETE FROM classes"), prepare("DELETE FROM notes"), prepare("DELETE FROM users"), ...seedStatements.map((s) => prepare(s)), ...accounts()]),
  );
  afterAll(() => dispose());

  // As the dev teacher unless told otherwise; "anon" sends no cookie.
  const request = (url: string, init?: RequestInit, who: Who = "dev") => app.request(url, signedIn(init, who), env);
  const json = async <T>(url: string, init?: RequestInit, who: Who = "dev") => (await request(url, init, who)).json() as Promise<T>;
  return {
    get env() {
      return env;
    },
    request,
    json,
    // A demo visitor: starts one, keeps its cookie, and sends requests as it.
    startDemo: async () => {
      const res = await app.request("/api/auth/demo", { method: "POST" }, env);
      if (res.status !== 201) throw new Error(`demo start → ${res.status} ${await res.text()}`);
      const token = res.headers
        .getSetCookie()
        .find((line) => line.startsWith("session="))!
        .split(";")[0]!
        .slice("session=".length);
      const me = (await res.json()) as SessionUser;
      const who: Who = { token };
      return { me, userId: me.id, token, request: (url: string, init?: RequestInit) => request(url, init, who), json: <T>(url: string, init?: RequestInit) => json<T>(url, init, who) };
    },
    // Spend some of a demo visitor's allowance directly, for tests at the limit.
    setUsed: (userId: string, used: { notes?: number; reports?: number }) =>
      prepare("UPDATE users SET demo_notes_used = coalesce(?, demo_notes_used), demo_reports_used = coalesce(?, demo_reports_used) WHERE id = ?", used.notes ?? null, used.reports ?? null, userId).run(),
    // Raw inserts for tests that need rows without going through tagging.
    insertNote: (id: string, classId: string | null, notedAt: string, ownerId = DEV_USER_ID) =>
      prepare("INSERT INTO notes (id, owner_id, class_id, kind, body, noted_at, created_at) VALUES (?, ?, ?, 'text', ?, ?, ?)", id, ownerId, classId, `note ${id.slice(-2)}`, notedAt, notedAt),
    tagNote: (noteId: string, studentId: string) => prepare("INSERT INTO note_students (note_id, student_id) VALUES (?, ?)", noteId, studentId),
    // A course material whose summary states grading weights (or none, for a unit plan).
    insertMaterial: (id: string, classId: string, grading: { category: string; weight: number }[], createdAt = "2026-10-01T00:00:00.000Z") =>
      prepare(
        "INSERT INTO class_materials (id, class_id, name, text, summary, created_at) VALUES (?, ?, 'syllabus.md', 'text', ?, ?)",
        id,
        classId,
        JSON.stringify({ description: "", goals: [], grading, units: [], policies: [] }),
        createdAt,
      ),
    // An open mention ("Alex") that could be any of the given students.
    mentionNote: (id: string, noteId: string, candidateIds: string[]) =>
      prepare(
        "INSERT INTO note_mentions (id, note_id, mention_text, candidate_ids, created_at) VALUES (?, ?, 'Alex', ?, ?)",
        id,
        noteId,
        JSON.stringify(candidateIds),
        "2026-10-01T00:00:00.000Z",
      ),
    // One score, undated, so it counts in any period.
    insertGrade: (id: string, studentId: string, assignment: string, score: number | null, position: number) =>
      prepare("INSERT INTO grade_entries (id, student_id, assignment, score, max_score, position) VALUES (?, ?, ?, ?, 10, ?)", id, studentId, assignment, score, position),
    // A saved summary for a period. The hash is wrong on purpose unless given: a test that
    // wants it current computes the real one.
    insertSynthesis: (id: string, studentId: string, range: { from: string; to: string }, json: object, inputHash = "not-the-real-hash", createdAt = "2026-10-20T00:00:00.000Z") =>
      prepare(
        "INSERT INTO syntheses (id, student_id, period_start, period_end, version, input_hash, model, json, created_at) VALUES (?, ?, ?, ?, 1, ?, 'claude-opus-5-5', ?, ?)",
        id,
        studentId,
        range.from,
        range.to,
        inputHash,
        JSON.stringify(json),
        createdAt,
      ),
  };
}

// The AI binding, faked: Whisper returns `text` (or throws); toMarkdown returns `markdown`
// (or an error result, the way the real one reports an unreadable file).
export function fakeAi(text: string | Error, markdown: string | Error = "") {
  return {
    run: vi.fn(async () => {
      if (text instanceof Error) throw text;
      return { text };
    }),
    toMarkdown: vi.fn(async (doc: { name: string }) =>
      markdown instanceof Error
        ? { id: "1", name: doc.name, mimeType: "application/pdf", format: "error", error: markdown.message }
        : { id: "1", name: doc.name, mimeType: "application/pdf", format: "markdown", tokens: 1, data: markdown },
    ),
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
