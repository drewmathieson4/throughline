import { describe, expect, it } from "vitest";
import { freshness } from "./fresh";

// Local times throughout, so the tests mean the same thing in any timezone.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const now = at(2026, 10, 23, 9);
const fresh = (when: Date) => freshness(when.toISOString(), now);

describe("freshness", () => {
  it("counts local days, not 24-hour spans", () => {
    expect(fresh(at(2026, 10, 23, 0, 5))).toEqual({ label: "Today", tone: "mint" });
    expect(fresh(at(2026, 10, 22, 23, 59))).toEqual({ label: "Yesterday", tone: "mint" });
    expect(fresh(at(2026, 10, 20, 18))).toEqual({ label: "3 days ago", tone: "mint" });
  });

  it("turns yellow after a week and coral after a month", () => {
    expect(fresh(at(2026, 10, 16)).tone).toBe("mint");
    expect(fresh(at(2026, 10, 15))).toEqual({ label: "8 days ago", tone: "sunny" });
    expect(fresh(at(2026, 9, 23)).tone).toBe("sunny");
    expect(fresh(at(2026, 9, 22))).toEqual({ label: "31 days ago", tone: "coral" });
  });

  it("is coral with no note at all", () => {
    expect(freshness(null, now)).toEqual({ label: "No notes yet", tone: "coral" });
  });
});
