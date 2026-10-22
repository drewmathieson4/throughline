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

## 2026-10-22 — Tagging returns roster names, not ids, through a structured-output enum
The tagger (Haiku 5.5) answers in a fixed JSON shape whose `student` field is an enum of the roster's display names, built per request. The model cannot invent a student or mistype an id; the Worker maps names back to ids and drops anything unmatched. We passed on free-text answers parsed with regex (fragile) and on asking for ids (opaque strings the model copies badly). The trade is that two students with the same full name need a suffix on the label, which `rosterLabels()` adds.

## 2026-10-22 — Verified verbatim quotes, not summaries, as per-student evidence
Each tag stores the exact passages of the note about that student. Every quote the model returns is located in the note body (case and whitespace tolerant) before it is stored; a quote that is not there is dropped. We passed on model-written summaries because they are an interpretation, not evidence, and cannot be checked. The throughline synthesis will cite these quotes, so they have to be real.

## 2026-10-22 — Unresolved names live in their own table and are shown to the teacher
When a name fits more than one student ("Alex" with two Alexes enrolled) the tagger does not guess. The name, its quotes, and the candidate ids go in `note_mentions`; the notes page shows it; assign or dismiss endpoints close it. We passed on tagging every candidate as a suggestion (noise in the wrong student's throughline) and on dropping the mention silently (the teacher never learns a note went unfiled). Only open mentions are stored; closing one deletes the row.

## 2026-10-22 — Nicknames are a JSON array column on students
`students.aliases` holds the other names a teacher uses ("Juni"). A join table would be the textbook answer, but at a dozen students with a nickname or two each, a JSON text column that Drizzle parses is simpler to read, seed, and send to the tagger. Editing aliases through the UI is a later feature; the seed sets them for now.

## 2026-10-22 — Tagging runs inside the create request
`POST /api/notes` saves the note, calls the tagger, and returns the note with its suggestions, adding a few seconds. The note is saved before the call, so a failed call (no key, rate limit, refusal) costs nothing but the tags, and `POST /api/notes/:id/retag` tries again. We passed on a background job because the Worker has none (see the Cloudflare entry) and on a fire-and-forget `waitUntil` because the page would then have to poll for tags.

## 2026-10-22 — Eval cases are generated by Opus, reviewed by hand, and committed
`scripts/eval/cases.json` holds about 150 teacher notes with answer keys across 14 categories, written by Opus 5.5 from a brief per category and the tagger's own rules, then reviewed by a person. The file is committed so every run scores the same set and a prompt change can be compared against the last run. We passed on template-filled cases (exact answers for free, but unnatural text that never trips the model) and on hand-writing all of them (too few to catch rare failures). `npm run eval:tagging` fails below 90% precision or recall on tags. The first runs settled the model's effort setting too: `low` matched or beat `medium` on every category (99.7% precision, 100% recall on tags after three prompt tweaks) while being a fifth faster, so it is the default.
