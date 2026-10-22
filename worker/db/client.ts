// One Drizzle client per request, attached as c.var.db so route files do not each
// rebuild it. Hono's generic carries both the Cloudflare bindings and this variable.
import { createMiddleware } from "hono/factory";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Db = DrizzleD1Database<typeof schema>;
export type AppEnv = { Bindings: Env; Variables: { db: Db } };

export const withDb = createMiddleware<AppEnv>(async (c, next) => {
  c.set("db", drizzle(c.env.DB, { schema }));
  await next();
});
