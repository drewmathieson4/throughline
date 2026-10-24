import { cn } from "@/lib/utils";
import { freshness, freshStyles } from "./fresh";

// "3 days ago" in the colour of how quiet the student has been; see fresh.ts.
export default function FreshPill({ lastNotedAt, prefix = "" }: { lastNotedAt: string | null; prefix?: string }) {
  const { label, tone } = freshness(lastNotedAt);
  return (
    <span className={cn("inline-flex flex-none items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold", freshStyles[tone].pill)}>
      <span aria-hidden className={cn("size-[7px] rounded-full", freshStyles[tone].dot)} />
      {prefix}
      {label}
    </span>
  );
}
