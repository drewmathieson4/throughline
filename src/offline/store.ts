// Where queued notes wait: one IndexedDB object store keyed by clientId. IndexedDB because
// it keeps binary audio and survives a reload or a closed app; localStorage holds only
// strings and a few MB. Kept thin, since it only runs in a browser; the rules are in queue.ts.
import type { QueuedNote, QueueStore } from "./queue";

const DB_NAME = "throughline";
const STORE = "queued-notes";

let opened: Promise<IDBDatabase> | null = null;
function open() {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "clientId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => {
    // Try again next time rather than remember the failure.
    opened = null;
    throw e;
  });
  return opened;
}

// One request in its own transaction, resolved once the transaction has committed.
async function run<T>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = request(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export const idbStore: QueueStore = {
  all: () => run("readonly", (s) => s.getAll() as IDBRequest<QueuedNote[]>),
  put: async (note) => void (await run("readwrite", (s) => s.put(note))),
  remove: async (clientId) => void (await run("readwrite", (s) => s.delete(clientId))),
};
