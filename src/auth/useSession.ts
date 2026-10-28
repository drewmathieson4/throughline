import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "../../worker/api-types";
import { ApiError, api, onUnauthorized } from "../api";

// Who is signed in, as far as the browser can tell. "unknown" is a request that never got an
// answer (no signal, a cached shell opening offline): the app opens anyway, so a note can
// still be captured into the offline queue, and a 401 later turns it into "out".
export type Session = { status: "loading" } | { status: "out" } | { status: "unknown" } | { status: "in"; user: SessionUser };

export function useSession() {
  const [session, setSession] = useState<Session>({ status: "loading" });

  useEffect(() => {
    let current = true;
    api<SessionUser>("/api/auth/me")
      .then((user) => current && setSession({ status: "in", user }))
      .catch((e: unknown) => current && setSession(e instanceof ApiError && e.status === 401 ? { status: "out" } : { status: "unknown" }));
    onUnauthorized(() => setSession({ status: "out" }));
    return () => {
      current = false;
      onUnauthorized(null);
    };
  }, []);

  // The server forgets the session first; the cookie is cleared with the answer. Either way
  // the browser is signed out, so a failed call is not reported.
  const signOut = useCallback(async () => {
    await api("/api/auth/signout", { method: "POST" }).catch(() => {});
    setSession({ status: "out" });
  }, []);

  // The demo: the server makes a visitor's account and its cookie on the spot. A failure
  // (the demo is full) is the caller's to show.
  const startDemo = useCallback(async () => {
    const user = await api<SessionUser>("/api/auth/demo", { method: "POST" });
    setSession({ status: "in", user });
  }, []);

  return { session, signOut, startDemo };
}
