# Zenith — JD-Tailored Resume Generator (Build Spec v1: Select-Only)

**Goal:** Paste a job description into a new "Tailor" tab → Zenith deterministically assembles a one-page resume by *selecting and arranging* the most JD-relevant items from a master content library → renders it in the existing Resume Builder → runs a check-up (deterministic JD-match score + a Claude critique with honest, fact-bounded suggestions).

**v1 scope (this spec):** *Select-only.* The engine picks and reorders pre-written, true bullets. It never rewrites or invents. The only LLM call is the optional check-up critique. v2 (bounded rephrasing + forced review) is sketched at the end but **not** built now.

---

## 0. Core principles (enforce these in code, not just intent)

1. **Single source of truth.** All factual content lives in the Master Profile. The tailoring engine may only *select, order, and show/hide* from it. In v1 it copies `bullet.text` verbatim — no edits.
2. **Determinism.** Same JD + same library → identical resume. No LLM in the generation path. (Mirrors Zenith's existing "pure-JS scoring over GPT" decision.)
3. **Reuse first.** ~70% already exists: `parseJD`, the Skill Dictionary, `computeHybridScore`, the `ResumeContent` model, the Resume Builder, and PDF export. Build only the library, the selector, and the check-up.
4. **Honesty guardrail in the critique.** The Claude check-up may only suggest *surfacing content that already exists* in the library. Genuine gaps are **flagged, never filled**. No "add Kubernetes if you haven't used it."

---

## 1. Reuse vs. new

| Piece | Status | Action |
|---|---|---|
| `parseJD` → `ParsedJD` (required/preferred skills, years, education, gatekeepers) | Exists | Reuse as-is |
| Skill Dictionary (200+, canonical/aliases/impliedBy/weight) | Exists | Reuse in selector |
| `computeHybridScore` (0–100, 5 components) | Exists | Reuse for check-up |
| `ResumeContent` model + Resume Builder UI (dnd, show/hide, fonts) | Exists | Reuse as render target |
| PDF render + save-to-vault (html2canvas + jsPDF) | Exists | Reuse for "save tailored version" |
| **Master Profile** (content library) | **New** | Build table + types + minimal editor |
| **Selection engine** (`tailorResume`) | **New** | Build pure-JS module |
| **Check-up** (deterministic score on generated resume + Claude critique) | **New** | Build endpoint + Anthropic call |
| **"Tailor" tab** (paste box → generate → builder + check-up panel) | **New** | Build React tab |

---

## 2. Data model — Master Profile

One row per user. Store the whole library as structured `jsonb` (matches Zenith's existing jsonb pattern; selection runs in memory so no need to normalize for v1).

### SQL

```sql
create table master_profile (
  user_id    uuid primary key references auth.users,
  content    jsonb not null default '{}',
  updated_at timestamptz default now()
);
alter table master_profile enable row level security;
create policy "user_scope" on master_profile using (user_id = auth.uid());
```

### TypeScript types (`shared/`)

```typescript
interface MasterProfile {
  header: { name: string; title: string; phone: string; email: string;
            linkedin?: string; github?: string; portfolio?: string };
  summaries: SummaryVariant[];      // multiple options; selector picks best-fit
  experiences: LibraryExperience[];
  projects: LibraryProject[];
  education: LibraryEducation[];
  skills: LibrarySkill[];
  awards: LibraryAward[];
}

interface SummaryVariant { id: string; text: string; tags: string[]; }

interface LibraryBullet {
  id: string;
  text: string;            // the TRUE, pre-written bullet — copied verbatim in v1
  skills: string[];        // canonical skills (Skill Dictionary keys) this bullet proves
  metric?: string;         // quantified impact, if any (e.g., "26% faster")
  strength: 1 | 2 | 3;     // manual impressiveness rating (3 = flagship)
  tags: string[];          // domain tags: "genai" | "cv" | "nlp" | "bioinformatics" | "fullstack" | "mlops" ...
}

interface LibraryExperience {
  id: string; org: string; role: string; location?: string;
  startDate: string; endDate: string | null; current: boolean;
  defaultInclude: boolean;  // always include (e.g., current role)
  tags: string[];
  bullets: LibraryBullet[]; // the POOL; selector chooses a subset
}

interface LibraryProject {
  id: string; name: string; links?: { label: string; url: string }[];
  startDate?: string; endDate?: string;
  tags: string[]; techStack: string[];
  bullets: LibraryBullet[];
}

interface LibraryEducation {
  id: string; institution: string; degree: string; field?: string;
  startDate?: string; endDate?: string; gpa?: string;
  defaultInclude: boolean; bullets: LibraryBullet[];
}

interface LibrarySkill {
  canonical: string;   // matches Skill Dictionary
  display: string;     // e.g., "PyTorch"
  category: string;    // "language" | "ml" | "nlp" | "cloud" | "web" | "data" ...
  proven: boolean;     // true if it appears in an experience/project bullet
}

interface LibraryAward { id: string; title: string; issuer?: string; date?: string; tags: string[]; }
```

**Seeding:** populate once from the real resume + projects. Rate each bullet's `strength` and tag every item/bullet. This is a one-time data-entry task (a minimal form, or seed JSON committed to the repo and upserted).

---

## 3. The `/tailor` pipeline (pure JS, no LLM)

```
POST /tailor { jobDescription, applicationId? }
   ↓
1. parsed = parseJD(jobDescription)            // REUSE existing
2. lib    = loadMasterProfile(userId)
3. score every bullet & item vs parsed         // selection engine (new)
4. select within a one-page budget + order sections
5. emit ResumeContent                          // existing shape → opens in Builder
   (optionally also return deterministic check-up score)
```

### Selection algorithm (`tailorResume(parsed, lib): ResumeContent`)

**3a. Expand skills.** For each `LibraryBullet`, expand `bullet.skills` via the Skill Dictionary's `impliedBy` (e.g., PyTorch + TensorFlow ⇒ implies `machine-learning`, `deep-learning`). This is the same expansion `parseResume` already does — reuse it.

**3b. Score each bullet** against `parsed`:

```
bulletScore =
    Σ over expanded bullet.skills:
        skill ∈ parsed.requiredSkills  → + (dictWeight(skill) * 3)
        skill ∈ parsed.preferredSkills → + (dictWeight(skill) * 1.5)
        else                           → + 0.25            // mild base credit
  + (bullet.metric ? 1.5 : 0)                              // quantified-impact bonus
  + (bullet.strength - 1)                                  // 0 / 1 / 2
```

**3c. Score each item** (experience/project):

```
itemScore = sum(top-K bulletScores in item)
          + recencyBonus(item.endDate)        // more recent = small bonus
          + tagOverlap(item.tags, parsed)      // domain alignment (see 3f)
```

**3d. Select items** within a one-page budget:
- Always include items with `defaultInclude` (current role, MS degree).
- Rank remaining experiences + projects by `itemScore`, include highest first until budget is reached (see 3g).
- Within each included item, keep the top `K` bullets by `bulletScore` (K≈4 for experiences, 3 for projects), but **always retain at least one `metric` bullet** if the item has one.

**3e. Skills section.** Emit matched skills first (those in `parsed.requiredSkills`), then matched preferred, then a few remaining proven skills. Cap to keep one-page.

**3f. Section ordering.** Compute `projectsRelevance` vs `experienceRelevance` (sum of selected itemScores per section). Lead with whichever is higher; tie-break toward Projects if the JD text matches a startup/portfolio signal (`/startup|portfolio|ship|build|prototype/i`). Header → Summary → [Projects | Experience, ordered] → Education → Skills → Awards.

**3g. One-page budget (first-cut heuristic).** Estimate lines: `headerLines + summaryLines + Σ(item header + bullets) + skillsLines`. If over a configurable `MAX_LINES` (start ~42 for typical fonts), trim lowest-`bulletScore` bullets, then lowest-`itemScore` non-default items, until under budget. Note in UI that the Builder's live preview is the real arbiter of page fit.

**3h. Summary.** Pick the `SummaryVariant` whose `tags` best overlap the JD's domain tags (3f); fallback to the first.

**Output:** a `ResumeContent` object (existing shape) → load directly into the Resume Builder. Deterministic.

---

## 4. The check-up

### Layer 1 — deterministic (reuse `computeHybridScore`)

Score the **generated** resume against the same `parsed` JD. Two integration options:
- **(Preferred, single code path):** render `ResumeContent` → plain text, then run the existing `parseResume` + `computeHybridScore`. Reuses everything; no new scoring code.
- (Alt) write a thin `resumeContentToParsedResume()` adapter. More code, skips text round-trip.

Returns the existing shape: `{ score, scoreBreakdown, matchedSkills, missingSkills }`. Show it live in the Tailor tab; re-run on builder edits.

### Layer 2 — Claude critique (Anthropic API)

Add `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY` to `api/.env`. Model: `claude-sonnet-4-6` (drop to `claude-haiku-4-5-20251001` for cost). One call, structured JSON out.

**System prompt:**
```
You are an expert technical recruiter and ATS specialist reviewing a resume that was
auto-assembled for a specific job description. Return ONLY valid JSON, no markdown.

Rules you must follow:
- There is no universal "ATS score." Judge the signals that actually matter:
  keyword coverage vs the JD, machine-parseability, and quantified-impact density.
- HONESTY: You may only suggest surfacing or re-emphasizing content that ALREADY
  appears in the candidate's material. Never suggest adding a skill, tool, metric,
  or experience that is not present. Real gaps must be FLAGGED, not filled.
- Be specific and actionable. Reference exact bullets/sections.
```

**User message payload:**
```
JOB DESCRIPTION:
<jdText>

GENERATED RESUME (plain text):
<resumeText>

DETERMINISTIC MATCH: score=<score>/100; matched=<matchedSkills>; missing=<missingSkills>

Return JSON:
{
  "parseability": { "issues": string[], "ok": string[] },        // formatting/headers/dates/no-tables
  "keywordCoverage": {
     "surfaceable": [{ "skill": string, "where": string }],      // present but buried — say where to surface
     "genuineGaps": string[]                                     // truly absent — flag only, do not fill
  },
  "quantification": { "strongBullets": string[], "weakBullets": string[] },
  "lengthFit": string,
  "prioritizedChanges": [{ "change": string, "why": string, "honest": true }]
}
```

Parse defensively (strip any stray fences before `JSON.parse`, wrap in try/catch) — same pattern Zenith already uses for OpenAI responses.

---

## 5. New endpoints (all require `Authorization: Bearer <token>`)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/master-profile` | — | `MasterProfile` |
| PUT | `/master-profile` | `MasterProfile` | updated `MasterProfile` |
| POST | `/tailor` | `{ jobDescription, applicationId? }` | `{ resumeContent, parsedJd, score?, scoreBreakdown?, matchedSkills?, missingSkills? }` |
| POST | `/tailor/checkup` | `{ resumeContent, jobDescription }` | `{ score, scoreBreakdown, matchedSkills, missingSkills, critique }` |

`/tailor` runs steps 1–5 (pure JS, fast, deterministic). `/tailor/checkup` runs Layer 1 + Layer 2; keep it separate so generation stays instant and the Claude call is on-demand. Optionally cache critique on `(resume_hash, jd_hash)` like `match_results` already does.

---

## 6. Frontend — "Tailor" tab

- **Inputs:** a JD paste box; optional "link to application" dropdown (pulls `job_description` from a tracked application).
- **Generate:** calls `/tailor` → loads `resumeContent` into the **existing Resume Builder** component (so editing/reorder/fonts/PDF all work for free).
- **Check-up panel:** big deterministic score + breakdown (Layer 1), updating live as the user edits in the builder; a "Run Claude check-up" button for Layer 2, rendering `prioritizedChanges`, `surfaceable` (with "where"), and `genuineGaps` (clearly marked "not added — your call").
- **Save:** reuse the builder's render-to-PDF + save-to-vault; auto-label `"{company} – {role} – tailored"` and, if `applicationId` was provided, attach it to that application's `documents`.

---

## 7. Build order for Claude Code (each step independently shippable)

1. **Master Profile**: SQL migration + `shared/` types + `GET/PUT /master-profile` + a minimal editor form (or commit a seed JSON and upsert). *Acceptance:* library round-trips and renders a baseline resume via the existing builder.
2. **Selection engine** `api/tailor/tailorResume.ts`: implement §3 (reusing `parseJD`, Skill Dictionary, skill expansion). Pure unit-testable function. *Acceptance:* given a sample JD + seeded library, returns a sensible, deterministic `ResumeContent`; same input → identical output.
3. **`POST /tailor`** + the "Tailor" tab wired to the builder. *Acceptance:* paste JD → tailored resume appears in builder.
4. **Check-up Layer 1**: render→text→`computeHybridScore`; show live score. *Acceptance:* score + matched/missing display and update on edit.
5. **Check-up Layer 2**: Anthropic call + critique panel + honesty guardrail prompt. *Acceptance:* returns structured critique; gaps are flagged, never auto-added.
6. **Save tailored version** to vault + attach to application. *Acceptance:* labeled PDF saved; appears in Files and on the application.

---

## 8. v2 (later — do NOT build now)

Add a **bounded rephrase** pass over *selected* bullets: an LLM rewrite constrained by prompt to the facts in the source bullet (no new tools/metrics/scope), with a **mandatory "review & approve before save"** step. Keep select-only as the default and rephrase as an opt-in toggle, so the trustworthy deterministic path always remains available.
