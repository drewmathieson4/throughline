// AI spend: what each account's model calls cost, and the two caps that switch the models
// off. Every call the Worker makes goes through a client from modelAccess(), whose fetch
// reads the usage out of each answer and adds its price to the account's counter, so no
// caller has to remember to count. Over the cap, modelAccess() hands back no client and the
// routes carry on as they do without an API key: notes save untagged, imports fall back,
// a summary is refused with the reason. Resetting is a terminal job (scripts/spend.ts).
// See DECISIONS.md.
import Anthropic from "@anthropic-ai/sdk";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq, sql } from "drizzle-orm";
import * as schema from "./db/schema";
import type { User } from "./db/schema";
import type { Db, UserEnv } from "./db/client";
import type { AiAllowance } from "./api-types";
import { HAIKU_MODEL, OPUS_MODEL } from "./model";

const MICRO = 1_000_000;
export const ACCOUNT_CAP_USD = 10;
export const ACCOUNT_CAP_MICRO = ACCOUNT_CAP_USD * MICRO;
// Across every account: it is all one card.
export const TOTAL_CAP_USD = 100;
export const TOTAL_CAP_MICRO = TOTAL_CAP_USD * MICRO;

// Dollars per million tokens, from the Claude pricing page (2026-10). A token at $/MTok is
// that many micro-dollars, so a cost is tokens × price with no conversion.
const PRICES: Record<string, { input: number; output: number }> = {
  [OPUS_MODEL]: { input: 4, output: 20 },
  [HAIKU_MODEL]: { input: 0.1, output: 0.5 },
};
const CACHE_READ = 0.1; // of the input price
const CACHE_WRITE = 1.25;

// What a Messages answer reports; the cache fields are null when no cache was used.
export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

// The price of one answer in micro-dollars, rounded up. A model not in the table (a
// server-side fallback answered) is priced as Opus, the dearest known: a surprise costs
// more on the meter, never less.
export function costMicro(model: string, usage: Usage): number {
  const price = PRICES[model] ?? PRICES[OPUS_MODEL]!;
  const input = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) * CACHE_READ + (usage.cache_creation_input_tokens ?? 0) * CACHE_WRITE;
  return Math.ceil(input * price.input + usage.output_tokens * price.output);
}

export type OnUsage = (model: string, usage: Usage) => Promise<void>;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const isUsage = (u: unknown): u is Usage =>
  typeof u === "object" && u !== null && typeof (u as Usage).input_tokens === "number" && typeof (u as Usage).output_tokens === "number";

// fetch as the SDK calls it, with a meter on every answer from the Messages endpoint. The
// answer is read from a clone, so the SDK gets its body untouched, and the meter waits for
// the charge before handing it over, so the counter is right by the time the route answers.
// A failure inside the meter is logged, never thrown: metering must not fail a model call.
// Every call here is a non-streaming parse(), so the body is one JSON document; a streamed
// answer would go unmetered, and is logged.
export function meteredFetch(onUsage: OnUsage, base: FetchLike = fetch): FetchLike {
  return async (input, init) => {
    const res = await base(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!res.ok || !new URL(url).pathname.endsWith("/v1/messages")) return res;
    try {
      if (!(res.headers.get("content-type") ?? "").includes("application/json")) throw new Error(`unmetered answer of type ${res.headers.get("content-type")}`);
      const body = (await res.clone().json()) as { model?: unknown; usage?: unknown };
      if (typeof body.model !== "string" || !isUsage(body.usage)) throw new Error("answer carried no usage");
      await onUsage(body.model, body.usage);
    } catch (err) {
      console.error("spend meter failed", err);
    }
    return res;
  };
}

// Add one answer's price to the account. One statement, so parallel calls add up right.
export async function charge(db: Db, userId: string, model: string, usage: Usage): Promise<void> {
  await db
    .update(schema.users)
    .set({ aiSpentMicro: sql`${schema.users.aiSpentMicro} + ${costMicro(model, usage)}` })
    .where(eq(schema.users.id, userId));
}

// Exempt from the account cap, not from the total. A demo visitor has no email.
export function isOwner(user: Pick<User, "email">, env: Pick<Env, "OWNER_EMAILS">): boolean {
  if (!user.email) return false;
  const owners = (env.OWNER_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return owners.includes(user.email.toLowerCase());
}

export type SpendState = { spentMicro: number; capMicro: number; off: AiAllowance["off"] };

// Where the account stands. The total is a sum over every account rather than a counter of
// its own: one source of truth, and a reset is one UPDATE.
export async function spendState(db: Db, user: User, env: Pick<Env, "OWNER_EMAILS">): Promise<SpendState> {
  const total = await db
    .select({ n: sql<number>`coalesce(sum(${schema.users.aiSpentMicro}), 0)` })
    .from(schema.users)
    .get();
  const off = (total?.n ?? 0) >= TOTAL_CAP_MICRO ? "total" : !isOwner(user, env) && user.aiSpentMicro >= ACCOUNT_CAP_MICRO ? "account" : null;
  return { spentMicro: user.aiSpentMicro, capMicro: ACCOUNT_CAP_MICRO, off };
}

export const aiOf = (state: SpendState): AiAllowance => ({ spentUsd: state.spentMicro / MICRO, capUsd: ACCOUNT_CAP_USD, off: state.off });

// What a route says when it cannot call a model. "account" and "total" are 403s: the
// offline queue drops a 403 with the server's reason rather than retrying it forever.
const PAUSED: Record<"account" | "total", string> = {
  account: `This account has used its $${ACCOUNT_CAP_USD} of AI; ask Drew to reset it`,
  total: "Throughline's AI budget is used up for now; ask Drew",
};

export type ModelAccess = { client: Anthropic; reason: null; denied: null } | { client: null; reason: "no_key" | "account" | "total"; denied: HTTPException };

// The client a route calls a model with, metered against the signed-in account, or why
// there is none. The check is before the call and the charge after it, so an account can go
// over by one call, cents. A route that can do without the model logs and carries on; one
// that cannot throws `denied`.
export async function modelAccess(c: Context<UserEnv>): Promise<ModelAccess> {
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { client: null, reason: "no_key", denied: new HTTPException(503, { message: "summaries need ANTHROPIC_API_KEY" }) };
  const db = c.var.db;
  const userId = c.var.user.id;
  const { off } = await spendState(db, c.var.user, c.env);
  if (off) return { client: null, reason: off, denied: new HTTPException(403, { message: PAUSED[off] }) };
  return { client: new Anthropic({ apiKey, fetch: meteredFetch((model, usage) => charge(db, userId, model, usage)) }), reason: null, denied: null };
}
