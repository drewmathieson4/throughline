import { describe, expect, test } from "vitest";
import { applyMapping, detectTable, headerRole, planImport, splitFullName, titleCaseIfShouting, type Table } from "./roster";

const table = (roles: Table["roles"], start: number, end: number, source: Table["source"] = "header"): Table => ({ roles, start, end, source });

describe("headerRole", () => {
  test.each([
    ["First Name", "first"],
    ["FirstName", "first"],
    ["first_name", "first"],
    ["Given Name", "first"],
    ["Student First Name", "first"],
    ["Last Name", "last"],
    ["Surname", "last"],
    ["Family name", "last"],
    ["Name", "full"],
    ["Student Name", "full"],
    ["Student", "full"],
    ["Preferred First Name", "preferred"],
    ["Nickname", "preferred"],
    ["Goes By", "preferred"],
    ["Section", "class"],
    ["Class Name", "class"],
    ["Homeroom", "class"],
    ["Student ID", null],
    ["Email", null],
    ["Username", null],
    ["Grade", null],
    ["Generated 8 roster rows across 2 sections, using each section's own student list.", null],
  ])("%s → %s", (cell, role) => {
    expect(headerRole(cell)).toBe(role);
  });
});

describe("detectTable", () => {
  test("reads first and last from the header, ignoring other columns", () => {
    const grid = [
      ["ID", "Last", "First", "Grade"],
      ["1", "Brook", "Tamsin", "7"],
    ];
    expect(detectTable(grid)).toEqual(table(["ignore", "last", "first", "ignore"], 1, 2));
  });
  test("Surname / Given Name", () => {
    expect(detectTable([["Surname", "Given Name"], ["Brook", "Tamsin"]])?.roles).toEqual(["last", "first"]);
  });
  test("a Name header is Last, First when the cells have commas, else First Last", () => {
    expect(detectTable([["Name"], ["Brook, Tamsin"], ["Quill, Avery"]])?.roles).toEqual(["full_last_first"]);
    expect(detectTable([["Student Name"], ["Tamsin Brook"], ["Avery Quill"]])?.roles).toEqual(["full_first_last"]);
  });
  test("preferred-name and class headers ride along", () => {
    expect(detectTable([["First", "Last", "Preferred", "Section"], ["Tamsin", "Brook", "Tam", "7A"]])?.roles).toEqual(["first", "last", "preferred", "class"]);
  });
  test("a header with no names under it is not a table", () => {
    expect(detectTable([["First", "Last"]])).toBeNull();
    expect(detectTable([["Student ID", "Email"], ["1", "a@b.c"]])).toBeNull();
  });
  test("finds the header in the middle of a file and stops at the summary rows after the table", () => {
    const grid = [
      ["Tool", "Roster Generator"],
      ["Students", "2"], // looks like a "Student" header, but nothing under it is a name
      ["First roll", "1"],
      [""],
      ["Section", "Roll", "Name", "Student ID"],
      ["7A", "1", "Tamsin Brook", "STU-1"],
      [""],
      ["7B", "2", "Mira Holloway", "STU-2"],
      ["Roster diff", ""],
      ["Added", "Tamsin Brook; Mira Holloway"],
    ];
    const t = detectTable(grid);
    expect(t).toEqual(table(["class", "ignore", "full_first_last", "ignore"], 5, 8));
    expect(applyMapping(grid, t!).rows.map((r) => [r.line, r.firstName, r.className])).toEqual([
      [6, "Tamsin", "7A"],
      [8, "Mira", "7B"],
    ]);
  });
  test("no header: one column of Last, First", () => {
    expect(detectTable([["Brook, Tamsin"], ["Quill, Avery"], ["Vale, Juniper"]])).toEqual(table(["full_last_first"], 0, 3, "content"));
  });
  test("no header: a full-name column beside ids and emails", () => {
    const grid = [
      ["1001", "Tamsin Brook", "tb@school.test"],
      ["1002", "Avery Quill", "aq@school.test"],
    ];
    expect(detectTable(grid)).toEqual(table(["ignore", "full_first_last", "ignore"], 0, 2, "content"));
  });
  test("no header: two bare word columns are ambiguous", () => {
    expect(detectTable([["Brook", "Tamsin"], ["Quill", "Avery"]])).toBeNull();
  });
  test("an empty grid is nothing", () => {
    expect(detectTable([])).toBeNull();
    expect(detectTable([[""]])).toBeNull();
  });
});

