import { useState } from "react";
import { toast } from "sonner";
import type { NoteWithTags } from "../../worker/api-types";
import { messageOf } from "../api";
import type { QueuedNote } from "../offline/queue";
import { mmss } from "../ui";
import { useRecorder } from "../useRecorder";
import { useNotes, type Person } from "./notesStore";

export const MAX_RECORDING_MS = 5 * 60 * 1000;
export const LIMIT_MESSAGE = `Reached the ${mmss(MAX_RECORDING_MS)} limit; this part was saved.`;
const WAITING_MESSAGE = "Saved. Uploads when you're back online";

// randomUUID exists only on https and localhost; a phone testing over the LAN gets the same
// v4 shape from getRandomValues.
const uuid = () =>
  crypto.randomUUID?.() ?? "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (+c / 4)))).toString(16));

// A note's identity, fixed the moment it is captured: the id a resend is recognised by, and
// when it happened (a voice note's is when recording started), however late it uploads.
const captured = (at: number) => ({ clientId: uuid(), notedAt: new Date(at).toISOString() });

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

// Text and voice saves for the Notes screen. They never overlap, so `pending` says which one
// is running. A voice note is saved the moment the recording stops: there is no
// review step. onSaved returns true when the caller shows the result itself (the phone's
// Saved sheet); otherwise a toast says what happened.
export function useCapture({ onSaved }: { onSaved: (saved: SavedNote) => boolean }) {
  const { people, queueNote } = useNotes();
  const [pending, setPending] = useState<"text" | "voice" | null>(null);

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

  // Every text and voice note goes through the offline queue, which sends it now when it can
  // (and the store adds it to the list). With no connection it waits on the device, and the
  // save still finishes at once.
  const save = (kind: "text" | "voice", queued: () => Promise<QueuedNote>, hitLimit = false) =>
    run(kind, async () => {
      const outcome = await queueNote(await queued());
      if (outcome.status === "refused") throw new Error(outcome.error);
      if (outcome.status === "waiting") toast.success(WAITING_MESSAGE);
      else {
        const { tagging, ...note } = outcome.note;
        const saved = { note, failed: tagging === "failed", hitLimit };
        if (onSaved(saved)) return;
        if (saved.failed) toast.warning(savedMessage(saved, people));
        else toast.success(savedMessage(saved, people));
      }
      if (hitLimit) toast.warning(LIMIT_MESSAGE);
    });

  const recorder = useRecorder({
    maxMs: MAX_RECORDING_MS,
    onStop: ({ audio, hitLimit, startedAt }) =>
      save("voice", async () => ({ ...captured(startedAt), kind: "voice", audio: await audio.arrayBuffer(), type: audio.type }), hitLimit),
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
    if (await save("text", async () => ({ ...captured(Date.now()), kind: "text", body: draft }))) setDraft("");
  }

  return { pending, recorder, record, draft, setDraft, saveDraft };
}

export type Capture = ReturnType<typeof useCapture>;
