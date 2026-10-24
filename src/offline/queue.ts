// The offline queue. Every text and voice note waits here until the server has it, so a note
// captured with no signal stays on the device and uploads later. Pure logic: the storage
// (IndexedDB in the browser, store.ts) and the send are passed in, so the rules run in Node.
import type { TaggedNoteResponse } from "../../worker/api-types";
import { ApiError } from "../api";

/** A captured note the server does not have yet. clientId is minted at capture, so a resend finds the note it made. */
export type QueuedNote = { clientId: string; notedAt: string } & ({ kind: "text"; body: string } | { kind: "voice"; audio: ArrayBuffer; type: string });

export type QueueStore = {
  all: () => Promise<QueuedNote[]>;
  put: (note: QueuedNote) => Promise<void>;
  remove: (clientId: string) => Promise<void>;
};

/** What became of a queued note: on the server, refused by it, or still waiting on the device. */
export type Outcome = { status: "sent"; note: TaggedNoteResponse } | { status: "refused"; error: string } | { status: "waiting" };
export type Settled = Exclude<Outcome, { status: "waiting" }>;

type Options = {
  store: QueueStore;
  send: (note: QueuedNote) => Promise<TaggedNoteResponse>;
  online: () => boolean;
  /** Each note the server took or refused. `awaited`: the add() that queued it is still waiting and reports it itself. */
  onSettled: (note: QueuedNote, outcome: Settled, awaited: boolean) => void;
  /** How many notes are waiting, after each change. */
  onCount: (waiting: number) => void;
};

// Refusals that keep the note for later: signed out, timed out, rate limited. Any other 4xx
// is about the note itself (nothing was heard, too long), and sending it again cannot help.
const RETRY = new Set([401, 408, 429]);

export function createQueue({ store, send, online, onSettled, onCount }: Options) {
  // add() calls waiting on their own note, by clientId.
  const waiters = new Map<string, (outcome: Outcome) => void>();
  let running: Promise<void> | null = null;
  let again = false;

  const count = () =>
    store.all().then(
      (all) => onCount(all.length),
      () => {},
    );

  function settle(note: QueuedNote, outcome: Settled) {
    const resolve = waiters.get(note.clientId);
    waiters.delete(note.clientId);
    onSettled(note, outcome, resolve !== undefined);
    resolve?.(outcome);
  }

  // One pass, oldest first. A fetch that never reached the server ends it, since the rest
  // would fail the same way; a server error skips only that note.
  async function pass() {
    const queued = (await store.all()).sort((a, b) => a.notedAt.localeCompare(b.notedAt));
    for (const note of queued) {
      if (!online()) return;
      let outcome: Settled;
      try {
        outcome = { status: "sent", note: await send(note) };
      } catch (e) {
        if (!(e instanceof ApiError)) return;
        if (e.status >= 500 || RETRY.has(e.status)) continue;
        outcome = { status: "refused", error: e.message };
      }
      await store.remove(note.clientId);
      settle(note, outcome);
      await count();
    }
  }

  // Send everything waiting. A call during a pass joins it and asks for one more pass, so a
  // note queued meanwhile goes too; nothing is sent twice at once.
  function flush(): Promise<void> {
    again = true;
    running ??= (async () => {
      try {
        while (again) {
          again = false;
          await pass();
        }
      } catch (e) {
        console.error("offline queue flush failed", e);
      } finally {
        running = null;
        for (const resolve of waiters.values()) resolve({ status: "waiting" });
        waiters.clear();
      }
    })();
    return running;
  }

  // Queue a note and try to send it now. Resolves once this note is sent, refused, or left
  // waiting (offline, or the send failed).
  async function add(note: QueuedNote): Promise<Outcome> {
    try {
      await store.put(note);
    } catch (e) {
      // No storage on this device (a locked-down browser): send it straight away, as before
      // there was a queue. A failed fetch then rejects and the caller says so.
      console.error("offline queue unavailable", e);
      let outcome: Settled;
      try {
        outcome = { status: "sent", note: await send(note) };
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        outcome = { status: "refused", error: e.message };
      }
      onSettled(note, outcome, true);
      return outcome;
    }
    await count();
    if (!online()) return { status: "waiting" };
    const outcome = new Promise<Outcome>((resolve) => waiters.set(note.clientId, resolve));
    void flush();
    return outcome;
  }

  return { add, flush, count };
}

export type Queue = ReturnType<typeof createQueue>;
