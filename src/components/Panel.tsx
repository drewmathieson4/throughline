import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsLaptop } from "@/lib/useIsLaptop";
import { cn } from "@/lib/utils";

// A small window with a title and a close button: a bottom sheet on a phone, a dialog on a
// laptop. `top` pins the dialog near the top, for a list that grows and shrinks as it is
// searched, so it does not jump about.
export function Panel({ open, onOpenChange, title, top = false, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; top?: boolean; children: ReactNode }) {
  const isLaptop = useIsLaptop();
  const Title = isLaptop ? DialogTitle : SheetTitle;
  const body = (
    <>
      <div className="flex items-center gap-2">
        <Title className="min-w-0 flex-1 text-lg font-extrabold">{title}</Title>
        <button type="button" onClick={() => onOpenChange(false)} aria-label="Close" className="inline-flex size-10 flex-none items-center justify-center rounded-full bg-muted text-secondary-foreground">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {children}
    </>
  );

  return isLaptop ? (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className={cn("flex max-h-[min(640px,calc(100svh-8rem))] flex-col gap-0 rounded-[28px] p-4 pb-5 sm:max-w-[460px]", top && "top-24 translate-y-0")}
      >
        {body}
      </DialogContent>
    </Dialog>
  ) : (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} aria-describedby={undefined} className="max-h-[85svh] rounded-t-[28px] border-0 px-4 pt-[18px] pb-[max(20px,env(safe-area-inset-bottom))]">
        {body}
      </SheetContent>
    </Sheet>
  );
}
