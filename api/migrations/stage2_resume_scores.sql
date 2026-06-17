-- ════════════════════════════════════════════════════════════════════════════
-- Stage 2 — Content-addressed live scoring
-- Apply in the Supabase SQL editor (or via the CLI) for the project.
-- ════════════════════════════════════════════════════════════════════════════

-- ── PART A — Score store ─────────────────────────────────────────────────────
-- A score is a content-addressed function of the RENDERED (ATS-visible) resume
-- text + the target JD. Same rendered text + same JD => same row => identical
-- score with no new Claude call.
create table if not exists public.resume_scores (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  jd_hash      text not null,
  content_hash text not null,
  score        int,
  review       jsonb,
  created_at   timestamptz not null default now(),
  unique (user_id, jd_hash, content_hash)
);

create index if not exists resume_scores_user_idx on public.resume_scores (user_id);

alter table public.resume_scores enable row level security;

-- A user may only ever see / write their own score rows.
drop policy if exists "resume_scores_select_own" on public.resume_scores;
create policy "resume_scores_select_own" on public.resume_scores
  for select using (auth.uid() = user_id);

drop policy if exists "resume_scores_insert_own" on public.resume_scores;
create policy "resume_scores_insert_own" on public.resume_scores
  for insert with check (auth.uid() = user_id);

drop policy if exists "resume_scores_update_own" on public.resume_scores;
create policy "resume_scores_update_own" on public.resume_scores
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "resume_scores_delete_own" on public.resume_scores;
create policy "resume_scores_delete_own" on public.resume_scores
  for delete using (auth.uid() = user_id);


-- ── PART C — Persist the JD with each assembled resume_builder version ───────
-- The Builder scores the live content against THIS version's target JD, so the
-- JD must travel with the version. (RLS on resume_builder is unchanged.)
alter table public.resume_builder
  add column if not exists job_description text,
  add column if not exists jd_hash         text;
