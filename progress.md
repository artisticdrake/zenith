# Zenith — Job Tracker SaaS

## Engineering Progress Log

_Last rewritten: 2026-06-17. This document reflects the **current** state of the code after the "Remove vault + deterministic matcher; cache Claude tailor scores" work. The old deterministic scoring engine (`matcher.ts`, `computeHybridScore`, `/match`, `/score/master`) and the 5-resume vault are **gone** — if you see them referenced anywhere else, that doc is stale._

---

## 1. What the product is

Zenith is a full-stack job-search SaaS. The user maintains one **Master Profile** (their entire career history, every bullet they've ever written, rated and tagged). For any job description, **Claude** tailors a one-page resume from that profile, scores the fit honestly, and proposes ready-to-paste bullet suggestions. The user reviews, approves, and edits the result in a live Resume Builder, then exports an ATS-safe PDF.

Two hard design rules govern everything:

1. **The Master Profile is the single source of truth.** Claude may only select / cut / reorder / condense facts that already exist in it — never invent.
2. **Claude is the sole tailoring _and_ scoring brain.** There is no deterministic scoring engine anymore. Every score is a Claude `matchScore` self-assessment.

---

## 2. Monorepo layout

npm workspaces, three packages:

| Package | Role | Runtime |
|---|---|---|
| `web/` | React + Vite SPA (port 5173) | `npm run dev:web` |
| `api/` | Express + TypeScript (port 3000), `tsx watch` | `npm run dev:api` |
| `extension/` | Manifest v3 Chrome extension (LinkedIn autofill) | `npm run build:ext` |

**Every LLM prompt in the entire product lives in one file: `api/src/index.ts`.** The web app and the extension contain no prompts — they only call the API endpoints below.

---

## 3. The LLM pipeline — all five prompts

There are exactly **five** LLM calls. Three use OpenAI (utility parsing), two use Claude (the core resume brain).

| # | Endpoint | File / lines | Model | Role |
|---|---|---|---|---|
| 1 | `POST /autofill` | `api/src/index.ts:295–314` | gpt-4o-mini | Job posting page → structured fields |
| 2 | `POST /summary` | `api/src/index.ts:437–465` | gpt-4o-mini | "Mira" career assessment |
| 3 | `POST /master-profile/seed-from-text` | `api/src/index.ts:524–559` | gpt-4.1-mini | Raw resume text → MasterProfile JSON |
| 4 | `POST /tailor/claude` | `api/src/index.ts:680–805` | claude-sonnet-4-6 | **Tailor: select content, write bullets, score** |
| 5 | `POST /rerank/claude` | `api/src/index.ts:919–964` | claude-sonnet-4-6 | **Re-rank: score the edited Builder resume** |

### 3.1 `POST /autofill` — gpt-4o-mini (`index.ts:295`)

Fetches a job posting URL (or accepts pre-extracted `pageText` from the extension), strips HTML, and extracts structured fields. `temperature: 0`.

> You are a job posting parser. Extract structured data from the page text below.
> Return ONLY valid JSON with exactly these fields (use null if not found): `company`, `position`, `location`, `salary`, `jobDescription` (copy the FULL job-description text exactly, no summarizing).

### 3.2 `POST /summary` — gpt-4o-mini (Mira) (`index.ts:437`)

Reads all of the user's applications + the Master Profile (server-side) and writes a warm-but-honest career assessment. `temperature: 0.2`.

- **System:** "You are Mira, a warm and empathetic AI career assistant who gives honest, grounded feedback… You speak plainly, avoid bullet points, and never use em dashes."
- **User prompt** injects funnel stats and `masterProfileToText(lib)`. Flags weekly application rate < 15, identifies skill gaps vs. applied roles, 6–10 plain-sentence lines.

### 3.3 `POST /master-profile/seed-from-text` — gpt-4.1-mini (`index.ts:524`)

Bootstraps a Master Profile from pasted/uploaded resume text (file uploads first go through `POST /parse-text` → pdf-parse / mammoth). `temperature: 0`, `response_format: json_object`.

- **System:** "You are a precise resume parser. Extract structured data from resume text and return ONLY valid JSON…"
- **User prompt** specifies the exact MasterProfile schema: `header`, `summaries`, `experiences` (with `bullets[] = {id, text, skills[], strength, tags[]}`), `projects`, `education`, `skills` (`{display, canonical, category, proven}`), `awards`.

### 3.4 `POST /tailor/claude` — claude-sonnet-4-6 (`index.ts:623`) ⭐ THE CORE

This is the prompt that **decides what stays in the resume and writes the bullets**. Full Master Profile JSON is embedded in the system prompt. `max_tokens: 6000`.

**System prompt (verbatim key rules, `index.ts:680`):**

> You are a professional resume tailor. Your ONLY data source is the candidate's Master Profile below.
> **MASTER PROFILE (your sole source of truth):** `<full profile JSON>`
> **HARD RULES — non-negotiable:**
> 1. You may SELECT, CUT, REORDER, CONDENSE bullets, and WRITE a tailored professional summary.
> 2. You must ONLY use facts present in the Master Profile. NEVER invent, embellish, or add any skill, metric, tool, title, experience, or project that is not explicitly present.
> 3. Do NOT optimize toward any numeric match score. Focus on honest, relevant presentation.
> 4. Produce a ONE-PAGE resume: be selective. Max 4 bullets per experience, max 3 per project.
> 5. Return ONLY valid JSON — no markdown fences, no explanation, no preamble.

It then requires an **HONEST FIT ASSESSMENT** (no inflation), enforces **SCOPING** (`genuineGaps` = what the candidate lacks vs. `suggestions` = how to strengthen what they have, must never overlap), and the **ACTIONABLE BULLETS** contract: for every suggestion, emit a `bulletSuggestions` entry `{ section, target, guidance, bullet }` grounded in real profile facts, using `[X]` placeholders for missing metrics.

**Output JSON:** `{ resumeContent: {header, summary, showSummary, sections[]}, review: {summary, keptItems, droppedItems, skillsSurfaced, suggestions, bulletSuggestions, fitAssessment{level,rationale}, recommendation, genuineGaps, matchScore} }`.

**User message:** just the JD (`jobDescription.slice(0, 6000)`).

### 3.5 `POST /rerank/claude` — claude-sonnet-4-6 (`index.ts:900`)

Scores the resume **exactly as written in the Builder** (after the user's edits), instead of regenerating from the Master Profile. `max_tokens: 2000`.

**System prompt (verbatim, `index.ts:919`):**

> You are an honest, rigorous resume evaluator. You are given a candidate's CURRENT resume (already written and edited by them) and a target job description. Score how well THIS resume — exactly as written — matches the job description.
> **HARD RULES:** Judge ONLY what is present; do NOT inflate; return ONLY valid JSON.

Same `bulletSuggestions` + `matchScore` contract as the tailor prompt, but grounded in the Builder content rather than the profile. **User message** carries both the JD and `JSON.stringify(resumeContent)`.

---

## 4. The scoring & caching mechanism — and why bullet edits don't move the score

This is the most important thing to understand about the current system, and the source of the active complaint.

### 4.1 The hash keys (`index.ts:24–26`)

```ts
const sha         = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
const hashJD      = (jd)  => sha(jd.replace(/\s+/g, ' ').trim().toLowerCase());
const hashProfile = (lib) => sha(JSON.stringify(lib ?? {}));   // ⚠ hashes the MASTER PROFILE only
```

### 4.2 Tailor caching (`index.ts:646–668, 862–876`)

`/tailor/claude` is cached in the `tailor_results` table keyed on **`(user_id, jd_hash, profile_hash)`**. Same JD + unchanged Master Profile → the stored result is returned with no Claude call. The score is persisted at `tailor_results.score = review.matchScore` and **never recomputed** for that key.

### 4.3 The badge (`index.ts:1026–1064`)

`GET /scores/claude` returns one score per application by matching each app's `hashJD(job_description)` against the newest `tailor_results` row. The Applications-tab badge shows **only this cached tailor score.**

### 4.4 The three scores, and the disconnect

There are **three different "scores" in the product**, and they are not the same number:

| Score | Computed from | Where shown | Updates when you edit bullets? |
|---|---|---|---|
| **Badge score** (`tailor_results.score`) | Master Profile (via `/tailor/claude`) | Applications tab badge | ❌ **Never** |
| **Tailor result score** (`result.review.matchScore`) | Master Profile (via `/tailor/claude`) | Tailor tab, after Generate | ❌ Never (frozen at generate time) |
| **Re-rank score** (`rerank.review.matchScore`) | The **edited Builder resume** (via `/rerank/claude`) | Tailor tab only, transient | ✅ Yes — but only on manual click |

**Why editing bullets in the Builder produces no score change:**

1. **Different data store.** Builder edits write to the `resume_builder` table (`useResumeData.ts:196–211, 220–226`), debounced 1.5s. The Master Profile is untouched.
2. **Cache never busts.** `profile_hash` hashes the **Master Profile only** (`index.ts:26`). Editing Builder bullets doesn't change the profile, so `(user_id, jd_hash, profile_hash)` stays identical and the cached badge/tailor score is frozen forever.
3. **Re-rank is the only path that reflects edits — and it's hidden.** `/rerank/claude` does score the live Builder content, but:
   - It only fires when the user clicks the "Re-rank" button in the Builder toolbar (`JobApplicationTracker.tsx:321–336` → `ResumeToolbar.tsx:109–117`).
   - Its result is shown over in the **Tailor tab** as transient React state (`TailorTab.tsx:362–365, 583`), not in the Builder where the editing happens.
   - It is **never written back** to `tailor_results` or the badge — `/rerank/claude` returns `{ review }` only, no DB write (`index.ts:1014`).

**Net effect for the user:** they edit bullets, watch the badge / generate score, and nothing ever changes — because that score is a frozen function of the Master Profile, not of what they're editing.

### 4.5 The bullet-suggestion → Builder handoff (`web/src/lib/bulletSuggestions.ts`)

Claude's `bulletSuggestions` (from tailor or rerank) are sent to the Builder via a localStorage queue:

- **Queue side (Tailor tab):** `queueBullets()` writes to `localStorage["jt.pending_bullets"]` and fires a `jt:bullets` event (`bulletSuggestions.ts:35–43`).
- **Apply side (Builder):** `useResumeData` drains the queue on mount and on the live event (`useResumeData.ts:127–143, 236+`), then `applyBulletsToContent()` inserts each line.
- **Targeting bug worth noting:** `pickItemIndex` (`bulletSuggestions.ts:74–86`) tries to match the suggestion's `target` against an item's org/role/project, but **falls back to index `0`** when there's no match — so a bullet can land under the wrong job/project silently. Insertion is append-only with no preview, diff, or undo of an individual applied suggestion.

---

## 5. Backend (`api/`)

Express + TypeScript, run via `tsx watch`. Two Supabase clients in `lib/supabase.ts`:

- `supabase` — service-role client (cache tables, admin ops).
- `getAuthClient(token)` — per-request client using the user's JWT so RLS applies.

All routes go through `requireAuth` (`middleware/auth.ts`), which validates the Bearer token via `supabase.auth.getUser()` and attaches `req.user`.

**Route groups (`src/index.ts`):**
- `/applications` — CRUD + `/applications/auto-ghost` (90-day-stale → Ghosted).
- `/profile` — GET/PUT/DELETE (DELETE = full account wipe across all tables + storage + auth).
- `/autofill` — prompt #1.
- `/summary` — prompt #2 (Mira).
- `/master-profile` — GET/PUT + `/seed-from-text` (prompt #3) + `/parse-text` (PDF/DOCX/DOC/TXT extraction).
- `/tailor/claude` — prompt #4, cached.
- `/rerank/claude` — prompt #5, **not** cached.
- `/scores/claude` — batch badge scores from `tailor_results` (no N+1).
- `/export/pdf` — Puppeteer renders `resumeContentToHtml` to a text-native ATS-safe PDF; a pdf-parse regression guard asserts extractable keywords (≥5) before responding.

---

## 6. Frontend (`web/`)

Single-page React app. `JobApplicationTracker.tsx` is the authenticated shell that owns shared state, tab routing, the score-loading (`loadCachedScores` → `/scores/claude`), and the re-rank handler (`handleRerank` → `/rerank/claude`). It passes the Supabase JWT as `Authorization: Bearer <token>` on every fetch.

**Tabs:**
- **Applications** (`tabs/ApplicationsTab.tsx`) — Kanban/table, cached score badges, Mira summary.
- **Master Information** (`tabs/MasterInfoTab.tsx` + `MasterProfileEditor.tsx`) — Master Profile form editor, JSON import/export, seed-from-resume.
- **Analytics** (`tabs/AnalyticsTab.tsx`) — KPI cards + recharts.
- **Tailor** (`tabs/TailorTab.tsx`) — JD input → Claude generate → review + **mandatory approve gate** → Builder handoff. Also displays the transient re-rank result.
- **Resume Builder** (`resume/ResumeBuilderLayout.tsx`, `hooks/useResumeData.ts`) — live editor + preview, versions, undo/redo, debounced auto-save to `resume_builder`, LaTeX copy, server-side PDF download, the Re-rank button.
- **Profile** (`tabs/ProfileTab.tsx`) — account settings, CSV export, theme, delete account.

**Handoffs (localStorage as the single source of truth across tab switches):**
- `jt.pending_tailor` — approved `ResumeContent`, consumed atomically by `useResumeData.fetchVersions` on Builder mount.
- `jt.pending_bullets` — queued bullet suggestions (see §4.5).

---

## 7. Chrome extension (`extension/`)

Manifest v3. Content script runs on LinkedIn job pages; background worker POSTs to the API at `localhost:3000` and opens the web app at `localhost:5173` (**both hardcoded** — rebuild if ports change). No LLM calls of its own; it only hits `/autofill` and the applications routes.

---

## 8. Supabase tables (current)

| Table | Purpose |
|---|---|
| `applications` | Job applications per user; `job_description`, `timeline` (jsonb), `last_updated` |
| `master_profile` | One row per user, `content` (jsonb MasterProfile) — **source of truth** for tailoring |
| `tailor_results` | Cached Claude tailor outputs keyed on `(user_id, jd_hash, profile_hash)`; holds `resume_content`, `review`, `score` |
| `resume_builder` | Builder versions per user (`content`, `settings`, `version_name`); written directly from the web app via the Supabase client |
| `profiles` | Display name, avatar, theme |
| `resumes` + Storage bucket `resumes` | **Legacy** (vault removed); only touched by the account-wipe cleanup |

---

## 9. Known gap driving current work

**The bullet-point mechanism and the scoring mechanism are two disconnected systems** (§4). Editing bullets in the Builder changes `resume_builder` but never the Master-Profile-derived score the user is looking at. The only score that reacts to edits (`/rerank/claude`) is manual, hidden in the wrong tab, and never persisted to the badge. On top of that, the suggestion-insertion logic can drop bullets under the wrong section item with no preview/undo.

**Open design questions for next steps (to discuss):**
1. Should the score auto-recompute (debounced `/rerank/claude`) as bullets are edited, shown live in the Builder?
2. Should the Applications badge reflect the **edited** resume (persist the rerank score) or keep the Master-Profile baseline — or show both with a delta?
3. Bullet UX fixes: correct-target insertion, inline accept/reject, per-suggestion undo.

_(Scoring trigger / badge-source / bullet-UX decisions deferred per the last discussion — to be settled before implementation.)_
