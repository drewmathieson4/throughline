// Contextual documents: the one way in for a file about a class. Haiku sorts it
// (worker/document-kind.ts): a syllabus or unit plan becomes course material, one row per
// picked class, summarised once (worker/materials-model.ts); a progress report or report-card
// comments becomes one note per student it is about, cut against the picked classes' roster
// (worker/documents.ts); a file with both does both, in parallel. `as=` gives the kind and
// skips the sorting call, which is how the result card's "Treat as … instead" re-posts it.
// Without the model (no key, or the account is over its spend cap) a file is stored as
// course material, unsummarised; one the teacher said is about students is refused.
//
// Importing a file again replaces what that file name made before in the picked classes,
// whichever kind it was, so a switch with `as=` removes the wrong kind. Why these choices,
// and how the notes are dated: see DECISIONS.md.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { stream } from "hono/streaming";
import type Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import * as schema from "../db/schema";
import type { CourseSummary, User } from "../db/schema";
import type { DocumentImportResult, DocumentKind, DocumentProgress, DocumentStep, MaterialRow, NoteWithTags } from "../api-types";
import type { Db, UserEnv } from "../db/client";
import { requireClass, selectClasses, selectRoster } from "../db/helpers";
import { assertAllowance, refund, reserve } from "../demo";
import { sortDocument } from "../document-kind";
import { splitDocument, type SplitResult } from "../documents";
import { pastDatetime } from "../fields";
import { summariseMaterial } from "../materials-model";
import { MAX_BODY_CHARS, mentionRow, noteRow } from "../note-rows";
import { modelAccess } from "../spend";
import { readUpload, uploadLimit, uploadName } from "../upload";
import { validate } from "../validate";

// More classes than a teacher has; it keeps each statement's class list well inside D1's
// 100 bound parameters.
const MAX_CLASSES = 20;

const documentKind = z.enum(["course", "students", "both"]) satisfies z.ZodType<DocumentKind>;
// ?classIds=a,b: the classes the teacher ticked, repeats dropped.
const classIdList = z
  .string()
  .transform((s) => [...new Set(s.split(",").map((id) => id.trim()).filter(Boolean))])
  .pipe(z.array(z.uuid("classIds must be class ids")).min(1, "pick a class").max(MAX_CLASSES, "too many classes"));
const documentQuery = z.object({
  name: uploadName,
  classIds: classIdList,
  // When the file was last modified: the fallback date for its notes.
  modified: pastDatetime("modified").optional(),
  // The kind, when the teacher has said it.
  as: documentKind.optional(),
});

const unreadable = () => new HTTPException(502, { message: "could not read the students out of that document" });

// The model's guess at the kind, or "course" when it could not be asked or did not answer
// usably (logged): a stored material loses nothing, and the result card's switch makes the
// file notes instead.
async function sort(client: Anthropic | null, name: string, text: string): Promise<DocumentKind> {
  if (!client) {
    console.warn("no model access (no API key, or over the spend cap); document stored as course material", name);
    return "course";
  }
  try {
    return await sortDocument({ text, client });
  } catch (err) {
    console.error("sorting failed for document", name, err);
    return "course";
  }
}

// The structured reading of a course document, or null when the model could not be asked or
// did not answer usably (logged). Null never blocks storing it.
async function summarise(client: Anthropic | null, name: string, text: string): Promise<CourseSummary | null> {
  if (!client) {
    console.warn("no model access (no API key, or over the spend cap); material stored without a summary", name);
    return null;
  }
  try {
    return await summariseMaterial({ text, client });
  } catch (err) {
    console.error("summarising failed for material", name, err);
    return null;
  }
}

// The passages about each student of the picked classes, or null when the model could not
// be asked or did not answer usably (logged). The caller decides what null means.
async function split(db: Db, userId: string, client: Anthropic | null, name: string, text: string, classIds: string[]): Promise<SplitResult | null> {
  if (!client) {
    console.warn("no model access (no API key, or over the spend cap); document not split", name);
    return null;
  }
  const [roster, classes] = await db.batch([selectRoster(db, userId, classIds), selectClasses(db, userId)]);
  try {
    return await splitDocument({ text, roster, classes: classes.filter((k) => classIds.includes(k.id)), client });
  } catch (err) {
    console.error("splitting failed for document", name, err);
    return null;
  }
}

