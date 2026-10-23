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

## 2026-10-22 — Notes are captured without a class; tagging infers it
The teacher just writes or speaks. The tagger looks across every class the teacher has, and the note's class is set from the students it finds when they all share one, or from a class the note names as a whole ("Period 3 was rowdy"); otherwise the note stays unassigned, and a name that fits students in two classes becomes an open mention that shows both with their class. Rationale: one less decision per note, and a batch of voice notes recorded in one sitting can span several classes. Suggestions set the class, not only confirmations, because most names are unique and waiting for a review step would leave every note unassigned until review tools exist; a teacher's confirm, add, or assign also settles it. We passed on a class dropdown next to the note box (one more tap per note, and wrong when a note spans classes), on an inbox page for unassigned notes (more UI than a label on the list), and on a manual class/student picker (deferred until there is evidence of how often inference fails). `notes.class_id` is nullable; a class given explicitly on create is kept. The migration rebuilds the `notes` table (SQLite cannot drop NOT NULL in place); D1 runs each migration inside a transaction, where `PRAGMA foreign_keys=OFF` is ignored, so the rebuild's DROP cascades through `note_students` and `note_mentions`. Harmless today because no production note has tags yet, but any future rebuild of a parent table needs a copy-and-restore step for its children first.

## 2026-10-22 — Roster import: the browser splits the file into cells, the Worker finds the students
The teacher picks a roster file or pastes names; papaparse turns the text into a grid of cells in the browser, and `POST /api/students/import` receives that grid as JSON. No file reaches the Worker, so there is no upload handling and the request is validated like any other. Everything that interprets the grid lives in `worker/roster.ts`, one pure module with one set of tests, because the model fallback below can only run server-side and the matching must use the same name cleaning the add-student form uses. We passed on parsing in the Worker (papaparse is UMD and the Workers bundle is the riskier place for it) and on a hand-written parser (quoted commas and embedded newlines are exactly where those go wrong).

## 2026-10-22 — The table is searched for, not assumed to start at row 1
A real export wraps the roster in metadata: a block of settings above, a summary below, blank lines between. Every row that names a name column ("Name", "First", "Surname"…) is tried as the header, the rows under it are read as students, and the candidate whose rows are most nearly all names wins; a "Students, 8" line in the settings block reads a few titles under it as names and far more non-names, so the real header beats it. A table ends at a row narrower than the header with nothing in the name columns. Cells with digits or symbols ("Grade 7 - A", "n/a") are never names, which is what keeps metadata out of the roster.

## 2026-10-22 — Column mapping: header rules, then content rules, then Haiku; no form for the teacher
Exports disagree about everything: "First Name" / "Given" / "Forename", a single "Student" column in either order, no header at all, ids and emails in between. Deterministic rules read the header row, then the shape of the data (a column of "Last, First" cells is unmistakable). Only when they give up (no header and two bare word columns, titles in another language) is Haiku 5.5 shown the first six rows and asked for a mapping. There is no preview or column-picking step: the teacher asked for the file to be imported, the summary says what happened, and a wrong guess is fixed on the students page (rename, mark as left, add by hand), which is cheaper than confirming every import. Without an API key, or when the model fails, the import says it found no names. We passed on model-first (a paid, non-deterministic call for every import when a header row answers most of them) and on a preview with per-column dropdowns (built, then cut: it asked the teacher to do the reading the import exists to do).

## 2026-10-22 — A section column creates or matches classes
When the file names two or more classes (a "Section", "Class", "Period" or "Homeroom" column), students go to classes with those names, matched to existing ones case-insensitively and created otherwise. One class name, or none, means the file is the roster of the class on screen, whatever the file calls it. Names already enrolled in their class are skipped, so importing the same file twice adds nobody and creates nothing. Inserts go in chunks of 16 rows inside one `db.batch()`, classes first: D1 allows 100 bound parameters per statement and a student row binds six; the batch is one transaction, so a failure part-way adds nobody.

## 2026-10-22 — Imported full names keep a first and a last name only
"Pell, Rowan James" and "Rowan James Pell" both become Rowan Pell: middle names are dropped, "Jr."/"III" stripped, surname particles ("de la Cruz", "van Beethoven") kept with the surname, and a name in ALL CAPS title-cased while mixed case ("McBride") is left alone. The tagger matches on first and last and a teacher says "Rowan", not "Rowan James"; a name that came out wrong is edited on the student page. A "Preferred name" or "Goes by" column becomes an alias, which the tagger already reads, so "Juni" in a note finds Juniper from day one.

## 2026-10-22 — A "last note" date per student, coloured by staleness
The roster shows when each student was last written about, with a dot: green within a week, amber within a month, red beyond that or never. The point is to be scannable at the end of a week: the red rows are the students the teacher has not noticed lately, which is the quiet failure mode this app exists to catch. The date comes from the newest note tagged to the student whether the tag is a suggestion or confirmed, because a suggestion still means a note named them; `noteCount` stays confirmed-only because it answers a different question (how much vetted evidence a report can draw on). The bands are computed in the browser from the current time, so the colour is right without a refetch. We passed on making the thresholds configurable (no evidence yet that a teacher wants different ones) and on sorting the table by staleness (the dot is enough to find the reds in a class of thirty).

## 2026-10-22 — The notes list filters by class and student in the browser
Two selects above the list narrow it to one class, one student, or both. The filtering happens in the browser: the page already loads every note and every roster (hundreds of rows for one teacher), so a query parameter would add a round trip per click for nothing. A student's filter matches notes where they are tagged, suggested or confirmed, and also notes where they are a candidate for a name the tagger could not settle, so filtering by Alex Marsh shows the bare-"Alex" notes with their "unsure who" line instead of hiding them. We passed on server-side filtering (revisit if a teacher ever has thousands of notes) and on a search box (names are a dropdown away; free-text search is a different feature).

## 2026-10-22 — Demo notes are written by Opus with answer keys and loaded through the API
`scripts/demo/notes.json` holds a term of synthetic notes (about 45 per class, dated 1 Sept onward) written by Opus 5.5 one class at a time: it plans an arc per student first, then writes the notes in date order so each student's notes tell a story the later synthesis can find. Each note carries an answer key in the eval's format, and `npm run demo:load` posts the notes to a running server one by one so the real tagger tags them, then prints where the tagger and the key disagree. The roster is read from the API, not from a second file, so the notes always match the database. We passed on a SQL dump of pre-tagged notes (it would not exercise the tagger and would go stale on every prompt change), on reusing the eval cases as the demo (they are deliberately adversarial and undated, so they read like a test suite), and on regenerating the eval roster from the seed (the 180 answer keys depend on its class membership; the two rosters are independent on purpose). The file is committed and read by a person before loading, like the eval cases.
