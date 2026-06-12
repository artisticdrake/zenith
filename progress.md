# Zenith — Job Tracker Executive Portal
## Product Progress Log

---

## What the product is

Zenith is a full-stack SaaS job search platform. The tagline "Executive Portal" reflects the intended positioning: not a scratchpad, but a professional command center that tracks every application through its full lifecycle, matches your resume against job descriptions with a deterministic scoring engine, and assembles a tailored one-page resume using Claude AI from your personal Master Profile — with a mandatory human-approval gate before anything reaches the Builder.

---

## Architecture Decision Record (2026-06-11) — Cleanup & Claude-score consolidation

Repo-wide cleanup. Decisions now final:

| Decision | Rule |
|---|---|
| **Vault fully removed** | All `/resumes` routes, FilesTab, VaultPickerModal, Import/Save-to-Vault in Builder — deleted. `resumes` table is legacy, touched only by account wipe |
| **Deterministic scorer removed** | `matcher.ts`, `skillDictionary.ts`, `/match` routes, `/score/master` — deleted. Claude's `review.matchScore` is the only score |
| **Claude scores are cached, never recomputed** | `tailor_results` table keyed on `(user_id, jd_hash, profile_hash)`. Same JD + unchanged Master Profile → stored result, no Claude call. Any change to JD or profile busts the cache via the hash |
| **Badges read the cache in one batch** | `GET /scores/claude` maps every application's JD hash to its stored score — replaces the old per-app N+1 |
| **Mira uses the Master Profile** | `/summary` previously read the active vault resume; now reads `master_profile` |
| **`shared` workspace deleted** | Was never imported; types live in `web/src/lib/types.ts` and `web/src/types/resume.types.ts` |

Match dialog removed from the Applications tab (its deterministic backend is gone); the score badge remains, fed by cached Claude scores.

---

## Architecture Decision Record (2026-06-02)

The v1 deterministic selection engine (`tailorResume.ts`) has been removed from the tailoring path and replaced with Claude as the sole tailoring brain. Key decisions that are now final:

| Decision | Rule |
|---|---|
| **Master Profile is the ONLY content source** | Claude tailors exclusively from it; nothing is invented |
| **Claude is the sole tailoring engine** | `tailorResume.ts` is dormant; never called |
| **Deterministic score is a display metric only** | Never fed to Claude, never gates anything, never used to order or select |
| **Mandatory approve gate** | Claude proposes → user reviews → user approves → Builder opens; not skippable |
| **Files/Vault tab removed** | Replaced by Master Information tab; no more 5-resume vault in the UI |

---

## Tab-by-Tab Breakdown

---

### Applications Tab

**What it does**

The root view of the tracker. Shows all saved job applications as either a Kanban board (grouped by status) or a compact table, with real-time filtering by status, source, and free-text search across company/position/location.

**Per-application data:**
- Company, position, location, salary (free-text)
- Date applied, source (LinkedIn / Handshake / Jobright / Glassdoor / Indeed / Interstride / Other)
- Referral flag, job URL, full job description text, notes
- Status (8 stages): Applied → Screening → Interview Scheduled → Interview Completed → Offer / Rejected / Ghosted / Withdrawn
- Timeline: auto-logged history of every status change (manual + auto-ghost events)

**Key behaviors:**
- **Auto-ghost**: any application inactive for 90+ days that hasn't reached a terminal status is automatically marked Ghosted, with `auto: true` appended to the timeline
- **Score badges**: each application card shows a score computed by `computeHybridScore` against the user's **Master Profile** text (previously scored against vault resumes; now always uses master profile). Pure JS, no LLM, runs on app load via `GET /score/master/:appId`.
- **Mira AI summary**: a sidebar button sends all applications to GPT-4o-mini for a personalized career assessment — observations about your funnel performance, patterns, and actionable next steps

**Chrome extension handoff:** The extension's "Save" button POSTs to `/applications` and redirects the browser to the web app. The saved job appears immediately in this tab.

**Status: Complete and stable. Score badges now use Master Profile as the scoring source.**

---

### Master Information Tab *(formerly "Files / Resume Vault")*

**What it does**

Houses the Master Profile — the single source of truth for all tailored resume content. Replaces the old Files/Resume Vault tab. The 5-resume vault is gone from the UI.

