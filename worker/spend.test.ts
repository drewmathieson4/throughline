import { expect, test, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "./db/schema";
import { ACCOUNT_CAP_MICRO, ACCOUNT_CAP_USD, TOTAL_CAP_MICRO, charge, costMicro, isOwner, meteredFetch, spendState } from "./spend";
import { DEV_USER_ID, OTHER_USER_ID, quietErrors, setupTestDb } from "./test-db";

const db = setupTestDb();
const client = () => drizzle(db.env.DB, { schema });
const userRow = (id: string) => client().select().from(schema.users).where(eq(schema.users.id, id)).get();

test("costMicro prices by model in micro-dollars, rounds up, and prices an unknown model as Opus", () => {
  expect(costMicro("claude-opus-5-5", { input_tokens: 1000, output_tokens: 500 })).toBe(14_000); // 1000 × $4 + 500 × $20 per MTok
  expect(costMicro("claude-haiku-5-5", { input_tokens: 10_000, output_tokens: 1000 })).toBe(1_500);
  expect(costMicro("claude-haiku-5-5", { input_tokens: 1, output_tokens: 1 })).toBe(1); // 0.6 rounds up
  expect(costMicro("claude-haiku-5-5", { input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 1000, cache_creation_input_tokens: 1000 })).toBe(235); // 100 + 10 + 125
  expect(costMicro("claude-fallback-model", { input_tokens: 1000, output_tokens: 500 })).toBe(14_000);
});

const answer = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });
const USAGE = { input_tokens: 10, output_tokens: 5 };
const MESSAGES = "https://api.anthropic.com/v1/messages";

test("meteredFetch charges each Messages answer once and hands the body on untouched", async () => {
  const onUsage = vi.fn(async () => {});
  const base = vi.fn(async () => answer({ model: "claude-haiku-5-5", usage: USAGE, content: [] }));
  const res = await meteredFetch(onUsage, base)(`${MESSAGES}?beta=true`, { method: "POST" });
  expect(await res.json()).toMatchObject({ model: "claude-haiku-5-5", content: [] });
  expect(onUsage).toHaveBeenCalledTimes(1);
  expect(onUsage).toHaveBeenCalledWith("claude-haiku-5-5", USAGE);
});

test("the SDK's client reaches the meter and still reads its answer", async () => {
  const onUsage = vi.fn(async () => {});
  const base = vi.fn(async (_input: string | URL | Request) =>
    answer({ id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", stop_sequence: null, usage: USAGE }),
  );
  const client = new Anthropic({ apiKey: "test-key", fetch: meteredFetch(onUsage, base) });
  const res = await client.messages.create({ model: "claude-haiku-5-5", max_tokens: 10, messages: [{ role: "user", content: "x" }] });
  expect(res.content).toEqual([{ type: "text", text: "hi" }]);
  expect(String(base.mock.calls[0]![0])).toBe(MESSAGES);
  expect(onUsage).toHaveBeenCalledWith("claude-haiku-5-5", USAGE);
});

test("meteredFetch leaves errors, other endpoints and streams alone, and a failed charge does not fail the call", async () => {
  const onUsage = vi.fn(async () => {});
  expect((await meteredFetch(onUsage, async () => answer({ error: {} }, { status: 429 }))(MESSAGES)).status).toBe(429);
  await meteredFetch(onUsage, async () => answer({ model: "m", usage: USAGE }))("https://api.anthropic.com/v1/models");
  await quietErrors(() => meteredFetch(onUsage, async () => new Response("data: {}", { headers: { "content-type": "text/event-stream" } }))(MESSAGES));
  expect(onUsage).not.toHaveBeenCalled();

  const failing = vi.fn(async () => {
    throw new Error("db down");
  });
  const res = await quietErrors(() => meteredFetch(failing, async () => answer({ model: "m", usage: USAGE }))(new URL(MESSAGES)));
  expect(res.ok).toBe(true);
  expect(failing).toHaveBeenCalledTimes(1);
});

test("charge adds up; spendState switches off at the account cap, exempts owners, and at the total switches off everyone", async () => {
  await charge(client(), DEV_USER_ID, "claude-opus-5-5", { input_tokens: 1000, output_tokens: 500 });
  await charge(client(), DEV_USER_ID, "claude-haiku-5-5", { input_tokens: 10_000, output_tokens: 1000 });
  let dev = (await userRow(DEV_USER_ID))!;
  expect(dev.aiSpentMicro).toBe(15_500);
  expect(await spendState(client(), dev, {})).toEqual({ spentUsd: 0.0155, capUsd: ACCOUNT_CAP_USD, off: null });

  await db.setSpent(DEV_USER_ID, ACCOUNT_CAP_MICRO);
  dev = (await userRow(DEV_USER_ID))!;
  const env = { OWNER_EMAILS: " Dev@Example.test ,someone@example.test" };
  expect((await spendState(client(), dev, {})).off).toBe("account");
  expect((await spendState(client(), dev, env)).off).toBeNull(); // trimmed, any case
  expect((await spendState(client(), { ...dev, email: "nobody@example.test" }, env)).off).toBe("account");

  await db.setSpent(OTHER_USER_ID, TOTAL_CAP_MICRO - ACCOUNT_CAP_MICRO);
  expect((await spendState(client(), dev, env)).off).toBe("total");
  expect(isOwner({ email: "" }, { OWNER_EMAILS: "" })).toBe(false);
});
