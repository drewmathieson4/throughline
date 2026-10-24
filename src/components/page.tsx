import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Link } from "react-router";

// The big heading's type, for the screens that lay their own h1 out beside an avatar.
export const titleText = "text-[30px] leading-tight font-extrabold tracking-[-0.03em] md:text-[34px]";

// The big heading every screen starts with, and an optional line of context above it.
export function PageTitle({ eyebrow, children }: { eyebrow?: ReactNode; children: ReactNode }) {
  return (
    <div>
      {eyebrow && <p className="text-[13px] font-semibold text-muted-foreground">{eyebrow}</p>}
      <h1 className={`mt-0.5 ${titleText}`}>{children}</h1>
    </div>
  );
}

// The wave in the Throughline mark; the tile around it is the caller's.
export function LogoWave({ className, strokeWidth = 2 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 15c3 0 3-6 6-6s3 6 6 6 3-6 6-6" />
    </svg>
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
