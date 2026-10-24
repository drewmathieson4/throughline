// The rows for a new note and its open mentions, shared by the routes that write notes: a
// typed or spoken note (routes/notes.ts) and the notes a document of reports becomes
// (routes/documents.ts). The one place that mints note ids and timestamps.
import * as schema from "./db/schema";
import type { Note } from "./db/schema";
import type { OpenMention } from "./tagging";

// Shared by text, voice and document notes. A backstop, not a product limit: a five-minute
// clip transcribes to roughly 5,000 characters. See DECISIONS.md.
export const MAX_BODY_CHARS = 50_000;

// A classId, when given, has already been checked with requireClass by the route.
export type NoteValues = { classId?: string | null; kind: schema.NoteKind; body: string; notedAt?: string; sourceName?: string };
export function noteRow(values: NoteValues, now = new Date().toISOString()): Note {
  return {
    id: crypto.randomUUID(),
    classId: values.classId ?? null,
    kind: values.kind,
    body: values.body,
    audioKey: null,
    sourceName: values.sourceName ?? null,
    notedAt: values.notedAt ?? now,
    createdAt: now,
  };
}

export const mentionRow = (noteId: string, m: OpenMention, now: string) => ({ id: crypto.randomUUID(), noteId, mentionText: m.mentionText, quotes: m.quotes, candidateIds: m.candidateIds, createdAt: now });
