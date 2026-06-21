-- ════════════════════════════════════════════════════════════════════════════
-- Stage 3b — Custom footer for the cover-letter PDF
-- Apply in the Supabase SQL editor (or via the CLI) for the project.
-- ════════════════════════════════════════════════════════════════════════════

-- A user-editable footer line rendered at the bottom of the cover-letter PDF
-- (e.g. an availability note or a portfolio URL). Persisted alongside the letter
-- and saved on edit via PATCH /cover-letter/:id.
alter table public.cover_letters
  add column if not exists footer text;
