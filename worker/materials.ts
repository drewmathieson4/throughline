// What other routes need from a class's course materials: the grading weights its newest
// syllabus states. Kept out of routes/materials.ts so the grade import and the student page
// can share the lookup without importing a Hono app.
import { and, desc, eq, inArray, isNotNull, type SQLWrapper } from "drizzle-orm";
import * as schema from "./db/schema";
import type { CourseSummary } from "./db/schema";
import type { Db } from "./db/client";
import type { Weight } from "./grades";

// The summaries of a class's materials, newest first. classId may be a subquery that
// yields it, so a caller that only has a student id can batch this with the rest.
export function selectMaterialSummaries(db: Db, classId: string | SQLWrapper) {
  const m = schema.classMaterials;
  const sameClass = typeof classId === "string" ? eq(m.classId, classId) : inArray(m.classId, classId);
  return db
    .select({ summary: m.summary })
    .from(m)
    .where(and(sameClass, isNotNull(m.summary)))
    .orderBy(desc(m.createdAt));
}

// The weights from the newest material that states any; null when none does. A unit plan
// uploaded after the syllabus does not make every student unweighted.
export function gradingWeights(rows: { summary: CourseSummary | null }[]): Weight[] | null {
  const stated = rows.find((r) => r.summary && r.summary.grading.length > 0);
  return stated?.summary?.grading ?? null;
}
