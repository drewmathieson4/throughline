import { expect, test } from "vitest";
import type { ClassRow } from "../db/schema";
import type { NoteWithTags } from "../api-types";
import { CLASS_B_ID, CLASS_C_ID, MENTION_ID, NOTE_ID, OTHER_CLASS_ID, OTHER_USER_ID, PERIOD_3_COUNT, SEED_CLASS_ID, STUDENT, jsonInit, setupTestDb } from "../test-db";

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

test("a class's report settings start empty, are written whole, and are checked", async () => {
  const url = `/api/classes/${SEED_CLASS_ID}/settings`;
  expect(await db.json(url)).toEqual({ reportRules: null, styleSamples: null });
  const first = { reportRules: { sentences: 5, avoid: [" always "], notes: "Warm." }, styleSamples: "  Rowan has had a strong term.  " };
  expect(await db.json(url, jsonInit("PUT", first))).toEqual({ reportRules: { sentences: 5, avoid: ["always"], notes: "Warm." }, styleSamples: "Rowan has had a strong term." });
  // The second write replaces the first; blank samples read as none.
  expect(await db.json(url, jsonInit("PUT", { reportRules: { avoid: [] }, styleSamples: "   " }))).toEqual({ reportRules: { avoid: [] }, styleSamples: null });
  expect(await db.json(url, jsonInit("PUT", { reportRules: null, styleSamples: null }))).toEqual({ reportRules: null, styleSamples: null });

  for (const body of [{}, { reportRules: { sentences: 1 }, styleSamples: null }, { reportRules: { sentences: 13 }, styleSamples: null }, { reportRules: { bogus: 1 }, styleSamples: null }, { reportRules: null, styleSamples: "x".repeat(10_001) }, { reportRules: { avoid: [""] }, styleSamples: null }]) {
    expect((await db.request(url, jsonInit("PUT", body))).status).toBe(400);
  }
  expect((await db.request(`/api/classes/${OTHER_CLASS_ID}/settings`)).status).toBe(404);
  expect((await db.request(`/api/classes/${OTHER_CLASS_ID}/settings`, jsonInit("PUT", first))).status).toBe(404);
  expect((await db.request(`/api/classes/${OTHER_CLASS_ID}/settings`, undefined, "other")).status).toBe(200);
});

test("DELETE /api/classes/:id removes the class with its students, notes, tags, mentions, materials and settings; an unassigned note tagged to its student survives untagged, its mentions pruned", async () => {
  await db.request(`/api/classes/${SEED_CLASS_ID}/settings`, jsonInit("PUT", { reportRules: { sentences: 4 }, styleSamples: null }));
  await db.env.DB.batch([
    db.insertNote(NOTE_ID(1), SEED_CLASS_ID, "2026-10-01T00:00:00.000Z"),
    db.insertNote(NOTE_ID(2), null, "2026-10-02T00:00:00.000Z"),
    db.insertNote(NOTE_ID(3), null, "2026-10-03T00:00:00.000Z"),
    db.tagNote(NOTE_ID(1), STUDENT.avery),
    db.tagNote(NOTE_ID(2), STUDENT.avery),
    db.mentionNote(MENTION_ID(1), NOTE_ID(1), [STUDENT.avery, STUDENT.rowan]),
    // On the unassigned notes: a candidate in another class stays; only this class's go.
    db.mentionNote(MENTION_ID(2), NOTE_ID(2), [STUDENT.avery, STUDENT.nola]),
    db.mentionNote(MENTION_ID(3), NOTE_ID(3), [STUDENT.avery, STUDENT.rowan]),
    db.insertMaterial("66666666-6666-4666-8666-666666666601", SEED_CLASS_ID, []),
  ]);
  const ofClass = () =>
    db.env.DB.prepare(
      "SELECT (SELECT count(*) FROM students WHERE class_id = ?1) AS students, (SELECT count(*) FROM notes WHERE class_id = ?1) AS notes, (SELECT count(*) FROM note_students WHERE student_id IN (SELECT id FROM students WHERE class_id = ?1)) AS tags, (SELECT count(*) FROM note_mentions WHERE note_id IN (SELECT id FROM notes WHERE class_id = ?1)) AS mentions, (SELECT count(*) FROM class_materials WHERE class_id = ?1) AS materials, (SELECT count(*) FROM settings WHERE class_id = ?1) AS settings",
    )
      .bind(SEED_CLASS_ID)
      .first<{ students: number; notes: number; tags: number; mentions: number; materials: number; settings: number }>();
  expect(await ofClass()).toEqual({ students: PERIOD_3_COUNT, notes: 1, tags: 2, mentions: 1, materials: 1, settings: 1 });

  const res = await db.request(`/api/classes/${SEED_CLASS_ID}`, { method: "DELETE" });
  expect(res.status).toBe(204);
  expect(await ofClass()).toEqual({ students: 0, notes: 0, tags: 0, mentions: 0, materials: 0, settings: 0 });
  expect((await db.json<ClassRow[]>("/api/classes")).map((c) => c.id)).toEqual([CLASS_B_ID, CLASS_C_ID]);
  const notes = await db.json<NoteWithTags[]>("/api/notes");
  expect(notes.map((n) => n.id)).toEqual([NOTE_ID(3), NOTE_ID(2)]);
  expect(notes[1]!.students).toEqual([]);
  expect(notes[1]!.mentions.map((m) => m.candidateIds)).toEqual([[STUDENT.nola]]);
  expect(notes[0]!.mentions).toEqual([]);

  expect((await db.request(`/api/classes/${SEED_CLASS_ID}`, { method: "DELETE" })).status).toBe(404);
  expect((await db.request(`/api/classes/${OTHER_CLASS_ID}`, { method: "DELETE" })).status).toBe(404);
  expect((await db.json<ClassRow[]>("/api/classes", undefined, "other")).map((c) => c.id)).toEqual([OTHER_CLASS_ID]);
});
