import { LogOut } from "lucide-react";
import type { SessionUser } from "../../worker/api-types";
import { useNotes } from "../notes/notesStore";
import { waitingToUpload } from "../ui";
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
export function AccountCard({ user, onSignOut, className }: { user: SessionUser | null; onSignOut: () => void; className?: string }) {
  const { waiting } = useNotes();
  if (!user) return null;
  return (
    <div className={cn("flex items-center gap-2.5 rounded-[14px] bg-muted py-2 pr-1.5 pl-2.5", className)}>
      <AccountAvatar user={user} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-bold">{user.name ?? user.email}</p>
        <p className="truncate text-xs text-muted-foreground">{waiting > 0 ? waitingToUpload(waiting) : user.email}</p>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="Sign out" title={waiting > 0 ? "Sign out once the waiting notes upload" : "Sign out"} disabled={waiting > 0} onClick={onSignOut}>
        <LogOut aria-hidden />
      </Button>
    </div>
  );
}
