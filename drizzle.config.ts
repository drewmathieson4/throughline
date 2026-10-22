import { defineConfig } from "drizzle-kit";

// drizzle-kit only needs this to turn worker/db/schema.ts into SQL migration files
// under ./drizzle. Applying them is wrangler's job (see package.json scripts).
export default defineConfig({
  schema: "./worker/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
});
