import type { GradeImportResult, RosterImportResult } from "../../worker/api-types";
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
