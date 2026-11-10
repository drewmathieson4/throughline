import { expect, test, vi } from "vitest";
import app from "../index";
import type { SessionUser } from "../api-types";
import { hashToken } from "../auth";
import { liveDemoCount } from "../demo";
import { googleProfile, type GoogleProfile } from "../google";
import { ACCOUNT_CAP_MICRO } from "../spend";
import { DEV_EMAIL, DEV_USER_ID, NOTE_ID, OTHER_USER_ID, SEED_STUDENT_COUNT, cookie, setupTestDb, signedIn } from "../test-db";

// The calls to Google are stubbed: the flow is exercised up to and after them.
vi.mock(import("../google"), async (importOriginal) => ({ ...(await importOriginal()), googleProfile: vi.fn() }));
const profileMock = vi.mocked(googleProfile);
// The count of live demo visitors runs for real unless a test fills the demo up.
vi.mock(import("../demo"), async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, liveDemoCount: vi.fn(real.liveDemoCount) };
});
const liveCountMock = vi.mocked(liveDemoCount);

const db = setupTestDb();
const configured = (): Env => ({ ...db.env, GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "client-secret" });
// A new account has spent nothing of its $10.
const FRESH_AI = { spentUsd: 0, capUsd: 10, off: null } as const;
const PROFILE: GoogleProfile = { sub: "google-123", email: "tess@example.test", email_verified: true, name: "Tess Teacher", picture: "https://example.test/tess.png" };

// Start sign-in and return what the callback needs: the state and the cookie that carries it.
async function start() {
  const res = await app.request("/api/auth/google", undefined, configured());
  expect(res.status).toBe(302);
  const state = cookie(res, "oauth_state")!;
  return { location: new URL(res.headers.get("location")!), state: state.value, cookie: `oauth_state=${state.value}` };
}
const callback = (query: Record<string, string>, cookie?: string) =>
  app.request(`/api/auth/callback?${new URLSearchParams(query)}`, cookie ? { headers: { cookie } } : undefined, configured());
const userRows = async () => (await db.env.DB.prepare("SELECT id, google_sub, name FROM users WHERE google_sub = ?").bind(PROFILE.sub).all<{ id: string; name: string }>()).results;
const sessionCount = async (userId: string) => (await db.env.DB.prepare("SELECT count(*) AS n FROM sessions WHERE user_id = ?").bind(userId).first<{ n: number }>())!.n;

