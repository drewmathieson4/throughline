// What happens to an account as a whole: its data leaving as one JSON document, and the
// account going with everything it owns. Both are built on the same owner-scoped predicates
// the routes use, so the export holds exactly what the teacher can see and the delete takes
// exactly that. The demo's purge of expired visitors is the same delete (worker/demo.ts).
import { asc, eq, inArray, type SQL } from "drizzle-orm";
import * as schema from "./db/schema";
import type { ClassMaterial, ClassRow, GradeEntry, Note, NoteMention, NoteStudent, ReportRow, SettingsRow, Student, SynthesisRow, User } from "./db/schema";
import type { Db } from "./db/client";
import { groupBy, ownedClasses } from "./db/helpers";

export type AccountExport = {
  exportedAt: string;
  user: Pick<User, "email" | "name">;
  classes: (ClassRow & { settings: SettingsRow | null; students: (Student & { grades: GradeEntry[] })[]; materials: ClassMaterial[] })[];
  notes: (Note & { tags: NoteStudent[]; mentions: NoteMention[] })[];
  evidence: SynthesisRow[];
  reports: ReportRow[];
};

// Everything the account owns, nested the way the app shows it. One request: a teacher's
// data is hundreds of rows, and the Worker has no scheduler for anything longer.
export async function exportAccount(db: Db, user: User): Promise<AccountExport> {
  const mine = ownedClasses(db, user.id);
  const myStudents = db.select({ id: schema.students.id }).from(schema.students).where(inArray(schema.students.classId, mine));
  const myNotes = db.select({ id: schema.notes.id }).from(schema.notes).where(eq(schema.notes.ownerId, user.id));
  const mySyntheses = db.select({ id: schema.syntheses.id }).from(schema.syntheses).where(inArray(schema.syntheses.studentId, myStudents));
  const [classes, settings, students, grades, materials, notes, tags, mentions, evidence, reports] = await db.batch([
    db.select().from(schema.classes).where(eq(schema.classes.ownerId, user.id)).orderBy(asc(schema.classes.createdAt)),
    db.select().from(schema.settings).where(inArray(schema.settings.classId, mine)),
    db.select().from(schema.students).where(inArray(schema.students.classId, mine)).orderBy(asc(schema.students.lastName), asc(schema.students.firstName)),
    db.select().from(schema.gradeEntries).where(inArray(schema.gradeEntries.studentId, myStudents)).orderBy(asc(schema.gradeEntries.position)),
    db.select().from(schema.classMaterials).where(inArray(schema.classMaterials.classId, mine)).orderBy(asc(schema.classMaterials.createdAt)),
    db.select().from(schema.notes).where(eq(schema.notes.ownerId, user.id)).orderBy(asc(schema.notes.notedAt), asc(schema.notes.createdAt)),
    db.select().from(schema.noteStudents).where(inArray(schema.noteStudents.noteId, myNotes)),
    db.select().from(schema.noteMentions).where(inArray(schema.noteMentions.noteId, myNotes)).orderBy(asc(schema.noteMentions.createdAt)),
    db.select().from(schema.syntheses).where(inArray(schema.syntheses.studentId, myStudents)).orderBy(asc(schema.syntheses.createdAt)),
    db.select().from(schema.reports).where(inArray(schema.reports.synthesisId, mySyntheses)).orderBy(asc(schema.reports.createdAt)),
  ]);
  const settingsOf = new Map(settings.map((s) => [s.classId, s]));
  const studentsOf = groupBy(students, (s) => s.classId);
  const gradesOf = groupBy(grades, (g) => g.studentId);
  const materialsOf = groupBy(materials, (m) => m.classId);
  const tagsOf = groupBy(tags, (t) => t.noteId);
  const mentionsOf = groupBy(mentions, (m) => m.noteId);
  return {
    exportedAt: new Date().toISOString(),
    user: { email: user.email, name: user.name },
    classes: classes.map((c) => ({
      ...c,
      settings: settingsOf.get(c.id) ?? null,
      students: (studentsOf.get(c.id) ?? []).map((s) => ({ ...s, grades: gradesOf.get(s.id) ?? [] })),
      materials: materialsOf.get(c.id) ?? [],
    })),
    notes: notes.map((n) => ({ ...n, tags: tagsOf.get(n.id) ?? [], mentions: mentionsOf.get(n.id) ?? [] })),
    evidence,
    reports,
  };
}

// Delete the users `which` picks, with everything they own. Notes and classes go first:
// owner_id points at users without a cascade. Deleting a class takes its students, grades,
// materials, tags, summaries and reports; deleting a user takes its sessions.
export function deleteUsers(db: Db, which: SQL | undefined) {
  const gone = db.select({ id: schema.users.id }).from(schema.users).where(which);
  return db.batch([
    db.delete(schema.notes).where(inArray(schema.notes.ownerId, gone)),
    db.delete(schema.classes).where(inArray(schema.classes.ownerId, gone)),
    db.delete(schema.users).where(which),
  ]);
}
