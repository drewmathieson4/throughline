// Zod field rules shared across routes, so a name or date entered by hand or pulled from
// a pasted file is validated the same way everywhere.
import { z } from "zod";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Collapse runs of whitespace and drop control (Cc) and format (Cf) characters a pasted
// file may carry: Excel's UTF-8 BOM, zero-width spaces, direction marks. Left in, they
// look right on screen but break sorting and dedup against the same name typed by hand.
export const cleanName = (s: string) =>
  s
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const nameField = (label: string) =>
  z.string().transform(cleanName).pipe(z.string().min(1, `${label} is required`).max(100, `${label} is too long`));

export const dateField = (label: string) => z.iso.date(`${label} must be YYYY-MM-DD`);

// A day of slack covers time zones; beyond that a date is a typo, not a plan.
export const notInFuture = (s: string) => Date.parse(s) <= Date.now() + ONE_DAY_MS;

// A moment the browser reports (when a note was taken, when a file was saved). Re-serialized
// so every stored value has the same shape and ORDER BY sorts chronologically; bounded so a
// typo like 9999-… cannot sit at the top of a list for the rest of the term.
export const pastDatetime = (label: string) =>
  z.iso
    .datetime({ offset: true })
    .transform((s) => new Date(s).toISOString())
    .refine(notInFuture, `${label} is in the future`);

// ?classId=… on every list route; /:id on every single-row route.
export const classIdQuery = z.object({ classId: z.uuid() });
export const idParam = z.object({ id: z.uuid() });
