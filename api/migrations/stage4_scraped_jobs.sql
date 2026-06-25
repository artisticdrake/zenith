-- ════════════════════════════════════════════════════════════════════════════
-- Stage 4 — Scraped / pasted job triage board (Phase 1)
-- Apply in the Supabase SQL editor (or via the CLI) for the project.
-- ════════════════════════════════════════════════════════════════════════════

-- A "job" is a posting the user wants triaged: its JD, where it came from, the
-- cached triage scores (master profile vs JD, computed by buildScorerPrompt), and
-- a lifecycle status. Content-addressed on (user_id, jd_hash) via hashJD so the
-- same posting pasted twice maps to one row (an upsert re-scores it in place).
-- RLS mirrors cover_letters exactly: a user may only ever see / write their own rows.
create table if not exists public.scraped_jobs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  source         text,                      -- 'manual' | 'wellfound' | 'builtin' | 'linkedin' | ...
  title          text,
  company        text,
  location       text,
  url            text,
  jd_text        text not null,
  jd_hash        text not null,
  posted_at      timestamptz,
  status         text not null default 'new', -- new | scored | generated | applied | skipped
  match_score    int,
  ats_score      int,
  recruiter_score int,
  bucket_verdict text,                       -- in-bucket | reach | out-of-pool | over-qualified
  lane_warning   text,
  scored_at      timestamptz,
  created_at     timestamptz not null default now(),
  unique (user_id, jd_hash)
);

create index if not exists scraped_jobs_user_status_idx on public.scraped_jobs (user_id, status);
create index if not exists scraped_jobs_user_score_idx  on public.scraped_jobs (user_id, match_score);

alter table public.scraped_jobs enable row level security;

-- A user may only ever see / write their own job rows. (The /internal/score-job
-- machine path uses the service-role client, which bypasses RLS by design, and
-- derives the owner from INTERNAL_USER_ID server-side — never from the request.)
drop policy if exists "scraped_jobs_select_own" on public.scraped_jobs;
create policy "scraped_jobs_select_own" on public.scraped_jobs
  for select using (auth.uid() = user_id);

drop policy if exists "scraped_jobs_insert_own" on public.scraped_jobs;
create policy "scraped_jobs_insert_own" on public.scraped_jobs
  for insert with check (auth.uid() = user_id);

drop policy if exists "scraped_jobs_update_own" on public.scraped_jobs;
create policy "scraped_jobs_update_own" on public.scraped_jobs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "scraped_jobs_delete_own" on public.scraped_jobs;
create policy "scraped_jobs_delete_own" on public.scraped_jobs
  for delete using (auth.uid() = user_id);
