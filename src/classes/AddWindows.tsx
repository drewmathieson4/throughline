import { useRef, useState } from "react";
import { ChartNoAxesColumn, ChevronDown, Plus, Table, UserPlus, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import type { GradeImportResult, RosterImportResult } from "../../worker/api-types";
import { api, jsonInit } from "../api";
import { useNotes } from "../notes/notesStore";
import ImportGrades from "../students/ImportGrades";
import ImportRoster from "../students/ImportRoster";
import { gradesHeadline, rosterHeadline } from "../students/importText";
import { errorText } from "../ui";
import { useAction } from "../useAction";
import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ImportResult = { kind: "roster"; result: RosterImportResult } | { kind: "grades"; result: GradeImportResult };
type Choice = "student" | "roster" | "grades";

const items: { key: Choice; label: string; hint: string; icon: LucideIcon; tile: string }[] = [
  { key: "student", label: "Add a student", hint: "Type a first and last name", icon: UserPlus, tile: "bg-accent text-accent-foreground" },
  { key: "roster", label: "Import roster", hint: "CSV or spreadsheet, any layout", icon: Table, tile: "bg-mint text-mint-foreground" },
  { key: "grades", label: "Import grade book", hint: "Scores are matched to students", icon: ChartNoAxesColumn, tile: "bg-coral text-coral-foreground" },
];

// The class page's one Add menu and the window each item opens. An import closes its window
// with a toast and hands the full result up for the card above the roster.
// onClassesChanged: a roster file can name other classes, which the import creates.
export default function AddMenu({ classId, onClassesChanged, onResult }: { classId: string; onClassesChanged: () => void; onResult: (r: ImportResult) => void }) {
  const { refreshRoster } = useNotes();
  const [open, setOpen] = useState<Choice | null>(null);
  const close = (o: boolean) => !o && setOpen(null);

  return (
    <>
      {/* Not modal: each item opens a window, and a modal menu closing under a dialog can
          leave the page unclickable. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button>
            <Plus className="size-4" aria-hidden />
            Add
            <ChevronDown className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 p-1.5">
          {items.map(({ key, label, hint, icon: Icon, tile }) => (
            <DropdownMenuItem key={key} onSelect={() => setOpen(key)} className="gap-3 p-2.5">
              <span className={`inline-flex size-9 flex-none items-center justify-center rounded-[11px] ${tile}`}>
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-foreground">{label}</span>
                <span className="block text-[12.5px] text-muted-foreground">{hint}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Panel open={open === "student"} onOpenChange={close} title="Add a student">
        <AddStudentForm classId={classId} onAdded={refreshRoster} />
      </Panel>
      <Panel open={open === "roster"} onOpenChange={close} title="Import roster">
        <ImportRoster
          classId={classId}
          onImported={(result) => {
            // New classes reload the class list, and with it every roster; otherwise just the rosters.
            if (result.classes.some((k) => k.created)) onClassesChanged();
            else refreshRoster();
            toast.success(rosterHeadline(result));
            setOpen(null);
            onResult({ kind: "roster", result });
          }}
        />
      </Panel>
      <Panel open={open === "grades"} onOpenChange={close} title="Import grade book">
        <ImportGrades
          classId={classId}
          onImported={(result) => {
            toast.success(gradesHeadline(result));
            setOpen(null);
            onResult({ kind: "grades", result });
          }}
        />
      </Panel>
    </>
  );
}

// Stays open after each add, with the cursor back in First name, for typing a few in a row.
function AddStudentForm({ classId, onAdded }: { classId: string; onAdded: () => void }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const firstRef = useRef<HTMLInputElement>(null);
  const { run: submit, busy: saving, error } = useAction(async () => {
    await api("/api/students", jsonInit("POST", { classId, firstName: first, lastName: last }));
    onAdded();
    toast.success(`Added ${first.trim()} ${last.trim()}`);
    setFirst("");
    setLast("");
    firstRef.current?.focus();
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mt-4 flex flex-col gap-3"
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Label>
          First name
          <Input ref={firstRef} value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="off" />
        </Label>
        <Label>
          Last name
          <Input value={last} onChange={(e) => setLast(e.target.value)} autoComplete="off" />
        </Label>
      </div>
      {error && <p className={errorText}>{error}</p>}
      <Button type="submit" className="self-end" disabled={saving || !first.trim() || !last.trim()}>
        {saving ? "Adding…" : "Add student"}
      </Button>
    </form>
  );
}
