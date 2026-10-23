import { useState, type FormEvent } from "react";
import { Mic, Paperclip } from "lucide-react";
import { DOCUMENT_TYPES } from "../api";
import FilePicker from "../FilePicker";
import { mmss } from "../ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import SoundBars from "./SoundBars";
import { MAX_RECORDING_MS, type Capture } from "./useCapture";

// The laptop's way in: type, upload a document, or record. A note needs no class: tagging
// works out who it is about.
export default function CaptureCard({ capture }: { capture: Capture }) {
  const { pending, recorder } = capture;
  const [draft, setDraft] = useState("");
  const busy = pending !== null || recorder.recording;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (busy || !draft.trim()) return;
    if (await capture.saveText(draft)) setDraft("");
  }

  return (
    <>
      <form onSubmit={submit} className="mt-[22px] rounded-[22px] border bg-card p-[18px] pb-3.5 shadow-card">
        <label htmlFor="note" className="block text-[15px] font-bold">
          New note
        </label>
        <textarea
          id="note"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // ⌘/Ctrl+Enter adds the note without reaching for the mouse.
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          placeholder="What did you notice today? Name students and they're tagged for you."
          className="mt-2.5 block w-full resize-y rounded-[14px] border border-input bg-field px-3.5 py-3 text-[15px] leading-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FilePicker accept={DOCUMENT_TYPES} disabled={busy} onFile={capture.upload} className="h-11 px-4">
            <Paperclip className="size-4" aria-hidden />
            {pending === "document" ? "Reading and tagging…" : "Upload a document"}
          </FilePicker>
          <span className="flex-1" />
          {recorder.supported && (
            <Button type="button" variant="soft" disabled={busy} onClick={capture.record}>
              <Mic aria-hidden />
              Record
            </Button>
          )}
          <Button type="submit" disabled={busy || !draft.trim()}>
            {pending === "text" ? "Saving and tagging…" : "Add note"}
          </Button>
        </div>
      </form>
      <RecordDialog capture={capture} />
    </>
  );
}

// Open while recording and while the recording saves. Esc and clicks outside do nothing, so
// a recording is only ever ended by Stop or Discard.
function RecordDialog({ capture }: { capture: Capture }) {
  const { recorder, pending, nearLimit } = capture;
  const keep = (e: Event) => e.preventDefault();
  return (
    <Dialog open={recorder.recording || pending === "voice"}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        onEscapeKeyDown={keep}
        onInteractOutside={keep}
        className="block rounded-[28px] px-6 pt-[26px] pb-[34px] text-center sm:max-w-[460px]"
      >
        {recorder.recording ? (
          <>
            <DialogTitle className="inline-flex items-center gap-2 text-xs font-extrabold tracking-[.08em] text-coral-foreground uppercase">
              <span className="size-2 animate-pulse rounded-full bg-coral-dot" aria-hidden />
              Recording
            </DialogTitle>
            <p className={cn("mt-2.5 text-5xl font-extrabold tracking-[-0.03em] tabular-nums", nearLimit && "text-sunny-foreground")}>{mmss(recorder.elapsedMs)}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">of {mmss(MAX_RECORDING_MS)} · say students' names as you go</p>
            <SoundBars stream={recorder.stream} className="mt-4 h-14" barClassName="bg-coral-dot/60" />
            <button
              type="button"
              onClick={recorder.stop}
              aria-label="Stop and save"
              className="mt-[18px] inline-flex size-[92px] animate-pulse-stop items-center justify-center rounded-full bg-coral-dot"
            >
              <span className="size-7 rounded-lg bg-white" />
            </button>
            <p className="mt-3.5 text-[13.5px] text-secondary-foreground">Tap to stop. It saves straight away.</p>
            <Button type="button" variant="ghost" onClick={recorder.cancel} className="mt-2.5 text-muted-foreground">
              Discard
            </Button>
          </>
        ) : (
          <div role="status" className="pt-6 pb-3">
            <span className="inline-block size-11 animate-spin rounded-full border-4 border-accent border-t-primary" aria-hidden />
            <DialogTitle className="mt-4 text-lg font-extrabold">Transcribing and tagging…</DialogTitle>
            <p className="mt-1 text-[13.5px] text-muted-foreground">Usually a few seconds</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
