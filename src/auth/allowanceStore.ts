import { createContext, useCallback, useContext, useState } from "react";
import type { AiAllowance, DemoAllowance, SessionUser } from "../../worker/api-types";
import { api } from "../api";

// What the account has left, where every screen can read it: a demo visitor's allowance
// (null for a teacher) and where the account stands against the AI spend cap. The server
// does the counting: after anything that might have spent some (a note sent, a summary
// made, a document imported, or one of those refused), it is asked again rather than
// guessed. Seeded once: the shell that holds this is mounted fresh for each sign-in
// (src/App.tsx).
export type AllowanceStore = { demo: DemoAllowance | null; ai: AiAllowance; refreshAllowance: () => void };

const FRESH: AiAllowance = { spentUsd: 0, capUsd: 0, off: null };
export const AllowanceContext = createContext<AllowanceStore>({ demo: null, ai: FRESH, refreshAllowance: () => {} });

export function useAllowanceStore(user: SessionUser | null): AllowanceStore {
  const [state, setState] = useState(() => ({ demo: user?.demo ?? null, ai: user?.ai ?? FRESH }));
  const refreshAllowance = useCallback(() => {
    if (!user) return;
    api<SessionUser>("/api/auth/me")
      .then((u) => setState({ demo: u.demo, ai: u.ai }))
      .catch(() => {});
  }, [user]);
  return { ...state, refreshAllowance };
}

export const useAllowance = () => useContext(AllowanceContext);
