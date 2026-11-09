// Which rows make up the demo template, as SQL: shared by scripts/demo/snapshot.ts, which
// runs it through wrangler, and worker/demo.test.ts, which runs it against the test D1. No
// imports on purpose, so both tsconfigs can take it.
//
// Two seed classes and four students of each, by the seed's fixed ids (scripts/seed-dev.sql),
// whoever owns them. The notes: in a template class, the class-level ones (no tags) and any
// tagged to a kept student; not yet assigned to a class, any tagged to a kept student or
// with a kept student as an open-mention candidate (a note that only says "Alex", or one
// spanning both classes). Tags to kept students only; grades for kept students; the course
// material and settings of the two classes; the newest saved summary per student and period.
const seedStudent = (n: string) => `22222222-2222-4222-8222-2222222222${n}`;
export const DEMO_TEMPLATE = [
  // Period 3 Humanities: Rowan Pell, Ember Castellane, Marlowe Finchley, Alex Marsh
  { classId: "11111111-1111-4111-8111-111111111111", students: ["02", "06", "05", "09"].map(seedStudent) },
  // B Block Humanities: Imogen Hale, Theo Brightwater, Ronan Pike, Alex Ruiz
  { classId: "11111111-1111-4111-8111-111111112222", students: ["15", "14", "13", "10"].map(seedStudent) },
];
const list = (ids: string[]) => `(${ids.map((id) => `'${id}'`).join(", ")})`;
const C = list(DEMO_TEMPLATE.map((t) => t.classId));
const S = list(DEMO_TEMPLATE.flatMap((t) => t.students));

const KEPT_TAG = `EXISTS (SELECT 1 FROM note_students ns WHERE ns.note_id = n.id AND ns.student_id IN ${S})`;
const ANY_TAG = `EXISTS (SELECT 1 FROM note_students ns WHERE ns.note_id = n.id)`;
const KEPT_CANDIDATE = `EXISTS (SELECT 1 FROM note_mentions m, json_each(m.candidate_ids) WHERE m.note_id = n.id AND json_each.value IN ${S})`;
const NOTE_IDS = `SELECT n.id FROM notes n WHERE (n.class_id IN ${C} AND (NOT ${ANY_TAG} OR ${KEPT_TAG})) OR (n.class_id IS NULL AND (${KEPT_TAG} OR ${KEPT_CANDIDATE}))`;

// One SELECT per section of the template file, in its order.
export const TEMPLATE_QUERIES = {
  classes: `SELECT * FROM classes WHERE id IN ${C} ORDER BY id`,
  students: `SELECT * FROM students WHERE id IN ${S} ORDER BY id`,
  notes: `SELECT * FROM notes WHERE id IN (${NOTE_IDS}) ORDER BY id`,
  tags: `SELECT * FROM note_students WHERE student_id IN ${S} AND note_id IN (${NOTE_IDS}) ORDER BY note_id, student_id`,
  mentions: `SELECT * FROM note_mentions WHERE note_id IN (${NOTE_IDS}) ORDER BY id`,
  materials: `SELECT * FROM class_materials WHERE class_id IN ${C} ORDER BY id`,
  grades: `SELECT * FROM grade_entries WHERE student_id IN ${S} ORDER BY id`,
  settings: `SELECT * FROM settings WHERE class_id IN ${C} ORDER BY class_id`,
  syntheses: `SELECT * FROM syntheses s WHERE s.student_id IN ${S} AND s.created_at = (SELECT max(s2.created_at) FROM syntheses s2 WHERE s2.student_id = s.student_id AND s2.period_start = s.period_start AND s2.period_end = s.period_end) ORDER BY id`,
};
export type TemplateSection = keyof typeof TEMPLATE_QUERIES;
