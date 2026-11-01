import type { ComponentProps } from "react";
import { AiPaused } from "./AiPaused";
import { SignInNudge } from "./SignInNudge";
import { useAllowance } from "./allowanceStore";

// What stands where a Generate button was when no fresh summary can be made (the store's
// `capped`): the AI is paused, so nothing to press; or a demo visitor has used their
// summaries, so the way on is to sign in. `short` is the few-word form for a roster row;
// `nudge` styles the sign-in link where its default does not fit.
export function CappedNotice({ short, className, nudge }: { short?: boolean; className?: string; nudge?: ComponentProps<typeof SignInNudge> }) {
  const { ai } = useAllowance();
  if (ai.off) return <AiPaused off={ai.off} short={short} className={className} />;
  return (
    <SignInNudge className={className} {...nudge}>
      {short ? "Sign in" : undefined}
    </SignInNudge>
  );
}
