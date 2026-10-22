// A real D1 (Miniflare, in memory) built from the committed migrations plus the dev seed, so
// route tests exercise the actual schema and SQL rather than a mock. Shared by every route test.
import { vi } from "vitest";
import { getPlatformProxy, unstable_splitSqlQuery as splitSql } from "wrangler";
import { drizzle } from "drizzle-orm/d1";
import { migrate } from "drizzle-orm/d1/migrator";
import seed from "../../scripts/seed-dev.sql?raw";

export const CLASS_ID = "11111111-1111-4111-8111-111111111111";
export const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";
// Seeded students, by first name (see scripts/seed-dev.sql).
export const STUDENT = {
  avery: "22222222-2222-4222-8222-222222222201",
  rowan: "22222222-2222-4222-8222-222222222202",
  juniper: "22222222-2222-4222-8222-222222222204",
  alexMarsh: "22222222-2222-4222-8222-222222222209",
  alexRuiz: "22222222-2222-4222-8222-222222222210",
} as const;

// Run a request whose failure path logs with console.error, without the noise in test output.
export async function quietErrors<T>(fn: () => T | Promise<T>): Promise<T> {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}

export async function testEnv(): Promise<{ env: Env; dispose: () => Promise<void> }> {
  // remoteBindings: false keeps the AI binding from dialing Cloudflare; voice tests swap it for
  // a fake anyway, so Whisper is never called and the suite runs offline.
  const proxy = await getPlatformProxy<Env>({ persist: false, remoteBindings: false });
  await migrate(drizzle(proxy.env.DB), { migrationsFolder: "drizzle" });
  // Same splitter `wrangler d1 execute --file` uses, so the seed file has one loader contract.
  await proxy.env.DB.batch(splitSql(seed).map((s) => proxy.env.DB.prepare(s)));
  // The proxy also loads .dev.vars. Tests must behave the same with or without a real key
  // there, so the key is stripped; a test that wants tagging attempted adds its own.
  const env = { ...proxy.env };
  delete (env as Partial<Env>).ANTHROPIC_API_KEY;
  return { env, dispose: proxy.dispose };
}
