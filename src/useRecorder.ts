import { useCallback, useEffect, useRef, useState } from "react";

// Mic capture via the browser's MediaRecorder. Owns the stream, the chunk buffer, and the
// time limit so App.tsx only deals with "start", "stop", and the resulting Blob.

// First type the browser supports wins. Chrome/Firefox: webm+opus. Safari: mp4 (aac).
// The server accepts any audio/* type, so this list is only a preference order.
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
// Speech is intelligible well below music bitrates; this keeps a 5-minute clip near 1 MB.
const BITRATE = 32_000;
// Anything shorter is a mis-tap: a header-only Blob that Whisper would charge for and reject.
const MIN_MS = 1000;

export type Recorder = {
  supported: boolean;
  recording: boolean;
  /** When the recording began (Date.now()), for useElapsed; null when not recording. */
  startedAt: number | null;
  /** The live mic while recording, for a level meter; null otherwise. */
  stream: MediaStream | null;
  start: () => Promise<void>;
  stop: () => void;
  /** Stops without handing anything to onStop: the teacher's Discard. */
  cancel: () => void;
};

/** hitLimit is true when the time limit ended the recording rather than the teacher. */
export type Recording = { audio: Blob; hitLimit: boolean };

export function useRecorder({ maxMs, onStop }: { maxMs: number; onStop: (rec: Recording) => void }): Recorder {
  // Set for the length of a recording; recording, stream and startedAt all derive from it.
  const [live, setLive] = useState<{ stream: MediaStream; startedAt: number } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  // Set while start() awaits the permission prompt, so a second click cannot open a second mic.
  const startingRef = useRef(false);
  // Set by cancel() so the stop that follows throws the audio away.
  const discardRef = useRef(false);
  // Latest onStop without re-creating start/stop every render.
  const onStopRef = useRef(onStop);
  useEffect(() => {
    onStopRef.current = onStop;
  }, [onStop]);

  const supported = typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const cancel = useCallback(() => {
    discardRef.current = true;
    stop();
  }, [stop]);

  const start = useCallback(async () => {
    if (recorderRef.current || startingRef.current) return;
    startingRef.current = true;
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true }).finally(() => {
      startingRef.current = false;
    });
    // Releasing the tracks turns off the browser's "mic in use" indicator.
    const release = () => mic.getTracks().forEach((t) => t.stop());

    let rec: MediaRecorder;
    try {
      const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      rec = new MediaRecorder(mic, { mimeType, audioBitsPerSecond: BITRATE });
    } catch (err) {
      release();
      throw err;
    }

    const chunks: Blob[] = [];
    const startedAt = Date.now();
    const limit = window.setTimeout(() => rec.stop(), maxMs);

    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      window.clearTimeout(limit);
      release();
      recorderRef.current = null;
      setLive(null);
      const elapsed = Date.now() - startedAt;
      const discarded = discardRef.current;
      discardRef.current = false;
      if (discarded || elapsed < MIN_MS) return;
      onStopRef.current({ audio: new Blob(chunks, { type: rec.mimeType }), hitLimit: elapsed >= maxMs });
    };

    recorderRef.current = rec;
    discardRef.current = false;
    setLive({ stream: mic, startedAt });
    rec.start();
  }, [maxMs]);

  // Leaving the page mid-recording must not leave the mic open.
  useEffect(() => stop, [stop]);

  return { supported, recording: live !== null, startedAt: live?.startedAt ?? null, stream: live?.stream ?? null, start, stop, cancel };
}

// Time since startedAt, ticking four times a second; 0 when not recording (and until the
// first tick, since `now` may predate the start). Call it in the component that shows the
// clock, so each tick re-renders only that component.
export function useElapsed(startedAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(tick);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}