#### Master Profile Library

A full-page always-expanded form editor. Every bullet you've ever written lives here, rated and tagged. Claude selects from this at tailoring time.

**Sections:**
- **Header**: name, title, phone, email, LinkedIn, GitHub, portfolio
- **Summaries**: multiple text variants with domain tags
- **Experiences**: org, role, location, start/end date, current toggle, always-include toggle, domain tags, and a pool of `LibraryBullet` objects
- **Projects**: name, tech stack, dates, domain tags, bullet pool
- **Education**: institution, degree, field, dates, GPA, always-include toggle
- **Skills**: canonical key, display name, category, proven flag
- **Awards**: title, issuer, date

**Per-bullet metadata:**
- `text`: the verbatim bullet sentence
- `skills[]`: canonical skill keys from the Skill Dictionary
- `metric?`: quantified impact string (e.g., "26%")
- `strength`: 1 / 2 / 3
- `tags[]`: domain tags

**JSON import/export:** A "JSON" button opens an inline panel for pasting a full `MasterProfile` JSON or exporting the current library. Import sanitizes all bullet texts on load.

**Data hygiene:** Bullet `onChange` replaces `\n` with space in real time. On load and JSON import, `sanitizeProfileBullets()` recursively cleans all `text` fields.

#### Seed from Existing Resume *(new)*

A collapsible panel at the top of the tab. Allows bootstrapping the Master Profile without hand-typing everything:

1. Paste resume text **or** upload a PDF/DOCX/TXT file
2. For file uploads, `POST /parse-text` extracts the text server-side (pdf-parse / mammoth)
3. `POST /master-profile/seed-from-text` sends the text to GPT-4.1-mini with a detailed MasterProfile JSON schema prompt
4. The parsed profile pre-fills the editor below — user reviews, enriches, and saves

**Status: Complete and stable.**

---

### Analytics Tab

**What it does**

Performance metrics and charts across all tracked applications.

**Metric cards (6):**
- Response Rate, Avg Response Time, Screening Rate, Interview Rate, Offer Rate, Median Offer Salary

All counters animate on load via `useCountUp` (800ms).

**Charts (4):**
- Monthly application volume (bar + running average overlay)
- Status distribution (donut)
- Application source breakdown (bar)
- Application funnel (conversion rates)

**Status: Complete and stable.**

---

### Resume Builder Tab

**What it does**

A full in-browser resume editor with live preview, version management, and export.

**Sections:** Header, Summary, Experience, Education, Projects, Skills, Custom

**Features:**
- Drag-to-reorder sections (`@dnd-kit`)
- Show/hide individual sections
- Add/remove/reorder bullet points
- Inline markdown: `**bold**`, `*italic*`
- 11 font choices
- Typography controls (size, spacing, margins, header alignment)
- Auto-fit one-page toggle
- Undo/redo (20 steps)
- Debounced auto-save to Supabase (1.5s)
- Named version management

**Tailor handoff:** When the user approves in the Tailor tab, `ResumeContent` is written to `localStorage` under `jt.pending_tailor` before tab switch. `useResumeData.fetchVersions` reads and atomically clears it on mount.

**Download PDF:** `POST /export/pdf` → Puppeteer server-side → text-native PDF with embedded TrueType fonts. ATS can extract and search the text.

**Regression guard:** pdf-parse re-extracts text from the generated PDF; asserts ≥5 known keywords are present; returns 500 if assertion fails.

**Status: Complete and stable.**

---

### Tailor Tab *(fully restructured — Claude-only flow)*

**What it does**

Paste a job description → Claude assembles a tailored one-page resume from your Master Profile → you review the proposal → you approve → it opens in the Resume Builder. Claude is the sole brain; no deterministic selection engine in this path.

---

#### Input Panel

- **Job Description textarea**: paste the full JD
- **Pull from saved application (optional)**: dropdown of apps that have a saved JD; selecting one pre-fills the textarea and records the `applicationId` for the post-approve link step

---

#### Claude Section

After clicking **"Generate with Claude AI"**, the right panel shows:

**Score Ring (read-only display metric)**
- Labeled "Display metric — not used by Claude"
- Computed after Claude returns: `resumeContentToText(resumeContent)` → `parseResume` → `computeHybridScore` vs `parseJD`
- Score is locked here; it is never sent to Claude and never used to select, order, or gate anything
- Breakdown bars: Required skills / Depth of evidence / Preferred skills / Experience / Education

