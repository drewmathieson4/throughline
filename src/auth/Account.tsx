import { LogOut } from "lucide-react";
import type { SessionUser } from "../../worker/api-types";
import { useNotes } from "../notes/notesStore";
import { allowanceLine, spendLine, waitingToUpload } from "../ui";
import { useAllowance } from "./allowanceStore";
import { SignInNudge } from "./SignInNudge";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { NO_CLASS } from "@/lib/avatar";
import { cn } from "@/lib/utils";

// Google's picture when there is one; initials otherwise. The picture is fetched without a
// referrer, which Google's image host requires.
function AccountAvatar({ user }: { user: SessionUser }) {
  const name = user.name ?? user.email;
  if (!user.pictureUrl) return <Avatar colour={NO_CLASS} name={name} size={36} />;
  return <img src={user.pictureUrl} alt="" referrerPolicy="no-referrer" className="size-9 flex-none rounded-full bg-muted" />;
}

// Who is signed in, with the way out. Sign out waits while captured notes are still on the
// device: they would otherwise upload under whoever signs in next. Nothing is shown when the
// app opened without an answer from the server (offline); the user is unknown until it does.
// A demo visitor sees what they have left and the way to their own account instead; a
// teacher who has spent some of their AI allowance sees how much.
export function AccountCard({ user, onSignOut, className }: { user: SessionUser | null; onSignOut: () => void; className?: string }) {
  const { waiting } = useNotes();
  const { demo, ai } = useAllowance();
  if (!user) return null;
  if (user.demo) {
    return (
      <div className={cn("rounded-[14px] bg-muted px-2.5 py-2", className)}>
        <div className="flex items-center gap-2.5">
          <Avatar colour={NO_CLASS} name="Demo" size={36} />
          <p className="min-w-0 flex-1 truncate text-[13.5px] font-bold">Demo</p>
          <SignInNudge size="sm" className="-mr-0.5">
            Sign in
          </SignInNudge>
        </div>
        <p className="mt-1.5 truncate text-xs text-muted-foreground">{allowanceLine(demo ?? user.demo)}</p>
      </div>
    );
  }
  return (
    <div className={cn("flex items-center gap-2.5 rounded-[14px] bg-muted py-2 pr-1.5 pl-2.5", className)}>
      <AccountAvatar user={user} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-bold">{user.name ?? user.email}</p>
        <p className="truncate text-xs text-muted-foreground">{waiting > 0 ? waitingToUpload(waiting) : ai.spentUsd > 0 ? spendLine(ai) : user.email}</p>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="Sign out" title={waiting > 0 ? "Sign out once the waiting notes upload" : "Sign out"} disabled={waiting > 0} onClick={onSignOut}>
        <LogOut aria-hidden />
      </Button>
    </div>
  );
}
