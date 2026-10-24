import { useState } from "react";
import { Link } from "react-router";
import { Plus, Users, X } from "lucide-react";
import { toast } from "sonner";
import type { NoteWithTags } from "../../worker/api-types";
import { api, jsonInit } from "../api";
import { errorText } from "../ui";
import { useAction } from "../useAction";
import { Avatar } from "@/components/Avatar";
import { initialsOf } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { useNotes, type Person } from "./notesStore";
import StudentPicker from "./StudentPicker";

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

// A note's open mentions ("Who is “Alex”?", settled by picking a candidate or Neither), its
// tags (each linking to the student, each removable), and + Tag for a student the tagger
// missed. A student's class is shown only when it would otherwise be unclear: the note has no
// class and its students span more than one, a student is outside the note's class, or a
// mention's candidates are in different classes. `compact` is the phone's Saved sheet: no
// quotes, and a heading over the tags.
export default function Tags({ note, compact = false }: { note: NoteWithTags; compact?: boolean }) {
  const { people, classNames, roster, update, colourOf } = useNotes();
  const [picking, setPicking] = useState(false);
  // Every route here answers with the note as it now stands; the list swaps it in.
  const { run, busy, error } = useAction(async (path: string, init: RequestInit, done: (n: NoteWithTags) => string) => {
    const updated = await api<NoteWithTags>(path, init);
    update(updated);
    toast.success(done(updated));
  });
  const label = (p: Person | undefined, withClass: boolean) =>
    p ? (withClass ? `${p.name} (${classNames.get(p.classId) ?? "class"})` : p.name) : "Unknown student";
  const spans = new Set(note.students.map((s) => people.get(s.studentId)?.classId)).size > 1;

  // Students still in a class and not already on the note, the note's own class first.
  const tagged = new Set(note.students.map((s) => s.studentId));
  const pickable = roster
    .filter((s) => !s.leftAt && !tagged.has(s.id))
    .sort((a, b) => Number(b.classId === note.classId) - Number(a.classId === note.classId) || a.lastName.localeCompare(b.lastName))
    .map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`, classId: s.classId, className: classNames.get(s.classId) ?? "" }));

  const untagged = note.students.length === 0 && note.mentions.length === 0;
  const classNote = (n: NoteWithTags) => (n.classId && n.students.length === 0 ? " · kept as a class note" : "");

  return (
    <>
      {note.mentions.map((m) => {
        const spansClasses = new Set(m.candidateIds.map((id) => people.get(id)?.classId)).size > 1;
        return (
          <div key={m.id} className="mt-3 rounded-[14px] border border-sunny-line/60 bg-sunny-soft p-3">
            <p className="text-[13.5px] font-bold text-sunny-ink">Who is “{m.mentionText}”?</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {m.candidateIds.map((id) => {
                const name = label(people.get(id), spansClasses);
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={busy}
                    onClick={() => run(`/api/notes/${note.id}/mentions/${m.id}/assign`, jsonInit("POST", { studentId: id }), () => `Tagged to ${name}`)}
                    className="inline-flex min-h-10 items-center gap-2 rounded-full border border-sunny-line bg-background pr-3.5 pl-[5px] text-[13.5px] font-semibold text-secondary-foreground hover:bg-muted disabled:opacity-50"
                  >
                    <Avatar colour={colourOf(people.get(id)?.classId)} name={people.get(id)?.name ?? "?"} className="size-[30px] text-[11px]" />
                    {name}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={busy}
                onClick={() => run(`/api/notes/${note.id}/mentions/${m.id}`, { method: "DELETE" }, (n) => `Left untagged${classNote(n)}`)}
                className="min-h-10 rounded-full border border-sunny-line px-3.5 text-[13.5px] font-semibold text-sunny-ink hover:bg-sunny/60 disabled:opacity-50"
              >
                Neither
              </button>
            </div>
          </div>
        );
      })}

      <div className={cn("mt-3 flex flex-col gap-2.5", !compact && "border-t border-dashed pt-3")}>
        {compact && note.students.length > 0 && <p className="text-xs font-extrabold tracking-[.06em] text-muted-foreground uppercase">Tagged</p>}
        {note.students.map((s) => {
          const p = people.get(s.studentId);
          const name = label(p, note.classId === null ? spans : p?.classId !== note.classId);
          const { bg, fg } = colourOf(p?.classId);
          const chip = (
            <>
              <span className="inline-flex size-[26px] items-center justify-center rounded-full bg-background text-[10.5px] font-extrabold">{initialsOf(p?.name ?? "?")}</span>
              {name}
            </>
          );
          const chipClass = "inline-flex min-h-8 items-center gap-[7px] rounded-l-full py-[3px] pl-[3px] text-[13px] font-bold";
          return (
            <div key={s.studentId}>
              <span className="inline-flex max-w-full items-center rounded-full" style={{ background: bg, color: fg }}>
                {p ? (
                  <Link to={`/classes/${p.classId}/students/${s.studentId}`} className={cn(chipClass, "hover:underline")}>
                    {chip}
                  </Link>
                ) : (
                  <span className={chipClass}>{chip}</span>
                )}
                <button
                  type="button"
                  aria-label={`Remove tag: ${name}`}
                  disabled={busy}
                  onClick={() => run(`/api/notes/${note.id}/students/${s.studentId}`, { method: "DELETE" }, () => `Removed ${p?.first ?? "the tag"}`)}
                  className="mr-0.5 inline-flex size-7 flex-none items-center justify-center rounded-full opacity-60 hover:bg-background/60 hover:opacity-100 disabled:opacity-30"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
              {/* Quotes that are the whole body (a note cut from a document, a one-line note) say nothing new. */}
              {!compact &&
                s.quotes.length > 0 &&
                collapse(s.quotes.join(" ")) !== collapse(note.body) &&
                s.quotes.map((q) => (
                  <p key={q} className="mt-1.5 ml-2 border-l-2 pl-2.5 text-[13px] leading-normal text-muted-foreground" style={{ borderColor: bg }}>
                    “{q}”
                  </p>
                ))}
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-2">
          {untagged &&
            (compact ? (
              <p className="text-[13.5px] text-muted-foreground">{note.classId ? "No one named, so it's kept as a class note." : "No students found in this note."}</p>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                {note.classId && <Users className="size-3.5" aria-hidden />}
                {note.classId ? "Class note · context for everyone" : "No students found"}
              </span>
            ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => setPicking(true)}
            className="inline-flex min-h-8 items-center gap-1 rounded-full border border-dashed border-input px-3 text-[13px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <Plus className="size-3.5" aria-hidden />
            Tag
          </button>
        </div>
        {error && <p className={errorText}>{error}</p>}
      </div>

      <StudentPicker
        open={picking}
        onOpenChange={setPicking}
        title="Tag a student"
        students={pickable}
        onPick={(id) => id && run(`/api/notes/${note.id}/students`, jsonInit("POST", { studentId: id }), () => `Tagged to ${people.get(id)?.name ?? "the student"}`)}
      />
    </>
  );
}
