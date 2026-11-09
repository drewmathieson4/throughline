import { describe, expect, it } from "vitest";
import { matches } from "./search";

const note = { body: "Avery nailed the Quiz.\nJuni asked for help.", sourceName: null };
const fromFile = { body: "Rowan is improving.", sourceName: "Term 1 reports.docx" };

describe("matches", () => {
  it("matches everything on a blank or whitespace query", () => {
    expect(matches(note, "")).toBe(true);
    expect(matches(note, "   ")).toBe(true);
  });

  it("ignores case and finds words across lines, in any order", () => {
    expect(matches(note, "quiz")).toBe(true);
    expect(matches(note, "help avery")).toBe(true);
    expect(matches(note, "nailed  the")).toBe(true);
  });

  it("needs every word", () => {
    expect(matches(note, "avery rowan")).toBe(false);
    expect(matches(note, "quizzes")).toBe(false);
  });

  it("searches the source document's name too", () => {
    expect(matches(fromFile, "reports")).toBe(true);
    expect(matches(fromFile, "term rowan")).toBe(true);
    expect(matches(note, "reports")).toBe(false);
  });
});
