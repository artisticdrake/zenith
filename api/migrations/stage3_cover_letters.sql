-- ════════════════════════════════════════════════════════════════════════════
-- Stage 3 — Per-application cover letters
-- Apply in the Supabase SQL editor (or via the CLI) for the project.
-- ════════════════════════════════════════════════════════════════════════════

-- A cover letter is content-addressed on (the target JD, the Master Profile) the
-- same way a tailored resume is (tailor_results): the same JD + unchanged profile
-- maps to one row, so a regenerate is free. The letter is also linked to an
-- application_id when one is known, so the Cover Letter tab can load it on open.
-- After a user edits the letter (PATCH), `edited` flips true so a later regenerate
-- knows the stored text is a manual edit, not a cache hit.
create table if not exists public.cover_letters (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  application_id uuid references public.applications (id) on delete set null,
  jd_hash        text not null,
  profile_hash   text not null,
  cover_letter   text,
  company        text,
  role           text,
  edited         boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, jd_hash, profile_hash)
);

create index if not exists cover_letters_user_idx on public.cover_letters (user_id);
create index if not exists cover_letters_app_idx on public.cover_letters (application_id);

alter table public.cover_letters enable row level security;

-- A user may only ever see / write their own cover-letter rows.
drop policy if exists "cover_letters_select_own" on public.cover_letters;
create policy "cover_letters_select_own" on public.cover_letters
  for select using (auth.uid() = user_id);

drop policy if exists "cover_letters_insert_own" on public.cover_letters;
create policy "cover_letters_insert_own" on public.cover_letters
  for insert with check (auth.uid() = user_id);

drop policy if exists "cover_letters_update_own" on public.cover_letters;
create policy "cover_letters_update_own" on public.cover_letters
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "cover_letters_delete_own" on public.cover_letters;
create policy "cover_letters_delete_own" on public.cover_letters
  for delete using (auth.uid() = user_id);
