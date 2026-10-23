import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const BARS = 24;
const flat = () => Array<number>(BARS).fill(0);

// Each bar's frequency bin, low voices in the middle and higher ones towards the edges, so
// speech makes a hump rather than a slope. With a 256-point FFT a bin is roughly 190 Hz wide;
// bins 1 to 12 cover most of a speaking voice.
const BIN = Array.from({ length: BARS }, (_, i) => 1 + Math.floor(Math.abs(i - (BARS - 1) / 2)));

// Bar heights from 0 to 1, from the live mic. The bars stay flat when the mic hears
// nothing, which is the point: a teacher sees a dead mic before talking for two minutes.
function useLevels(stream: MediaStream | null) {
  const [levels, setLevels] = useState(flat);
  useEffect(() => {
    if (!stream) return;
    const audio = new AudioContext();
    // Safari can start the context suspended when it is not created inside the tap itself.
    void audio.resume();
    const source = audio.createMediaStreamSource(stream);
    const analyser = audio.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    const bins = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    let last = 0;
    // About ten renders a second: smooth enough with the CSS transition, cheap on a phone.
    const tick = (t: number) => {
      frame = requestAnimationFrame(tick);
      if (t - last < 100) return;
      last = t;
      analyser.getByteFrequencyData(bins);
      setLevels(BIN.map((b) => Math.min(1, bins[b] / 200)));
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void audio.close();
      setLevels(flat());
    };
  }, [stream]);
  return levels;
}

export default function SoundBars({ stream, className, barClassName }: { stream: MediaStream | null; className?: string; barClassName: string }) {
  const levels = useLevels(stream);
  return (
    <div aria-hidden className={cn("flex h-[52px] items-center justify-center gap-1", className)}>
      {levels.map((level, i) => (
        <span key={i} className={cn("w-1 rounded-full transition-[height] duration-150", barClassName)} style={{ height: 8 + Math.round(level * 44) }} />
      ))}
    </div>
  );
}
