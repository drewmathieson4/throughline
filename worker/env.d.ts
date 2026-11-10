// Secrets never go in wrangler.jsonc, so the generated worker-configuration.d.ts does not know
// about them (unless a local .dev.vars exists when `wrangler types` runs, which is why that
// file is not re-committed with the key in it). This is the one committed declaration; it
// merges with the generated `Env` and typechecks on a fresh clone.
interface Env {
  ANTHROPIC_API_KEY: string;
  // The OAuth client from the Google Cloud console (Google Auth Platform → Clients).
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  // Comma-separated emails exempt from the per-account AI spend cap (worker/spend.ts).
  OWNER_EMAILS?: string;
  // Comma-separated emails that may sign in; unset or empty, anyone can (worker/allowlist.ts).
  ALLOWED_EMAILS?: string;
}
