import { Link } from "react-router";
import { AlertCircle, ArrowUp, ChevronRight, MessageSquareText, Mic } from "lucide-react";
import type { NoteWithTags } from "../../worker/api-types";
import { mmss, needsYou } from "../ui";
import { useElapsed } from "../useRecorder";
import { LogoWave } from "@/components/page";
import { cn } from "@/lib/utils";
import SoundBars from "./SoundBars";
import { MAX_RECORDING_MS, type Capture } from "./useCapture";

// The phone's Notes home: one giant button, Shazam-style. The screen is cobalt, red while
// recording; the result slides up as the Saved sheet (NotesView). The bottom padding clears
// the fixed tab bar.
export default function RecordHome({ capture, notes, needsCount, onOpenNeeds }: { capture: Capture; notes: NoteWithTags[]; needsCount: number; onOpenNeeds: () => void }) {
  const { recorder, pending, draft, setDraft } = capture;
  const elapsedMs = useElapsed(recorder.startedAt);
  const recording = recorder.recording;
  const saving = pending === "voice";
  const idle = !recording && !saving;
  const latest = notes[0];

  return (
    <section
      aria-label="Record a note"
      className={cn(
        "flex min-h-svh flex-col px-[18px] pt-[18px] pb-[calc(var(--tabbar-h)+16px)] text-white transition-colors duration-300",
        recording ? "bg-recording" : "bg-primary",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="inline-flex size-8 items-center justify-center rounded-[10px] bg-white/20">
          <LogoWave className="size-4" strokeWidth={2.4} />
        </span>
        <span className="flex-1 text-[17px] font-extrabold tracking-[-0.02em]">Throughline</span>
        {needsCount > 0 && (
          <button type="button" onClick={onOpenNeeds} className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full bg-sunny-dot px-3 text-[13px] font-extrabold text-sunny-ink">
            <AlertCircle className="size-4" aria-hidden />
            {needsYou(needsCount)}
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-[18px] py-2">
        <div className="relative flex size-[310px] items-center justify-center">
          <span aria-hidden className={cn("absolute inset-7 rounded-full bg-white/25", recording ? "animate-ring-fast" : "animate-ring")} />
          <span aria-hidden className={cn("absolute inset-7 rounded-full bg-white/25", recording ? "animate-ring-fast [animation-delay:.6s]" : "animate-ring [animation-delay:1.3s]")} />
          {idle && (
            <button
              type="button"
              onClick={capture.record}
              disabled={!recorder.supported || pending !== null}
              className="relative flex size-[254px] flex-col items-center justify-center gap-2.5 rounded-full bg-white text-primary shadow-lift disabled:opacity-80"
            >
              <Mic className="size-[60px]" strokeWidth={2.1} aria-hidden />
              <span className="text-[26px] font-extrabold tracking-[-0.02em]">Record note</span>
            </button>
          )}
          {recording && (
            <button
              type="button"
              onClick={recorder.stop}
              aria-label="Stop and save"
              className="relative flex size-[254px] flex-col items-center justify-center gap-3.5 rounded-full bg-white text-recording shadow-lift"
            >
              <span className="text-[54px] leading-none font-extrabold tracking-[-0.03em] tabular-nums">{mmss(elapsedMs)}</span>
              <span className="size-[30px] rounded-lg bg-recording" />
              <span className="text-base font-extrabold">Tap to stop</span>
            </button>
          )}
          {saving && (
            <div role="status" className="relative flex size-[254px] flex-col items-center justify-center gap-4 rounded-full bg-white/15 text-center">
              <span className="size-[50px] animate-spin rounded-full border-[5px] border-white/30 border-t-white" aria-hidden />
              <span className="text-[19px] leading-[1.3] font-extrabold">
                Transcribing
                <br />
                and tagging…
              </span>
            </div>
          )}
        </div>
        {idle && (
          <p className="text-center text-[15.5px] font-semibold text-white/90">
            {recorder.supported ? "Tap and talk. Name students as you go." : "This browser can't record. Type a note below."}
          </p>
        )}
        {recording && (
          <div className="flex flex-col items-center gap-2.5">
            <SoundBars stream={recorder.stream} barClassName="bg-white/80" />
            <p className="text-[13.5px] font-semibold text-white/90">Up to {mmss(MAX_RECORDING_MS)} · saves the moment you stop</p>
            <button type="button" onClick={recorder.cancel} className="min-h-10 rounded-full border border-white/50 px-[18px] text-sm font-bold">
              Discard
            </button>
          </div>
        )}
      </div>

      {idle && (
        <div className="flex flex-col gap-2.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void capture.saveDraft();
            }}
            className="flex min-h-[50px] items-center rounded-full bg-white/20 pr-[5px] pl-[18px] focus-within:ring-3 focus-within:ring-white/60">
            <input
              aria-label="Type a note instead"
              placeholder="Or type a note…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[15.5px] text-white outline-none placeholder:text-white/80"
            />
            {draft.trim() && (
              <button type="submit" aria-label="Save note" disabled={pending !== null} className="inline-flex size-10 flex-none items-center justify-center rounded-full bg-white text-primary disabled:opacity-60">
                {pending === "text" ? <span className="size-4 animate-spin rounded-full border-2 border-accent border-t-primary" aria-hidden /> : <ArrowUp className="size-4" strokeWidth={2.6} aria-hidden />}
              </button>
            )}
          </form>
          <Link to="/notes/feed" className="flex w-full items-center gap-3 rounded-[20px] bg-white py-3 pr-3.5 pl-3 text-foreground shadow-pop">
            <span className="inline-flex size-[42px] flex-none items-center justify-center rounded-[13px] bg-accent text-accent-foreground">
              <MessageSquareText className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-extrabold">
                Recent notes <span className="font-semibold text-muted-foreground">{notes.length}</span>
              </span>
              <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{latest ? latest.body : "Nothing yet"}</span>
            </span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        </div>
      )}
    </section>
  );
}
