import { useState } from "react";
import { AlertCircle, Check, Upload } from "lucide-react";
import { toast } from "sonner";
import type { DocumentImportResult, DocumentKind, DocumentProgress, DocumentStep } from "../../worker/api-types";
import { DOCUMENT_TYPES, fileInit } from "../api";
import FilePicker from "../FilePicker";
import NoteItem from "../NoteItem";
import { kinds } from "../noteKinds";
import { useNotes } from "../notes/notesStore";
import Tags from "../notes/Tags";
import { documentHeadline, documentLines } from "../students/importText";
import { caption, chipOff, errorText, mmss } from "../ui";
import { useAction } from "../useAction";
import { useElapsed } from "../useRecorder";
import { Avatar } from "@/components/Avatar";
import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A finished import, with the file kept in memory so the result card can re-post it. */
export type DocumentImport = { result: DocumentImportResult; file: File };

/** The steps an import has reported so far, and when it began. */
type Progress = { startedAt: number; steps: Map<DocumentStep, "running" | "done"> };

// Posts the file and reads the import's stream line by line, handing each step to onStep.
// A refusal before the stream starts is an ordinary JSON error.
async function postDocument(url: string, file: File, onStep: (step: DocumentStep, done: boolean) => void): Promise<DocumentImportResult> {
  const res = await fetch(url, fileInit(file));
  if (res.headers.get("content-type") !== "application/x-ndjson" || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `${url} → ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  let outcome: DocumentProgress | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const lines = (buffered + value).split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines.filter((l) => l.trim())) {
      const parsed = JSON.parse(line) as DocumentProgress;
      if ("step" in parsed) onStep(parsed.step, parsed.done === true);
      else outcome = parsed;
    }
  }
  if (!outcome || "step" in outcome) throw new Error("The import stopped before it finished.");
  if ("error" in outcome) throw new Error(outcome.error);
  return outcome.result;
}

// Posts a file to /api/documents, showing each step as the Worker reports it, and folds the
// notes it made into the notes store; a toast says what happened. `as` is the kind when the
// teacher has said it.
function useDocumentImport(onImported: (imported: DocumentImport) => void) {
  const { add, classNames } = useNotes();
  const [progress, setProgress] = useState<Progress | null>(null);
  const action = useAction(async (file: File, classIds: string[], as?: DocumentKind) => {
    const query = new URLSearchParams({ name: file.name, classIds: classIds.join(",") });
    // The file's own date is the fallback for notes from a document that states none.
    if (file.lastModified > 0 && file.lastModified <= Date.now()) query.set("modified", new Date(file.lastModified).toISOString());
    if (as) query.set("as", as);
    setProgress({ startedAt: Date.now(), steps: new Map() });
    try {
      const result = await postDocument(`/api/documents?${query}`, file, (step, done) =>
        setProgress((p) => p && { ...p, steps: new Map(p.steps).set(step, done ? "done" : "running") }),
      );
      add(result.notes, result.replaced);
      if (result.splitFailed) toast.warning(documentHeadline(result, classNames));
      else toast.success(documentHeadline(result, classNames));
      onImported({ result, file });
    } finally {
      setProgress(null);
    }
  });
  return { ...action, progress };
}

const STEP_LABELS: Record<DocumentStep, string> = {
  read: "Reading the file",
  sort: "Working out what it is",
  summarise: "Summarising the course",
  split: "Making notes for each student",
  save: "Saving",
};

// The import's steps as they start and finish, with a running clock: a long report pack
// takes a minute, and a still screen for that long looks broken.
function ImportProgress({ progress }: { progress: Progress }) {
  const elapsed = useElapsed(progress.startedAt);
  // Until the first step arrives, the file is still on its way up.
  const steps: [string, "running" | "done"][] = progress.steps.size > 0 ? [...progress.steps].map(([id, state]) => [STEP_LABELS[id], state]) : [["Uploading", "running"]];
  return (
    <div role="status" className="rounded-[14px] bg-muted px-3.5 py-3">
      <ol className="flex flex-col gap-2">
        {steps.map(([label, state]) => (
          <li key={label} className="flex items-center gap-2.5 text-sm font-semibold">
            {state === "done" ? (
              <Check className="size-4 flex-none text-primary" strokeWidth={3} aria-hidden />
            ) : (
              <span className="size-4 flex-none animate-spin rounded-full border-2 border-ring/40 border-t-primary" aria-hidden />
            )}
            <span className={cn(state === "done" && "text-muted-foreground")}>{label}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs font-semibold text-muted-foreground tabular-nums">{mmss(elapsed)}</p>
    </div>
  );
}

// Tick the classes the file is for (this one already is) and pick it: the import starts on
// the spot and the Worker works out whether it is course material, student notes, or both.
export default function ImportDocument({ classId, onImported }: { classId: string; onImported: (imported: DocumentImport) => void }) {
  const { classNames, colourOf } = useNotes();
  const [picked, setPicked] = useState([classId]);
  const { run, busy, error, progress } = useDocumentImport(onImported);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="mt-4 flex flex-col gap-3">
      <fieldset disabled={busy}>
        <legend className={`mb-2 ${caption}`}>Classes</legend>
        <div className="flex flex-wrap gap-2">
          {[...classNames].map(([id, name]) => {
            const on = picked.includes(id);
            const { bg, fg } = colourOf(id);
            return (
              <label
                key={id}
                style={on ? { background: bg, borderColor: fg, color: fg } : undefined}
                className={cn(
                  "inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-full border pr-3.5 pl-1.5 text-sm font-bold has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                  !on && chipOff,
                )}
              >
                <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(id)} />
                <Avatar colour={{ bg, fg }} name={name} size={30} />
                {name}
                <Check className={cn("size-4", !on && "invisible")} strokeWidth={3} aria-hidden />
              </label>
            );
          })}
        </div>
      </fieldset>
      {progress ? (
        <ImportProgress progress={progress} />
      ) : (
        <FilePicker accept={DOCUMENT_TYPES} disabled={busy || picked.length === 0} onFile={(file) => run(file, picked)} className="justify-center px-3.5 text-[15px] font-bold">
          <Upload className="size-4" aria-hidden />
          Choose a file
        </FilePicker>
      )}
      {error && <p className={errorText}>{error}</p>}
    </div>
  );
}

// The card's account of an import: what was done, the notes it made (each opens), and the
// switch for a wrong guess, which re-posts the same file to the same classes with the kind
// given and so replaces what the first import made.
export function DocumentSummary({ imported, onImported }: { imported: DocumentImport; onImported: (imported: DocumentImport) => void }) {
  const { classNames } = useNotes();
  const { result, file } = imported;
  const { run, busy, error, progress } = useDocumentImport(onImported);
  const switches: { as: DocumentKind; label: string }[] = [];
  if (result.kind !== "students") switches.push({ as: "students", label: "Treat as student notes instead" });
  if (result.kind !== "course") switches.push({ as: "course", label: "Treat as course material instead" });

  return (
    <>
      {documentLines(result, classNames).map((line, i) => (
        <p key={line} className={i === 0 ? "font-bold" : "mt-1 text-secondary-foreground"}>
          {line}
        </p>
      ))}
      <MadeNotes key={result.notes.map((n) => n.id).join()} made={result.notes} />
      {error && <p className={`mt-2 ${errorText}`}>{error}</p>}
      {progress ? (
        <div className="mt-3">
          <ImportProgress progress={progress} />
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {switches.map((s) => (
            <Button key={s.as} type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(file, result.classIds, s.as)}>
              {s.label}
            </Button>
          ))}
        </div>
      )}
    </>
  );
}

// One chip per note the import made, by the student it is about (or the name it could not
// settle); a chip opens the note with its tags, as the student timeline does.
function MadeNotes({ made }: { made: DocumentImportResult["notes"] }) {
  const { notes, people, colourOf } = useNotes();
  const [openId, setOpenId] = useState<string | null>(null);
  if (made.length === 0) return null;
  // The store's copy, so a tag changed in the window shows here too.
  const current = (id: string) => notes?.find((n) => n.id === id) ?? made.find((n) => n.id === id);
  const shown = openId ? current(openId) : undefined;

  return (
    <>
      <ul className="mt-3 flex flex-wrap gap-2">
        {made.map((n) => {
          const person = n.students[0] && people.get(n.students[0].studentId);
          const chip = "inline-flex min-h-9 items-center gap-1.5 rounded-full border text-[13.5px] font-bold hover:bg-muted";
          return (
            <li key={n.id}>
              {person ? (
                <button type="button" onClick={() => setOpenId(n.id)} className={cn(chip, "border-border bg-card pr-3 pl-1")}>
                  <Avatar colour={colourOf(person.classId)} name={person.name} size={30} />
                  {person.name}
                </button>
              ) : (
                <button type="button" onClick={() => setOpenId(n.id)} className={cn(chip, "border-sunny-line/60 bg-sunny-soft px-3 text-sunny-ink")}>
                  <AlertCircle className="size-4" aria-hidden />
                  {n.mentions[0]?.mentionText ?? "Unassigned"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <Panel open={shown !== undefined} onOpenChange={(open) => !open && setOpenId(null)} title={shown ? kinds[shown.kind].label : ""}>
        {shown && (
          <ul className="mt-3 overflow-y-auto">
            <NoteItem note={shown}>
              <Tags note={shown} />
            </NoteItem>
          </ul>
        )}
      </Panel>
    </>
  );
}
