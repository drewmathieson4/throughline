// Sign in with Google, the demo, sign out, and who am I. GET /google and GET /callback are
// browser navigations, not fetches: the teacher leaves for Google and comes back with a code.
// The state cookie ties the two together so a callback the app did not start is refused.
// POST /demo is the other way in: an account with no Google behind it (worker/demo.ts).
// Everything else under /api needs the session cookie these routes set (worker/auth.ts).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import * as schema from "../db/schema";
import type { User } from "../db/schema";
import type { AppEnv } from "../db/client";
import type { SessionUser } from "../api-types";
import { SESSION_COOKIE, STATE_COOKIE, cookieOptions, createSession, deleteSession, newToken, requireUser, setSessionCookie } from "../auth";
import { DEMO_MAX_LIVE, DEMO_SESSION_DAYS, allowanceOf, cloneDemo, deleteDemoUser, liveDemoCount, purgeExpiredDemos } from "../demo";
import { authorizeUrl, googleProfile } from "../google";
import { validate } from "../validate";

const STATE_MAX_AGE = 10 * 60; // seconds: long enough to pick an account, not to be replayed later
const STATE_PATH = "/api/auth"; // the state cookie only travels to these routes

const callbackQuery = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() });

// Google must send the teacher back to the origin they started from: localhost in dev, the
// deployed host in production. Each is registered as a redirect URI on the OAuth client.
const callbackUri = (url: string) => `${new URL(url).origin}/api/auth/callback`;

// What the browser may know about who is signed in.
const sessionUser = (user: User): SessionUser => ({ id: user.id, email: user.email, name: user.name, pictureUrl: user.pictureUrl, demo: allowanceOf(user) });

const auth = new Hono<AppEnv>();

// GET /api/auth/google → off to Google's account picker.
auth.get("/google", (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) throw new HTTPException(503, { message: "sign-in is not configured" });
  const state = newToken();
  setCookie(c, STATE_COOKIE, state, { ...cookieOptions(c), path: STATE_PATH, maxAge: STATE_MAX_AGE });
  return c.redirect(authorizeUrl({ clientId: c.env.GOOGLE_CLIENT_ID, redirectUri: callbackUri(c.req.url), state }));
});

// GET /api/auth/callback?code=…&state=… → back from Google. Makes the user on first sign-in,
// refreshes their name and picture after, starts a session, and sends them to the app. A
// visitor arriving from the demo leaves their copy behind: it is deleted once they are in.
auth.get("/callback", validate("query", callbackQuery), async (c) => {
  const { code, state, error } = c.req.valid("query");
  const was = c.var.user;
  // The teacher closed Google's picker or said no: back to the sign-in screen, no error.
  if (error) return c.redirect("/");
  const expected = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: STATE_PATH });
  if (!code || !state || !expected || state !== expected) throw new HTTPException(400, { message: "sign-in did not start here; try again" });

  const profile = await googleProfile({ code, redirectUri: callbackUri(c.req.url), clientId: c.env.GOOGLE_CLIENT_ID, clientSecret: c.env.GOOGLE_CLIENT_SECRET });
  if (!profile.email_verified) throw new HTTPException(403, { message: "Google has not verified that email address" });

  const now = new Date().toISOString();
  const refreshed = { email: profile.email, name: profile.name ?? null, pictureUrl: profile.picture ?? null, lastSigninAt: now };
  const user = await c.var.db
    .insert(schema.users)
    .values({ id: crypto.randomUUID(), googleSub: profile.sub, createdAt: now, ...refreshed })
    .onConflictDoUpdate({ target: schema.users.googleSub, set: refreshed })
    .returning()
    .get();

  const token = await createSession(c.var.db, user.id);
  setSessionCookie(c, token);
  if (was?.demo) await deleteDemoUser(c.var.db, was.id);
  return c.redirect("/");
});

// POST /api/auth/demo → a new demo account with its own copy of the synthetic classes, and
// a session for it: 201 with the same shape as /me. A browser that is already signed in (a
// second tap) gets who it is, 200. 503 when the demo is full or not set up on this database.
// Expired visitors are cleared out on the way, since nothing else runs on a schedule.
auth.post("/demo", async (c) => {
  if (c.var.user) return c.json(sessionUser(c.var.user));
  await purgeExpiredDemos(c.var.db);
  if ((await liveDemoCount(c.var.db)) >= DEMO_MAX_LIVE) throw new HTTPException(503, { message: "the demo is busy; try again later" });
  const user = await cloneDemo(c.var.db);
  const token = await createSession(c.var.db, user.id, DEMO_SESSION_DAYS);
  setSessionCookie(c, token, DEMO_SESSION_DAYS);
  return c.json(sessionUser(user), 201);
});

// GET /api/auth/me → the signed-in teacher or demo visitor, or 401.
auth.get("/me", requireUser, (c) => c.json(sessionUser(c.var.user!)));

// POST /api/auth/signout → ends this browser's session on the server, not just the cookie.
auth.post("/signout", requireUser, async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await deleteSession(c.var.db, token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

export default auth;
