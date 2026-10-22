import { afterAll, beforeAll, expect, test } from "vitest";
import app from "../index";
import { CLASS_ID, STUDENT, UNKNOWN_ID, testEnv } from "../test/db";
import type { RosterStudent } from "../api";

let env: Env;
let dispose = async () => {};

beforeAll(async () => {
  ({ env, dispose } = await testEnv());
});

afterAll(() => dispose());

test("GET /api/classes lists the seeded class", async () => {
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([expect.objectContaining({ id: CLASS_ID, name: "Period 3 Humanities" })]);
});

test("GET /api/classes/:classId/students returns the roster by last name with aliases", async () => {
  const res = await app.request(`/api/classes/${CLASS_ID}/students`, {}, env);
  expect(res.status).toBe(200);
  const roster = (await res.json()) as RosterStudent[];
  expect(roster).toHaveLength(10);
  expect(roster.map((s) => s.lastName)).toEqual([...roster.map((s) => s.lastName)].sort());
  expect(roster.find((s) => s.id === STUDENT.juniper)).toEqual({ id: STUDENT.juniper, firstName: "Juniper", lastName: "Vale", aliases: ["Juni"] });
  expect(roster.find((s) => s.id === STUDENT.avery)?.aliases).toEqual([]);
});

test("GET /api/classes/:classId/students is 404 for an unknown class and 400 for a bad id", async () => {
  expect((await app.request(`/api/classes/${UNKNOWN_ID}/students`, {}, env)).status).toBe(404);
  expect((await app.request(`/api/classes/nope/students`, {}, env)).status).toBe(400);
});
