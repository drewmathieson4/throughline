// Shared by the demo note generator and loader. Both read the roster from a running dev
// server (`npm run dev`), so the notes match the database with no second copy to drift.
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { RosterEntry, TagClass } from "../../worker/tagging.ts";
import { Expected, messageOf } from "../eval/shared.ts";

export const NOTES_PATH = new URL("notes.json", import.meta.url);
export const baseUrlOption = { type: "string", default: "http://localhost:5173" } as const;

export const DemoNote = z.object({
  id: z.string(),
  // The class the batch was written for; regenerating one class replaces only its notes.
  batch: z.string(),
  notedAt: z.iso.datetime(),
  note: z.string(),
  expected: Expected,
  rationale: z.string(),
});
export type DemoNote = z.infer<typeof DemoNote>;

export const loadNotes = (): DemoNote[] => z.array(DemoNote).parse(JSON.parse(readFileSync(NOTES_PATH, "utf8")));

// The API needs a signed-in teacher. Sign in at the dev server in a browser, then copy the
// `session` cookie's value (DevTools → Application → Cookies) into SESSION for the script.
export const authHeaders = (): Record<string, string> => (process.env.SESSION ? { cookie: `session=${process.env.SESSION}` } : {});
const SIGN_IN_HINT = "sign in at the dev server, copy the `session` cookie value from DevTools → Application → Cookies, and run with SESSION=<value>";

export async function checkResponse(res: Response, url: string): Promise<void> {
  if (res.ok) return;
  if (res.status === 401) throw new Error(`${url} → 401: ${SIGN_IN_HINT}`);
  throw new Error(`${url} → ${res.status} ${await res.text()}`);
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() }).catch((err) => {
    throw new Error(`could not reach ${url} (is \`npm run dev\` running?): ${messageOf(err)}`);
  });
  await checkResponse(res, url);
  return res.json() as Promise<T>;
}

// The routes return more columns than these types name; the extras are ignored.
export async function fetchRoster(baseUrl: string): Promise<{ classes: TagClass[]; students: RosterEntry[] }> {
  const classes = await getJson<TagClass[]>(`${baseUrl}/api/classes`);
  const rosters = await Promise.all(classes.map((c) => getJson<RosterEntry[]>(`${baseUrl}/api/students?classId=${c.id}`)));
  return { classes, students: rosters.flat() };
}

// Short, stable id prefix for a class: initials of its words ("Period 3 Humanities" → p3h).
export const classSlug = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toLowerCase();