**Claude's Review**
- `summary`: 1–2 sentence narrative of tailoring decisions
- `keptItems`: experiences/projects Claude selected and why
- `droppedItems`: what was excluded and why
- `skillsSurfaced`: skills surfaced from the profile for this JD
- `suggestions`: honest observations about real gaps or improvements

---

#### Mandatory Approve Gate

The **"Approve & Open in Builder"** button is the only way to proceed. It cannot be bypassed.

On click:
1. Writes `resumeContent` to `localStorage["jt.pending_tailor"]`
2. Sets `approved = true`
3. Shows the post-approve app-link panel (see below)
4. An "Open in Builder" button appears to trigger the tab switch

---

#### Post-Approve: Create / Link Application *(Task 4)*

After approving, a panel offers to associate the tailored resume with an application entry:

- **If a saved app was linked (via dropdown):** "Link to Existing Application" — updates the application's notes field with a timestamp
- **If JD was pasted manually:** "Create an Application" — form with Company + Role fields → calls `POST /applications` with the JD text stored as `job_description`
- **Skip** dismisses the panel

---

#### Claude Tailoring Endpoint (`POST /tailor/claude`)

```
1. Load MasterProfile from master_profile table — the ONLY allowed content source
2. Call claude-sonnet-4-6 with:
   - System prompt: full MasterProfile JSON embedded; HARD RULES stated explicitly:
       a. Select, cut, reorder, condense, write summary — ONLY from Master Profile facts
       b. NEVER invent, embellish, or add any skill/metric/tool/title/experience not present
       c. Do NOT optimize toward any numeric score
       d. One-page output: max 4 bullets/exp, 3/proj
   - User message: the JD
3. Defensive JSON parse (strip code fences, regex fallback, try/catch)
4. After Claude returns resumeContent:
   parseJD(jd) → parseResume(resumeContentToText(resumeContent)) → computeHybridScore
   → return as { score, scoreBreakdown } alongside resumeContent + review (display only)
```

Returns: `{ resumeContent, review: { summary, keptItems, droppedItems, skillsSurfaced, suggestions }, score, scoreBreakdown }`

**`POST /tailor` (old deterministic endpoint)**: returns 410 Gone. `tailorResume.ts` is dormant.
**`POST /tailor/checkup`**: removed. Its functionality is folded into the Claude review above.

---

**Status: Claude-only flow complete. Approve gate is mandatory. Score is display-only.**

---

### Profile Tab

**What it does**

Account management, preferences, and data export.

- Avatar + display name editor
- Stats: total applications, days active
- Theme toggle: light / dark (persisted to localStorage + Supabase)
- CSV export
- Logout
- Delete account (two-step): cascades across all tables and Storage

**Status: Complete and stable.**

---

## Infrastructure & Cross-Cutting

### Chrome Extension

Manifest V3 extension. Injects a floating panel on supported job boards. **Left as-is in the v2 restructure.**

- Autofill via `POST /autofill` (GPT-4.1-mini extracts structured fields)
- Session cache in `chrome.storage.session` (30-min TTL, LRU eviction)
- SPA navigation interception with 1.5s debounce
- Background service worker self-ping (keep-alive)
- PKCE OAuth via `chrome.identity.launchWebAuthFlow`

**Status: Complete and stable. Port mismatch note: extension hardcodes API at 3000, web at 5173.**

---

### Matching Pipeline

Four-step hybrid pipeline in `api/src/matcher.ts`:

1. `parseJD(jdText)` — pure JS regex + Skill Dictionary → `ParsedJD`
2. `parseResume(text)` — pure JS section-aware parsing → `ParsedResume`
3. `computeHybridScore(resume, jd)` — 5-component weighted scorer (0–100); deterministic and locked
4. `generateExplanation(...)` — GPT-4o-mini writes narrative from the locked score

This pipeline is now used in two places:
- **Match dialog** (`POST /match`): scores against vault resume (legacy; vault UI removed but backend route kept)
- **Badge scoring** (`GET /score/master/:appId`): scores app JD against Master Profile text — the live path

**Status: Complete and stable.**

