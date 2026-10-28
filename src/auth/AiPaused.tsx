import type { AiAllowance } from "../../worker/api-types";
import { cn } from "@/lib/utils";

// What stands where a Generate button was once the models are switched off: this account
// has used its AI allowance, or the whole app has. Nothing to press; the reset is Drew's.
// `short` is the few-word form for a roster row.
export function AiPaused({ off, short, className }: { off: NonNullable<AiAllowance["off"]>; short?: boolean; className?: string }) {
  const text = short ? (off === "account" ? "AI paused" : "AI paused for now") : off === "account" ? "AI is paused for this account. Ask Drew to reset it." : "Throughline's AI budget is used up for now. Ask Drew.";
  return <p className={cn("flex items-center text-[13px] font-bold text-muted-foreground", className)}>{text}</p>;
}
