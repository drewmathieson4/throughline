import { useEffect, useState } from "react";
import { Ellipsis, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import type { ClassRow, Student } from "../../worker/db/schema";
import type { NoteWithTags, StudentDetail } from "../../worker/api-types";
import { api, jsonInit, messageOf } from "../api";
import { shortDay } from "../classes/term";
import FreshPill from "../classes/FreshPill";
import NoteItem from "../NoteItem";
import { kinds, noteWhen } from "../noteKinds";
import { dayLabel } from "../notes/days";
import { useNotes } from "../notes/notesStore";
import Tags from "../notes/Tags";
import { errorText } from "../ui";
import { useAction } from "../useAction";
import GradesCard from "./GradesCard";
import { Avatar } from "@/components/Avatar";
import { BackLink, titleText } from "@/components/page";
import { Panel } from "@/components/Panel";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Local calendar date as YYYY-MM-DD, built from the parts rather than a locale format so the
// server's date check cannot trip on an ICU quirk. Local, not UTC: a teacher marking a
// student as left at 7pm should get today.
function today() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type Patch = Partial<Pick<Student, "firstName" | "lastName" | "leftAt">>;

// /classes/:classId/students/:studentId. The student and their grades come from the
// student's own route; their notes, with the quotes about them, from the notes store, so a
// tag changed in the note window shows here at once.
export default function StudentPage({ cls, id }: { cls: ClassRow; id: string }) {
  const { notes, refreshRoster, colourOf } = useNotes();
  const [data, setData] = useState<StudentDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [openNote, setOpenNote] = useState<string | null>(null);

  const save = async (body: Patch) => {
    const student = await api<Student>(`/api/students/${id}`, jsonInit("PATCH", body));
    setData((prev) => prev && { ...prev, student });
    refreshRoster();
    return student;
  };
  const { run: setLeft, busy, error } = useAction(async (leftAt: string | null) => {
    const s = await save({ leftAt });
    toast.success(leftAt ? `Marked ${s.firstName} as left` : `${s.firstName} is back in ${cls.name}`);
  });

  useEffect(() => {
    api<StudentDetail>(`/api/students/${id}`)
      .then(setData)
      .catch((e) => setLoadError(messageOf(e)));
  }, [id]);

  const back = <BackLink to={`/classes/${cls.id}`}>{cls.name}</BackLink>;
  // Keep the way back even when the load fails (student deleted elsewhere, network down).
  if (!data) {
    return (
      <section>
        {back}
        <p className={cn("mt-2", loadError ? errorText : "text-sm text-muted-foreground")}>{loadError ?? "Loading…"}</p>
      </section>
    );
  }

  const { student, grades } = data;
  const name = `${student.firstName} ${student.lastName}`;
  const theirs = (notes ?? []).filter((n) => n.students.some((s) => s.studentId === id)).sort((a, b) => b.notedAt.localeCompare(a.notedAt));
  // Looked up in every note, not just theirs, so the window stays open on a note the teacher
  // just untagged them from.
  const shown = openNote ? notes?.find((n) => n.id === openNote) : undefined;

  return (
    <section aria-labelledby="student-name">
      {back}
      <div className="mt-2.5 flex flex-wrap items-center gap-4">
        <Avatar colour={colourOf(student.classId)} name={name} size={72} />
        <div className="min-w-[180px] flex-1">
          <h1 id="student-name" className={cn(titleText, "leading-[1.1]")}>
            {name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <FreshPill lastNotedAt={theirs[0]?.notedAt ?? null} prefix="Last note: " />
            {student.leftAt && <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-bold text-secondary-foreground">Left {shortDay(student.leftAt)}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <Link to={`/reports/${cls.id}/${student.id}`} className={buttonVariants({ variant: "soft" })}>
            <Sparkles className="size-4" aria-hidden />
            View report
          </Link>
          {/* Not modal: the menu opens the rename window, and a modal menu closing under a
              dialog can leave the page unclickable. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions" disabled={busy}>
                <Ellipsis className="size-5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto">
              <DropdownMenuItem onSelect={() => setRenaming(true)}>Edit name</DropdownMenuItem>
              {student.leftAt ? (
                <DropdownMenuItem onSelect={() => setLeft(null)}>Reactivate</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => setLeft(today())}>Mark as left</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {error && <p className={cn("mt-2", errorText)}>{error}</p>}

      {grades && <GradesCard grades={grades} />}

      <h2 className="mt-7 mb-3 text-lg font-extrabold tracking-[-0.01em]">
        Notes about {student.firstName} <span className="font-semibold text-muted-foreground">{notes ? theirs.length : ""}</span>
      </h2>
      {notes === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : theirs.length === 0 ? (
        <p className="rounded-2xl bg-muted px-4 py-5 text-sm text-muted-foreground">
          No notes about {student.firstName} yet.
        </p>
      ) : (
        <ol>
          {theirs.map((n) => (
            <TimelineItem key={n.id} note={n} studentId={id} onOpen={() => setOpenNote(n.id)} />
          ))}
        </ol>
      )}

      <Panel open={shown !== undefined} onOpenChange={(open) => !open && setOpenNote(null)} title={shown ? kinds[shown.kind].label : ""}>
        {shown && (
          <ul className="mt-3 overflow-y-auto">
            <NoteItem note={shown}>
              <Tags note={shown} />
            </NoteItem>
          </ul>
        )}
      </Panel>
      <RenamePanel key={String(renaming)} open={renaming} student={student} onClose={() => setRenaming(false)} save={save} />
    </section>
  );
}

const when = (note: NoteWithTags) => {
  const day = dayLabel(new Date(note.notedAt), new Date());
  // A note cut from a document has a day, not a time.
  return note.kind === "progress_report" ? day : `${day}, ${noteWhen(note, true)}`;
};

// One note on the timeline: when and how, then the lines about this student. A note that
// named them without a quote shows the start of its text instead.
function TimelineItem({ note, studentId, onOpen }: { note: NoteWithTags; studentId: string; onOpen: () => void }) {
  const quotes = note.students.find((s) => s.studentId === studentId)?.quotes ?? [];
  return (
    <li className="group relative pb-[18px] pl-7 last:pb-0">
      <span aria-hidden className="absolute top-1.5 -bottom-1.5 left-1.5 w-0.5 bg-border group-last:hidden" />
      <span aria-hidden className={cn("absolute top-0.5 left-0 size-3.5 rounded-full border-[3px] border-background", kinds[note.kind].dot)} />
      <p className="text-[12.5px] font-bold text-muted-foreground">
        {when(note)} · {kinds[note.kind].label}
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="mt-1.5 w-full rounded-2xl border border-border bg-card px-4 py-3 text-left text-[15px] leading-[1.55] shadow-xs transition-colors hover:border-ring/60"
      >
        {quotes.length > 0 ? (
          quotes.map((q) => (
            <span key={q} className="block not-first:mt-1.5">
              “{q}”
            </span>
          ))
        ) : (
          <span className="line-clamp-3">{note.body}</span>
        )}
        <span className="sr-only"> (open the whole note)</span>
      </button>
    </li>
  );
}

// Only a saved rename closes the window; a failure keeps the typed names on screen. Keyed by
// whether it is open, so each opening starts from the current name.
function RenamePanel({ open, student, onClose, save }: { open: boolean; student: Student; onClose: () => void; save: (body: Patch) => Promise<Student> }) {
  const [first, setFirst] = useState(student.firstName);
  const [last, setLast] = useState(student.lastName);
  const { run, busy, error } = useAction(async () => {
    const s = await save({ firstName: first, lastName: last });
    toast.success(`Renamed to ${s.firstName} ${s.lastName}`);
  });

  return (
    <Panel open={open} onOpenChange={(o) => !o && onClose()} title="Edit name">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run()) onClose();
        }}
        className="mt-4 flex flex-col gap-3"
      >
        <div className="grid grid-cols-2 gap-2.5">
          <Label>
            First name
            <Input value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="off" />
          </Label>
          <Label>
            Last name
            <Input value={last} onChange={(e) => setLast(e.target.value)} autoComplete="off" />
          </Label>
        </div>
        {error && <p className={errorText}>{error}</p>}
        <Button type="submit" className="self-end" disabled={busy || !first.trim() || !last.trim()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </form>
    </Panel>
  );
}
