import { useEffect, useRef, useState } from "react";
import { messageOf } from "./api";

// Saves a value a moment after the last edit, and at once on `flush` (a blur, a close), when
// the key changes (another student, a regenerated summary) or when the component goes, so
// an edit is never lost to navigation. The saved and error state belong to the key on
// screen: a save that lands after the key moved on changes nothing shown.
export const SAVE_AFTER_MS = 800;

export function useAutosave<T>(key: string | null, save: (value: T, key: string) => Promise<unknown>) {
  // The key with an edit not yet saved, and the key whose last save failed.
  const [unsaved, setUnsaved] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    pending.current?.();
  }, [key]);
  useEffect(() => () => pending.current?.(), []);

  function run(value: T, forKey: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    save(value, forKey)
      .then(() => {
        setUnsaved((u) => (u === forKey ? null : u));
        setFailed((f) => (f?.key === forKey ? null : f));
      })
      .catch((e) => setFailed({ key: forKey, message: messageOf(e) }));
  }

  function edit(value: T) {
    if (!key) return;
    const forKey = key;
    setUnsaved(forKey);
    if (timer.current) clearTimeout(timer.current);
    pending.current = () => run(value, forKey);
    timer.current = setTimeout(pending.current, SAVE_AFTER_MS);
  }

  const flush = () => pending.current?.();

  return { saved: unsaved !== key, error: failed && failed.key === key ? failed.message : null, edit, flush };
}
