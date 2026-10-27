import { expect, test } from "vitest";
import type { MaterialRow } from "../api-types";
import { CLASS_B_ID, OTHER_CLASS_ID, SEED_CLASS_ID as CLASS_ID, UNKNOWN_ID, setupTestDb } from "../test-db";

// Materials are written by POST /api/documents (documents.test.ts); these tests insert rows
// directly and cover listing and deleting.
const db = setupTestDb();

const MATERIAL_ID = (n: number) => `55555555-5555-4555-8555-5555555555${String(n).padStart(2, "0")}`;
const insert = (n: number, classId: string, createdAt: string) => db.insertMaterial(MATERIAL_ID(n), classId, [{ category: "Tests", weight: 100 }], createdAt).run();
const list = (classId: string) => db.request(`/api/materials?classId=${classId}`);
const listJson = (classId: string) => db.json<MaterialRow[]>(`/api/materials?classId=${classId}`);

test("GET /api/materials lists a class's materials newest first, without the text, and 404s an unknown class", async () => {
  await insert(1, CLASS_ID, "2026-10-23T10:00:00.000Z");
  await insert(2, CLASS_ID, "2026-10-23T10:00:01.000Z");
  await insert(3, CLASS_B_ID, "2026-10-23T10:00:02.000Z");
  const rows = await listJson(CLASS_ID);
  expect(rows.map((m) => m.id)).toEqual([MATERIAL_ID(2), MATERIAL_ID(1)]);
  expect(rows[0]).toMatchObject({ classId: CLASS_ID, name: "syllabus.md", summary: { grading: [{ category: "Tests", weight: 100 }] } });
  expect(rows[0]).not.toHaveProperty("text");
  expect((await list(UNKNOWN_ID)).status).toBe(404);
  expect((await list("nope")).status).toBe(400);
});

test("DELETE /api/materials/:id removes one material; deleting the class removes the rest", async () => {
  await insert(1, CLASS_ID, "2026-10-23T10:00:00.000Z");
  await insert(2, CLASS_ID, "2026-10-23T10:00:01.000Z");
  const res = await db.request(`/api/materials/${MATERIAL_ID(1)}`, { method: "DELETE" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: MATERIAL_ID(1) });
  expect((await db.request(`/api/materials/${MATERIAL_ID(1)}`, { method: "DELETE" })).status).toBe(404);
  expect((await listJson(CLASS_ID)).map((m) => m.id)).toEqual([MATERIAL_ID(2)]);

  await db.env.DB.prepare("DELETE FROM classes WHERE id = ?").bind(CLASS_ID).run();
  const left = await db.env.DB.prepare("SELECT count(*) AS n FROM class_materials").first<{ n: number }>();
  expect(left?.n).toBe(0);
});

test("another teacher's materials are not found, to list or to delete", async () => {
  const id = "55555555-5555-4555-8555-555555555599";
  await db.insertMaterial(id, OTHER_CLASS_ID, []).run();
  expect((await db.request(`/api/materials?classId=${OTHER_CLASS_ID}`)).status).toBe(404);
  expect((await db.request(`/api/materials/${id}`, { method: "DELETE" })).status).toBe(404);
  expect((await db.json<MaterialRow[]>(`/api/materials?classId=${OTHER_CLASS_ID}`, undefined, "other")).map((m) => m.id)).toEqual([id]);
  expect((await db.request(`/api/materials/${id}`, { method: "DELETE" }, "other")).status).toBe(200);
});
