# Zenith

**Zenith is an AI job-search command center.** Track every application through its full lifecycle, keep your entire career history in one **Master Profile**, and let Claude tailor a one-page, ATS-safe resume for any job description — with a live, content-addressed match score that follows whatever you edit in the Builder.

Two principles run through the whole product:

1. **The Master Profile is the single source of truth.** Every tailored resume is selected/cut/reordered/condensed from facts that already exist in it — nothing is invented.
2. **Claude is the sole tailoring *and* scoring brain.** There is no deterministic scoring engine; every score is a Claude assessment of the *rendered* resume text against the JD.

---

## Table of contents

1. [Monorepo layout](#monorepo-layout)
2. [Tech stack](#tech-stack)
3. [Core flows](#core-flows)
4. [Scoring model](#scoring-model)
5. [The LLM pipeline (all prompts)](#the-llm-pipeline-all-prompts)
6. [API reference](#api-reference)
7. [Database schema](#database-schema)
8. [Frontend architecture](#frontend-architecture)
9. [Chrome extension](#chrome-extension)
10. [Running locally](#running-locally)
11. [Environment variables](#environment-variables)
12. [Database migrations](#database-migrations)
13. [Testing](#testing)
14. [Security](#security)

---

## Monorepo layout

npm workspaces, three packages:

```
job-tracker-saas/
├── web/          React + Vite SPA          (port 5173)
├── api/          Express + TypeScript API  (port 3000, tsx watch)
├── extension/    Chrome Manifest v3 ext    (LinkedIn autofill)
├── api/migrations/   SQL to apply in Supabase
└── package.json  workspace root + scripts
```

> **Every LLM prompt lives in one file: `api/src/index.ts`.** The web app and extension contain no prompts — they only call API endpoints.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind, Radix UI, `@dnd-kit`, Recharts, lucide-react |
| Backend | Node + Express, TypeScript via `tsx`, Puppeteer (PDF), `pdf-parse` / `mammoth` (resume import) |
| Auth & DB | Supabase (Postgres + Auth + Storage, Row-Level Security) |
| AI — tailoring & scoring | **Claude `claude-sonnet-4-6`** (Anthropic) |
| AI — utility parsing | OpenAI `gpt-4o-mini` (autofill, Mira summary), `gpt-4.1-mini` (resume → profile seed) |
| Extension | Manifest v3, content script + background worker, PKCE OAuth |

---

## Core flows

```
Master Information ──► Tailor ──► Resume Builder ──► PDF
(profile = truth)      (Claude)   (live scoring)     (ATS-safe)
```

**1 — Master Information.** Build/maintain the Master Profile (experiences, projects, education, skills, summaries, awards — every bullet rated and tagged). Import via JSON, or **seed from an existing resume** (paste text or upload PDF/DOCX/TXT → GPT parses it into the profile schema).

**2 — Tailor.** Paste a job description → **Generate with Claude** → Claude returns an honest fit assessment (0–100 `matchScore`, gaps, recommendation) plus **candidate bullet suggestions**. You **edit and approve** the bullets you want (placeholders like `[X]` are preserved), then **Send to Builder**.

**3 — Assembly.** "Send to Builder" calls a server-side **assembly pass**: Claude treats every bullet across your Master Profile, your current resume, and your approved bullets as a candidate "block" and assembles the single best one-page resume — keeping, cutting, reordering, or replacing blocks. It is saved as a **new** Builder version (never overwriting a previous one), with the target JD attached.

**4 — Resume Builder.** A full live editor (drag-to-reorder sections, show/hide, inline `**bold**`/`*italic*`, fonts, typography, undo/redo, auto-save). The **match score follows your live content** (see below). **Re-rank** re-scores; **Re-assemble** re-optimizes into a new version. Export a text-native, ATS-safe PDF.

---

## Scoring model

The score is a **content-addressed function of the live, rendered resume** — not of a stale snapshot, and not of the raw JSON.

- The resume is rendered to the **same ATS-visible plain text** the exported PDF exposes (`resumeContentToText`, shared with the PDF HTML path). That text is what gets **hashed** and **scored**, so the number you see matches what a recruiter's parser reads.
- Scores are cached in **`resume_scores`**, keyed on `(user_id, jd_hash, content_hash)`:
  - **Edit content → hash changes → cache miss → recompute** (auto, debounced ~3s after edits settle, when *Live score* is on).
  - **Revert to identical content → cache hit → same score, no Claude call.** Score stability is free.
- **`/rerank/claude` is the single live scorer.** **`/assemble/claude` primes the same store**, so a freshly assembled resume already shows its score with no extra call.
- **Re-rank is pure scoring — it never mutates the resume.** Only **Re-assemble** produces new content (as a new version).
- Builder versions carry their target `job_description`; a version without one shows scoring disabled with *"No target job description for this version."*

> Tailoring scores live **only** in the Tailor/Builder flow. There is no score badge on the Applications tab.

---

## The LLM pipeline (all prompts)

All five prompts are in `api/src/index.ts`.

| Endpoint | Model | Role |
|---|---|---|
| `POST /autofill` | gpt-4o-mini | Job-posting page → structured fields (company, role, location, salary, JD text) |
| `POST /summary` | gpt-4o-mini | "Mira" — warm-but-honest career assessment over your funnel + profile |
| `POST /master-profile/seed-from-text` | gpt-4.1-mini | Raw resume text → MasterProfile JSON |
| `POST /tailor/claude` | claude-sonnet-4-6 | Tailor from the Master Profile: pick content, write bullet suggestions, assess fit (cached in `tailor_results`) |
| `POST /assemble/claude` | claude-sonnet-4-6 | Assemble the best one-page resume from profile + current resume + approved bullets; new version; primes the score store |
| `POST /rerank/claude` | claude-sonnet-4-6 | Score the live rendered resume against the JD; content-addressed cache in `resume_scores` |

---

## API reference

All routes require `Authorization: Bearer <supabase-jwt>` (validated by `requireAuth`).

**Applications**
- `GET /applications` · `POST /applications` · `PUT /applications/:id` · `DELETE /applications/:id`
- `POST /applications/auto-ghost` — marks 90-day-stale, non-terminal apps as Ghosted

**Profile & account**
- `GET/PUT/DELETE /profile` — DELETE is a full account wipe (all tables + storage + auth)

**Master Profile**
- `GET/PUT /master-profile`
- `POST /master-profile/seed-from-text` — resume text → profile JSON
- `POST /parse-text` — extract text from uploaded PDF/DOCX/DOC/TXT

**AI**
- `POST /autofill` — URL or pre-extracted `pageText` → structured job fields
- `POST /summary` — Mira career assessment
- `POST /tailor/claude` — `{ jobDescription, applicationId? }` → `{ resumeContent, review }`
- `POST /assemble/claude` — `{ jobDescription, approvedBullets[], currentResume?, company?, role? }` → `{ version, resumeContent, score, changeLog }`
- `POST /rerank/claude` — `{ jobDescription, resumeContent }` → `{ review, score, contentHash, fromCache }`

**Export**
- `POST /export/pdf` — `{ content, settings }` → Puppeteer-rendered, text-native PDF (a `pdf-parse` regression guard asserts extractable keywords before responding)

---

## Database schema

Supabase Postgres, RLS on every user-owned table.

| Table | Purpose |
|---|---|
| `applications` | Job applications per user — `job_description`, `timeline` (jsonb), `last_updated`, status |
| `master_profile` | One row per user, `content` (jsonb MasterProfile) — **source of truth** |
| `resume_builder` | Builder versions — `content`, `settings`, `version_name`, **`job_description`, `jd_hash`** |
| `resume_scores` | Content-addressed scores — `jd_hash`, `content_hash`, `score`, `review`; `UNIQUE(user_id, jd_hash, content_hash)` |
| `tailor_results` | Generation cache for `/tailor/claude`, keyed on `(user_id, jd_hash, profile_hash)` |
| `profiles` | Display name, avatar, theme |
| `resumes` + Storage bucket | **Legacy** (vault removed); only touched by the account-wipe cleanup |

---

## Frontend architecture

Single-page React app. `JobApplicationTracker.tsx` is the authenticated shell — owns shared state, tab routing, and the assembly handoff. Tabs:

- **Applications** — Kanban/table, Mira summary, search & filters, auto-ghost notice
- **Master Information** — Master Profile form editor, JSON import/export, seed-from-resume
- **Analytics** — KPI cards + Recharts charts
- **Tailor** — JD → Claude generate → editable/approvable bullets → Send to Builder
- **Resume Builder** (`resume/ResumeBuilderLayout.tsx`, `hooks/useResumeData.ts`) — live editor + preview, versions, undo/redo, debounced auto-save, **live score chip / Re-rank / Re-assemble**, LaTeX copy, PDF download
- **Profile** — account settings, CSV export, theme, delete account

Handoff from Tailor to Builder is server-driven: `/assemble/claude` writes the new version, and the Builder loads the newest version on mount.

---

## Chrome extension

Manifest v3. A content script runs on LinkedIn job pages; the background worker POSTs to the API and opens the web app. Ports are hardcoded (`localhost:3000` API, `localhost:5173` web) — rebuild if they change. The extension makes no LLM calls of its own; it only hits `/autofill` and the applications routes.

---

## Running locally

```bash
# install (workspace root)
npm install

# frontend  → http://localhost:5173
npm run dev:web

# backend   → http://localhost:3000
npm run dev:api

# build the Chrome extension
npm run build:ext

# lint everything
npm run lint
```

Load the extension via `chrome://extensions` → *Load unpacked* → the built `extension/` output.

---

## Environment variables

`api/.env`:

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY2=        # note: the key name is OPENAI_API_KEY2
ANTHROPIC_API_KEY=      # used by /tailor, /assemble, /rerank
PORT=3000
```

`web/.env`:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=http://localhost:3000
```

---

## Database migrations

SQL lives in `api/migrations/`. Apply in the Supabase SQL editor (or via the CLI) for your project.

- **`stage2_resume_scores.sql`** — creates the `resume_scores` table (content-addressed scores, per-user RLS) and adds `job_description` / `jd_hash` to `resume_builder`.

> If the score table is missing, scoring still works (Claude is called each time) — caching just fails soft until the migration is applied.

---

## Testing

```bash
npm run test          # all suites
```

- **web** — Vitest + Testing Library (`web/tests/**.test.tsx`) plus standalone `tsx` specs (`*.spec.ts`)
- **api** — standalone `tsx` specs (`api/tests/*.spec.ts`) using `node:assert`, covering the normalization boundaries and the HTML/text render paths

Typecheck: `npm run build --workspace=api` (tsc) and `npx tsc --noEmit` in `web/`.

---

## Security

- Every API route is gated by `requireAuth`, which validates the Supabase JWT and attaches `req.user`.
- Two Supabase clients (`api/src/lib/supabase.ts`): a service-role client for cache/admin tables, and a per-request, JWT-scoped client so **Row-Level Security** applies to user-owned data. User-owned tables (`resume_scores`, `resume_builder`, `applications`, `master_profile`) enforce `auth.uid() = user_id`.
- PDF export is text-native and ATS-safe; a `pdf-parse` regression guard asserts extractable keywords before the file is returned.
- Account deletion cascades across all tables, storage, and auth.
