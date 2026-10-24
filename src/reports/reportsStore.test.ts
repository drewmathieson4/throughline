import { describe, expect, it } from "vitest";
import { runQueue, wholeYear } from "./reportsStore";

describe("wholeYear", () => {
  it("uses the class's term when it has one", () => {
    expect(wholeYear({ termStart: "2026-09-02", termEnd: "2027-06-18" })).toEqual({ from: "2026-09-02", to: "2027-06-18" });
  });

  it("falls back to September to June of the school year we are in", () => {
    const none = { termStart: null, termEnd: null };
    expect(wholeYear(none, new Date(2026, 9, 23))).toEqual({ from: "2026-09-01", to: "2027-06-30" });
    expect(wholeYear(none, new Date(2027, 2, 1))).toEqual({ from: "2026-09-01", to: "2027-06-30" });
  });

  it("fills only the missing end", () => {
    expect(wholeYear({ termStart: "2026-08-25", termEnd: null }, new Date(2026, 9, 23))).toEqual({ from: "2026-08-25", to: "2027-06-30" });
  });
});

describe("runQueue", () => {
  it("runs every id, never more than the limit at once, and reports each outcome", async () => {
    let inFlight = 0;
    let most = 0;
    const seen: string[] = [];
    const outcomes: boolean[] = [];
    await runQueue(
      ["a", "b", "c", "d", "e"],
      2,
      async (id) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        seen.push(id);
        if (id === "c") throw new Error("no");
      },
      (ok) => outcomes.push(ok),
    );
    expect(seen.sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(most).toBe(2);
    expect(outcomes.filter((ok) => !ok)).toHaveLength(1);
    expect(outcomes).toHaveLength(5);
  });
});
