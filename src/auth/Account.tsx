import { useState } from "react";
import { Ellipsis } from "lucide-react";
import type { SessionUser } from "../../worker/api-types";
import { useNotes } from "../notes/notesStore";
import { allowanceLine, errorText, spendLine, waitingToUpload } from "../ui";
import { useAction } from "../useAction";
import { useAllowance } from "./allowanceStore";
import { SignInNudge } from "./SignInNudge";
import { Avatar } from "@/components/Avatar";
import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NO_CLASS } from "@/lib/avatar";
import { cn } from "@/lib/utils";

// Google's picture when there is one; initials otherwise. The picture is fetched without a
// referrer, which Google's image host requires.
function AccountAvatar({ user }: { user: SessionUser }) {
  const name = user.name ?? user.email;
  if (!user.pictureUrl) return <Avatar colour={NO_CLASS} name={name} size={36} />;
  return <img src={user.pictureUrl} alt="" referrerPolicy="no-referrer" className="size-9 flex-none rounded-full bg-muted" />;
}

// Who is signed in, with the way out: a menu with Sign out and Delete account. Both wait
// while captured notes are still on the device: they would otherwise upload under whoever
// signs in next. Nothing is shown when the app opened without an answer from the server
// (offline); the user is unknown until it does. A demo visitor sees what they have left and
// the way to their own account instead; a teacher who has spent some of their AI allowance
// sees how much.
export function AccountCard({ user, onSignOut, onDeleteAccount, className }: { user: SessionUser | null; onSignOut: () => void; onDeleteAccount: () => Promise<void>; className?: string }) {
  const { waiting } = useNotes();
  const { demo, ai } = useAllowance();
  const [deleting, setDeleting] = useState(false);
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
      {/* Not modal: the menu opens the delete window, and a modal menu closing under a
          dialog can leave the page unclickable. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Account actions">
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto">
          <DropdownMenuItem onSelect={onSignOut} disabled={waiting > 0}>
            Sign out
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)} disabled={waiting > 0}>
            Delete account
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteAccountPanel key={String(deleting)} open={deleting} user={user} onClose={() => setDeleting(false)} onDelete={onDeleteAccount} />
    </div>
  );
}

// The one typed confirmation in the app: the teacher's email, because nothing is bigger
// than this and nothing brings it back. Keyed by whether it is open, so each opening starts
// empty. A success signs the browser out, so there is nothing to close.
function DeleteAccountPanel({ open, user, onClose, onDelete }: { open: boolean; user: SessionUser; onClose: () => void; onDelete: () => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const { run, busy, error } = useAction(onDelete);
  const matches = typed.trim().toLowerCase() === user.email.toLowerCase();

  return (
    <Panel open={open} onOpenChange={(o) => !o && onClose()} title="Delete your account?">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (matches) void run();
        }}
        className="mt-2 flex flex-col gap-3"
      >
        <p className="text-sm text-secondary-foreground">Every class, note, grade, evidence and report is deleted now. There is no undo.</p>
        <Label>
          Type {user.email} to confirm
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        </Label>
        {error && <p className={errorText}>{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={busy || !matches}>
            {busy ? "Deleting…" : "Delete account"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
