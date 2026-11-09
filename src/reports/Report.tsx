import { useEffect, useState } from "react";
import { Copy, PenLine, Settings2 } from "lucide-react";
import { toast } from "sonner";
import type { ReportView, SynthesisRosterRow } from "../../worker/api-types";
import { api, jsonInit, messageOf } from "../api";
import { CappedNotice } from "../auth/CappedNotice";
import { useAllowance } from "../auth/allowanceStore";
import { dateFormat, errorText } from "../ui";
import { useAutosave } from "../useAutosave";
import ReportSettings from "./ReportSettings";
import { useReports } from "./reportsStore";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// The report: the comment for the parents, written from the saved evidence and edited here.
// Edits save on their own shortly after the last keystroke and when the box loses focus; the
// generated text is kept underneath so Reset is free. Copy puts the text on the clipboard
// for the school's report system. A report belongs to the summary it was written from, so a
// remade summary shows none until Write report is pressed again. Shown only for a student
// with evidence; ReportPane covers the rest.

export default function Report({ row, classId, disabled, onWrite }: { row: SynthesisRosterRow; classId: string; disabled: boolean; onWrite: () => void }) {
  const [loaded, setLoaded] = useState<ReportView | null>(null);
  const [text, setText] = useState("");
  // A load failure stays with the report it came from, so moving on clears it.
  const [failed, setFailed] = useState<{ reportId: string; message: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { reportsCapped } = useAllowance();
  const writing = useReports().writing.has(row.studentId);
  const id = row.reportId;

  // Back to exactly the generated text counts as untouched.
  const { saved, error: saveError, edit: schedule, flush } = useAutosave<string | null>(id, (editedText, reportId) =>
    api<ReportView>(`/api/reports/${reportId}`, jsonInit("PATCH", { editedText })).then((r) => setLoaded((prev) => (prev && prev.id === r.id ? r : prev))),
  );

  useEffect(() => {
    if (!id) return;
    let latest = true;
    api<ReportView>(`/api/reports/${id}`)
      .then((r) => {
        if (!latest) return;
        setLoaded(r);
        setText(r.editedText ?? r.generatedText);
      })
      .catch((e) => latest && setFailed({ reportId: id, message: messageOf(e) }));
    return () => {
      latest = false;
    };
  }, [id]);

  const shown = loaded && loaded.id === id ? loaded : null;
  const loadError = failed && failed.reportId === id ? failed.message : null;
  const error = loadError ?? saveError;

  function edit(next: string) {
    if (!shown) return;
    setText(next);
    schedule(next === shown.generatedText ? null : next);
  }

  function reset() {
    if (!shown) return;
    setText(shown.generatedText);
    schedule(null);
    flush();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy; select the text and copy it instead");
    }
  }

  const settings = <ReportSettings classId={classId} open={settingsOpen} onOpenChange={setSettingsOpen} />;
  const settingsButton = (
    <Button type="button" variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
      <Settings2 aria-hidden />
      Report settings
    </Button>
  );

  if (shown) {
    const edited = shown.editedText !== null;
    return (
      <>
        {row.status === "stale" && (
          <p className="mt-[18px] rounded-2xl border border-sunny-line bg-sunny-soft px-4 py-3 text-sm font-bold text-sunny-ink">
            The evidence has changed since this was written. Regenerate it on the Evidence tab, then write again.
          </p>
        )}
        <p className="mt-[18px] text-[13px] text-muted-foreground">
          Written {dateFormat.format(new Date(shown.createdAt))}
          {edited && " · Edited"}
          {!saved && " · Saving…"}
        </p>
        <Textarea aria-label="Report" className="mt-2.5 min-h-40 text-[16px] leading-[1.7] md:text-[16px]" value={text} onChange={(e) => edit(e.target.value)} onBlur={flush} />
        {error && <p className={cn("mt-2", errorText)}>{error}</p>}
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Button type="button" variant="soft" onClick={copy}>
            <Copy aria-hidden />
            Copy
          </Button>
          {edited && (
            <Button type="button" variant="outline" size="sm" onClick={reset}>
              Reset to generated
            </Button>
          )}
          <span className="flex-1" />
          {settingsButton}
          {reportsCapped && !writing ? (
            <CappedNotice short nudge={{ size: "sm", className: "border-ring/60 text-accent-foreground" }} />
          ) : (
            <Button type="button" variant="outline" size="sm" className="border-ring/60 text-accent-foreground" disabled={disabled || writing} onClick={onWrite}>
              {writing && <span className="size-3 animate-spin rounded-full border-2 border-accent border-t-primary" aria-hidden />}
              {writing ? "Writing…" : "Write again"}
            </Button>
          )}
        </div>
        {settings}
      </>
    );
  }

  return (
    <div className="mt-[22px] px-5 py-8 text-center">
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
        {writing ? <span className="size-6 animate-spin rounded-full border-[3px] border-ring/40 border-t-primary" aria-hidden /> : <PenLine className="size-6" aria-hidden />}
      </span>
      {loadError && <p className={cn("mt-3", errorText)}>{loadError}</p>}
      {id && !loadError ? (
        <p className="mt-3 text-base font-extrabold">Loading…</p>
      ) : writing ? (
        <p className="mt-3 text-base font-extrabold">Writing…</p>
      ) : (
        <>
          <p className="mt-3 text-base font-extrabold">No report yet</p>
          <p className="mx-auto mt-1.5 max-w-[34ch] text-[13.5px] text-muted-foreground">Written from the evidence, for you to edit before it goes out.</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {reportsCapped ? (
              <CappedNotice />
            ) : (
              <Button type="button" disabled={disabled} onClick={onWrite}>
                <PenLine aria-hidden />
                Write report
              </Button>
            )}
            {settingsButton}
          </div>
        </>
      )}
      {settings}
    </div>
  );
}
