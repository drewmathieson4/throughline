// Zod schemas on Hono's bundled validator (no extra dependency). A failed parse throws a
// 400 whose message is the first issue; app.onError turns it into { error: message }.
import { validator } from "hono/validator";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";

export const validate = <Target extends "json" | "query" | "param", Schema extends z.ZodType>(target: Target, schema: Schema) =>
  validator(target, (value): z.output<Schema> => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? "invalid request" });
    }
    return parsed.data;
  });
