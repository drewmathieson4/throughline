import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

// What the sign-in callback says to an email that is not on the allowlist (worker/allowlist.ts).
// It names Drew's address because the link may reach someone nobody invited (a resume reader).
export const CONTACT_EMAIL = "drewmathieson4@gmail.com";
const PRIVATE_TRIAL = `Throughline is a private trial. To be added, email Drew at ${CONTACT_EMAIL} from your Google address.`;

// A refused sign-in comes back as ?signin=private. The notice is read once and the query
// dropped from the address bar, so a reload or a shared link does not carry it. Both the
// sign-in screen and the app read it: a demo visitor who tried Google from inside the app
// still holds their demo session, so they land back in the app, not on the sign-in screen.
export function useSignInNotice(): string | null {
  const [params, setParams] = useSearchParams();
  const [notice] = useState(() => (params.get("signin") === "private" ? PRIVATE_TRIAL : null));
  useEffect(() => {
    if (params.has("signin")) setParams(new URLSearchParams(), { replace: true });
  }, [params, setParams]);
  return notice;
}
