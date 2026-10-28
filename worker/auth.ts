// Sessions: who is making this request. The browser holds a random token in an HttpOnly
// cookie; the sessions table holds its SHA-256, so neither a copy of the database nor a
// script on the page can use it. withUser reads it on every /api request; requireUser is the
// guard the resource routes sit behind. See DECISIONS.md.
import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq, gt } from "drizzle-orm";
import * as schema from "./db/schema";
import type { AppEnv, Db } from "./db/client";

export const SESSION_COOKIE = "session";
export const STATE_COOKIE = "oauth_state";
export const SESSION_DAYS = 30; // a teacher's; a demo visitor's is shorter (worker/demo.ts)
const DAY_S = 24 * 60 * 60;

// 32 random bytes as URL-safe text: the session token, and the OAuth state.
export const newToken = () => crypto.getRandomValues(new Uint8Array(32)).toBase64({ alphabet: "base64url", omitPadding: true });

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return new Uint8Array(digest).toHex();
}

// Cookie rules shared by the session and state cookies. SameSite=Lax still sends the cookie
// on the top-level redirect back from Google, which Strict would not. Secure is off only on
// plain-http localhost; Safari refuses a Secure cookie there.
export const cookieOptions = (c: Context) => ({
  httpOnly: true,
  sameSite: "Lax" as const,
  path: "/",
  secure: new URL(c.req.url).protocol === "https:",
});

// A new session for the user, lasting `days`; returns the raw token the cookie carries.
export async function createSession(db: Db, userId: string, days = SESSION_DAYS): Promise<string> {
  const token = newToken();
  const now = Date.now();
  await db.insert(schema.sessions).values({
    tokenHash: await hashToken(token),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + days * DAY_S * 1000).toISOString(),
  });
  return token;
}

// The cookie that carries the token, living as long as the session does.
export const setSessionCookie = (c: Context, token: string, days = SESSION_DAYS) => setCookie(c, SESSION_COOKIE, token, { ...cookieOptions(c), maxAge: days * DAY_S });

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, await hashToken(token)));
}

// The user behind a token, or null when there is no live session for it.
async function userOf(db: Db, token: string | undefined): Promise<schema.User | null> {
  if (!token) return null;
  const row = await db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, await hashToken(token)), gt(schema.sessions.expiresAt, new Date().toISOString())))
    .get();
  return row?.user ?? null;
}

export const withUser = createMiddleware<AppEnv>(async (c, next) => {
  c.set("user", await userOf(c.var.db, getCookie(c, SESSION_COOKIE)));
  await next();
});

// 401 when nobody is signed in. The browser treats it as "show the sign-in screen", and the
// offline queue keeps a note that gets it, so nothing captured is lost.
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) throw new HTTPException(401, { message: "sign in" });
  await next();
});