describe("splitFullName", () => {
  test.each([
    ["Pell, Rowan", "last_first", "Rowan", "Pell"],
    ["Pell, Rowan James", "last_first", "Rowan", "Pell"],
    ["Pell, Rowan, Jr.", "last_first", "Rowan", "Pell"],
    ["Pell Jr., Rowan", "last_first", "Rowan", "Pell"],
    ["de la Cruz, Ana", "last_first", "Ana", "de la Cruz"],
    ["Rowan Pell", "last_first", "Rowan", "Pell"], // no comma: read as First Last
    ["Rowan Pell", "first_last", "Rowan", "Pell"],
    ["Rowan James Pell", "first_last", "Rowan", "Pell"],
    ["Ana de la Cruz", "first_last", "Ana", "de la Cruz"],
    ["Ludwig van Beethoven", "first_last", "Ludwig", "van Beethoven"],
    ["Rowan Pell Jr.", "first_last", "Rowan", "Pell"],
    ["Rowan Pell III", "first_last", "Rowan", "Pell"],
    ["  Rowan   Pell ", "first_last", "Rowan", "Pell"],
    ["Van Morrison", "first_last", "Van", "Morrison"], // a particle in first position is a first name
  ])("%s (%s) → %s / %s", (s, format, first, last) => {
    expect(splitFullName(s, format as "first_last" | "last_first")).toEqual({ firstName: first, lastName: last });
  });
  test("one word is not a name", () => {
    expect(splitFullName("Rowan", "first_last")).toEqual({ error: "only one name" });
    expect(splitFullName("Pell,", "last_first")).toEqual({ error: "only one name" });
    expect(splitFullName("", "first_last")).toEqual({ error: "no name" });
  });
});

describe("titleCaseIfShouting", () => {
  test.each([
    ["PELL", "Pell"],
    ["O'BRIEN", "O'Brien"],
    ["SMITH-JONES", "Smith-Jones"],
    ["DE LA CRUZ", "De La Cruz"],
    ["McBride", "McBride"],
    ["van Beethoven", "van Beethoven"],
    ["Rowan", "Rowan"],
    ["", ""],
  ])("%s → %s", (s, out) => {
    expect(titleCaseIfShouting(s)).toBe(out);
  });
});

describe("applyMapping", () => {
  test("cleans names and turns a preferred name into an alias", () => {
    const grid = [
      ["First", "Last", "Goes by"],
      ["Juniper", "Vale", "Juni"],
      [" TAMSIN ", "BROOK", "Tamsin"],
      ["Avery", "Quill", ""],
    ];
    expect(applyMapping(grid, table(["first", "last", "preferred"], 1, 4))).toEqual({
      rows: [
        { line: 2, firstName: "Juniper", lastName: "Vale", aliases: ["Juni"], className: null },
        { line: 3, firstName: "Tamsin", lastName: "Brook", aliases: [], className: null },
        { line: 4, firstName: "Avery", lastName: "Quill", aliases: [], className: null },
      ],
      skipped: [],
    });
  });
  test("reports why a line was skipped, and passes over blank lines", () => {
    const grid = [
      ["", ""],
      ["Tamsin", ""],
      ["", "Brook"],
      ["x".repeat(101), "Brook"],
      ["Grade 7", "A"],
    ];
    expect(applyMapping(grid, table(["first", "last"], 0, 5)).skipped.map((s) => [s.line, s.reason])).toEqual([
      [2, "no last name"],
      [3, "no first name"],
      [4, "name too long"],
      [5, "not a name"],
    ]);
  });
  test("splits a full-name column and reports a lone word", () => {
    const grid = [["Brook, Tamsin"], ["Quill"], ["Vale, Juniper Rose"]];
    const out = applyMapping(grid, table(["full_last_first"], 0, 3));
    expect(out.rows.map((r) => `${r.firstName} ${r.lastName}`)).toEqual(["Tamsin Brook", "Juniper Vale"]);
    expect(out.skipped).toEqual([{ line: 2, cells: ["Quill"], reason: "only one name" }]);
  });
  test("first and last columns win over a full-name column", () => {
    const grid = [["Brook, Tamsin", "Avery", "Quill"]];
    expect(applyMapping(grid, table(["full_last_first", "first", "last"], 0, 1)).rows[0]).toMatchObject({ firstName: "Avery", lastName: "Quill" });
  });
  test("a first column with no last column skips every row", () => {
    expect(applyMapping([["Tamsin"]], table(["first", "ignore"], 0, 1)).skipped[0]?.reason).toBe("no last name");
  });
});

describe("planImport", () => {
  const roster = [
    { firstName: "Avery", lastName: "Quill" },
    { firstName: "Ana", lastName: "de la Cruz" },
  ];
  const row = (line: number, firstName: string, lastName: string) => ({ line, firstName, lastName, aliases: [], className: null });
  test("matches enrolled students ignoring case and spacing, collapses repeats", () => {
    const out = planImport([row(1, "avery", "QUILL"), row(2, "Rowan", "Pell"), row(3, "Rowan", "Pell"), row(4, "Ana", "De La Cruz")], roster);
    expect(out.added).toEqual([{ firstName: "Rowan", lastName: "Pell", aliases: [] }]);
    expect(out.existing.map((s) => s.lastName)).toEqual(["QUILL", "De La Cruz"]);
    expect(out.skipped).toEqual([{ line: 3, cells: ["Rowan", "Pell"], reason: "same as line 2" }]);
  });
  test("does not leak the line number or class into the result", () => {
    expect(planImport([row(1, "Rowan", "Pell")], []).added[0]).toEqual({ firstName: "Rowan", lastName: "Pell", aliases: [] });
  });
});
