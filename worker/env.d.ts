// Secrets never go in wrangler.jsonc, so the generated worker-configuration.d.ts does not know
// about them (unless a local .dev.vars exists when `wrangler types` runs, which is why that
// file is not re-committed with the key in it). This is the one committed declaration; it
// merges with the generated `Env` and typechecks on a fresh clone.
interface Env {
  ANTHROPIC_API_KEY: string;
}
