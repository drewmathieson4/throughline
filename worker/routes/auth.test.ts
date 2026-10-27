import { expect, test, vi } from "vitest";
import app from "../index";
import type { SessionUser } from "../api-types";
import { hashToken } from "../auth";
import { googleProfile, type GoogleProfile } from "../google";
import { DEV_USER_ID, setupTestDb, signedIn } from "../test-db";

// The calls to Google are stubbed: the flow is exercised up to and after them.
vi.mock(import("../google"), async (importOriginal) => ({ ...(await importOriginal()), googleProfile: vi.fn() }));
const profileMock = vi.mocked(googleProfile);

const db = setupTestDb();
const configured = (): Env => ({ ...db.env, GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "client-secret" });
const PROFILE: GoogleProfile = { sub: "google-123", email: "tess@example.test", email_verified: true, name: "Tess Teacher", picture: "https://example.test/tess.png" };

type Cookie = { name: string; value: string; attrs: Record<string, string> };
// Every Set-Cookie on a response, split into name, value and lower-cased attributes.
function cookies(res: Response): Cookie[] {
  return res.headers.getSetCookie().map((line) => {
    const [pair, ...rest] = line.split(";").map((s) => s.trim());
    const [name, value] = pair!.split("=", 2) as [string, string];
    const attrs: Record<string, string> = {};
    for (const a of rest) {
      const [k, v = ""] = a.split("=", 2) as [string, string];
      attrs[k.toLowerCase()] = v;
    }
    return { name, value, attrs };
  });
}
const cookie = (res: Response, name: string) => cookies(res).find((c) => c.name === name);

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

  const me = await app.request("/api/auth/me", { headers: { cookie: `session=${session.value}` } }, db.env);
  expect(me.status).toBe(200);
  expect(await me.json()).toEqual({ id: user!.id, email: PROFILE.email, name: "Tess Teacher", pictureUrl: "https://example.test/tess.png" } satisfies SessionUser);
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
  expect((await app.request("/api/auth/me", { headers: { cookie: "session=not-a-session" } }, db.env)).status).toBe(401);
  await db.env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await hashToken("stale"), DEV_USER_ID, "2026-01-01T00:00:00.000Z", "2026-01-31T00:00:00.000Z")
    .run();
  expect((await app.request("/api/auth/me", { headers: { cookie: "session=stale" } }, db.env)).status).toBe(401);
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

test("health and sign-in need no session; every other /api route does", async () => {
  expect((await db.request("/api/health", undefined, "anon")).status).toBe(200);
  const res = await db.request("/api/classes", undefined, "anon");
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "sign in" });
  expect((await db.request("/api/notes", signedIn(undefined, "anon"), "anon")).status).toBe(401);
  expect((await db.request("/api/classes")).status).toBe(200);
});
