import { useState } from "react";
import { useMatch, useNavigate } from "react-router";
import { AlertCircle, ChevronDown, Mic } from "lucide-react";
// Type-only imports: nothing from the Worker ends up in the browser bundle.
import type { ClassRow } from "../../worker/db/schema";
import type { NoteWithTags } from "../../worker/api-types";
import NoteItem from "../NoteItem";
import { errorText } from "../ui";
import { BackLink, PageTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { colourFor } from "@/lib/avatar";
import { useIsLaptop } from "@/lib/useIsLaptop";
import { cn } from "@/lib/utils";
import CaptureCard from "./CaptureCard";
import { groupByDay } from "./days";
import { useNotes } from "./notesStore";
import RecordHome from "./RecordHome";
import SavedSheet from "./SavedSheet";
import StudentPicker from "./StudentPicker";
import Tags from "./Tags";
import { useCapture, type SavedNote } from "./useCapture";

const todayLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });

const chip = "inline-flex min-h-9 flex-none items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-semibold";
const chipOn = "border-primary bg-primary text-primary-foreground";
const chipOff = "border-input bg-background text-secondary-foreground hover:bg-muted";

// Tagged, or a candidate for a name the tagger could not settle ("Alex" with two Alexes).
const about = (n: NoteWithTags, studentId: string) =>
  n.students.some((s) => s.studentId === studentId) || n.mentions.some((m) => m.candidateIds.includes(studentId));

