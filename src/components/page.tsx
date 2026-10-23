import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Link } from "react-router";

// The big heading every screen starts with, and an optional line of context above it.
export function PageTitle({ eyebrow, children }: { eyebrow?: ReactNode; children: ReactNode }) {
  return (
    <div>
      {eyebrow && <p className="text-[13px] font-semibold text-muted-foreground">{eyebrow}</p>}
      <h1 className="mt-0.5 text-[30px] leading-tight font-extrabold tracking-[-0.03em] md:text-[34px]">{children}</h1>
    </div>
  );
}

// "‹ Classes": the way up one level. The browser's back button works too, since every
// screen has its own URL.
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex min-h-9 items-center gap-0.5 pr-2 text-sm font-bold text-accent-foreground hover:underline">
      <ChevronLeft className="size-4" aria-hidden />
      {children}
    </Link>
  );
}
