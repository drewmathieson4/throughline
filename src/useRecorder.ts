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
  elapsedMs: number;
  start: () => Promise<void>;
  stop: () => void;
};

/** hitLimit is true when the time limit ended the recording rather than the teacher. */
export type Recording = { audio: Blob; hitLimit: boolean };

export function useRecorder({ maxMs, onStop }: { maxMs: number; onStop: (rec: Recording) => void }): Recorder {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  // Set while start() awaits the permission prompt, so a second click cannot open a second mic.
  const startingRef = useRef(false);
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

  const start = useCallback(async () => {
    if (recorderRef.current || startingRef.current) return;
    startingRef.current = true;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).finally(() => {
      startingRef.current = false;
    });
    // Releasing the tracks turns off the browser's "mic in use" indicator.
    const release = () => stream.getTracks().forEach((t) => t.stop());

    let rec: MediaRecorder;
    try {
      const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      rec = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: BITRATE });
    } catch (err) {
      release();
      throw err;
    }

    const chunks: Blob[] = [];
    const startedAt = Date.now();
    const tick = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    const limit = window.setTimeout(() => rec.stop(), maxMs);

    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      window.clearInterval(tick);
      window.clearTimeout(limit);
      release();
      recorderRef.current = null;
      setRecording(false);
      setElapsedMs(0);
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_MS) return;
      onStopRef.current({ audio: new Blob(chunks, { type: rec.mimeType }), hitLimit: elapsed >= maxMs });
    };

    recorderRef.current = rec;
    setRecording(true);
    rec.start();
  }, [maxMs]);

  // Leaving the page mid-recording must not leave the mic open.
  useEffect(() => stop, [stop]);

  return { supported, recording, elapsedMs, start, stop };
}
