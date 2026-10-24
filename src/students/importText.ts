import type { DocumentImportResult, GradeImportResult, RosterImportResult } from "../../worker/api-types";
import { plural } from "../ui";

// How many students a roster import added and found already there, across every class it named.
export const rosterCounts = (result: RosterImportResult) => ({
  added: result.classes.reduce((n, k) => n + k.added.length, 0),
  existing: result.classes.reduce((n, k) => n + k.existing.length, 0),
});

// The one line each import's toast says; the card above the roster has the rest.
export function rosterHeadline(result: RosterImportResult) {
  const { added, existing } = rosterCounts(result);
  return `Added ${plural(added, "student")}${existing > 0 ? `, ${existing} already enrolled` : ""}`;
}

export const gradesHeadline = (result: GradeImportResult) => `Added ${plural(result.entries, "score")} for ${plural(result.students, "student")}`;

const andList = new Intl.ListFormat(undefined, { type: "conjunction" });

// What a document import did, a sentence per part: the toast joins them, the result card
// shows them one per line.
export function documentLines(result: DocumentImportResult, classNames: Map<string, string>): string[] {
  const classes = andList.format(result.classIds.map((id) => classNames.get(id) ?? "a class"));
  const lines: string[] = [];
  if (result.materials.length > 0) lines.push(`Saved ${result.name} as course material for ${classes}.`);
  if (result.splitFailed) lines.push("Couldn't read the students out of it.");
  else if (result.kind !== "course") {
    const unsure = result.notes.filter((n) => n.mentions.length > 0).length;
    lines.push(
      result.notes.length === 0
        ? `No students from ${classes} were named in ${result.name}.`
        : `Made ${plural(result.notes.length, "note")} from ${result.name}${unsure > 0 ? `, ${plural(unsure, "name")} unsure` : ""}.`,
    );
  }
  if (result.replaced.length > 0) lines.push(`Replaced ${plural(result.replaced.length, "note")} made from it earlier.`);
  return lines;
}

export const documentHeadline = (result: DocumentImportResult, classNames: Map<string, string>) => documentLines(result, classNames).join(" ");
