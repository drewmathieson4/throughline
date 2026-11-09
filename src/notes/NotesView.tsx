import { useState } from "react";
import { useMatch, useNavigate } from "react-router";
import { AlertCircle, ChevronDown, CloudUpload, Mic, Search, X } from "lucide-react";
// Type-only imports: nothing from the Worker ends up in the browser bundle.
import type { ClassRow, NoteKind } from "../../worker/db/schema";
import type { NoteWithTags } from "../../worker/api-types";
import NoteItem from "../NoteItem";
import { kinds } from "../noteKinds";
import { chipOff, chipOn, chipRow, errorText, waitingToUpload } from "../ui";
import { BackLink, PageTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { useIsLaptop } from "@/lib/useIsLaptop";
import { cn } from "@/lib/utils";
import CaptureCard from "./CaptureCard";
import { groupByDay } from "./days";
import NoteMenu from "./NoteMenu";
import { toPickable, useNotes } from "./notesStore";
import RecordHome from "./RecordHome";
import SavedSheet from "./SavedSheet";
import { matches } from "./search";
import StudentPicker from "./StudentPicker";
import Tags from "./Tags";
import { useCapture, type SavedNote } from "./useCapture";

const chip = "inline-flex min-h-9 flex-none items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-semibold";

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
  const { notes, error, people, roster, classNames, needsCount, waiting, colourOf } = useNotes();
  const [needsOnly, setNeedsOnly] = useState(false);
  const [classFilter, setClassFilter] = useState("");
  const [studentFilter, setStudentFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<NoteKind | "">("");
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  // The phone's Saved sheet, and the note to fade in on the feed.
  const [saved, setSaved] = useState<SavedNote | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);

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
          waiting={waiting}
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
  const shown = all.filter(
    (n) =>
      (!needs || n.mentions.length > 0) &&
      (!classFilter || n.classId === classFilter) &&
      (!studentFilter || about(n, studentFilter)) &&
      (!kindFilter || n.kind === kindFilter) &&
      matches(n, query),
  );
  const studentName = people.get(studentFilter)?.name;
  const searching = query.trim() !== "";
  const anyFilter = needs || classFilter || studentFilter || kindFilter || searching;
  const clearFilters = () => {
    setNeedsOnly(false);
    setClassFilter("");
    setStudentFilter("");
    setKindFilter("");
    setQuery("");
  };
  // Only the kinds the teacher has notes of: a chip for a kind with nothing behind it is noise.
  const kindChips = (Object.keys(kinds) as NoteKind[]).filter((k) => all.some((n) => n.kind === k));
  // Picking a class the chosen student is not in drops the student filter, not the notes.
  const pickClass = (id: string) => {
    const next = classFilter === id ? "" : id;
    setClassFilter(next);
    if (next && studentFilter && people.get(studentFilter)?.classId !== next) setStudentFilter("");
  };
  const filterable = picking
    ? roster
        .filter((s) => !s.leftAt && (!classFilter || s.classId === classFilter))
        .map((s) => toPickable(s, classNames))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return (
    <section>
      {!isLaptop && (
        <div className="mb-1.5">
          <BackLink to="/notes">Record</BackLink>
        </div>
      )}
      <PageTitle>Notes</PageTitle>
      {isLaptop && <CaptureCard capture={capture} />}
      {waiting > 0 && (
        <p role="status" className="mt-4 inline-flex min-h-[30px] items-center gap-1.5 rounded-full bg-accent px-3 text-[13px] font-bold text-accent-foreground">
          <CloudUpload className="size-4" aria-hidden />
          {waitingToUpload(waiting)}
        </p>
      )}
      {error && <p className={`mt-4 ${errorText}`}>{error}</p>}

      {all.length > 0 && (
        <label className="mt-4 flex min-h-[46px] items-center gap-2 rounded-[14px] bg-muted px-3.5 text-muted-foreground md:mt-[22px]">
          <Search className="size-4 flex-none" aria-hidden />
          <input
            type="search"
            aria-label="Search notes"
            placeholder="Search notes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {searching && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="-mr-1.5 inline-flex size-8 items-center justify-center rounded-full hover:bg-background">
              <X className="size-4" aria-hidden />
            </button>
          )}
        </label>
      )}

      <div className={cn(chipRow, all.length > 0 && "mt-2.5 md:mt-3")}>
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
        {kindChips.length > 1 &&
          kindChips.map((k) => {
            const { label, icon: Icon } = kinds[k];
            return (
              <button key={k} type="button" aria-pressed={kindFilter === k} onClick={() => setKindFilter(kindFilter === k ? "" : k)} className={cn(chip, kindFilter === k ? chipOn : chipOff)}>
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            );
          })}
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
                    <span className="truncate rounded-full px-2.5 py-[3px] text-xs font-bold" style={{ background: colourOf(n.classId).bg, color: colourOf(n.classId).fg }}>
                      {classNames.get(n.classId) ?? "Class"}
                    </span>
                  )
                }
                actions={<NoteMenu note={n} />}
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
            {all.length === 0 ? "No notes yet" : searching ? `Nothing mentions “${query.trim()}”` : studentName ? `No notes about ${studentName} here yet` : "Nothing matches these filters"}
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
          className="fixed right-[18px] bottom-[calc(var(--tabbar-h)+20px)] z-30 inline-flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-pop"
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
