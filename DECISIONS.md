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
