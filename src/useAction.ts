import { useState } from "react";
import { messageOf } from "./api";

// The busy flag and error message every form keeps around one request. `run` never
// throws: a failure lands in `error` for the form to show, and `run` resolves false so the
// caller can skip its on-success step (closing a form, clearing a draft).
export function useAction<A extends unknown[]>(fn: (...args: A) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(...args: A): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await fn(...args);
      return true;
    } catch (e) {
      setError(messageOf(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}
