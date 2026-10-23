import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import type { ClassRow } from "../../worker/db/schema";
import { api, jsonInit } from "../api";
import { Avatar } from "@/components/Avatar";
import { PageTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { errorText, fieldLabel, input } from "../ui";
import { useAction } from "../useAction";
import { termLabel } from "./term";

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
      <label className={fieldLabel}>
        Class name
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Period 8 · Journalism" />
      </label>
      <div className="grid grid-cols-2 gap-2.5">
        <label className={fieldLabel}>
          Term starts
          <input type="date" className={input} value={termStart} onChange={(e) => setTermStart(e.target.value)} />
        </label>
        <label className={fieldLabel}>
          Term ends
          <input type="date" className={input} value={termEnd} onChange={(e) => setTermEnd(e.target.value)} />
        </label>
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
      {none && <p className="mt-2 text-[15px] text-muted-foreground">Create your first class, then add its students and course materials.</p>}
      <div className="mt-5 grid gap-3.5 md:grid-cols-2">
        {classes.map((c) => (
          <Link
            key={c.id}
            to={`/classes/${c.id}`}
            className="flex min-h-[120px] items-center gap-3.5 rounded-2xl border border-border bg-card p-[18px] shadow-card transition-colors hover:border-ring/60"
          >
            <Avatar id={c.id} name={c.name} size="lg" square />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-lg font-extrabold tracking-[-0.01em]">{c.name}</span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">{termLabel(c)}</span>
            </span>
            <ChevronRight className="size-5 text-[#9AA1AE]" aria-hidden />
          </Link>
        ))}
        {none || creating ? (
          <NewClassForm onCreated={created} onCancel={none ? undefined : () => setCreating(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex min-h-[120px] items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-[#C9D0DC] text-[15px] font-bold text-accent-foreground hover:bg-accent/40"
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
