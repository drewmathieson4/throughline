// One Drizzle client per request, attached as c.var.db so route files do not each
// rebuild it. Hono's generic carries both the Cloudflare bindings and this variable, plus
// the signed-in user that worker/auth.ts attaches.
import { createMiddleware } from "hono/factory";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";
import type { User } from "./schema";

export type Db = DrizzleD1Database<typeof schema>;
// Every /api request: the user is null until withUser finds a session.
export type AppEnv = { Bindings: Env; Variables: { db: Db; user: User | null } };
// The resource routes, which sit behind requireUser: the user is always there.
export type UserEnv = { Bindings: Env; Variables: { db: Db; user: User } };

export const withDb = createMiddleware<AppEnv>(async (c, next) => {
  c.set("db", drizzle(c.env.DB, { schema }));
  await next();
});