---

### PDF Export Pipeline

`POST /export/pdf { content, settings }`:
1. `resumeContentToHtml(content, settings)` → self-contained HTML
2. Puppeteer + bundled Chromium → `page.pdf({ format: 'Letter' })`
3. pdf-parse regression guard: asserts ≥5 known keywords present; returns 500 on failure

PDF output: `CIDFontType2` (TrueType-based) with `/ToUnicode` entries. Verified ATS-extractable via `pdftotext`.

**Status: Complete and stable.**

---

## Known Gaps / Next Up

| Area | Gap | Priority |
|---|---|---|
| Builder | Verify all 6 rendering checks (bullet split, lowercase start, header slot contamination, edu isolation, empty skill labels) on a live Claude-tailored resume | High |
| Tailor | Save tailored PDF to vault (or attach JSON to application) with auto-label | High |
| Matching | Match dialog still references vault resume flow — works for existing cached results, but "Run Match" now uses master profile score (no narrative/rewrites for new runs) | Medium |
| Extension | Port mismatch: hardcoded 3000/5173 — rebuild needed if ports change | Medium |
| Tailor | Live check-up score updating as user edits in Builder | Low |
| Auth | Token refresh failure not handled gracefully (user must reload) | Low |
| Builder | DnD section-ID collision if manually-created section shares ID with tailor output | Low |
| Matching | `extractYearsRequired` takes only last regex match — multi-requirement JDs may lose data | Low |
| PDF | `html2canvas` still present in `web/package.json` as a dependency — safe to remove | Low |

---

## File Map (key files only)

```
api/src/
  index.ts                    All Express routes (30+)
  matcher.ts                  Hybrid matching pipeline (parseJD, parseResume, score, explain)
  middleware/auth.ts          requireAuth JWT guard
  lib/supabase.ts             Admin client + per-request RLS-scoped client
  lib/skillDictionary.ts      200+ skills with aliases, weights, implication rules
  tailor/
    tailorResume.ts           DORMANT — pure-JS selection engine (not called in v2)
    resumeContentToText.ts    ResumeContent → plain text (used for badge scoring)
  export/
    resumeToHtml.ts           ResumeContent + settings → self-contained HTML
    pdfExport.ts              Puppeteer wrapper + regression guard

web/src/
  components/
    JobApplicationTracker.tsx Root authenticated shell (owns all shared state)
    layout/Sidebar.tsx        Tab nav, TabId type (master-info replaces files)
    tabs/
      ApplicationsTab.tsx     Kanban/table view, match score badges, Mira
      MasterInfoTab.tsx       Master Profile editor + seed-from-resume (replaces FilesTab)
      MasterProfileEditor.tsx Section-wise form + JSON import/export (alwaysOpen / seedProfile props)
      AnalyticsTab.tsx        KPI cards + 4 Recharts charts
      TailorTab.tsx           JD input → Claude generate → approve gate → Builder handoff
      ProfileTab.tsx          Account settings, export, delete
    resume/
      ResumeBuilderLayout.tsx Orchestrates editor + preview
      editor/                 EditorPanel, SectionList, ExperienceItem, ProjectItem, etc.
      preview/                ResumePreview, PreviewExperience, PreviewProject, PreviewSkills
      export/generatePDF.ts   Client-side hook that calls POST /export/pdf
  hooks/
    useResumeData.ts          Resume builder state, versions, undo/redo, auto-save, tailor handoff
    useAutoFit.ts             Auto-adjust typography to fit one page
  pages/ResumeBuilder.tsx     Thin wrapper around ResumeBuilderLayout

shared/types.ts               ApplicationStatus, JobImportPayload, MasterProfile + Library* types
```

---

## Supabase Tables

| Table | Purpose |
|---|---|
| `applications` | Job applications per user; includes `job_description`, `parsed_jd` (jsonb cache) |
| `resumes` | Vault resume metadata + `extracted_text` + `parsed_resume` (jsonb) — backend routes kept; vault UI removed |
| `master_profile` | Single row per user with `content` (jsonb MasterProfile) — the source of truth for tailoring |
| `profiles` | Display name, avatar, theme settings |
| `match_results` | Cached match outputs keyed on `(application_id, resume_id, jd_hash)` — legacy; badges now use master profile scoring |
