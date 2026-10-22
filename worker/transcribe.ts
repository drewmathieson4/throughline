// Speech to text via Workers AI Whisper. Kept in its own file so the model choice lives
// in one place and route tests can swap the AI binding for a fake.
const MODEL = "@cf/openai/whisper-large-v3-turbo";

// Returns the trimmed transcript; empty string means Whisper heard nothing.
export async function transcribe(ai: Ai, audio: ArrayBuffer): Promise<string> {
  const result = await ai.run(MODEL, {
    audio: new Uint8Array(audio).toBase64(),
    task: "transcribe",
    language: "en",
    // Drops silent stretches before decoding; Whisper tends to invent text for silence.
    vad_filter: true,
  });
  // Whisper can answer without a text field for clips it filtered down to silence.
  return (result.text ?? "").trim();
}
