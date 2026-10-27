import { expect, test } from "vitest";
import type { ClassRow } from "../db/schema";
import { CLASS_B_ID, CLASS_C_ID, OTHER_CLASS_ID, OTHER_USER_ID, SEED_CLASS_ID, jsonInit, setupTestDb } from "../test-db";

const db = setupTestDb();

const post = (body: unknown) => db.request("/api/classes", jsonInit("POST", body));

test("POST /api/classes creates a class and GET lists it after the seed", async () => {
  const res = await post({ name: "  Period 5  ", termStart: "2026-09-01" });
  expect(res.status).toBe(201);
  const created = (await res.json()) as ClassRow;
  expect(created).toMatchObject({ name: "Period 5", termStart: "2026-09-01", termEnd: null });

  const all = await db.json<ClassRow[]>("/api/classes");
  expect(all.map((c) => c.id)).toEqual([SEED_CLASS_ID, CLASS_B_ID, CLASS_C_ID, created.id]);

  // Tab, bell, Excel's BOM and a zero-width space: all cleaned out of a pasted name.
  const messy = await db.json<ClassRow>("/api/classes", jsonInit("POST", { name: "﻿Period\t3\u0007​" }));
  expect(messy.name).toBe("Period 3");
});

test("POST /api/classes rejects bad input with { error }", async () => {
  for (const body of [{ name: "" }, { name: "x", termStart: "Sept 1" }, { name: "x", termStart: "2026-09-02", termEnd: "2026-09-01" }, "{nope"]) {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
  }
});

test("each teacher sees only their own classes, and a new class belongs to whoever made it", async () => {
  const mine = await db.json<ClassRow[]>("/api/classes");
  expect(mine.map((c) => c.id)).not.toContain(OTHER_CLASS_ID);
  const theirs = await db.json<ClassRow[]>("/api/classes", undefined, "other");
  expect(theirs.map((c) => c.id)).toEqual([OTHER_CLASS_ID]);

  const made = await db.json<ClassRow>("/api/classes", jsonInit("POST", { name: "Period 2 Science" }), "other");
  expect(made.ownerId).toBe(OTHER_USER_ID);
  expect((await db.json<ClassRow[]>("/api/classes")).map((c) => c.id)).not.toContain(made.id);
  expect((await db.json<ClassRow[]>("/api/classes", undefined, "other")).map((c) => c.id)).toContain(made.id);
});
