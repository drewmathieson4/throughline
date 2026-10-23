import { Check, Mic } from "lucide-react";
import { kinds, noteWhen } from "../noteKinds";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useNotes } from "./notesStore";
import Tags from "./Tags";
import { LIMIT_MESSAGE, type SavedNote } from "./useCapture";

// The phone's result after a save: what was heard and who it went to, with any "Who is…?"
// to settle on the spot. The note is read from the store by id, so settling or retagging
// here shows at once.
export default function SavedSheet({ saved, onClose, onRecordAnother }: { saved: SavedNote | null; onClose: () => void; onRecordAnother?: () => void }) {
  const { notes } = useNotes();
  const note = saved && (notes?.find((n) => n.id === saved.note.id) ?? saved.note);
  return (
    <Sheet open={note !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        aria-describedby={undefined}
        className="max-h-[78svh] overflow-y-auto rounded-t-[28px] border-0 px-5 pt-3 pb-[max(26px,env(safe-area-inset-bottom))] text-foreground"
      >
        <span aria-hidden className="mx-auto mb-4 block h-[5px] w-10 rounded-full bg-input" />
        {note && saved && (
          <>
            <div className="flex items-center gap-3">
              <span className="inline-flex size-9 flex-none items-center justify-center rounded-full bg-mint-dot text-white">
                <Check className="size-5" strokeWidth={3} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-[19px] font-extrabold tracking-[-0.01em]">Saved</SheetTitle>
                <p className="mt-px text-[12.5px] text-muted-foreground">
                  {kinds[note.kind].label} · {noteWhen(note, true)}
                </p>
              </div>
            </div>
            <p className="mt-3.5 text-[15px] leading-[1.55] whitespace-pre-wrap">{note.body}</p>
            {(saved.failed || saved.hitLimit) && (
              <p className="mt-3.5 rounded-[14px] bg-sunny px-3 py-2.5 text-[13.5px] font-semibold text-sunny-foreground">
                {saved.failed && "Tagging did not run. Use + Tag to add students. "}
                {saved.hitLimit && LIMIT_MESSAGE}
              </p>
            )}
            <Tags note={note} compact />
            <div className="mt-5 flex gap-2.5">
              <Button type="button" variant="outline" size="lg" onClick={onClose} className="h-[50px] flex-1">
                Done
              </Button>
              {onRecordAnother && (
                <Button type="button" size="lg" onClick={onRecordAnother} className="h-[50px] flex-[1.5]">
                  <Mic aria-hidden />
                  Record another
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
