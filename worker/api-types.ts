// Response shapes the routes compose from more than one table. The frontend imports these
// type-only, like the row types in db/schema.ts, so a renamed column fails typecheck in
// both places instead of drifting.
import type { Note, Student } from "./db/schema";

export type RosterStudent = Student & { noteCount: number; pendingCount: number };
export type StudentDetail = { student: Student; notes: (Note & { confirmed: number })[] };
