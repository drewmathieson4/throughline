# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Throughline: a teacher records quick text/voice notes, each note is tagged to the students it mentions, and the app synthesizes a per-student "throughline" backed by that evidence. Single-teacher scale (hundreds of rows, not millions). Non-obvious choices and their rationale live in `DECISIONS.md`; add an entry there when making one.

## Commands

```
npm run dev                # Vite + Worker + local D1 on one port
npm run typecheck          # tsc -b across app, node, and worker tsconfigs
npm run lint               # oxlint
npm run test               # vitest run (route tests use a real in-memory D1 via wrangler)
npx vitest run path/to/file.test.ts   # single test file
npm run build              # typecheck + vite build
npm run deploy             # build + wrangler deploy

npm run db:generate        # schema.ts -> new SQL migration in drizzle/
npm run db:migrate:local   # apply migrations to the local D1
npm run db:migrate:remote  # apply migrations to production D1
npm run cf-typegen         # regenerate worker-configuration.d.ts after editing wrangler.jsonc bindings
```

Schema change workflow: edit `worker/db/schema.ts`, run `db:generate`, run `db:migrate:local`, run `typecheck`. Never hand-edit files under `drizzle/` or the live database; commit the generated SQL and `drizzle/meta/` together.

## Working with me
- Default to plan mode always to discuss features.  Ask clarifying questions before proposing a plan
- One feature per commit
- Ask before adding dependancies.  Explain what the dependancy is and why it's needed
- One branch per feature (`git checkout -b <feature>`), stacked on the previous feature's branch when it builds on unmerged work.
- Per feature, the gate is typecheck, lint, and tests. Do not run /code-review, /simplify, or /security-review inside the feature session.
- Reviews are batched and token-light: every few commits, or before a merge to main or a deploy, Drew opens a fresh session and runs `/code-review low` and `/simplify low` over the batch; `/security-review` only when the batch touched API routes, student data, uploads, or AI prompt inputs. Never run them at higher effort or from the session that wrote the code. This is a demo on synthetic data: things may break and be fixed later.


## Architecture

One Cloudflare Worker serves both halves. Cloudflare serves the built React app as static assets first; only `/api/*` reaches the Worker code.

- `worker/index.ts` is a Hono app. One resource per file under `worker/routes/`; `worker/db/client.ts` middleware attaches the Drizzle client as `c.var.db`. `Env` (with the `DB` binding) comes from the generated `worker-configuration.d.ts`, driven by `wrangler.jsonc`.
- `worker/db/schema.ts` is the single source of truth for the data model. Drizzle types every query from it and drizzle-kit generates migrations from it. Conventions: text UUIDs minted in the Worker, ISO-8601 strings for dates, integer 0/1 for booleans.
- `src/` is the React frontend. `src/App.tsx` is the shell (class picker, view tabs); `src/notes/` and `src/students/` hold the two views. The frontend imports row types (type-only) from `worker/db/schema.ts`.
- Three tsconfigs exist because the three environments differ: `tsconfig.app.json` (browser, DOM), `tsconfig.worker.json` (Workers runtime, no DOM), `tsconfig.node.json` (vite.config). `tsconfig.json` only references them.

Data model shape worth knowing before touching routes: a `note` belongs to a class; `note_students` is the many-to-many to students, each row a live tag with the verbatim quotes as evidence; `note_mentions` holds names the tagger could not settle, with candidate students, until the teacher does; a note with no `note_students` rows is class-level context. `syntheses` stores one row per AI run with an `input_hash` to skip reruns; `report_drafts` keeps generated text and the teacher's edits in separate columns.

## Constraints

- Demo data is synthetic only. Student notes are FERPA-covered; never seed, test with, or commit real student data. Keep secrets in `.dev.vars` (gitignored).
- Model roles are fixed in `DECISIONS.md`: Opus 5.5 for synthesis and report drafts, Haiku 5.5 for tagging notes to students.
- The Worker has no long-running background jobs; design features to complete within a request.
- Voice-note transcription uses the Workers AI binding, which reaches the real Cloudflare account even in `npm run dev`; run `npx wrangler login` once per machine. Route tests fake the binding and never call it.
