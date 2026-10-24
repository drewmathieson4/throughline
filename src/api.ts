import type { UploadExtension } from "../worker/api-types";

// Every /api error response is { error: string }; surface that message when present.
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `${url} → ${res.status}`);
  return data as T;
}

export const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// What the document upload routes read. The type-only import means a misspelt or dropped
// extension fails typecheck without any Worker code reaching the browser bundle.
const DOCUMENT_EXTENSIONS: Record<UploadExtension, true> = { pdf: true, docx: true, txt: true, md: true };
export const DOCUMENT_TYPES = Object.keys(DOCUMENT_EXTENSIONS).map((e) => `.${e}`).join(",");

// A file or recording sent as the raw request body, the way the upload routes read it. The
// browser leaves the type blank for some extensions; the Worker decides by the name anyway.
export const fileInit = (file: Blob): RequestInit => ({
  method: "POST",
  headers: { "content-type": file.type || "application/octet-stream" },
  body: file,
});

export const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
