import { useState } from "react";
import { Check, Search, Users, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsLaptop } from "@/lib/useIsLaptop";
import { cn } from "@/lib/utils";

export type Pickable = { id: string; name: string; className: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** In the order to show them. */
  students: Pickable[];
  selected?: string;
  /** Adds an "Any student" row that picks null: the filter's way back to everyone. */
  allowAny?: boolean;
  onPick: (id: string | null) => void;
};

// A searchable list of students: a bottom sheet on a phone, a dialog near the top on a laptop.
// The feed's student filter and a note's "+ Tag" both use it.
export default function StudentPicker({ open, onOpenChange, title, students, selected, allowAny, onPick }: Props) {
  const isLaptop = useIsLaptop();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? students.filter((s) => s.name.toLowerCase().includes(q)) : students;
  const change = (next: boolean) => {
    if (!next) setQuery("");
    onOpenChange(next);
  };
  const pick = (id: string | null) => {
    onPick(id);
    change(false);
  };
  const row = "flex min-h-[52px] w-full items-center gap-3 rounded-xl px-1.5 text-left hover:bg-muted";

  const body = (
    <>
      <div className="flex items-center gap-2">
        {isLaptop ? <DialogTitle className="flex-1 text-lg font-extrabold">{title}</DialogTitle> : <SheetTitle className="flex-1 text-lg font-extrabold">{title}</SheetTitle>}
        <button type="button" onClick={() => change(false)} aria-label="Close" className="inline-flex size-10 items-center justify-center rounded-full bg-muted text-secondary-foreground">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <label className="mt-3 flex min-h-[46px] items-center gap-2 rounded-[14px] bg-muted px-3.5 text-muted-foreground">
        <Search className="size-4" aria-hidden />
        <input
          autoFocus={isLaptop}
          aria-label="Search students"
          placeholder="Search students"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none"
        />
      </label>
      <div className="mt-2 overflow-y-auto [scrollbar-width:none]">
        {allowAny && !q && (
          <button type="button" onClick={() => pick(null)} className={cn(row, "text-[15px] font-bold")}>
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
              <Users className="size-4" aria-hidden />
            </span>
            <span className="flex-1">Any student</span>
            {!selected && <Check className="size-5 text-primary" aria-hidden />}
          </button>
        )}
        {shown.map((s) => (
          <button key={s.id} type="button" onClick={() => pick(s.id)} aria-pressed={s.id === selected} className={cn(row, s.id === selected && "bg-accent")}>
            <Avatar id={s.id} name={s.name} className="size-9 text-xs" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold">{s.name}</span>
              <span className="block truncate text-[12.5px] text-muted-foreground">{s.className}</span>
            </span>
            {s.id === selected && <Check className="size-5 text-primary" aria-hidden />}
          </button>
        ))}
        {shown.length === 0 && <p className="px-1.5 py-4 text-sm text-muted-foreground">{q ? `No student matches “${query.trim()}”.` : "No students to pick."}</p>}
      </div>
    </>
  );

  return isLaptop ? (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="top-24 flex max-h-[min(640px,calc(100svh-8rem))] translate-y-0 flex-col gap-0 rounded-[28px] p-4 pb-5 sm:max-w-[460px]">
        {body}
      </DialogContent>
    </Dialog>
  ) : (
    <Sheet open={open} onOpenChange={change}>
      <SheetContent side="bottom" showCloseButton={false} aria-describedby={undefined} className="max-h-[85svh] rounded-t-[28px] border-0 px-4 pt-[18px] pb-[max(20px,env(safe-area-inset-bottom))]">
        {body}
      </SheetContent>
    </Sheet>
  );
}
