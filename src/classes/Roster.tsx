import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { useNotes } from "../notes/notesStore";
import { errorText, plural } from "../ui";
import FreshPill from "./FreshPill";
import { calendarDay } from "./term";
import { Avatar } from "@/components/Avatar";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// One class's students, from the notes store (which holds every roster, departed students
// included); the switch filters here, so toggling costs no request.
export default function Roster({ classId }: { classId: string }) {
  const { roster, rosterLoaded, error, colourOf } = useNotes();
  const [includeLeft, setIncludeLeft] = useState(false);
  const students = roster.filter((s) => s.classId === classId);
  const shown = includeLeft ? students : students.filter((s) => !s.leftAt);

  if (!rosterLoaded) return <p className={cn("mt-4", error ? errorText : "text-sm text-muted-foreground")}>{error ?? "Loading…"}</p>;
  return (
    <div className="mt-4">
      <div className="mb-2.5 flex items-center justify-end">
        <label className="flex items-center gap-2.5 text-[13.5px] font-semibold text-secondary-foreground">
          Show students who left
          <Switch checked={includeLeft} onCheckedChange={setIncludeLeft} />
        </label>
      </div>
      <div className="overflow-hidden rounded-[22px] border border-border bg-card">
        {shown.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-[15px] font-bold">{students.length === 0 ? "No students yet" : "Everyone has left"}</p>
            <p className="mt-1.5 text-[13.5px] text-muted-foreground">
              {students.length === 0
                ? "Import a roster from a spreadsheet, or add students one at a time from Add."
                : `All ${plural(students.length, "student")} have left. Turn on "Show students who left" to see them.`}
            </p>
          </div>
        ) : (
          <ul>
            {shown.map((s) => (
              <li key={s.id} className="border-b border-muted last:border-b-0">
                <Link to={`/classes/${classId}/students/${s.id}`} className={cn("flex min-h-[68px] items-center gap-3 px-4 py-2.5 hover:bg-muted/60", s.leftAt && "opacity-60")}>
                  <Avatar colour={colourOf(classId)} name={`${s.firstName} ${s.lastName}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold">
                      {s.firstName} {s.lastName}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                      {s.leftAt && `Left ${calendarDay(s.leftAt)} · `}
                      {plural(s.noteCount, "note")}
                      {s.unsureCount > 0 && <span className="font-bold text-sunny-foreground"> · {s.unsureCount} unsure</span>}
                    </span>
                  </span>
                  <FreshPill lastNotedAt={s.lastNotedAt} />
                  <ChevronRight className="size-4 flex-none text-[#9AA1AE]" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
