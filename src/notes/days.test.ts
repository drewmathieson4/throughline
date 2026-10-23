import { describe, expect, it } from "vitest";
import { dayLabel, groupByDay } from "./days";

// Local times throughout, so the tests mean the same thing in any timezone.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const note = (id: string, when: Date) => ({ id, notedAt: when.toISOString() });

describe("dayLabel", () => {
  const now = at(2026, 10, 23, 9);

  it("names today and yesterday by local day, up to the minute either side of midnight", () => {
    expect(dayLabel(at(2026, 10, 23, 0, 0), now)).toBe("Today");
    expect(dayLabel(at(2026, 10, 22, 23, 59), now)).toBe("Yesterday");
    expect(dayLabel(at(2026, 10, 22, 0, 0), now)).toBe("Yesterday");
  });

  it("counts yesterday across a month boundary", () => {
    expect(dayLabel(at(2026, 10, 31, 20), at(2026, 11, 1, 8))).toBe("Yesterday");
  });

  it("gives older days a weekday and date, adding the year only when it differs", () => {
    const older = at(2026, 10, 20);
    expect(dayLabel(older, now)).toBe(older.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }));
    const lastYear = at(2025, 10, 20);
    expect(dayLabel(lastYear, now)).toContain("2025");
  });
});

describe("groupByDay", () => {
  const now = at(2026, 10, 23, 15);

  it("groups newest first, one group per day", () => {
    const groups = groupByDay([note("a", at(2026, 10, 23, 10)), note("b", at(2026, 10, 23, 9)), note("c", at(2026, 10, 22, 14))], now);
    expect(groups.map((g) => [g.label, g.notes.map((n) => n.id)])).toEqual([
      ["Today", ["a", "b"]],
      ["Yesterday", ["c"]],
    ]);
  });

  it("files a just-added document note under its own date, not at the top", () => {
    // Document notes are dated at noon UTC on the document's date.
    const doc = { id: "doc", notedAt: "2026-10-20T12:00:00.000Z" };
    const groups = groupByDay([doc, note("a", at(2026, 10, 23, 10)), note("c", at(2026, 10, 22, 14))], now);
    expect(groups.map((g) => g.notes.map((n) => n.id))).toEqual([["a"], ["c"], ["doc"]]);
  });
});
