import { useParams } from "react-router";
import type { ClassRow } from "../../worker/db/schema";
import ClassPage from "../class/ClassPage";
import StudentsPage, { StudentDetail } from "../students/StudentsPage";
import { Avatar } from "@/components/Avatar";
import { BackLink } from "@/components/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { termLabel } from "./term";

function Missing() {
  return (
    <section>
      <BackLink to="/classes">Classes</BackLink>
      <p className="mt-3 text-[15px] text-muted-foreground">That class no longer exists.</p>
    </section>
  );
}

// /classes/:classId — one class: its roster and its course materials.
export default function ClassView({ classes, onClassesChanged }: { classes: ClassRow[]; onClassesChanged: () => void }) {
  const { classId } = useParams();
  const cls = classes.find((c) => c.id === classId);
  if (!cls) return <Missing />;

  return (
    <section>
      <BackLink to="/classes">Classes</BackLink>
      <div className="mt-2 flex items-center gap-3.5">
        <Avatar id={cls.id} name={cls.name} size="lg" square />
        <div className="min-w-0 flex-1">
          <h1 className="text-[30px] leading-tight font-extrabold tracking-[-0.03em] md:text-[34px]">{cls.name}</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">{termLabel(cls)}</p>
        </div>
      </div>
      <Tabs defaultValue="students" className="mt-[22px]">
        <TabsList className="h-auto bg-[#EEF0F4] p-1">
          <TabsTrigger value="students" className="h-[38px] px-[18px] font-bold">
            Students
          </TabsTrigger>
          <TabsTrigger value="materials" className="h-[38px] px-[18px] font-bold">
            Materials
          </TabsTrigger>
        </TabsList>
        <TabsContent value="students">
          <StudentsPage key={cls.id} classId={cls.id} onClassesChanged={onClassesChanged} />
        </TabsContent>
        <TabsContent value="materials">
          <ClassPage key={cls.id} classId={cls.id} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

// /classes/:classId/students/:studentId — one student, with the way back to their class.
export function StudentView({ classes }: { classes: ClassRow[] }) {
  const { classId, studentId } = useParams();
  const cls = classes.find((c) => c.id === classId);
  if (!cls || !studentId) return <Missing />;
  return <StudentDetail key={studentId} id={studentId} back={<BackLink to={`/classes/${cls.id}`}>{cls.name}</BackLink>} />;
}
