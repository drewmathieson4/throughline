import { expect, test } from "vitest";
import type { ClassRow } from "../db/schema";
import { CLASS_B_ID, SEED_CLASS_ID, jsonInit, setupTestDb } from "../test-db";

const db = setupTestDb();

const post = (body: unknown) => db.request("/api/classes", jsonInit("POST", body));

test("POST /api/classes creates a class and GET lists it after the seed", async () => {
  const res = await post({ name: "  Period 5  ", termStart: "2026-09-01" });
  expect(res.status).toBe(201);
  const created = (await res.json()) as ClassRow;
  expect(created).toMatchObject({ name: "Period 5", termStart: "2026-09-01", termEnd: null });

  const all = await db.json<ClassRow[]>("/api/classes");
  expect(all.map((c) => c.id)).toEqual([SEED_CLASS_ID, CLASS_B_ID, created.id]);

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
