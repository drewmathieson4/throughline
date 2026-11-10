import { useState } from "react";
import { Ellipsis, X } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import type { ClassRow } from "../../worker/db/schema";
import { api } from "../api";
import { useNotes } from "../notes/notesStore";
import { GradesSummary } from "../students/ImportGrades";
import { RosterSummary } from "../students/ImportRoster";
import StudentPage from "../students/StudentPage";
import { caption, errorText } from "../ui";
import { useAction } from "../useAction";
import AddMenu, { type ImportResult } from "./AddWindows";
import { DocumentSummary } from "./ImportDocument";
import Materials from "./Materials";
import Roster from "./Roster";
import { termLabel } from "./term";
import { useMaterials } from "./useMaterials";
import { Avatar } from "@/components/Avatar";
import { BackLink, titleText } from "@/components/page";
import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

function Missing() {
  return (
    <section>
      <BackLink to="/classes">Classes</BackLink>
      <p className="mt-3 text-[15px] text-muted-foreground">That class no longer exists.</p>
    </section>
  );
}

// /classes/:classId — one class: its roster and its course materials. The page is keyed by
// class, so the tab, the import result and the materials start afresh for each one.
export default function ClassView({ classes, onClassesChanged }: { classes: ClassRow[]; onClassesChanged: () => void }) {
  const { classId } = useParams();
  const cls = classes.find((c) => c.id === classId);
  if (!cls) return <Missing />;
  return <ClassPage key={cls.id} cls={cls} onClassesChanged={onClassesChanged} />;
}

function ClassPage({ cls, onClassesChanged }: { cls: ClassRow; onClassesChanged: () => void }) {
  const { roster, colourOf } = useNotes();
  const materials = useMaterials(cls.id);
  const [tab, setTab] = useState("students");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [deleting, setDeleting] = useState(false);
  const active = roster.filter((s) => s.classId === cls.id && !s.leftAt).length;
  // A document lands on the tab it went to, and may have added or replaced materials.
  const onResult = (r: ImportResult) => {
    setResult(r);
    setTab(r.kind === "document" && r.result.kind === "course" ? "materials" : "students");
    if (r.kind === "document") materials.reload();
  };
  const card = result && <ResultCard result={result} classId={cls.id} onDismiss={() => setResult(null)} onResult={onResult} />;

  return (
    <section>
      <BackLink to="/classes">Classes</BackLink>
      <div className="mt-2 flex items-center gap-3.5">
        <Avatar colour={colourOf(cls.id)} name={cls.name} size={56} square />
        <div className="min-w-0 flex-1">
          <h1 className={titleText}>{cls.name}</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">{termLabel(cls)}</p>
        </div>
        <AddMenu classId={cls.id} onClassesChanged={onClassesChanged} onResult={onResult} />
        {/* Not modal: the menu opens the delete window, and a modal menu closing under a
            dialog can leave the page unclickable. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="More actions">
              <Ellipsis className="size-5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
              Delete class
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="mt-[22px]">
        <TabsList className="h-auto bg-track p-1">
          <TabsTrigger value="students" className="h-[38px] px-[18px] font-bold">
            Students <span className="opacity-60">{active}</span>
          </TabsTrigger>
          <TabsTrigger value="materials" className="h-[38px] px-[18px] font-bold">
            Materials <span className="opacity-60">{materials.materials?.length ?? ""}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="students">
          {card}
          <Roster classId={cls.id} />
        </TabsContent>
        <TabsContent value="materials">
          {result?.kind === "document" && card}
          <Materials {...materials} />
        </TabsContent>
      </Tabs>
      <DeletePanel open={deleting} cls={cls} onClose={() => setDeleting(false)} onClassesChanged={onClassesChanged} />
    </section>
  );
}

// Delete asks once and says what goes. The class list and the notes are fetched again (the
// sidebar and the feed drop it at once); the page itself is left behind.
function DeletePanel({ open, cls, onClose, onClassesChanged }: { open: boolean; cls: ClassRow; onClose: () => void; onClassesChanged: () => void }) {
  const { refreshNotes } = useNotes();
  const navigate = useNavigate();
  const { run, busy, error } = useAction(async () => {
    await api(`/api/classes/${cls.id}`, { method: "DELETE" });
    onClassesChanged();
    refreshNotes();
    toast(`Deleted ${cls.name}`);
    navigate("/classes");
  });

  return (
    <Panel open={open} onOpenChange={(o) => !o && onClose()} title={`Delete ${cls.name}?`}>
      <p className="mt-2 text-sm text-secondary-foreground">Its students, notes, materials, grades, evidence and reports go too.</p>
      {error && <p className={cn("mt-2", errorText)}>{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" variant="destructive" disabled={busy} onClick={() => run()}>
          {busy ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </Panel>
  );
}

const CAPTIONS: Record<ImportResult["kind"], string> = { roster: "Roster import", grades: "Grade book import", document: "Document import" };

// What the last import did, in full, until the teacher dismisses it or leaves the class. A
// document's card shows on Materials too, and its switch hands the new result back up.
function ResultCard({ result, classId, onDismiss, onResult }: { result: ImportResult; classId: string; onDismiss: () => void; onResult: (r: ImportResult) => void }) {
  return (
    <section role="status" className="mt-4 rounded-[22px] border border-border bg-card p-4 pr-3 text-sm shadow-card">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={`mb-1 ${caption}`}>{CAPTIONS[result.kind]}</p>
          {result.kind === "roster" && <RosterSummary result={result.result} classId={classId} />}
          {result.kind === "grades" && <GradesSummary result={result.result} />}
          {result.kind === "document" && <DocumentSummary imported={result} onImported={(imported) => onResult({ kind: "document", ...imported })} />}
        </div>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="inline-flex size-9 flex-none items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}

// /classes/:classId/students/:studentId — one student, with the way back to their class.
export function StudentView({ classes }: { classes: ClassRow[] }) {
  const { classId, studentId } = useParams();
  const cls = classes.find((c) => c.id === classId);
  if (!cls || !studentId) return <Missing />;
  return <StudentPage key={studentId} cls={cls} id={studentId} />;
}