test("GET /api/auth/google sends the browser to Google with a state that an HttpOnly cookie remembers", async () => {
  const { location, state, cookie: c } = await start();
  expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  expect(Object.fromEntries(location.searchParams)).toEqual({
    client_id: "client-id",
    redirect_uri: "http://localhost/api/auth/callback",
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  expect(state.length).toBeGreaterThan(30);
  expect(c).toBe(`oauth_state=${state}`);
  const res = await app.request("/api/auth/google", undefined, configured());
  const stateCookie = cookie(res, "oauth_state")!;
  expect(stateCookie.attrs).toMatchObject({ httponly: "", path: "/api/auth", samesite: "Lax", "max-age": "600" });
  expect(stateCookie.attrs).not.toHaveProperty("secure");
});

test("GET /api/auth/google is a 503 until the Google client is configured", async () => {
  const res = await app.request("/api/auth/google", undefined, db.env);
  expect(res.status).toBe(503);
});

test("the callback makes the user, starts a session the cookie carries, and /me reports it", async () => {
  profileMock.mockResolvedValueOnce(PROFILE);
  const { state, cookie: c } = await start();
  const res = await callback({ code: "the-code", state }, c);
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/");
  expect(profileMock).toHaveBeenCalledWith({ code: "the-code", redirectUri: "http://localhost/api/auth/callback", clientId: "client-id", clientSecret: "client-secret" });

  const session = cookie(res, "session")!;
  expect(session.attrs).toMatchObject({ httponly: "", path: "/", samesite: "Lax", "max-age": String(30 * 24 * 60 * 60) });
  expect(session.attrs).not.toHaveProperty("secure"); // plain-http localhost
  expect(cookie(res, "oauth_state")!.attrs["max-age"]).toBe("0"); // used once

  const [user] = await userRows();
  expect(user!.name).toBe("Tess Teacher");
  const stored = await db.env.DB.prepare("SELECT user_id FROM sessions WHERE token_hash = ?").bind(await hashToken(session.value)).first<{ user_id: string }>();
  expect(stored?.user_id).toBe(user!.id);

  const me = await app.request("/api/auth/me", signedIn(undefined, { token: session.value }), db.env);
  expect(me.status).toBe(200);
  expect(await me.json()).toEqual({ id: user!.id, email: PROFILE.email, name: "Tess Teacher", pictureUrl: "https://example.test/tess.png", demo: null, ai: FRESH_AI } satisfies SessionUser);
});

test("POST /api/auth/demo makes a visitor with a week-long session, and says so on /me", async () => {
  const res = await app.request("/api/auth/demo", { method: "POST" }, db.env);
  expect(res.status).toBe(201);
  const session = cookie(res, "session")!;
  expect(session.attrs).toMatchObject({ httponly: "", path: "/", samesite: "Lax", "max-age": String(7 * 24 * 60 * 60) });
  const made = (await res.json()) as SessionUser;
  expect(made).toEqual({ id: made.id, email: "", name: "Demo", pictureUrl: null, demo: { notesLeft: 30, evidenceLeft: 4, reportsLeft: 4 }, ai: FRESH_AI } satisfies SessionUser);
  const stored = await db.env.DB.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?").bind(await hashToken(session.value)).first<{ user_id: string; expires_at: string }>();
  expect(stored?.user_id).toBe(made.id);
  expect(Date.parse(stored!.expires_at) - Date.now()).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
  const me = await app.request("/api/auth/me", signedIn(undefined, { token: session.value }), db.env);
  expect(await me.json()).toEqual(made);

  // Asked again by the same browser: the same visitor, nothing new made. A teacher gets themselves.
  const again = await app.request("/api/auth/demo", signedIn({ method: "POST" }, { token: session.value }), db.env);
  expect(again.status).toBe(200);
  expect(((await again.json()) as SessionUser).id).toBe(made.id);
  expect(cookie(again, "session")).toBeUndefined();
  const dev = await db.request("/api/auth/demo", { method: "POST" });
  expect(dev.status).toBe(200);
  expect(((await dev.json()) as SessionUser).id).toBe(DEV_USER_ID);
  expect((await db.env.DB.prepare("SELECT count(*) AS n FROM users WHERE demo = 1").first<{ n: number }>())!.n).toBe(1);
});

test("POST /api/auth/demo is a 503 while the demo is full", async () => {
  liveCountMock.mockResolvedValueOnce(100);
  const res = await app.request("/api/auth/demo", { method: "POST" }, db.env);
  expect(res.status).toBe(503);
  expect((await db.env.DB.prepare("SELECT count(*) AS n FROM users WHERE demo = 1").first<{ n: number }>())!.n).toBe(0);
});

test("signing in with Google from the demo makes the teacher and deletes the visitor's copy", async () => {
  const demo = await db.startDemo();
  const [cls] = await demo.json<{ id: string }[]>("/api/classes");
  profileMock.mockResolvedValueOnce(PROFILE);
  const { state, cookie: c } = await start();
  const res = await callback({ code: "the-code", state }, `${c}; session=${demo.token}`);
  expect(res.status).toBe(302);
  const [user] = await userRows();
  expect(user!.name).toBe("Tess Teacher");
  expect(await sessionCount(user!.id)).toBe(1);
  expect(await db.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(demo.userId).first()).toBeNull();
  expect(await db.env.DB.prepare("SELECT id FROM classes WHERE id = ?").bind(cls!.id).first()).toBeNull();
  expect((await db.env.DB.prepare("SELECT count(*) AS n FROM notes WHERE owner_id = ?").bind(demo.userId).first<{ n: number }>())!.n).toBe(0);
  expect((await demo.request("/api/auth/me")).status).toBe(401);
});

test("signing in again with the same Google account refreshes the user rather than adding one", async () => {
  profileMock.mockResolvedValueOnce(PROFILE).mockResolvedValueOnce({ ...PROFILE, name: "Tess T." });
  const first = await start();
  await callback({ code: "c1", state: first.state }, first.cookie);
  const second = await start();
  await callback({ code: "c2", state: second.state }, second.cookie);
  const rows = await userRows();
  expect(rows).toHaveLength(1);
  expect(rows[0]!.name).toBe("Tess T.");
  expect(await sessionCount(rows[0]!.id)).toBe(2);
});

test("a callback the app did not start is refused before Google is asked", async () => {
  const { state, cookie: c } = await start();
  expect((await callback({ code: "x", state: "forged" }, c)).status).toBe(400);
  expect((await callback({ code: "x", state })).status).toBe(400); // no cookie
  expect((await callback({ state }, c)).status).toBe(400); // no code
  expect(profileMock).not.toHaveBeenCalled();
  expect(await userRows()).toHaveLength(0);
});

test("the teacher backing out of Google's picker lands on the sign-in screen, not an error", async () => {
  const res = await callback({ error: "access_denied" });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/");
  expect(cookie(res, "session")).toBeUndefined();
});

test("an account whose email Google has not verified is refused", async () => {
  profileMock.mockResolvedValueOnce({ ...PROFILE, email_verified: false });
  const { state, cookie: c } = await start();
  const res = await callback({ code: "x", state }, c);
  expect(res.status).toBe(403);
  expect(await userRows()).toHaveLength(0);
});

test("GET /api/auth/me is a 401 with no cookie, an unknown token, or an expired session", async () => {
  expect((await db.request("/api/auth/me", undefined, "anon")).status).toBe(401);
  expect((await db.request("/api/auth/me", undefined, { token: "not-a-session" })).status).toBe(401);
  await db.env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await hashToken("stale"), DEV_USER_ID, "2026-01-01T00:00:00.000Z", "2026-01-31T00:00:00.000Z")
    .run();
  expect((await db.request("/api/auth/me", undefined, { token: "stale" })).status).toBe(401);
});

test("GET /api/auth/me says where the account stands against the AI spend cap", async () => {
  await db.setSpent(DEV_USER_ID, 1_234_567);
  expect((await db.json<SessionUser>("/api/auth/me")).ai).toEqual({ spentUsd: 1.234567, capUsd: 10, off: null });
  await db.setSpent(DEV_USER_ID, ACCOUNT_CAP_MICRO);
  expect((await db.json<SessionUser>("/api/auth/me")).ai.off).toBe("account");
  const asOwner = await app.request("/api/auth/me", signedIn(), { ...db.env, OWNER_EMAILS: DEV_EMAIL });
  expect(((await asOwner.json()) as SessionUser).ai.off).toBeNull();
});

test("POST /api/auth/signout ends the session on the server and clears the cookie", async () => {
  const before = await sessionCount(DEV_USER_ID);
  const res = await db.request("/api/auth/signout", { method: "POST" });
  expect(res.status).toBe(200);
  expect(cookie(res, "session")!.attrs["max-age"]).toBe("0");
  expect(await sessionCount(DEV_USER_ID)).toBe(before - 1);
  expect((await db.request("/api/auth/me")).status).toBe(401);
  expect((await db.request("/api/auth/signout", { method: "POST" })).status).toBe(401);
});

test("DELETE /api/auth/account removes the teacher with their classes, notes and sessions, clears the cookie, and leaves the other teacher alone", async () => {
  await db.insertNote(NOTE_ID(1), null, "2026-10-01T00:00:00.000Z").run();
  const owned = (userId: string) =>
    db.env.DB.prepare(
      "SELECT (SELECT count(*) FROM users WHERE id = ?1) AS users, (SELECT count(*) FROM classes WHERE owner_id = ?1) AS classes, (SELECT count(*) FROM students WHERE class_id IN (SELECT id FROM classes WHERE owner_id = ?1)) AS students, (SELECT count(*) FROM notes WHERE owner_id = ?1) AS notes, (SELECT count(*) FROM sessions WHERE user_id = ?1) AS sessions",
    )
      .bind(userId)
      .first<{ users: number; classes: number; students: number; notes: number; sessions: number }>();
  expect(await owned(DEV_USER_ID)).toEqual({ users: 1, classes: 3, students: SEED_STUDENT_COUNT, notes: 1, sessions: 1 });
  const theirs = await owned(OTHER_USER_ID);

  const res = await db.request("/api/auth/account", { method: "DELETE" });
  expect(res.status).toBe(204);
  expect(cookie(res, "session")!.attrs["max-age"]).toBe("0");
  expect(await owned(DEV_USER_ID)).toEqual({ users: 0, classes: 0, students: 0, notes: 0, sessions: 0 });
  expect(await owned(OTHER_USER_ID)).toEqual(theirs);
  expect((await db.request("/api/auth/me")).status).toBe(401);
  expect((await db.request("/api/auth/account", { method: "DELETE" }, "anon")).status).toBe(401);

  // A demo visitor can leave the same way.
  const demo = await db.startDemo();
  expect((await demo.request("/api/auth/account", { method: "DELETE" })).status).toBe(204);
  expect(await owned(demo.userId)).toEqual({ users: 0, classes: 0, students: 0, notes: 0, sessions: 0 });
});

test("health, sign-in and the demo need no session; every other /api route does", async () => {
  expect((await db.request("/api/health", undefined, "anon")).status).toBe(200);
  expect((await db.request("/api/auth/demo", { method: "POST" }, "anon")).status).toBe(201);
  const res = await db.request("/api/classes", undefined, "anon");
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "sign in" });
  expect((await db.request("/api/notes", signedIn(undefined, "anon"), "anon")).status).toBe(401);
  expect((await db.request("/api/classes")).status).toBe(200);
});
