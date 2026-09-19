# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
# Run frontend (Vite dev server, port 5173)
npm run dev:web

# Run backend (tsx watch, port 3000)
npm run dev:api

# Build Chrome extension
npm run build:ext

# Lint all workspaces
npm run lint

# Run individual workspace commands
npm run dev --workspace=web
npm run dev --workspace=api
npm run build --workspace=api   # tsc only
```

Tests: `npm run test` (root) runs tsx-based specs in `web/tests/` and `api/tests/` covering the data-normalization boundaries (JSON imports, Codex tailor output, LaTeX/PDF export). There is no test framework — each spec is a plain script with `node:assert`.

## Environment Setup

`api/.env` requires:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY2` (note: key name is `OPENAI_API_KEY2`, not `OPENAI_API_KEY`)
- `ANTHROPIC_API_KEY` (used by the `/tailor/Codex` endpoint)
- `PORT` (default: 3000)

`web/.env` requires Supabase credentials for the frontend Supabase client plus `VITE_API_URL`.

## Architecture

This is an npm workspaces monorepo with three packages: `web`, `api`, `extension`.

### Core design decisions (final)
- **Master Profile is the single source of truth.** All tailored resume content comes from the `master_profile` table. The old 5-resume vault (Files tab, `resumes` table routes) has been removed.
- **Codex is the sole tailoring and scoring brain.** `POST /tailor/Codex` embeds the full Master Profile JSON in the system prompt with hard no-invention rules. Codex returns `resumeContent` + `review` (including a 0–100 `matchScore` self-assessment). There is no deterministic scoring engine anymore.
- **Tailor results are cached.** `tailor_results` table, keyed on `(user_id, jd_hash, profile_hash)`. The same JD with an unchanged Master Profile returns the stored result without calling Codex. Editing the JD or the profile changes a hash and busts the cache naturally.
- **Mandatory approve gate.** Codex proposes → user reviews → user approves → Builder opens via a `localStorage["jt.pending_tailor"]` handoff consumed atomically by `useResumeData.fetchVersions`.

### Backend (`api/`)
Express + TypeScript server run via `tsx watch`. Two Supabase clients exist in `lib/supabase.ts`:
- `supabase` — service role client (admin ops, cache tables, bulk updates)
- `getAuthClient(token)` — per-request client using the user's JWT so Supabase RLS policies apply

All routes use `requireAuth` middleware (`middleware/auth.ts`) which validates the Bearer token via `supabase.auth.getUser()` and attaches `req.user`.

Route groups in `src/index.ts`:
- `/applications` CRUD + `/applications/auto-ghost` (marks 18-day-stale apps Ghosted)
- `/profile` GET/PUT/DELETE (DELETE is a full account wipe across all tables + storage + auth)
- `/autofill` — fetches a job posting URL (or accepts pre-extracted `pageText` from the extension) and extracts structured fields via GPT-4o-mini
- `/summary` — "Mira" AI career assessment (GPT-4o-mini); pulls the Master Profile server-side for context
- `/master-profile` GET/PUT + `/master-profile/seed-from-text` (GPT-4.1-mini parses raw resume text into MasterProfile JSON) + `/parse-text` (extracts text from uploaded PDF/DOCX/DOC/TXT via pdf-parse/mammoth)
- `/tailor/Codex` — the tailoring endpoint (Codex-sonnet-4-6, cached as described above)
- `/scores/Codex` — batch endpoint: returns `{ [applicationId]: score }` for all of the user's applications by matching each app's JD hash against stored tailor results. One request, no N+1.
- `/export/pdf` — Puppeteer renders `resumeContentToHtml` output to a text-native, ATS-safe PDF; pdf-parse regression guard asserts extractable keywords before responding

### Frontend (`web/`)
Single-page React app. `JobApplicationTracker.tsx` is the authenticated shell that owns shared state and tab routing. It talks to the API via `fetch`, passing the Supabase JWT as `Authorization: Bearer <token>`.

Tabs:
- **Applications** (`tabs/ApplicationsTab.tsx`) — Kanban/table views, score badges (cached Codex scores via `GET /scores/Codex`), Mira summary
- **Master Information** (`tabs/MasterInfoTab.tsx` + `MasterProfileEditor.tsx`) — Master Profile form editor, JSON import/export, seed-from-resume
- **Analytics** (`tabs/AnalyticsTab.tsx`) — KPI cards + recharts charts
- **Tailor** (`tabs/TailorTab.tsx`) — JD input → Codex generate → review + approve gate → Builder handoff
- **Resume Builder** (`resume/ResumeBuilderLayout.tsx`, `hooks/useResumeData.ts`) — full editor with live preview, versions, undo/redo, debounced auto-save to the `resume_builder` table, LaTeX copy, server-side PDF download
- **Profile** (`tabs/ProfileTab.tsx`) — account settings, CSV export, theme, delete account

### Chrome Extension (`extension/`)
Manifest v3 extension. Content script runs on LinkedIn job pages; background worker POSTs to the API at `localhost:3000` and opens the web app at `localhost:5173` (both hardcoded — rebuild if ports change).

### Supabase Tables
- `applications` — job applications per user; includes `job_description`, `timeline` (jsonb), `last_updated`
- `master_profile` — one row per user with `content` (jsonb MasterProfile) — the source of truth for tailoring
- `tailor_results` — cached Codex tailor outputs keyed on `(user_id, jd_hash, profile_hash)`; holds `resume_content`, `review`, `score`
- `resume_builder` — Builder versions per user (`content`, `settings`, `version_name`); written directly from the web app via the Supabase client
- `profiles` — display name, avatar, theme settings
- `resumes` + Storage bucket `resumes` — **legacy** (vault removed); only referenced by the account-wipe cleanup
