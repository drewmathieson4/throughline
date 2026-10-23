# Decisions

One entry per non-obvious choice: what we picked, what we passed on, and why. Newest at the bottom.

## 2026-10-20 — Cloudflare Workers instead of a rented server
A Worker is a function Cloudflare runs on demand near the user and then shuts down; there is no machine to provision or patch, and the free tier covers a demo. We passed on a VPS or Vercel-plus-database because both mean a second vendor and a monthly bill. The trade is no long-running background jobs inside the Worker, which this app does not need.

## 2026-10-20 — React + Vite over Next.js
Cloudflare's own template wires React, Vite, TypeScript and the Worker into one `npm run dev` and one `wrangler deploy`. Next.js is the more recognizable name but needs an adapter on Cloudflare and brings server-rendering machinery this app does not use. The audience for this project cares about the workflow and the AI design more than the framework.

## 2026-10-20 — Hono for the API
Hono is a small, typed router built for the Workers runtime. The alternative was hand-written `if (url.pathname === ...)` branches in the Worker, which is fine for one route and unpleasant for fifteen.

## 2026-10-20 — D1 (hosted SQLite) over Postgres
D1 sits next to the Worker, needs no connection string or extra account, and is free at this scale. Postgres earns its keep with many concurrent writers or advanced features; a single-teacher notes app with a few hundred rows has neither.

## 2026-10-20 — Drizzle ORM with generated migrations
Tables are described once in TypeScript (`worker/db/schema.ts`); Drizzle types every query from that file and drizzle-kit turns schema changes into numbered SQL files under `drizzle/`. We never edit the live database by hand. A fresh clone rebuilds the database from the migration history.

## 2026-10-20 — Synthetic demo data only
Real student notes are FERPA-covered and re-identifiable even with names swapped. The hosted demo runs on a generated class and says so on screen. Real data, if ever used, stays on the teacher's own instance.

## 2026-10-20 — Opus 5.5 for synthesis and drafts, Haiku 5.5 for note tagging
Synthesis and prose quality are the product; the cost difference is cents per student. Tagging a note with the students it mentions is a bulk extraction task where the cheap model is plenty.

## 2026-10-20 — No tool-generated first commit
The scaffold was run with `--no-git` so the first commit is written by a person and says why the project exists.

## 2026-10-22 — Route tests run against a real D1 via wrangler's getPlatformProxy
`worker/routes/notes.test.ts` asks wrangler (already a devDependency) for the same Miniflare-backed `env` the dev server uses, with `persist: false` so each run starts from an empty in-memory database, then applies the committed migrations and the dev seed. Tests call the Hono app directly with `app.request(path, init, env)`. We passed on `@cloudflare/vitest-pool-workers`, which runs tests inside workerd itself, because it only supports Vitest 4 and the project is on 5; and on mocking the database, because a mock would not prove the SQL or the schema. The trade is that route code runs in Node during tests rather than workerd, which matters only if a route starts using a Workers-only API.

## 2026-10-22 — Demo data is a SQL file under scripts/, run by wrangler
`scripts/seed-dev.sql` holds one synthetic class and eight invented students with fixed ids and `INSERT OR IGNORE`, so `npm run db:seed:local` is safe to rerun and the route tests can load the same file. It lives outside `drizzle/` because wrangler treats every `.sql` in the migrations directory as a migration. We passed on a TypeScript seed script (needs a runner and a way to reach D1 from Node for the same result) and on a `/api/dev/seed` route (ships seeding logic in the Worker and needs guarding against production).

## 2026-10-22 — Whisper on Workers AI for voice-note transcription
The Anthropic API does not accept audio, so transcription needs a second model. Cloudflare's hosted Whisper (`@cf/openai/whisper-large-v3-turbo`) is reached through an `AI` binding on the Worker: no new package, no second vendor account, a free daily allowance and roughly a tenth of a cent per audio minute after that. We passed on the browser's Web Speech API (Chrome-only, routes audio through Google, stops on pauses, poor with names) and on the OpenAI Whisper API (same model but another key and vendor). The trade is that `npm run dev` reaches the real Cloudflare account for transcription, so the machine must have run `npx wrangler login` once.

## 2026-10-22 — Voice notes keep the transcript only; the audio is discarded
The recording is sent to Whisper and never written anywhere. That removes an R2 bucket, a size-and-ownership check on stored keys, and cleanup of abandoned uploads, and it means no audio of a teacher talking about students sits in storage. `notes.audio_key` stays in the schema, null for now, so storing audio later is a feature change rather than a migration.

## 2026-10-22 — A voice note is saved as soon as transcription finishes
No review-and-edit step before the note is written. Speed for the teacher wins; flagging a shaky transcript and correcting names and tags is planned as its own feature. Recording stops itself at five minutes and the page says so, so a long brain dump becomes several short notes, each one a separate Whisper call and a small unit for tagging.

## 2026-10-22 — Note bodies cap at 50,000 characters, text and voice alike
One server-side limit for both kinds. It is a backstop against runaway input, not a product constraint: nothing a teacher types comes close, and a five-minute clip transcribes to roughly 5,000 characters. D1 stores rows that size without trouble. The real cost of a huge note is the synthesis prompt it later joins, which stays small at single-teacher scale. Voice notes used to have no transcript limit at all; a 10 MB audio file uploaded straight to the API could have produced a 30,000-character note.

## 2026-10-22 — Route tests fake the AI binding
`getPlatformProxy` runs with `remoteBindings: false` and each voice test passes `{ ...env, AI: fake }`, where the fake returns a canned transcript or throws. The tests prove the route (type and size checks, empty-transcript rejection, what reaches Whisper, what is written) without network, cost, or a real model, which they could not prove anyway.
## 2026-10-22 — A student who leaves is marked, not deleted
`students.left_at` holds the date a student left the class; the active roster is `WHERE left_at IS NULL`. Deleting the row would cascade through `note_students` and strip the student from every note that mentioned them, destroying evidence the teacher may still need (a mid-year report, a transfer summary). A date beats a status enum because it answers "when" for free and costs the same null check. Reactivating is clearing the date, which covers the student who switches back. The roster endpoint returns everyone, departed or not; at a few dozen rows the client can hide them with a filter instead of a second request and a race guard around the toggle.

## 2026-10-22 — View switching in React state, no router
The app has a few views (notes, students, with roster import next) behind one class picker. A router package would add a dependency, URL design, and a second place where state lives, for no user-visible gain at this size. The selected class id is remembered in `localStorage` so a reload lands on the same class. Revisit if deep links to a student become a real need.
