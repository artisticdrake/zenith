-- ════════════════════════════════════════════════════════════════════════════
-- Stage 5 — Scrape sessions / history on the job-triage board
-- Apply in the Supabase SQL editor (or via the CLI) for the project.
-- Additive + nullable: safe to run on a populated scraped_jobs table.
-- ════════════════════════════════════════════════════════════════════════════

-- Every row written by a single POST /jobs/scrape call shares one freshly-generated
-- scrape_session_id and one scraped_at timestamp, so the UI can group a scrape's
-- results into a collapsible "session" (newest first). Distinct from scored_at
-- (when the scorer last ran) and created_at (row insert). Manually-pasted jobs and
-- any pre-existing rows keep scrape_session_id = NULL → they show as "Ungrouped".
-- A deduped re-scrape returns the existing row untouched, so it KEEPS its original
-- session rather than jumping to the new one.
alter table public.scraped_jobs
  add column if not exists scrape_session_id uuid,
  add column if not exists scraped_at        timestamptz;

-- Group a user's jobs by session efficiently (Sessions view).
create index if not exists scraped_jobs_user_session_idx
  on public.scraped_jobs (user_id, scrape_session_id);
