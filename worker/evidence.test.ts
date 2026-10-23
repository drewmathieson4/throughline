import { expect, test } from "vitest";
import type { CourseSummary, GradeEntry } from "./db/schema";
import { buildEvidence, coverageOf, type EvidenceNote, type EvidenceRows } from "./evidence";
import { inputHash } from "./synthesis-model";

const RANGE = { from: "2026-09-01", to: "2026-12-19" };
const TODAY = "2026-10-23";

const note = (id: string, notedAt: string, quotes: string[], kind: EvidenceNote["kind"] = "text"): EvidenceNote => ({
  id,
  kind,
  sourceName: kind === "progress_report" ? "fall.docx" : null,
  notedAt: `${notedAt}T15:00:00.000Z`,
  createdAt: `${notedAt}T15:00:00.000Z`,
  quotes,
});

const grade = (studentId: string, assignment: string, score: number | null, dueDate: string | null, position: number, category = "Quizzes"): GradeEntry => ({
  id: `${studentId}-${assignment}`,
  studentId,
  assignment,
  category,
  score,
  maxScore: 10,
  dueDate,
  position,
});

const syllabus: CourseSummary = {
  description: "Humanities syllabus",
  goals: ["Read a primary source", "Write an argument from evidence"],
  grading: [{ category: "Quizzes", weight: 100 }],
  units: [{ name: "Mesopotamia", when: "September" }],
  policies: ["Late work accepted for a week"],
};

function rows(over: Partial<EvidenceRows> = {}): EvidenceRows {
  const grades = [grade("avery", "Quiz 1", 8, "2026-09-12", 0), grade("avery", "Quiz 2", null, null, 1), grade("avery", "Summer packet", 9, "2026-08-20", 2)];
  return {
    student: { firstName: "Avery", lastName: "Quill" },
    className: "Period 3",
    range: RANGE,
    notes: [note("n1", "2026-09-14", ["Avery led the seminar."]), note("n2", "2026-10-01", ["Avery's thesis was vague."], "progress_report")],
    grades,
    classGrades: [...grades, grade("rowan", "Quiz 1", 6, "2026-09-12", 0)],
    materials: [{ summary: syllabus }],
    context: [{ id: "c1", notedAt: "2026-10-02T09:00:00.000Z", body: "The whole class struggled with the essay rubric." }],
    ...over,
  };
}

test("notes, grades in the range (undated included) and the grade summary get citation ids in order", () => {
  const e = buildEvidence(rows(), TODAY);
  expect([...e.citations.keys()]).toEqual(["N1", "N2", "G1", "G2", "GRADES"]);
  expect(e.citations.get("N2")).toEqual({
    type: "note",
    noteId: "n2",
    notedAt: "2026-10-01T15:00:00.000Z",
    kind: "progress_report",
    sourceName: "fall.docx",
    quotes: ["Avery's thesis was vague."],
  });
  // The August packet is outside the range; the undated quiz counts in every range.
  expect(e.citations.get("G1")).toMatchObject({ type: "grade", assignment: "Quiz 1", pct: 80, classMean: 70 });
  expect(e.citations.get("G2")).toMatchObject({ type: "grade", assignment: "Quiz 2", score: null, dueDate: null });
  expect(e.grades).toMatchObject({ count: 1, missing: 1, weighted: true });
  expect(e.coverage.undatedGrades).toBe(true);
  expect(e.empty).toBe(false);
});

test("the message carries the goals by id, the quotes fenced as evidence, and class notes as uncitable context", () => {
  const e = buildEvidence(rows(), TODAY);
  expect([...e.goals]).toEqual([
    ["GOAL1", "Read a primary source"],
    ["GOAL2", "Write an argument from evidence"],
  ]);
  expect(e.message).toContain("GOAL2. Write an argument from evidence");
  expect(e.message).toContain('<evidence>\nN1. 2026-09-14 · typed note\n- "Avery led the seminar."');
  expect(e.message).toContain("N2. 2026-10-01 · progress report (fall.docx)");
  expect(e.message).toContain("G1. 2026-09-12 · Quiz 1 · Quizzes · 8/10 = 80% · class mean 70%");
  expect(e.message).toContain("G2. no due date · Quiz 2 · Quizzes · missing");
  expect(e.message).toMatch(/never cite them:\n<context>\nC1\. 2026-10-02\nThe whole class struggled/);
  expect(e.message).toContain("Late work accepted for a week");
  expect(e.message).not.toContain("Summer packet");
});

test("no syllabus goals, no grades, and no notes are each said plainly", () => {
  const e = buildEvidence(rows({ materials: [], grades: [], classGrades: [], context: [] }), TODAY);
  expect(e.goals.size).toBe(0);
  expect(e.message).toContain("return no goals");
  expect(e.message).toContain("No grades in this period.");
  expect(e.citations.has("GRADES")).toBe(false);
  expect(buildEvidence(rows({ notes: [] }), TODAY).message).toContain("No notes about Avery in this period.");
  expect(buildEvidence(rows({ notes: [], grades: [] }), TODAY).empty).toBe(true);
});

test("coverage counts sources, silences and empty months up to today, and labels by fixed rules", () => {
  const notes = [note("a", "2026-09-03", ["x"]), note("b", "2026-09-10", ["x"], "voice"), note("c", "2026-10-20", ["x"])];
  const c = coverageOf(notes, null, false, RANGE, TODAY);
  expect(c).toMatchObject({ notes: 3, bySource: { text: 2, voice: 1 }, daysSinceLastNote: 3, longestSilenceDays: 40, emptyMonths: [], grades: 0 });
  expect(c.label).toBe("thin"); // three notes, but a 40-day silence
  // A range in the past ends at its own last day; months with no note are named.
  expect(coverageOf(notes, null, false, { from: "2026-08-01", to: "2026-11-30" }, "2027-01-10").emptyMonths).toEqual(["2026-08", "2026-11"]);
  expect(coverageOf(notes.slice(0, 2), null, false, RANGE, TODAY).label).toBe("very_thin");
  expect(coverageOf([], null, false, RANGE, TODAY)).toMatchObject({ label: "very_thin", daysSinceLastNote: null, lastNotedAt: null });
  const weekly = ["09-03", "09-10", "09-17", "09-24", "10-01", "10-08", "10-15", "10-22"].map((d, i) => note(`w${i}`, `2026-${d}`, ["x"]));
  expect(coverageOf(weekly, null, false, RANGE, TODAY).label).toBe("well_supported");
});

test("the input hash is stable, ignores today, and changes with a quote, a grade or a goal", async () => {
  const base = await inputHash(buildEvidence(rows(), TODAY));
  expect(await inputHash(buildEvidence(rows(), TODAY))).toBe(base);
  expect(await inputHash(buildEvidence(rows(), "2026-11-30"))).toBe(base);
  const r = rows();
  const edited = rows({ notes: [r.notes[0]!, { ...r.notes[1]!, quotes: ["Avery's thesis was sharp."] }] });
  expect(await inputHash(buildEvidence(edited, TODAY))).not.toBe(base);
  const regraded = rows({ grades: [{ ...r.grades[0]!, score: 9 }, ...r.grades.slice(1)] });
  expect(await inputHash(buildEvidence(regraded, TODAY))).not.toBe(base);
  const newGoal = rows({ materials: [{ summary: { ...syllabus, goals: [...syllabus.goals, "Map a trade route"] } }] });
  expect(await inputHash(buildEvidence(newGoal, TODAY))).not.toBe(base);
});
