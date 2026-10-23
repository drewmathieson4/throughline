// Reading an uploaded file into text, shared by every route that takes a document (a
// progress report, a syllabus). The file arrives as the raw request body, its name in the
// query string, like a voice note's audio. Plain text is decoded here; PDF and Word files go
// through Workers AI's toMarkdown on the same AI binding Whisper uses: no package, no
// second vendor, free for these formats. The file itself is never stored.
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { UploadExtension } from "./api-types";
import type { AppEnv } from "./db/client";

// Well above a term's report pack; a 10 MB PDF is a scan, which toMarkdown cannot read anyway.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// About fifteen pages of text once converted: a term's report pack, a syllabus. A document of
// reports is copied back by the model, so this also bounds one call's output and the wait.
const MAX_UPLOAD_CHARS = 60_000;

// What each accepted extension is read as. toMarkdown wants the media type on the blob (an
// untyped blob is rejected), and the extension is a surer guide than what the browser sends.
const mediaTypes: Record<UploadExtension, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
};
const uploadExtensions = Object.keys(mediaTypes) as UploadExtension[];
const extensionOf = (name: string): UploadExtension | null => {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return uploadExtensions.find((e) => e === ext) ?? null;
};

// The file name as sent by the browser; what it ends in decides how it is read.
export const uploadName = z
  .string()
  .trim()
  .min(1, "file name is required")
  .max(200, "file name is too long")
  .refine((n) => extensionOf(n) !== null, `unsupported file type (use ${uploadExtensions.join(", ")})`);

// A cap on a raw request body: rejects a declared content-length over it, otherwise stops
// reading as soon as the body passes it, so an oversized upload is never fully buffered.
export const limitBody = (maxSize: number, message: string) =>
  bodyLimit({
    maxSize,
    onError: () => {
      throw new HTTPException(413, { message });
    },
  });
export const uploadLimit = limitBody(MAX_UPLOAD_BYTES, "file is too large");

// Embedded images would be sent to an image model, which is the one billed part of
// toMarkdown; a report's text is what matters.
const noImages = { images: { convert: false } };

// The text of the uploaded file, trimmed, or a 400 saying why there is none. `name` has
// passed uploadName.
export async function readUpload(c: Context<AppEnv>, name: string): Promise<string> {
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) throw new HTTPException(400, { message: "file is empty" });

  let text: string;
  const ext = extensionOf(name)!;
  if (ext === "txt" || ext === "md") {
    text = new TextDecoder().decode(bytes);
  } else {
    // The binding reports an unreadable file as a result with format "error", and throws on
    // input it will not take at all; both mean the same thing to the teacher.
    const unreadable = (why: unknown) => {
      console.error("toMarkdown failed for", name, why);
      return new HTTPException(400, { message: "could not read that file" });
    };
    const blob = new Blob([bytes], { type: mediaTypes[ext] });
    let result: ConversionResponse;
    try {
      result = await c.env.AI.toMarkdown({ name, blob }, { conversionOptions: { pdf: noImages, docx: noImages } });
    } catch (err) {
      throw unreadable(err);
    }
    if (result.format === "error") throw unreadable(result.error);
    text = result.data;
  }
  text = text.trim();
  if (!text) throw new HTTPException(400, { message: "could not read that file" });
  if (text.length > MAX_UPLOAD_CHARS) throw new HTTPException(400, { message: `file is too long (over ${MAX_UPLOAD_CHARS.toLocaleString("en")} characters)` });
  return text;
}
