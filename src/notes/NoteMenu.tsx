import { useState } from "react";
import { Ellipsis } from "lucide-react";
import { toast } from "sonner";
import type { NoteWithTags, TaggedNoteResponse } from "../../worker/api-types";
import { api, jsonInit } from "../api";
import { errorText } from "../ui";
import { useAction } from "../useAction";
import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useNotes } from "./notesStore";

// What a datetime-local input shows for an instant: local wall-clock time to the minute.
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The "…" on a note card: Edit opens a window over the text and the date; Delete takes the
// note off the list at once, with Undo on the toast (see NotesProvider.remove).
export default function NoteMenu({ note }: { note: NoteWithTags }) {
  const { remove } = useNotes();
  const [editing, setEditing] = useState(false);
  return (
    <>
      {/* Not modal: the menu opens the edit window, and a modal menu closing under a dialog
          can leave the page unclickable. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Note actions" className="-my-1.5 -mr-1.5 size-8 text-muted-foreground">
            <Ellipsis className="size-5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto">
          <DropdownMenuItem onSelect={() => setEditing(true)}>Edit</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => remove(note)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditPanel key={String(editing)} open={editing} note={note} onClose={() => setEditing(false)} />
    </>
  );
}

// Only a saved edit closes the window; a failure keeps the typed text on screen. Keyed by
// whether it is open, so each opening starts from the note as it stands. Only what changed
// is sent: a rewrite re-checks the tags' quotes on the server, a date change does not.
function EditPanel({ open, note, onClose }: { open: boolean; note: NoteWithTags; onClose: () => void }) {
  const { update, refreshRoster } = useNotes();
  const [body, setBody] = useState(note.body);
  const [when, setWhen] = useState(toLocalInput(note.notedAt));
  const { run, busy, error } = useAction(async () => {
    const notedAt = new Date(when).toISOString();
    const patch = {
      ...(body.trim() !== note.body && { body: body.trim() }),
      ...(notedAt !== note.notedAt && { notedAt }),
    };
    if (Object.keys(patch).length === 0) return;
    const updated = await api<TaggedNoteResponse>(`/api/notes/${note.id}`, jsonInit("PATCH", patch));
    update(updated);
    if (patch.notedAt) refreshRoster();
    toast.success("Note updated");
  });

  return (
    <Panel open={open} onOpenChange={(o) => !o && onClose()} title="Edit note">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run()) onClose();
        }}
        className="mt-4 flex min-h-0 flex-col gap-3"
      >
        <Label>
          Note
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="max-h-[40svh] overflow-y-auto" autoFocus />
        </Label>
        <Label>
          When
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Label>
        {error && <p className={cn("mt-1", errorText)}>{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || body.trim() === "" || when === ""}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
