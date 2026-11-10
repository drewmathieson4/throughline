// Everything an account owns, as one JSON document the teacher can download: the way their
// data leaves the app. Built on the same owner-scoped predicates the routes use, so it holds
// exactly what the teacher can see, nested the way the app shows it. One request: a
// teacher's data is hundreds of rows, and the Worker has no scheduler for anything longer.
import { asc, eq, inArray } from "drizzle-orm";
import * as schema from "./db/schema";
import type { ClassMaterial, ClassRow, GradeEntry, Note, NoteMention, NoteStudent, ReportRow, SettingsRow, Student, SynthesisRow, User } from "./db/schema";
import type { Db } from "./db/client";
import { ownedClasses } from "./db/helpers";

export type AccountExport = {
  exportedAt: string;
  user: Pick<User, "email" | "name">;
  classes: (ClassRow & { settings: SettingsRow | null; students: (Student & { grades: GradeEntry[] })[]; materials: ClassMaterial[] })[];
  notes: (Note & { tags: NoteStudent[]; mentions: NoteMention[] })[];
  evidence: SynthesisRow[];
  reports: ReportRow[];
};

// Rows under their parent's id, in the order they came.
function under<T, K extends keyof T>(rows: T[], key: K): Map<T[K], T[]> {
  const groups = new Map<T[K], T[]>();
  for (const row of rows) {
    const list = groups.get(row[key]);
    if (list) list.push(row);
    else groups.set(row[key], [row]);
  }
  return groups;
}

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
  const studentsOf = under(students, "classId");
  const gradesOf = under(grades, "studentId");
  const materialsOf = under(materials, "classId");
  const tagsOf = under(tags, "noteId");
  const mentionsOf = under(mentions, "noteId");
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
