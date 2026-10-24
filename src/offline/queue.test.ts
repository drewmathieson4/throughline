import { describe, expect, it, vi } from "vitest";
import type { TaggedNoteResponse } from "../../worker/api-types";
import { ApiError } from "../api";
import { createQueue, type QueuedNote, type QueueStore } from "./queue";

const text = (clientId: string, notedAt: string): QueuedNote => ({ clientId, notedAt, kind: "text", body: clientId });

// IndexedDB stand-in: a Map, in insertion order.
function memoryStore(initial: QueuedNote[] = []): QueueStore & { ids: () => string[] } {
  const rows = new Map(initial.map((n) => [n.clientId, n]));
  return {
    all: async () => [...rows.values()],
    put: async (n) => void rows.set(n.clientId, n),
    remove: async (id) => void rows.delete(id),
    ids: () => [...rows.keys()],
  };
}

// The server's reply for a note: only the id matters to the queue.
const reply = (n: QueuedNote) => ({ id: `note-${n.clientId}` }) as TaggedNoteResponse;

function setup({ initial = [] as QueuedNote[], online = true, send = async (n: QueuedNote) => reply(n) } = {}) {
  const store = memoryStore(initial);
  const state = { online };
  const sent = vi.fn(send);
  const onSettled = vi.fn();
  const counts: number[] = [];
  const queue = createQueue({ store, send: sent, online: () => state.online, onSettled, onCount: (n) => counts.push(n) });
  return { queue, store, state, sent, onSettled, counts };
}

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

describe("createQueue", () => {
  it("sends a note added online and reports it to the add that queued it", async () => {
    const { queue, store, onSettled, counts } = setup();
    const note = text("a", "2026-10-24T09:00:00.000Z");
    expect(await queue.add(note)).toEqual({ status: "sent", note: reply(note) });
    expect(store.ids()).toEqual([]);
    expect(onSettled).toHaveBeenCalledWith(note, { status: "sent", note: reply(note) }, true);
    expect(counts).toEqual([1, 0]);
  });

  it("keeps a note added offline without trying, then sends the queue oldest first", async () => {
    const { queue, state, sent, store } = setup({ online: false });
    expect(await queue.add(text("late", "2026-10-24T10:00:00.000Z"))).toEqual({ status: "waiting" });
    expect(await queue.add(text("early", "2026-10-24T09:00:00.000Z"))).toEqual({ status: "waiting" });
    expect(sent).not.toHaveBeenCalled();

    state.online = true;
    await queue.flush();
    expect(sent.mock.calls.map(([n]) => n.clientId)).toEqual(["early", "late"]);
    expect(store.ids()).toEqual([]);
  });

  it("stops at a fetch that never reached the server and keeps everything", async () => {
    const { queue, sent, store } = setup({ initial: [text("a", "2026-10-24T09:00:00.000Z")], send: offline });
    expect(await queue.add(text("b", "2026-10-24T10:00:00.000Z"))).toEqual({ status: "waiting" });
    expect(sent).toHaveBeenCalledTimes(1);
    expect(store.ids()).toEqual(["a", "b"]);
  });

  it("drops a note the server refuses and passes on its message", async () => {
    const { queue, store, onSettled } = setup({
      initial: [text("old", "2026-10-24T08:00:00.000Z")],
      send: async (n) => {
        if (n.clientId === "old") throw new ApiError("nothing was heard", 400);
        return reply(n);
      },
    });
    const note = text("new", "2026-10-24T09:00:00.000Z");
    expect(await queue.add(note)).toEqual({ status: "sent", note: reply(note) });
    expect(store.ids()).toEqual([]);
    // Nobody was waiting on the old note, so the caller toasts the refusal itself.
    expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ clientId: "old" }), { status: "refused", error: "nothing was heard" }, false);
  });

  it("keeps a note on a server error or a rate limit and still sends the rest", async () => {
    const { queue, store, sent } = setup({
      initial: [text("broken", "2026-10-24T08:00:00.000Z"), text("limited", "2026-10-24T08:30:00.000Z")],
      send: async (n) => {
        if (n.clientId === "broken") throw new ApiError("transcription failed", 502);
        if (n.clientId === "limited") throw new ApiError("Daily limit reached", 429);
        return reply(n);
      },
    });
    const note = text("fine", "2026-10-24T09:00:00.000Z");
    expect(await queue.add(note)).toEqual({ status: "sent", note: reply(note) });
    expect(sent).toHaveBeenCalledTimes(3);
    expect(store.ids()).toEqual(["broken", "limited"]);
  });

  it("never sends a note twice when flushes overlap, and picks up a note added mid-flush", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { queue, sent } = setup({
      initial: [text("a", "2026-10-24T09:00:00.000Z")],
      send: async (n) => {
        if (n.clientId === "a") await gate;
        return reply(n);
      },
    });
    const first = queue.flush();
    const second = queue.flush();
    const added = queue.add(text("b", "2026-10-24T10:00:00.000Z"));
    release();
    await Promise.all([first, second]);
    expect((await added).status).toBe("sent");
    expect(sent.mock.calls.map(([n]) => n.clientId)).toEqual(["a", "b"]);
  });

  it("sends straight away when the device has no storage", async () => {
    const { queue, store, onSettled } = setup();
    store.put = () => Promise.reject(new Error("no IndexedDB"));
    const note = text("a", "2026-10-24T09:00:00.000Z");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await queue.add(note)).toEqual({ status: "sent", note: reply(note) });
    expect(onSettled).toHaveBeenCalledWith(note, { status: "sent", note: reply(note) }, true);
    quiet.mockRestore();
  });
});
