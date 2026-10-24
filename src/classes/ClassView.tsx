import { useState } from "react";
import { X } from "lucide-react";
import { useParams } from "react-router";
import type { ClassRow } from "../../worker/db/schema";
import { useNotes } from "../notes/notesStore";
import { GradesSummary } from "../students/ImportGrades";
import { RosterSummary } from "../students/ImportRoster";
import StudentPage from "../students/StudentPage";
import { caption } from "../ui";
import AddMenu, { type ImportResult } from "./AddWindows";
import Materials from "./Materials";
import Roster from "./Roster";
import { termLabel } from "./term";
import { useMaterials } from "./useMaterials";
import { Avatar } from "@/components/Avatar";
import { BackLink, titleText } from "@/components/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  const active = roster.filter((s) => s.classId === cls.id && !s.leftAt).length;

  return (
    <section>
      <BackLink to="/classes">Classes</BackLink>
      <div className="mt-2 flex items-center gap-3.5">
        <Avatar colour={colourOf(cls.id)} name={cls.name} size={56} square />
        <div className="min-w-0 flex-1">
          <h1 className={titleText}>{cls.name}</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">{termLabel(cls)}</p>
        </div>
        <AddMenu
          classId={cls.id}
          onClassesChanged={onClassesChanged}
          onResult={(r) => {
            setResult(r);
            setTab("students");
          }}
        />
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
          {result && <ResultCard result={result} classId={cls.id} onDismiss={() => setResult(null)} />}
          <Roster classId={cls.id} />
        </TabsContent>
        <TabsContent value="materials">
          <Materials classId={cls.id} {...materials} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

// What the last import did, in full, until the teacher dismisses it or leaves the class.
function ResultCard({ result, classId, onDismiss }: { result: ImportResult; classId: string; onDismiss: () => void }) {
  return (
    <section role="status" className="mt-4 rounded-[22px] border border-border bg-card p-4 pr-3 text-sm shadow-card">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={`mb-1 ${caption}`}>{result.kind === "roster" ? "Roster import" : "Grade book import"}</p>
          {result.kind === "roster" ? <RosterSummary result={result.result} classId={classId} /> : <GradesSummary result={result.result} />}
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
