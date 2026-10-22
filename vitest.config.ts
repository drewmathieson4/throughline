import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: Vitest would otherwise load the Cloudflare
// Vite plugin and try to boot the dev Worker. Route tests get their D1 from wrangler's
// getPlatformProxy instead (see worker/routes/notes.test.ts).
export default defineConfig({
  test: {
    hookTimeout: 30_000, // Miniflare takes a few seconds to start
  },
});
