import { useState } from "react";
import { toast } from "sonner";
import type { DocumentImportResult, NoteWithTags, TaggedNoteResponse } from "../../worker/api-types";
import { api, fileInit, jsonInit, messageOf } from "../api";
import { mmss, plural } from "../ui";
import { useRecorder } from "../useRecorder";
import { useNotes, type Person } from "./notesStore";

export const MAX_RECORDING_MS = 5 * 60 * 1000;
export const LIMIT_MESSAGE = `Reached the ${mmss(MAX_RECORDING_MS)} limit; this part was saved.`;

/** A note just saved by text or voice. `failed`: saved, but tagging did not run. */
export type SavedNote = { note: NoteWithTags; failed: boolean; hitLimit: boolean };

const andList = new Intl.ListFormat(undefined, { type: "conjunction" });

// The one-line summary after a save: who it went to, or why nobody.
function savedMessage({ note, failed }: SavedNote, people: Map<string, Person>) {
  const saved = note.kind === "voice" ? "Voice note saved" : "Saved";
  if (failed) return `${saved}, but tagging did not run. Use + Tag to add students.`;
  const names = note.students.map((s) => people.get(s.studentId)?.first ?? "a student");
  const parts = [saved];
  if (names.length > 0) parts.push(`tagged to ${andList.format(names)}`);
  if (note.mentions.length > 0) parts.push(`not sure who ${andList.format(note.mentions.map((m) => `“${m.mentionText}”`))} is`);
  if (parts.length > 1) return parts.join(" · ");
  return note.classId ? `${saved} as a class note` : `${saved} · no students named`;
}

// Text, voice and document saves for the Notes screen. They never overlap, so `pending` says
// which one is running. A voice note is saved the moment the recording stops: there is no
// review step. onSaved returns true when the caller shows the result itself (the phone's
// Saved sheet); otherwise a toast says what happened.
export function useCapture({ onSaved }: { onSaved: (saved: SavedNote) => boolean }) {
  const { add, people } = useNotes();
  const [pending, setPending] = useState<"text" | "voice" | "document" | null>(null);

  // Runs one save. False means it failed and a toast said why.
  async function run(kind: NonNullable<typeof pending>, fn: () => Promise<void>) {
    setPending(kind);
    try {
      await fn();
      return true;
    } catch (e) {
      toast.error(messageOf(e));
      return false;
    } finally {
      setPending(null);
    }
  }

  const save = (kind: "text" | "voice", url: string, init: RequestInit, hitLimit = false) =>
    run(kind, async () => {
      const { tagging, ...note } = await api<TaggedNoteResponse>(url, init);
      add([note]);
      const saved = { note, failed: tagging === "failed", hitLimit };
      if (onSaved(saved)) return;
      if (saved.failed) toast.warning(savedMessage(saved, people));
      else toast.success(savedMessage(saved, people));
      if (hitLimit) toast.warning(LIMIT_MESSAGE);
    });

  const recorder = useRecorder({
    maxMs: MAX_RECORDING_MS,
    onStop: ({ audio, hitLimit }) => save("voice", "/api/notes/voice", fileInit(audio), hitLimit),
  });

  async function record() {
    try {
      await recorder.start();
    } catch (e) {
      // Usually "Permission denied": the browser blocked the mic.
      toast.error(`Could not start recording: ${messageOf(e)}`);
    }
  }

  // The typed note, shared by the laptop's capture card and the phone's Record screen, so a
  // half-typed note survives the phone moving between /notes and /notes/feed.
  const [draft, setDraft] = useState("");
  async function saveDraft() {
    if (pending || recorder.recording || !draft.trim()) return;
    if (await save("text", "/api/notes", jsonInit("POST", { body: draft }))) setDraft("");
  }

  // An uploaded document (an old progress report) becomes one note per student it is about.
  const upload = (file: File) =>
    run("document", async () => {
      const query = new URLSearchParams({ name: file.name });
      // The file's own date is the fallback for notes from a document that states none.
      if (file.lastModified > 0 && file.lastModified <= Date.now()) query.set("modified", new Date(file.lastModified).toISOString());
      const result = await api<DocumentImportResult>(`/api/notes/document?${query}`, fileInit(file));
      add(result.notes, result.replaced);
      const unsure = result.notes.filter((n) => n.mentions.length > 0).length;
      const made =
        result.notes.length === 0
          ? `No students from your roster were named in ${result.name}.`
          : `Made ${plural(result.notes.length, "note")} from ${result.name}${unsure > 0 ? `, ${plural(unsure, "name")} unsure` : ""}.`;
      toast.success(result.replaced.length > 0 ? `${made} Replaced ${plural(result.replaced.length, "note")} made from it earlier.` : made);
    });

  return { pending, recorder, record, draft, setDraft, saveDraft, upload };
}

export type Capture = ReturnType<typeof useCapture>;
