import { describe, expect, test } from "vitest";
import type { GradeEntry } from "./db/schema";
import { summarise } from "./grades";

let n = 0;
const row = (p: Partial<GradeEntry> & { assignment: string }): GradeEntry => ({
  id: `g-${++n}`,
  studentId: "s-avery",
  category: null,
  score: 80,
  maxScore: 100,
  dueDate: null,
  position: n,
  ...p,
});
const weights = [
  { category: "Homework", weight: 20 },
  { category: "Quizzes", weight: 20 },
  { category: "Tests", weight: 60 },
];

test("empty input → null", () => {
  expect(summarise([], [], weights)).toBeNull();
});

describe("categories and overall", () => {
  const rows = [
    row({ assignment: "HW 1", category: "Homework", score: 10, maxScore: 10 }),
    row({ assignment: "HW 2", category: "homework", score: 8, maxScore: 10 }),
    row({ assignment: "Quiz 1", category: "Quizzes", score: 10, maxScore: 20 }),
    row({ assignment: "Quiz 2", category: "Quizzes", score: null, maxScore: 20 }),
    row({ assignment: "Test 1", category: "Tests", score: 30, maxScore: 40 }),
    row({ assignment: "Test 2", category: "Tests", score: 34, maxScore: 40 }),
  ];

  test("means per category, best first, with the syllabus weight and missing count; strongest and weakest", () => {
    const s = summarise(rows, rows, weights)!;
    expect(s.byCategory).toEqual([
      { category: "Homework", weight: 20, count: 2, missing: 0, mean: 90 },
      { category: "Tests", weight: 60, count: 2, missing: 0, mean: 80 },
      { category: "Quizzes", weight: 20, count: 1, missing: 1, mean: 50 },
    ]);
    expect(s.count).toBe(5);
    expect(s.missing).toBe(1);
    // Quizzes has one scored entry, so it does not rank.
    expect(s.strongest).toBe("Homework");
    expect(s.weakest).toBe("Tests");
  });

  test("overall follows the weights when every scored category has one", () => {
    const s = summarise(rows, rows, weights)!;
    expect(s.weighted).toBe(true);
    expect(s.overall).toBe(76); // (90*20 + 50*20 + 80*60) / 100
  });

  test("an unweighted category makes the overall a plain mean", () => {
    const extra = [...rows, row({ assignment: "Map", category: "other", score: 50, maxScore: 100 })];
    const s = summarise(extra, extra, weights)!;
    expect(s.weighted).toBe(false);
    expect(s.overall).toBe(73.3); // mean of 100, 80, 50, 75, 85, 50
    expect(s.byCategory.find((c) => c.category === "other")).toMatchObject({ weight: null, mean: 50 });
  });

  test("without a syllabus the overall is the mean of scored entries and missing work is left out", () => {
    const s = summarise(rows, rows, [])!;
    expect(s.weighted).toBe(false);
    expect(s.overall).toBe(78); // mean of 100, 80, 50, 75, 85
  });

  test("a category with no scored entry is listed last with a null mean and does not block weighting", () => {
    const only = [row({ assignment: "HW 1", category: "Homework", score: 9, maxScore: 10 }), row({ assignment: "Quiz 1", category: "Quizzes", score: null })];
    const s = summarise(only, only, weights)!;
    expect(s.byCategory.map((c) => [c.category, c.mean])).toEqual([
      ["Homework", 90],
      ["Quizzes", null],
    ]);
    expect(s.weighted).toBe(true);
    expect(s.overall).toBe(90);
  });
});

describe("trend", () => {
  test("needs four scored entries", () => {
    const three = [row({ assignment: "a", score: 50 }), row({ assignment: "b", score: 50 }), row({ assignment: "c", score: 90 })];
    expect(summarise(three, three, [])!.trend).toBeNull();
  });

  test.each([
    ["rising", [60, 65, 80, 90]],
    ["slipping", [90, 85, 70, 60]],
    ["steady", [80, 82, 84, 86]],
  ])("%s", (label, scores) => {
    const rows = scores.map((score, i) => row({ assignment: `a${i}`, score }));
    const t = summarise(rows, rows, [])!.trend!;
    expect(t.label).toBe(label);
    expect(t.from).toBe(Math.round((scores[0]! + scores[1]!) / 2));
    expect(t.to).toBe(Math.round((scores[2]! + scores[3]!) / 2));
  });

  test("follows due dates when every entry has one, else the file's order; the odd entry goes to the second half", () => {
    const dated = [
      row({ assignment: "late", score: 90, dueDate: "2026-10-01", position: 0 }),
      row({ assignment: "early", score: 50, dueDate: "2026-09-01", position: 1 }),
      row({ assignment: "mid", score: 60, dueDate: "2026-09-15", position: 2 }),
      row({ assignment: "later", score: 95, dueDate: "2026-10-10", position: 3 }),
      row({ assignment: "last", score: 100, dueDate: "2026-10-20", position: 4 }),
    ];
    const s = summarise(dated, dated, [])!;
    expect(s.entries.map((e) => e.assignment)).toEqual(["early", "mid", "late", "later", "last"]);
    expect(s.trend).toEqual({ label: "rising", from: 55, to: 95 });

    const mixed = dated.map((r, i) => ({ ...r, dueDate: i === 0 ? null : r.dueDate }));
    expect(summarise(mixed, mixed, [])!.entries.map((e) => e.assignment)).toEqual(["late", "early", "mid", "later", "last"]);
  });
});

describe("biggest win and loss", () => {
  test("the entry furthest from the student's mean by at least ten points, with the class mean there", () => {
    const avery = [row({ assignment: "a", score: 70 }), row({ assignment: "b", score: 95 }), row({ assignment: "c", score: 45 }), row({ assignment: "d", score: 70 })];
    const alex = [row({ assignment: "b", studentId: "s-alex", score: 55 }), row({ assignment: "c", studentId: "s-alex", score: 35 })];
    const s = summarise(avery, [...avery, ...alex], [])!;
    expect(s.biggestWin).toEqual({ assignment: "b", pct: 95, classMean: 75 });
    expect(s.biggestLoss).toEqual({ assignment: "c", pct: 45, classMean: 40 });
  });

  test("nothing within ten points of the mean counts", () => {
    const rows = [row({ assignment: "a", score: 75 }), row({ assignment: "b", score: 84 }), row({ assignment: "c", score: 66 })];
    const s = summarise(rows, rows, [])!;
    expect(s.biggestWin).toBeNull();
    expect(s.biggestLoss).toBeNull();
  });

  test("class mean is null when no classmate has a score there", () => {
    const rows = [row({ assignment: "a", score: 50 }), row({ assignment: "b", score: 90 })];
    expect(summarise(rows, [], [])!.biggestWin).toEqual({ assignment: "b", pct: 90, classMean: null });
  });
});

test("entries carry the percent, rounded, and null for missing work; a zero max counts as missing", () => {
  const rows = [row({ assignment: "a", score: 2, maxScore: 3 }), row({ assignment: "b", score: null }), row({ assignment: "c", score: 5, maxScore: 0 })];
  const s = summarise(rows, rows, [])!;
  expect(s.entries.map((e) => e.pct)).toEqual([66.7, null, null]);
  expect(s.missing).toBe(2);
  expect(s.overall).toBe(66.7);
});
