import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AiAllowance, DemoAllowance, SessionUser } from "../../worker/api-types";
import { api, onSpent } from "../api";

// What the account has left, where every screen can read it: a demo visitor's allowance
// (null for a teacher), where the account stands against the AI spend cap, and whether fresh
// evidence or a report can be made at all. The server does the counting: after any call that
// might have spent some (src/api.ts), it is asked again rather than guessed. Seeded once: the
// shell that holds this is mounted fresh for each sign-in (src/App.tsx).
export type AllowanceStore = {
  demo: DemoAllowance | null;
  ai: AiAllowance;
  /** No fresh evidence summary can be made: the AI is paused, or a demo visitor has used theirs. */
  capped: boolean;
  /** No report can be written: the AI is paused, or a demo visitor has used theirs. */
  reportsCapped: boolean;
};

const FRESH: AiAllowance = { spentUsd: 0, capUsd: 0, off: null };
export const AllowanceContext = createContext<AllowanceStore>({ demo: null, ai: FRESH, capped: false, reportsCapped: false });

export function useAllowanceStore(user: SessionUser | null): AllowanceStore {
  const [state, setState] = useState(() => ({ demo: user?.demo ?? null, ai: user?.ai ?? FRESH }));
  const refresh = useCallback(() => {
    if (!user) return;
    api<SessionUser>("/api/auth/me")
      .then((u) => setState({ demo: u.demo, ai: u.ai }))
      .catch(() => {});
  }, [user]);
  useEffect(() => {
    onSpent(refresh);
    return () => onSpent(null);
  }, [refresh]);
  return useMemo(
    () => ({ ...state, capped: state.ai.off !== null || state.demo?.evidenceLeft === 0, reportsCapped: state.ai.off !== null || state.demo?.reportsLeft === 0 }),
    [state],
  );
}

export const useAllowance = () => useContext(AllowanceContext);
