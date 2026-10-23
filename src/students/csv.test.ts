import { expect, test } from "vitest";
import { csvToGrid } from "./csv";

test("comma-separated with a header, a quoted comma, and blank lines", () => {
  expect(csvToGrid('First,Last\n"Pell, Jr.",Rowan\n\n  \nAvery,Quill\n')).toEqual([
    ["First", "Last"],
    ["Pell, Jr.", "Rowan"],
    ["Avery", "Quill"],
  ]);
});

test("tab-separated, as pasted from a spreadsheet, with Excel's BOM", () => {
  expect(csvToGrid("﻿Last\tFirst\r\nPell\tRowan\r\n")).toEqual([
    ["Last", "First"],
    ["Pell", "Rowan"],
  ]);
});

test("plain lines of Last, First stay one column", () => {
  expect(csvToGrid("Pell, Rowan\nQuill, Avery\n")).toEqual([["Pell, Rowan"], ["Quill, Avery"]]);
});

test("Last,First without a space is two columns", () => {
  expect(csvToGrid("Pell,Rowan\nQuill,Avery")).toEqual([
    ["Pell", "Rowan"],
    ["Quill", "Avery"],
  ]);
});

test("long cells are cut to what the API accepts", () => {
  expect(csvToGrid("x".repeat(300))[0]![0]).toHaveLength(200);
});
