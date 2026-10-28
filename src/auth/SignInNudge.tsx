import type { ReactNode } from "react";
import type { VariantProps } from "class-variance-authority";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The way on when the demo's allowance is spent, in place of a Generate button. A link, not
// a button: signing in is a navigation to Google. Signing in starts fresh with the teacher's
// own classes; the demo copy is not carried over, and the words say so.
export function SignInNudge({
  variant = "outline",
  size,
  className,
  children = "Sign in with Google to use your own classes",
}: VariantProps<typeof buttonVariants> & { className?: string; children?: ReactNode }) {
  return (
    <a href="/api/auth/google" className={cn(buttonVariants({ variant, size }), className)}>
      {children}
    </a>
  );
}
