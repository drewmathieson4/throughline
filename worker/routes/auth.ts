// Sign in with Google, sign out, and who am I. GET /google and GET /callback are browser
// navigations, not fetches: the teacher leaves for Google and comes back with a code. The
// state cookie ties the two together so a callback the app did not start is refused.
// Everything else under /api needs the session cookie these routes set (worker/auth.ts).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import * as schema from "../db/schema";
import type { AppEnv } from "../db/client";
import type { SessionUser } from "../api-types";
import { SESSION_COOKIE, SESSION_DAYS, STATE_COOKIE, cookieOptions, createSession, deleteSession, newToken, requireUser } from "../auth";
import { authorizeUrl, googleProfile } from "../google";
import { validate } from "../validate";

const STATE_MAX_AGE = 10 * 60; // seconds: long enough to pick an account, not to be replayed later
const STATE_PATH = "/api/auth"; // the state cookie only travels to these routes

const callbackQuery = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() });

// Google must send the teacher back to the origin they started from: localhost in dev, the
// deployed host in production. Each is registered as a redirect URI on the OAuth client.
const callbackUri = (url: string) => `${new URL(url).origin}/api/auth/callback`;

const auth = new Hono<AppEnv>();

// GET /api/auth/google → off to Google's account picker.
auth.get("/google", (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) throw new HTTPException(503, { message: "sign-in is not configured" });
  const state = newToken();
  setCookie(c, STATE_COOKIE, state, { ...cookieOptions(c), path: STATE_PATH, maxAge: STATE_MAX_AGE });
  return c.redirect(authorizeUrl({ clientId: c.env.GOOGLE_CLIENT_ID, redirectUri: callbackUri(c.req.url), state }));
});

// GET /api/auth/callback?code=…&state=… → back from Google. Makes the user on first sign-in,
// refreshes their name and picture after, starts a session, and sends them to the app.
auth.get("/callback", validate("query", callbackQuery), async (c) => {
  const { code, state, error } = c.req.valid("query");
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
  setCookie(c, SESSION_COOKIE, token, { ...cookieOptions(c), maxAge: SESSION_DAYS * 24 * 60 * 60 });
  return c.redirect("/");
});

// GET /api/auth/me → the signed-in teacher, or 401.
auth.get("/me", requireUser, (c) => {
  const { id, email, name, pictureUrl } = c.var.user!;
  return c.json({ id, email, name, pictureUrl } satisfies SessionUser);
});

// POST /api/auth/signout → ends this browser's session on the server, not just the cookie.
auth.post("/signout", requireUser, async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await deleteSession(c.var.db, token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

export default auth;