// The passages that fit one note body: later ones are dropped once it is full, and a first
// one that is itself over the cap is cut to fit. A backstop (it takes a 50,000-character
// document about one student to reach), not a product limit.
function fittingPassages(passages: string[]): string[] {
  const kept: string[] = [];
  let length = 0;
  for (const p of passages) {
    const next = length + (kept.length ? 2 : 0) + p.length; // joined with "\n\n"
    if (next > MAX_BODY_CHARS) {
      if (kept.length === 0) kept.push(p.slice(0, MAX_BODY_CHARS).trim());
      break;
    }
    kept.push(p);
    length = next;
  }
  return kept;
}

const documents = new Hono<UserEnv>();

// POST /api/documents?name=…&classIds=a,b[&modified=…][&as=course|students|both] with the
// file as the body. A bad query, an unknown class, or students with no model are refused
// up front with an ordinary JSON error. Otherwise the answer streams as newline-delimited
// JSON: a { step, done? } line as each step starts and ends, so the teacher sees what a
// minute-long import is doing, then one { status, result } or { status, error } line.
// result is { name, kind, classIds, materials, notes, replaced, splitFailed? }; status is
// 201 when anything was written, 200 when the document named nobody, 400 when the file
// cannot be read. A document of students whose split fails is a 502 with nothing written;
// one of both kinds keeps its material and says splitFailed.
documents.post("/", validate("query", documentQuery), uploadLimit, async (c) => {
  const { name, classIds, as } = c.req.valid("query");
  const db = c.var.db;
  const access = await modelAccess(c);
  if (as === "students" && !access.client) {
    // Checked before the file is read: without the model there is nothing to do with it. An
    // account over its spend cap is told so; a missing key reads as an unreadable file.
    if (access.reason !== "no_key") throw access.denied;
    console.warn("ANTHROPIC_API_KEY is not set; document not imported", name);
    throw unreadable();
  }
  const uid = c.var.user.id;
  await Promise.all(classIds.map((id) => requireClass(db, uid, id)));
  // A demo visitor with no notes left is told before the file is read or the model asked;
  // what the import would write is counted at the save.
  await assertAllowance(db, c.var.user, "notes");

  c.header("content-type", "application/x-ndjson");
  return stream(c, async (out) => {
    const send = (line: DocumentProgress) => out.write(`${JSON.stringify(line)}\n`);
    try {
      const { status, result } = await importDocument(c.req.valid("query"), db, c.var.user, access.client, () => readUpload(c, name), send);
      await send({ status, result });
    } catch (err) {
      // Past the first byte the HTTP status is spent, so failures travel in the last line.
      if (err instanceof HTTPException) await send({ status: err.status, error: err.message });
      else {
        console.error("document import failed", name, err);
        await send({ status: 500, error: "internal error" });
      }
    }
  });
});

