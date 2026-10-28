import { createContext, useCallback, useContext, useState } from "react";
import type { DemoAllowance, SessionUser } from "../../worker/api-types";
import { api } from "../api";

// What a demo visitor has left of the demo's allowance, where every screen can read it.
// The server does the counting: after anything that might have spent some (a note sent, a
// summary made, a document imported, or one of those refused), the count is asked for again
// rather than guessed. null for a teacher. Seeded once: the shell that holds this is mounted
// fresh for each sign-in (src/App.tsx).
export type DemoStore = { demo: DemoAllowance | null; refreshDemo: () => void };

export const DemoContext = createContext<DemoStore>({ demo: null, refreshDemo: () => {} });

export function useDemoStore(user: SessionUser | null): DemoStore {
  const [demo, setDemo] = useState<DemoAllowance | null>(user?.demo ?? null);
  const refreshDemo = useCallback(() => {
    if (!user?.demo) return;
    api<SessionUser>("/api/auth/me")
      .then((u) => setDemo(u.demo))
      .catch(() => {});
  }, [user]);
  return { demo, refreshDemo };
}

export const useDemo = () => useContext(DemoContext);
