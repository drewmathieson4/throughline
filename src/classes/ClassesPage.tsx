import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import type { ClassRow } from "../../worker/db/schema";
import { api, jsonInit } from "../api";
import { useNotes } from "../notes/notesStore";
import { errorText, plural } from "../ui";
import { useAction } from "../useAction";
import { termLabel } from "./term";
import { Avatar } from "@/components/Avatar";
import { PageTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function NewClassForm({ onCreated, onCancel }: { onCreated: (c: ClassRow) => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [termStart, setTermStart] = useState("");
  const [termEnd, setTermEnd] = useState("");
  const { run: submit, busy: saving, error } = useAction(async () => {
    onCreated(await api<ClassRow>("/api/classes", jsonInit("POST", { name, termStart: termStart || undefined, termEnd: termEnd || undefined })));
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3 rounded-2xl border-2 border-ring/60 bg-card p-[18px]"
    >
      <p className="text-base font-extrabold">New class</p>
      <Label>
        Class name
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Period 8 · Journalism" />
      </Label>
      <div className="grid grid-cols-2 gap-2.5">
        <Label>
          Term starts
          <Input type="date" value={termStart} onChange={(e) => setTermStart(e.target.value)} />
        </Label>
        <Label>
          Term ends
          <Input type="date" value={termEnd} onChange={(e) => setTermEnd(e.target.value)} />
        </Label>
      </div>
      {error && <p className={errorText}>{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={saving || !name.trim()}>
          {saving ? "Creating…" : "Create class"}
        </Button>
      </div>
    </form>
  );
}

// A class at a glance: who is in it (from the notes store, so no request of its own) and how
// many of its notes have a name to settle.
function ClassCard({ cls }: { cls: ClassRow }) {
  const { roster, notes, colourOf } = useNotes();
  const students = roster.filter((s) => s.classId === cls.id && !s.leftAt);
  const unsure = notes?.filter((n) => n.classId === cls.id && n.mentions.length > 0).length ?? 0;
  return (
    <Link to={`/classes/${cls.id}`} className="flex flex-col gap-4 rounded-[22px] border border-border bg-card p-[18px] shadow-card transition-colors hover:border-ring/60">
      <span className="flex items-center gap-3.5">
        <Avatar colour={colourOf(cls.id)} name={cls.name} size={56} square />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg font-extrabold tracking-[-0.01em]">{cls.name}</span>
          <span className="mt-0.5 block text-[13px] text-muted-foreground">{termLabel(cls)}</span>
        </span>
        <ChevronRight className="size-5 text-chevron" aria-hidden />
      </span>
      <span className="flex items-center gap-2.5">
        {students.length > 0 && (
          <span className="inline-flex pl-2">
            {students.slice(0, 5).map((s) => (
              <Avatar key={s.id} colour={colourOf(cls.id)} name={`${s.firstName} ${s.lastName}`} size={30} className="-ml-2 border-2 border-card" />
            ))}
          </span>
        )}
        <span className="text-[13px] font-semibold text-secondary-foreground">{students.length > 0 ? plural(students.length, "student") : "No students yet"}</span>
        <span className="flex-1" />
        {unsure > 0 && <span className="rounded-full bg-sunny px-2.5 py-0.5 text-xs font-bold text-sunny-foreground">{unsure} unsure</span>}
      </span>
    </Link>
  );
}

// Every class as a card, and New class at the end. With no class yet the form is open and
// cannot be cancelled: there is nothing else to do here.
export default function ClassesPage({ classes, onCreated }: { classes: ClassRow[]; onCreated: (c: ClassRow) => void }) {
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const none = classes.length === 0;

  function created(c: ClassRow) {
    onCreated(c);
    setCreating(false);
    toast(`Created ${c.name}`);
    navigate(`/classes/${c.id}`);
  }

  return (
    <section>
      <PageTitle>Classes</PageTitle>
      <div className="mt-5 grid gap-3.5 md:grid-cols-2">
        {classes.map((c) => (
          <ClassCard key={c.id} cls={c} />
        ))}
        {none || creating ? (
          <NewClassForm onCreated={created} onCancel={none ? undefined : () => setCreating(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex min-h-[120px] items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-dashed-line text-[15px] font-bold text-accent-foreground hover:bg-accent/40"
          >
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-accent">
              <Plus className="size-5" aria-hidden />
            </span>
            New class
          </button>
        )}
      </div>
    </section>
  );
}