// Every note, whatever its class: capture is class-less. On a phone, /notes is the Record
// screen and the feed is /notes/feed; on a laptop both show the feed under a capture card.
// One component serves both URLs (the route is /notes/*), so a recording carries on when the
// phone moves between them. The filters work on the loaded list; the server's ?classId is
// deliberately unused, since a student filter has no server equivalent.
export default function NotesView({ classes }: { classes: ClassRow[] }) {
  const isLaptop = useIsLaptop();
  const onFeed = useMatch("/notes/feed") !== null;
  const home = !isLaptop && !onFeed;
  const navigate = useNavigate();
  const { notes, error, people, needsCount } = useNotes();
  const [needsOnly, setNeedsOnly] = useState(false);
  const [classFilter, setClassFilter] = useState("");
  const [studentFilter, setStudentFilter] = useState("");
  const [picking, setPicking] = useState(false);
  // The phone's Saved sheet, and the note to fade in on the feed.
  const [saved, setSaved] = useState<SavedNote | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  // Fixed at mount: a heading that changed on a re-render past midnight would be no help.
  const [today] = useState(() => todayLabel.format(new Date()));

  const capture = useCapture({
    onSaved: (s) => {
      setFreshId(s.note.id);
      if (!home) return false;
      setSaved(s);
      return true;
    },
  });

  if (home) {
    return (
      <>
        <RecordHome
          capture={capture}
          notes={notes ?? []}
          needsCount={needsCount}
          onOpenNeeds={() => {
            setNeedsOnly(true);
            navigate("/notes/feed");
          }}
        />
        <SavedSheet
          saved={saved}
          onClose={() => setSaved(null)}
          onRecordAnother={
            capture.recorder.supported
              ? () => {
                  setSaved(null);
                  void capture.record();
                }
              : undefined
          }
        />
      </>
    );
  }

  const all = notes ?? [];
  const needs = needsOnly && needsCount > 0;
  const shown = all.filter((n) => (!needs || n.mentions.length > 0) && (!classFilter || n.classId === classFilter) && (!studentFilter || about(n, studentFilter)));
  const studentName = people.get(studentFilter)?.name;
  const anyFilter = needs || classFilter || studentFilter;
  const clearFilters = () => {
    setNeedsOnly(false);
    setClassFilter("");
    setStudentFilter("");
  };
  // Picking a class the chosen student is not in drops the student filter, not the notes.
  const pickClass = (id: string) => {
    const next = classFilter === id ? "" : id;
    setClassFilter(next);
    if (next && studentFilter && people.get(studentFilter)?.classId !== next) setStudentFilter("");
  };
  const filterable = [...people.entries()]
    .filter(([, p]) => !p.left && (!classFilter || p.classId === classFilter))
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([id, p]) => ({ id, name: p.name, className: classes.find((c) => c.id === p.classId)?.name ?? "" }));

  return (
    <section>
      {!isLaptop && (
        <div className="mb-1.5">
          <BackLink to="/notes">Record</BackLink>
        </div>
      )}
      <PageTitle eyebrow={today}>Notes</PageTitle>
      {isLaptop && <CaptureCard capture={capture} />}
      {error && <p className={`mt-4 ${errorText}`}>{error}</p>}

      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] md:mx-0 md:mt-[22px] md:flex-wrap md:px-0">
        {needsCount > 0 && (
          <button
            type="button"
            aria-pressed={needs}
            onClick={() => setNeedsOnly(!needs)}
            className={cn(chip, "font-bold", needs ? "border-sunny-dot bg-sunny-dot text-sunny-ink" : "border-sunny-line/60 bg-sunny-soft text-sunny-ink")}
          >
            <AlertCircle className="size-4" aria-hidden />
            Needs you · {needsCount}
          </button>
        )}
        <button type="button" aria-pressed={!anyFilter} onClick={clearFilters} className={cn(chip, !anyFilter ? chipOn : chipOff)}>
          All notes
        </button>
        {classes.map((c) => (
          <button key={c.id} type="button" aria-pressed={classFilter === c.id} onClick={() => pickClass(c.id)} className={cn(chip, classFilter === c.id ? chipOn : chipOff)}>
            {c.name}
          </button>
        ))}
        <button type="button" aria-haspopup="dialog" onClick={() => setPicking(true)} className={cn(chip, "pr-3", studentFilter ? chipOn : chipOff)}>
          {studentName ?? "Any student"}
          <ChevronDown className="size-4" aria-hidden />
        </button>
      </div>

      {notes === null && !error && <p className="mt-6 text-sm text-muted-foreground">Loading…</p>}
      {groupByDay(shown).map((g) => (
        <div key={g.key}>
          <h2 className="mt-[26px] mb-2.5 text-[13px] font-bold tracking-[0.02em] text-muted-foreground">{g.label}</h2>
          <ul className="flex flex-col gap-3">
            {g.notes.map((n) => (
              <NoteItem
                key={n.id}
                note={n}
                timeOnly
                fresh={n.id === freshId}
                badge={
                  n.classId && (
                    <span className="truncate rounded-full px-2.5 py-[3px] text-xs font-bold" style={{ background: colourFor(n.classId).bg, color: colourFor(n.classId).fg }}>
                      {classes.find((c) => c.id === n.classId)?.name ?? "Class"}
                    </span>
                  )
                }
              >
                <Tags note={n} />
              </NoteItem>
            ))}
          </ul>
        </div>
      ))}
      {notes !== null && shown.length === 0 && (
        <div className="mt-7 rounded-[22px] border-2 border-dashed border-input px-5 py-9 text-center">
          <p className="text-[15px] font-bold text-secondary-foreground">
            {all.length === 0 ? "No notes yet" : studentName ? `No notes about ${studentName} here yet` : "Nothing matches these filters"}
          </p>
          {anyFilter && (
            <Button type="button" variant="soft" onClick={clearFilters} className="mt-3">
              Show all notes
            </Button>
          )}
        </div>
      )}

      {!isLaptop && capture.recorder.supported && (
        <button
          type="button"
          aria-label="Record a voice note"
          onClick={() => {
            navigate("/notes");
            void capture.record();
          }}
          className="fixed right-[18px] bottom-[calc(78px+max(20px,env(safe-area-inset-bottom)))] z-30 inline-flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-pop"
        >
          <Mic className="size-7" aria-hidden />
        </button>
      )}

      <StudentPicker
        open={picking}
        onOpenChange={setPicking}
        title="Filter by student"
        students={filterable}
        selected={studentFilter || undefined}
        allowAny
        onPick={(id) => setStudentFilter(id ?? "")}
      />
    </section>
  );
}