// The import itself, reporting each step through `send` as it starts and ends.
async function importDocument(
  { name, classIds, modified, as }: z.infer<typeof documentQuery>,
  db: Db,
  user: User,
  client: Anthropic | null,
  read: () => Promise<string>,
  send: (line: DocumentProgress) => Promise<unknown>,
): Promise<{ status: 200 | 201; result: DocumentImportResult }> {
  const userId = user.id;
  const step = async <T>(id: DocumentStep, work: () => Promise<T>): Promise<T> => {
    await send({ step: id });
    const value = await work();
    await send({ step: id, done: true });
    return value;
  };
  const text = await step("read", read);
  const kind = as ?? (await step("sort", () => sort(client, name, text)));
  const wantsMaterial = kind !== "students";
  const wantsNotes = kind !== "course";

  const [summary, parts] = await Promise.all([
    wantsMaterial ? step("summarise", () => summarise(client, name, text)) : null,
    wantsNotes ? step("split", () => split(db, userId, client, name, text, classIds)) : null,
  ]);
  // A document only of students has no value uncut, so a failed split writes nothing.
  if (kind === "students" && !parts) throw unreadable();
  const splitFailed = wantsNotes && !parts;

  const now = new Date().toISOString();
  const inserts: BatchItem<"sqlite">[] = [];

  const materials: MaterialRow[] = [];
  if (wantsMaterial) {
    for (const classId of classIds) {
      const row = { id: crypto.randomUUID(), classId, name, text, summary, createdAt: now };
      inserts.push(db.insert(schema.classMaterials).values(row));
      const { text: _text, ...listed } = row;
      materials.push(listed);
    }
  }

  const written: NoteWithTags[] = [];
  if (parts) {
    // A date the document states is stored at noon UTC so it shows as that day everywhere.
    const notedAt = parts.documentDate ? `${parts.documentDate}T12:00:00.000Z` : (modified ?? now);
    const reportNote = (quotes: string[], classId?: string) =>
      noteRow({ ownerId: userId, classId, kind: "progress_report", body: quotes.join("\n\n"), sourceName: name, notedAt }, now);
    // An entry whose passages could not be verified has no evidence and gets no note.
    for (const s of parts.students) {
      const quotes = fittingPassages(s.quotes);
      if (quotes.length === 0) continue;
      const note = reportNote(quotes, s.classId);
      inserts.push(db.insert(schema.notes).values(note), db.insert(schema.noteStudents).values({ noteId: note.id, studentId: s.studentId, quotes }));
      written.push({ ...note, students: [{ studentId: s.studentId, quotes }], mentions: [] });
    }
    for (const m of parts.mentions) {
      const quotes = fittingPassages(m.quotes);
      if (quotes.length === 0) continue;
      const note = reportNote(quotes);
      const mention = mentionRow(note.id, { ...m, quotes }, now);
      inserts.push(db.insert(schema.notes).values(note), db.insert(schema.noteMentions).values(mention));
      written.push({ ...note, students: [], mentions: [{ id: mention.id, mentionText: mention.mentionText, quotes, candidateIds: mention.candidateIds }] });
    }
  }

  // What this file made before in the picked classes: its notes there, and the notes of names
  // it could not settle, which have no class and belong here when a candidate is in a picked
  // class. A failed split leaves the earlier notes where they are.
  const n = schema.notes;
  const m = schema.noteMentions;
  const pickedStudents = db.select({ id: schema.students.id }).from(schema.students).where(inArray(schema.students.classId, classIds));
  const unsettled = db
    .select({ id: m.noteId })
    .from(m)
    .where(sql`exists (select 1 from json_each(${m.candidateIds}) where json_each.value in ${pickedStudents})`);
  const earlierNotes = and(
    eq(n.ownerId, userId),
    eq(n.sourceName, name),
    eq(n.kind, "progress_report"),
    or(inArray(n.classId, classIds), and(isNull(n.classId), inArray(n.id, unsettled))),
  );
  const removeNotes = db
    .delete(n)
    .where(splitFailed ? sql`false` : earlierNotes)
    .returning({ id: n.id });
  const removeMaterials = db.delete(schema.classMaterials).where(and(eq(schema.classMaterials.name, name), inArray(schema.classMaterials.classId, classIds)));

  // One transaction: the earlier set goes even when this import found nobody, because the
  // file is what the teacher just said these classes should hold. A demo visitor's allowance
  // pays for the notes written plus one for a course document, however many classes it went
  // to; the notes an earlier import made are not given back.
  const counted = written.length + (wantsMaterial ? 1 : 0);
  await reserve(db, user, "notes", counted);
  const [deleted] = await step("save", () => db.batch([removeNotes, removeMaterials, ...inserts])).catch(async (err: unknown) => {
    await refund(db, user, "notes", counted);
    throw err;
  });
  const result: DocumentImportResult = { name, kind, classIds, materials, notes: written, replaced: deleted.map((r) => r.id), ...(splitFailed && { splitFailed: true }) };
  return { status: materials.length + written.length > 0 ? 201 : 200, result };
}

export default documents;
