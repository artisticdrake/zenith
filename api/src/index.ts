import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { supabase, getAuthClient } from './lib/supabase';
import { requireAuth } from './middleware/auth';
import OpenAI from 'openai';
import { resumeContentToHtml, resumeContentToText } from './export/resumeToHtml';
import { generatePdf } from './export/pdfExport';
import { coverLetterToHtml } from './export/coverLetterToHtml';
import { normalizeResumeContent, normalizeResumeSettings, normalizeReview } from './lib/normalizeResume';
import { buildScorerPrompt, buildTailorPrompt, buildAssemblerPrompt, buildCoverLetterPrompt } from './lib/prompts';
import { sanitizeResumeContent, sanitizeBulletSuggestions, sanitizeResumeText } from './lib/sanitizeResumeText';
import { runBuiltinScrape, normalizeBuiltinJob } from './lib/apifyBuiltin';

dotenv.config({ path: require('path').resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;
// Railway (and most PaaS) put the app behind a reverse proxy. Trust the first hop
// so req.ip reflects the real client (X-Forwarded-For) — required for the /internal
// rate limiter below to key on the actual caller rather than the proxy.
app.set('trust proxy', 1);

// helper — lazy OpenAI client that always reads the key fresh
function getOpenAI() {
  return new OpenAI({ apiKey: (process.env.OPENAI_API_KEY2 || '').trim() });
}

// ── Hashing helpers (tailor-result cache keys) ────────────────────────────────

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
const hashJD = (jd: string) => sha(jd.replace(/\s+/g, ' ').trim().toLowerCase());
const hashProfile = (lib: unknown) => sha(JSON.stringify(lib ?? {}));
// Content hash is over the RENDERED (ATS-visible) text — the same bytes /export/pdf
// exposes — so a score keyed on it always matches what a recruiter's parser reads.
const hashContent = (rc: unknown) => sha(resumeContentToText(rc as any));

// ── Claude helpers (shared cores) ─────────────────────────────────────────────
// The tailor / scorer / assembler / cover-letter routes and the new job-triage
// routes all talk to Claude the SAME way: claude-sonnet-4-6, temperature 0,
// defensive JSON parse (strip fences, then regex-extract the object). Factored
// here so every path is identical and there is one place to change it. The
// prompt copy itself still lives only in lib/prompts.ts.
async function callClaudeJSON(apiKey: string, system: string, user: string, maxTokens: number): Promise<any> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  const responseData = await response.json() as any;
  if (!response.ok) {
    throw new Error(responseData?.error?.message || 'Claude API error');
  }

  const rawText: string = responseData?.content?.[0]?.text ?? '';
  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim();
    return JSON.parse(cleaned);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude returned malformed JSON');
    return JSON.parse(match[0]);
  }
}

// Score the candidate's MASTER PROFILE (rendered to the same plain text Mira
// uses) against a JD, calling buildScorerPrompt exactly as /rerank/claude does
// (same model, max_tokens 3000, temperature 0, parse, normalizeReview). This is
// the "should this candidate apply" triage score, computed before any resume
// exists — shared by /internal/score-job and /jobs/:id/score so a board score
// matches what the standalone scorer would produce for the same JD.
async function runProfileScorer(lib: any, jdText: string, apiKey: string): Promise<any> {
  const resumeText = masterProfileToText(lib ?? {});
  const { system, user } = buildScorerPrompt(jdText, resumeText);
  const parsed = await callClaudeJSON(apiKey, system, user, 3000);
  // Use the RAW scorer review: normalizeReview whitelists only the tailor/builder
  // UI fields and drops atsScore / recruiterScore / bucketFit / laneWarning, which
  // the triage board needs. We only sanitize the paste-ready bullets.
  const review = (parsed && typeof parsed === 'object' && parsed.review && typeof parsed.review === 'object')
    ? parsed.review
    : parsed;
  if (review && Array.isArray((review as any).bulletSuggestions)) {
    (review as any).bulletSuggestions = sanitizeBulletSuggestions((review as any).bulletSuggestions);
  }
  return review;
}

// Tailor a one-page resume from the Master Profile + JD (buildTailorPrompt),
// coerced + sanitized to the Builder's exact shape. The raw generation core
// shared by /tailor/claude (via tailorWithCache) and /jobs/:id/generate.
async function runProfileTailor(lib: any, jdText: string, apiKey: string): Promise<{ resumeContent: any; review: any }> {
  const masterProfileJson = JSON.stringify(lib, null, 2);
  const { system, user } = buildTailorPrompt(masterProfileJson, jdText);
  const parsed = await callClaudeJSON(apiKey, system, user, 6000);
  if (!Array.isArray(parsed.resumeContent?.sections) || parsed.resumeContent.sections.length === 0) {
    throw new Error('Claude response missing resumeContent.sections');
  }
  const resumeContent = sanitizeResumeContent(normalizeResumeContent(parsed.resumeContent));
  const review = normalizeReview(parsed.review);
  if (review && Array.isArray((review as any).bulletSuggestions)) {
    (review as any).bulletSuggestions = sanitizeBulletSuggestions((review as any).bulletSuggestions);
  }
  return { resumeContent, review };
}

// Tailor + cache: same JD + unchanged profile returns the stored tailor_results
// row with no Claude call. Shared by /tailor/claude and /jobs/:id/generate so the
// generate flow reuses the exact tailor cache (not a separate path).
async function tailorWithCache(opts: {
  userId: string; lib: any; jobDescription: string; applicationId?: string | null; apiKey: string;
}): Promise<{ resumeContent: any; review: any; fromCache: boolean }> {
  const { userId, lib, jobDescription, applicationId, apiKey } = opts;
  const jdHash = hashJD(jobDescription);
  const profileHash = hashProfile(lib);

  try {
    const { data: cached } = await supabase
      .from('tailor_results')
      .select('resume_content, review')
      .eq('user_id', userId)
      .eq('jd_hash', jdHash)
      .eq('profile_hash', profileHash)
      .maybeSingle();
    if (cached?.resume_content) {
      console.log(`[tailorWithCache] cache hit userId=${userId} jdHash=${jdHash}`);
      return {
        resumeContent: normalizeResumeContent(cached.resume_content),
        review: normalizeReview(cached.review),
        fromCache: true,
      };
    }
  } catch (err: any) {
    console.warn('[tailorWithCache] cache lookup failed (continuing without cache):', err.message);
  }

  const { resumeContent, review } = await runProfileTailor(lib, jobDescription, apiKey);

  const { error: saveErr } = await supabase
    .from('tailor_results')
    .upsert({
      user_id: userId,
      application_id: applicationId ?? null,
      jd_hash: jdHash,
      profile_hash: profileHash,
      resume_content: resumeContent,
      review,
      score: typeof review?.matchScore === 'number' ? review.matchScore : null,
      created_at: new Date().toISOString(),
    }, { onConflict: 'user_id,jd_hash,profile_hash' });
  if (saveErr) console.warn('[tailorWithCache] failed to cache result:', saveErr.message);

  return { resumeContent, review, fromCache: false };
}

// Persist an assembled/tailored resumeContent as a NEW resume_builder version
// (never overwrites) and prime resume_scores so the Builder's first re-rank is a
// cache hit. Extracted from /assemble/claude so /jobs/:id/generate writes the
// version the exact same way. Returns the created version row.
async function createBuilderVersion(authClient: any, userId: string, opts: {
  resumeContent: any; jobDescription: string; company?: string; role?: string;
  score: number | null; changeLog?: string[]; settings?: any;
}): Promise<any> {
  const { resumeContent, jobDescription, company, role, score, changeLog = [], settings = {} } = opts;
  const jdHash = hashJD(jobDescription);

  const label = (typeof company === 'string' && company.trim())
    || (typeof role === 'string' && role.trim())
    || 'Resume';
  const versionName = `Tailored — ${label} ${new Date().toISOString()}`;

  const { data: version, error: insertErr } = await authClient
    .from('resume_builder')
    .insert({
      user_id: userId,
      version_name: versionName,
      content: resumeContent,
      settings: settings ?? {},
      job_description: jobDescription,
      jd_hash: jdHash,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertErr) throw new Error(insertErr.message);

  // Prime the score store so the freshly written resume is already scored —
  // the Builder's first (auto) re-rank on this content is a cache hit, no spend.
  try {
    const contentHash = hashContent(resumeContent);
    await authClient.from('resume_scores').upsert({
      user_id: userId,
      jd_hash: jdHash,
      content_hash: contentHash,
      score,
      review: { matchScore: score, source: 'assemble', changeLog },
    }, { onConflict: 'user_id,jd_hash,content_hash' });
  } catch (err: any) {
    console.warn('[createBuilderVersion] failed to prime score (continuing):', err.message);
  }

  return version;
}

// Generate (or return cached) a job-specific cover letter and persist it to
// cover_letters, content-addressed on (user_id, jd_hash, profile_hash). Extracted
// from /cover-letter/claude so /jobs/:id/generate reuses the same logic. An
// UNEDITED stored letter for the same JD + profile is returned with no Claude call.
async function generateAndStoreCoverLetter(opts: {
  userId: string; lib: any; jobDescription: string; applicationId?: string | null;
  company?: string; role?: string; apiKey: string;
}): Promise<{ id: string | null; coverLetter: string; footer: string | null; fromCache: boolean }> {
  const { userId, lib, jobDescription, applicationId, company, role, apiKey } = opts;
  const jdHash = hashJD(jobDescription);
  const profileHash = hashProfile(lib);

  try {
    const { data: cached } = await supabase
      .from('cover_letters')
      .select('id, cover_letter, footer, edited')
      .eq('user_id', userId)
      .eq('jd_hash', jdHash)
      .eq('profile_hash', profileHash)
      .maybeSingle();
    if (cached?.cover_letter && !cached.edited) {
      console.log(`[generateAndStoreCoverLetter] cache hit userId=${userId} jdHash=${jdHash}`);
      return { id: cached.id, coverLetter: cached.cover_letter, footer: cached.footer ?? null, fromCache: true };
    }
  } catch (err: any) {
    console.warn('[generateAndStoreCoverLetter] cache lookup failed (continuing without cache):', err.message);
  }

  const masterProfileJson = JSON.stringify(lib, null, 2);
  const { system, user } = buildCoverLetterPrompt(
    masterProfileJson, jobDescription,
    typeof company === 'string' ? company : undefined,
    typeof role === 'string' ? role : undefined,
  );
  const parsed = await callClaudeJSON(apiKey, system, user, 1500);
  if (typeof parsed.coverLetter !== 'string' || !parsed.coverLetter.trim()) {
    throw new Error('Claude response missing coverLetter');
  }

  const coverLetter = sanitizeResumeText(parsed.coverLetter.trim());

  const { data: saved, error: saveErr } = await supabase
    .from('cover_letters')
    .upsert({
      user_id: userId,
      application_id: applicationId ?? null,
      jd_hash: jdHash,
      profile_hash: profileHash,
      cover_letter: coverLetter,
      company: typeof company === 'string' ? company : null,
      role: typeof role === 'string' ? role : null,
      edited: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,jd_hash,profile_hash' })
    .select('id, footer')
    .single();
  if (saveErr) console.warn('[generateAndStoreCoverLetter] failed to persist:', saveErr.message);

  return { id: saved?.id ?? null, coverLetter, footer: saved?.footer ?? null, fromCache: false };
}

// CORS — browser calls come from the web app's origin. CORS_ALLOWED_ORIGINS is a
// comma-separated allowlist (e.g. "https://app.example.com,http://localhost:5173").
// If it's unset, all origins are allowed (dev-friendly default — set the env var in
// production to lock the browser surface down). Server-to-server callers (n8n Cloud
// hitting /internal/*, curl) send no Origin header and are ALWAYS allowed: CORS is a
// browser-enforced policy and never applies to those requests.
const corsAllowlist = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // non-browser (server-to-server) → allow
      if (corsAllowlist.length === 0) return cb(null, true); // no allowlist → allow all
      return cb(null, corsAllowlist.includes(origin));
    },
  }),
);
app.use(express.json({ limit: '20mb' }));

// Rate-limit the public /internal/* machine path so a leaked x-internal-key can't
// run up unbounded scorer (Anthropic) calls. Fixed 1-minute window, per client IP;
// INTERNAL_RATE_LIMIT_PER_MIN (default 60) sets the cap. Auth is unchanged — this
// runs before the handler's x-internal-key check and only throttles request volume.
const internalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.INTERNAL_RATE_LIMIT_PER_MIN) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Rate limit exceeded; slow down.' },
});
app.use('/internal', internalLimiter);

// GET: Fetch all applications for the logged-in user
app.get('/applications', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const authClient = getAuthClient(req.headers.authorization as string);

  const { data, error } = await authClient
    .from('applications')
    .select('*')
    .eq('user_id', userId)
    .order('last_updated', { ascending: false });

  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

// POST: Create a new application
app.post('/applications', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const payload = req.body;
  const authClient = getAuthClient(req.headers.authorization as string);

  const { data, error } = await authClient
    .from('applications')
    .insert([{ ...payload, user_id: userId }])
    .select()
    .single();

  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

// PUT: Update an existing application
app.put('/applications/:id', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  const payload = req.body;
  const authClient = getAuthClient(req.headers.authorization as string);

  const { data, error } = await authClient
    .from('applications')
    .update({ ...payload, last_updated: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    console.error('Application Update Error:', error.message);
    return res.status(400).json({ success: false, error: error.message });
  }

  console.log('Application updated:', id);
  res.json({ success: true, data });
});

// DELETE: Remove a single application
app.delete('/applications/:id', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  const authClient = getAuthClient(req.headers.authorization as string);

  const { error } = await authClient
    .from('applications')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true });
});

// POST: Auto-ghost stale applications
// Marks any application (not already Ghosted/Rejected/Offer/Withdrawn) that hasn't
// been updated in 90+ days as "Ghosted". Uses the service-role client so it can
// bulk-update all rows for the user in one query.
app.post('/applications/auto-ghost', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - NINETY_DAYS_MS).toISOString();

  // Terminal statuses that should never be auto-ghosted
  const TERMINAL = ['Ghosted', 'Rejected', 'Offer', 'Withdrawn'];

  // Find stale applications using the service-role client (bypasses RLS for the query,
  // but we filter by user_id so data is still scoped correctly).
  const { data: stale, error: fetchErr } = await supabase
    .from('applications')
    .select('id, timeline')
    .eq('user_id', userId)
    .not('status', 'in', `(${TERMINAL.join(',')})`)
    .lt('last_updated', cutoff);

  if (fetchErr) return res.status(400).json({ success: false, error: fetchErr.message });
  if (!stale || stale.length === 0) return res.json({ success: true, ghosted: 0 });

  const now = new Date().toISOString();
  const nowTs = Date.now();

  // Update each stale application: append a Ghosted timeline entry
  const updates = stale.map((app: any) => {
    const prevTimeline = Array.isArray(app.timeline) ? app.timeline : [];
    return supabase
      .from('applications')
      .update({
        status: 'Ghosted',
        last_updated: now,
        timeline: [...prevTimeline, { status: 'Ghosted', ts: nowTs, auto: true }],
      })
      .eq('id', app.id)
      .eq('user_id', userId);
  });

  await Promise.all(updates);

  console.log(`Auto-ghosted ${stale.length} applications for user ${userId}`);
  res.json({ success: true, ghosted: stale.length });
});

// GET: Fetch user profile
app.get('/profile', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const authClient = getAuthClient(req.headers.authorization as string);

  const { data, error } = await authClient
    .from('profiles')
    .select('id, theme_settings, display_name, avatar_id, created_at')
    .eq('id', userId)
    .single();

  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

// PUT: Update user profile
app.put('/profile', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const { theme_settings, display_name, avatar_id } = req.body;
  const authClient = getAuthClient(req.headers.authorization as string);

  const payload: Record<string, any> = { id: userId };
  if (theme_settings !== undefined) payload.theme_settings = theme_settings;
  if (display_name !== undefined) payload.display_name = display_name;
  if (avatar_id !== undefined) payload.avatar_id = avatar_id;

  const { data, error } = await authClient
    .from('profiles')
    .upsert(payload)
    .select()
    .single();

  if (error) {
    console.error('Profile Save Error:', error.message);
    return res.status(400).json({ success: false, error: error.message });
  }

  console.log('Profile saved successfully!');
  res.json({ success: true, data });
});

// DELETE: Full account wipe
app.delete('/profile', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;

  const { error: appsError } = await supabase
    .from('applications')
    .delete()
    .eq('user_id', userId);

  if (appsError) {
    console.error('Failed to delete applications:', appsError.message);
    return res.status(400).json({ success: false, error: appsError.message });
  }

  // Delete legacy resume files from storage (vault feature removed; old data may remain)
  const { data: resumeFiles } = await supabase
    .from('resumes')
    .select('storage_path')
    .eq('user_id', userId);

  if (resumeFiles && resumeFiles.length > 0) {
    const paths = resumeFiles.map((r: any) => r.storage_path);
    await supabase.storage.from('resumes').remove(paths);
  }

  // Best-effort cleanup of per-user tables (some may be empty or legacy)
  await supabase.from('resumes').delete().eq('user_id', userId);
  await supabase.from('tailor_results').delete().eq('user_id', userId);
  await supabase.from('master_profile').delete().eq('user_id', userId);
  await supabase.from('resume_builder').delete().eq('user_id', userId);

  const { error: profileError } = await supabase
    .from('profiles')
    .delete()
    .eq('id', userId);

  if (profileError) {
    console.error('Failed to delete profile:', profileError.message);
    return res.status(400).json({ success: false, error: profileError.message });
  }

  const { error: authError } = await supabase.auth.admin.deleteUser(userId);

  if (authError) {
    console.error('Failed to delete auth user:', authError.message);
    return res.status(400).json({ success: false, error: authError.message });
  }

  console.log('Account fully deleted for user', userId);
  res.json({ success: true });
});

// ─── Autofill ────────────────────────────────────────────────────────────────
// POST /autofill
// Body: { url: string, pageText?: string }
//   pageText: pre-extracted page text from the browser (used by extension to bypass
//             server-side fetch limitations on auth-gated sites like LinkedIn)
// Returns: { company, position, location, salary, jobDescription, source }
// Used by: Add Application form + Chrome extension
app.post('/autofill', requireAuth, async (req, res) => {
  const { url, pageText: rawPageText } = req.body;

  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ success: false, error: 'A valid URL is required.' });
  }

  let pageText = '';

  if (rawPageText && typeof rawPageText === 'string' && rawPageText.trim().length > 100) {
    // Extension sent pre-extracted browser text — use it directly (already JS-rendered, authenticated)
    pageText = rawPageText.replace(/\s{3,}/g, '\n').trim().slice(0, 15000);
  } else {
    // 1. Fetch the page server-side (fallback for web app manual autofill)
    let rawHtml = '';
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      rawHtml = await response.text();
    } catch (err: any) {
      return res.status(422).json({ success: false, error: `Could not fetch the URL: ${err.message}` });
    }

    // 2. Strip HTML to readable text
    pageText = rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s{3,}/g, '\n\n')
      .trim()
      .slice(0, 12000);
  }

  // 3. GPT-4o extraction
  const prompt = `You are a job posting parser. Extract structured data from the page text below.

Return ONLY valid JSON with exactly these fields (use null if not found):
{
  "company": "Company name (the hiring company, not the job board)",
  "position": "Job title / position",
  "location": "City, State or Remote",
  "salary": "Salary or pay range if mentioned, else null",
  "jobDescription": "Find the section titled 'Job Description', 'About the Job', 'About this role', 'Responsibilities', or similar — then copy its FULL text exactly as it appears. Do NOT summarize, shorten, or paraphrase. Include all sections: requirements, responsibilities, nice-to-haves, benefits, day-to-day, etc. Preserve all bullet points and formatting as plain text."
}

PAGE TEXT:
${pageText}`;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 3000,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = completion.choices[0].message.content?.trim() || '';
    const clean = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(clean);

    return res.json({ success: true, data: parsed });
  } catch (err: any) {
    console.error('AUTOFILL ERROR FULL:', JSON.stringify(err?.response?.data || err?.error || err?.message || err, null, 2));
    return res.status(500).json({ success: false, error: `Extraction failed: ${err?.response?.data?.error?.message || err?.error?.message || err.message}` });
  }
});

// ── Master Profile → plain text (used for Mira's context) ─────────────────────

function masterProfileToText(lib: any): string {
  const lines: string[] = [];
  const h = lib.header ?? {};
  if (h.name) lines.push(h.name);
  if (h.title) lines.push(h.title);

  if (lib.summaries?.length) {
    lines.push('\nSUMMARY');
    lines.push((lib.summaries[0].text || '').trim());
  }

  if (lib.experiences?.length) {
    lines.push('\nEXPERIENCE');
    for (const exp of lib.experiences) {
      const parts = [exp.org, exp.role, exp.location, [exp.startDate, exp.current ? 'Present' : exp.endDate].filter(Boolean).join(' – ')].filter(Boolean);
      lines.push(parts.join(' | '));
      for (const b of exp.bullets ?? []) {
        if (b.text?.trim()) lines.push('- ' + b.text.trim());
      }
    }
  }

  if (lib.projects?.length) {
    lines.push('\nPROJECTS');
    for (const proj of lib.projects) {
      const parts = [proj.name, (proj.techStack ?? []).join(', ')].filter(Boolean);
      lines.push(parts.join(' | '));
      for (const b of proj.bullets ?? []) {
        if (b.text?.trim()) lines.push('- ' + b.text.trim());
      }
    }
  }

  if (lib.education?.length) {
    lines.push('\nEDUCATION');
    for (const edu of lib.education) {
      const parts = [edu.institution, [edu.degree, edu.field].filter(Boolean).join(', '), [edu.startDate, edu.endDate].filter(Boolean).join(' – ')].filter(Boolean);
      lines.push(parts.join(' | '));
    }
  }

  if (lib.skills?.length) {
    lines.push('\nSKILLS');
    const byCategory: Record<string, string[]> = {};
    for (const s of lib.skills) {
      const cat = s.category || 'Other';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(s.display || s.canonical || '');
    }
    for (const [cat, items] of Object.entries(byCategory)) {
      lines.push(`${cat}: ${items.join(', ')}`);
    }
  }

  return lines.join('\n');
}

// ─── Mira AI Summary ─────────────────────────────────────────────────────────
// POST /summary
// Body: { apps: Application[] }
// Returns: { summary: string, hasProfile: boolean }
app.post('/summary', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const { apps } = req.body;

  if (!Array.isArray(apps) || apps.length === 0) {
    return res.status(400).json({ success: false, error: 'No applications provided.' });
  }

  // Fetch Master Profile server-side — the single source of truth for candidate background
  const { data: profileRow } = await supabase
    .from('master_profile')
    .select('content')
    .eq('user_id', userId)
    .maybeSingle();

  const lib = profileRow?.content;
  const hasProfile = !!(lib?.experiences?.length || lib?.skills?.length);

  // Build stats
  const total = apps.length;
  const now = new Date();
  const weekAgo = new Date(); weekAgo.setDate(now.getDate() - 7);
  const thisWeek = apps.filter((a: any) => new Date(a.dateApplied) >= weekAgo).length;

  const statusCounts: Record<string, number> = {
    Applied: 0, Screening: 0, 'Interview Scheduled': 0,
    'Interview Completed': 0, Offer: 0, Rejected: 0, Withdrawn: 0,
  };
  apps.forEach((a: any) => {
    if (statusCounts[a.status] !== undefined) statusCounts[a.status]++;
  });
  const interviews = (statusCounts['Interview Scheduled'] || 0) + (statusCounts['Interview Completed'] || 0);

  // Build per-application context with JD snippets
  const appDetails = apps
    .slice(0, 20)
    .map((a: any) => {
      const jd = a.jobDescription ? `\n   JD Snippet: ${a.jobDescription.slice(0, 400)}` : '';
      return `- ${a.company} | ${a.position} | ${a.status} | Applied: ${a.dateApplied}${jd}`;
    })
    .join('\n');

  const profileSection = hasProfile
    ? `\nMASTER PROFILE (the user's full background):\n${masterProfileToText(lib).slice(0, 3000)}`
    : '\nMASTER PROFILE: Empty — the user has not built their Master Profile yet. Call that out as something to address.';

  const prompt = `You are Mira, an empathetic but grounded AI career assistant. Analyze this person's job search honestly.

Guidelines:
- Be warm and supportive in tone, but never sugarcoat the reality
- Acknowledge genuine progress and effort where it exists
- Be direct about what isn't working without being harsh
- If weekly application rate is below 15, flag it clearly but constructively
- Speak directly to the user in second person
- Offer one or two concrete, actionable observations — not generic advice
- If a Master Profile is provided, identify specific skill gaps or positioning mismatches relative to the roles they are applying to
- If the Master Profile is empty, point that out as something to address
- Plain sentences only, no bullet points or formatting
- 6-10 lines total

APPLICATIONS (${total} total, ${thisWeek} this week):
${appDetails}

STATS:
Screening: ${statusCounts['Screening']} | Interviews: ${interviews} | Offers: ${statusCounts['Offer']} | Rejected: ${statusCounts['Rejected']}
${profileSection}`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 500,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are Mira, a warm and empathetic AI career assistant who gives honest, grounded feedback. You are encouraging but never dishonest. You speak plainly, avoid bullet points, and never use em dashes.' },
        { role: 'user', content: prompt },
      ],
    });

    const summary = response.choices[0].message.content?.trim() || '';
    return res.json({ success: true, summary, hasProfile });
  } catch (err: any) {
    console.error('Mira summary error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Master Profile ─────────────────────────────────────────────────────────────

app.get('/master-profile', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const authClient = getAuthClient(req.headers.authorization as string);

  const { data, error } = await authClient
    .from('master_profile')
    .select('content')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: error.message });

  if (!data) {
    // Upsert an empty profile row for first-time users
    const { error: upErr } = await authClient
      .from('master_profile')
      .upsert({ user_id: userId, content: {} }, { onConflict: 'user_id' });
    if (upErr) return res.status(500).json({ success: false, error: upErr.message });
    return res.json({ success: true, data: {} });
  }

  return res.json({ success: true, data: data.content });
});

app.put('/master-profile', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const authClient = getAuthClient(req.headers.authorization as string);
  const content = req.body;

  const { error } = await authClient
    .from('master_profile')
    .upsert({ user_id: userId, content, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, data: content });
});

// ── Parse raw resume text into MasterProfile JSON (seed feature) ──────────────

app.post('/master-profile/seed-from-text', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string' || text.trim().length < 50) {
    return res.status(400).json({ success: false, error: 'Resume text is required (min 50 characters)' });
  }

  const systemPrompt = `You are a precise resume parser. Extract structured data from resume text and return ONLY valid JSON — no markdown, no code fences, no explanation.`;

  const userPrompt = `Parse the resume text below into a MasterProfile JSON object.

Rules:
- header: extract name, title (professional headline), phone, email, linkedin (path only e.g. "linkedin.com/in/user"), github (path only), portfolio
- experiences: array of work experiences with id ("exp-N"), org, role, location (optional), startDate, endDate (null if current), current (boolean), defaultInclude: true, tags: [], bullets: array of { id: "b-N", text, skills: [], strength: 2, tags: [] }, AND experienceType: classify each role as exactly one of "professional-engineering" | "internship" | "research" | "non-engineering-ops" | "other" — infer from title/org/dates. A full-time post-degree software/ML role is "professional-engineering"; anything labeled intern/co-op is "internship"; lab/research-assistant roles are "research"; mailroom/retail/admin/support are "non-engineering-ops". This drives seniority bucketing downstream, so be accurate and do NOT upgrade an intern or ops role.
- projects: array with id ("proj-N"), name, startDate, endDate, techStack (array of strings), tags: [], bullets: array of { id: "b-N", text, skills: [], strength: 2, tags: [] }
- education: array with id ("edu-N"), institution, degree, field (optional), startDate, endDate, gpa (optional), defaultInclude: true, bullets: []
- skills: flat array with display (display name e.g. "PyTorch"), canonical (lowercase no spaces e.g. "pytorch"), category (group e.g. "ML/DL"), proven: true
- summaries: if a summary/objective section exists, create one entry with id "sum-1", text, tags: []; else empty array
- awards: array with id ("award-N"), title, issuer, date, tags: [], AND these validation fields when present in the text (else null): placement (e.g. "2nd of 6 teams", "3rd place", "1st"), amount (e.g. "$4,000"), cohortSize (e.g. "364 participants", "6 teams"), percentile (e.g. "top 0.6%"), validatedBy (named judges/orgs/users, e.g. "judged by researchers from Google DeepMind, Suno, Ableton"). Capture these verbatim from the text; never invent them.
- workAuth: a single string capturing any work-authorization / visa info stated in the resume (e.g. "F-1 STEM OPT, ~3 yrs, no sponsorship required"); null if none stated. Do NOT infer or fabricate authorization.

Return ONLY the JSON object — no markdown wrapping.

JSON shape (follow exactly):
{
  "header": { "name": "", "title": "", "phone": "", "email": "", "linkedin": "", "github": "", "portfolio": "" },
  "summaries": [],
  "experiences": [],
  "projects": [],
  "education": [],
  "skills": [],
  "awards": [],
  "workAuth": null
}

Resume text:
${text.slice(0, 12000)}`;

  try {
    const ai = getOpenAI();
    const completion = await ai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);
    return res.json({ success: true, data: parsed });
  } catch (err: any) {
    console.error('[seed-from-text] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Extract text from uploaded file (for seed-from-resume in MasterInfoTab) ───

app.post('/parse-text', requireAuth, async (req, res) => {
  const { fileName, fileType, fileData } = req.body;
  if (!fileName || !fileType || !fileData) {
    return res.status(400).json({ success: false, error: 'fileName, fileType, and fileData are required' });
  }

  const ext = (fileName as string).split('.').pop()?.toLowerCase();
  const fileBuffer = Buffer.from(fileData as string, 'base64');

  try {
    let rawText = '';
    if (ext === 'pdf') {
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: fileBuffer, verbosity: 0 });
      const result = await parser.getText();
      rawText = result.text;
    } else if (ext === 'docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      rawText = result.value;
    } else if (ext === 'doc') {
      rawText = fileBuffer.toString('utf-8').replace(/[^\x20-\x7E\n]/g, ' ');
    } else if (ext === 'txt') {
      rawText = fileBuffer.toString('utf-8');
    } else {
      return res.status(400).json({ success: false, error: `Unsupported file type: .${ext}` });
    }

    const normalizedText = rawText.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
    if (normalizedText.length < 50) {
      return res.status(422).json({ success: false, error: 'Could not extract enough text from the file.' });
    }

    return res.json({ success: true, text: normalizedText });
  } catch (err: any) {
    console.error('[parse-text] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Tailor (Claude is the sole resume-tailoring brain) ─────────────────────────

// POST /tailor/claude
// Body: { jobDescription: string, applicationId?: string }
// Results are cached in tailor_results keyed on (user_id, jd_hash, profile_hash):
// the same JD + unchanged Master Profile returns the stored result without
// calling Claude again. Editing the JD or the profile busts the cache naturally.
app.post('/tailor/claude', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const authClient = getAuthClient(req.headers.authorization as string);
  const { jobDescription, applicationId } = req.body;

  if (!jobDescription || typeof jobDescription !== 'string') {
    return res.status(400).json({ success: false, error: 'jobDescription is required' });
  }

  // Load master profile — the ONLY allowed content source
  const { data: profileRow, error: profileErr } = await authClient
    .from('master_profile')
    .select('content')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileErr) return res.status(500).json({ success: false, error: profileErr.message });

  const lib = profileRow?.content;
  if (!lib?.experiences?.length && !lib?.projects?.length) {
    return res.status(400).json({ success: false, error: 'Master profile is empty. Go to the Master Information tab and build your profile first.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY is not configured on the server.' });
  }

  try {
    const { resumeContent, review, fromCache } = await tailorWithCache({
      userId, lib, jobDescription, applicationId, apiKey,
    });
    console.log(`[/tailor/claude] userId=${userId} fromCache=${fromCache} sections=${resumeContent.sections.length} fit=${(review as any)?.fitAssessment?.level ?? 'none'} score=${review?.matchScore ?? 'n/a'}`);
    return res.json({ success: true, resumeContent, review, fromCache });
  } catch (err: any) {
    console.error('[/tailor/claude] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Re-rank an edited resume against a JD ──────────────────────────────────────
// POST /rerank/claude
// Body: { jobDescription: string, resumeContent: ResumeContent }
// Scores the resume EXACTLY AS WRITTEN (after Builder edits) against the JD.
// Unlike /tailor/claude this does NOT regenerate from the Master Profile — it
// grades the content the user is actually looking at. Returns { review }.
app.post('/rerank/claude', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const authClient = getAuthClient(req.headers.authorization as string);
  const { jobDescription, resumeContent: rawContent } = req.body;

  if (!jobDescription || typeof jobDescription !== 'string') {
    return res.status(400).json({ success: false, error: 'jobDescription is required' });
  }
  if (!rawContent || typeof rawContent !== 'object') {
    return res.status(400).json({ success: false, error: 'resumeContent is required' });
  }

  // Coerce to the known shape, then key the score on the RENDERED text + JD.
  const resumeContent = normalizeResumeContent(rawContent);
  const jdHash = hashJD(jobDescription);
  const contentHash = hashContent(resumeContent);

  // Cache check — identical rendered text + JD returns the stored score with NO
  // Claude call (score stability; reverting an edit returns the same number free).
  try {
    const { data: cached } = await authClient
      .from('resume_scores')
      .select('score, review')
      .eq('user_id', userId)
      .eq('jd_hash', jdHash)
      .eq('content_hash', contentHash)
      .maybeSingle();
    if (cached) {
      return res.json({ success: true, review: cached.review, score: cached.score, contentHash, fromCache: true });
    }
  } catch (err: any) {
    console.warn('[/rerank/claude] score-cache lookup failed (continuing):', err.message);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY is not configured on the server.' });
  }

  const { system: systemPrompt, user: userMessage } = buildScorerPrompt(jobDescription, resumeContentToText(resumeContent));

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    const responseData = await response.json() as any;
    if (!response.ok) {
      const errMsg = responseData?.error?.message || 'Claude API error';
      console.error('[/rerank/claude] Anthropic error:', errMsg);
      return res.status(500).json({ success: false, error: errMsg });
    }

    const rawText: string = responseData?.content?.[0]?.text ?? '';

    let parsed: any;
    try {
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/m, '')
        .replace(/\s*```\s*$/m, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (!match) {
        console.error('[/rerank/claude] invalid JSON from Claude:', rawText.slice(0, 300));
        return res.status(500).json({ success: false, error: 'Claude returned malformed JSON' });
      }
      try { parsed = JSON.parse(match[0]); }
      catch { return res.status(500).json({ success: false, error: 'Could not parse Claude response as JSON' }); }
    }

    const review = normalizeReview(parsed.review ?? parsed);
    if (!review) {
      return res.status(500).json({ success: false, error: 'Claude response missing review' });
    }
    // Sanitize paste-ready bullets only; analytical prose is left untouched.
    if (Array.isArray((review as any).bulletSuggestions)) {
      (review as any).bulletSuggestions = sanitizeBulletSuggestions((review as any).bulletSuggestions);
    }

    const score = typeof review.matchScore === 'number' ? Math.round(review.matchScore) : null;

    // Persist into the content-addressed score store so the same rendered text +
    // JD never costs another Claude call.
    try {
      await authClient.from('resume_scores').upsert({
        user_id: userId,
        jd_hash: jdHash,
        content_hash: contentHash,
        score,
        review,
      }, { onConflict: 'user_id,jd_hash,content_hash' });
    } catch (err: any) {
      console.warn('[/rerank/claude] failed to cache score (continuing):', err.message);
    }

    console.log(`[/rerank/claude] userId=${userId} fit=${review.fitAssessment?.level ?? 'none'} score=${score ?? 'n/a'}`);
    return res.json({ success: true, review, score, contentHash, fromCache: false });
  } catch (err: any) {
    console.error('[/rerank/claude] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Assemble a new resume from master profile + current resume + approved bullets ─
// POST /assemble/claude
// Body: { jobDescription: string, approvedBullets: [{ id, text, section, target }], company?: string, role?: string }
// Treats every bullet across the Master Profile, the user's CURRENT resume, and the
// approved new bullets as candidate "blocks", and asks Claude to assemble the single
// best one-page resume. Writes the result as a NEW resume_builder version (never
// overwrites the previous one). Returns { version, resumeContent, score, changeLog }.
app.post('/assemble/claude', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const authClient = getAuthClient(req.headers.authorization as string);
  const { jobDescription, approvedBullets: rawBullets, company, role, currentResume: rawCurrentResume } = req.body;

  if (!jobDescription || typeof jobDescription !== 'string') {
    return res.status(400).json({ success: false, error: 'jobDescription is required' });
  }

  const approvedBullets = Array.isArray(rawBullets)
    ? rawBullets
        .filter((b: any) => b && typeof b.text === 'string' && b.text.trim())
        .map((b: any) => ({
          id: typeof b.id === 'string' ? b.id : undefined,
          text: String(b.text).trim(),
          section: typeof b.section === 'string' ? b.section : 'experience',
          target: typeof b.target === 'string' ? b.target : undefined,
        }))
    : [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY is not configured on the server.' });
  }

  // Source 1: Master Profile (the full content library)
  const { data: profileRow, error: profileErr } = await authClient
    .from('master_profile')
    .select('content')
    .eq('user_id', userId)
    .maybeSingle();
  if (profileErr) return res.status(500).json({ success: false, error: profileErr.message });

  const lib = profileRow?.content;
  if (!lib?.experiences?.length && !lib?.projects?.length && !approvedBullets.length) {
    return res.status(400).json({ success: false, error: 'Master profile is empty and no bullets were approved. Build your Master Profile or approve some bullets first.' });
  }

  // Source 2: the user's CURRENT resume. A Builder-initiated "Re-assemble" passes
  // the LIVE (possibly edited) content explicitly; otherwise fall back to the
  // latest saved builder version. We still read the latest version for its
  // settings (so the new version inherits formatting).
  const { data: latestVersion } = await authClient
    .from('resume_builder')
    .select('id, content, settings')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const currentResume = (rawCurrentResume && typeof rawCurrentResume === 'object')
    ? normalizeResumeContent(rawCurrentResume)
    : latestVersion?.content
      ? normalizeResumeContent(latestVersion.content)
      : null;

  const { system: systemPrompt, user: userMessage } = buildAssemblerPrompt(lib, currentResume, approvedBullets, jobDescription);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 6000,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    const responseData = await response.json() as any;
    if (!response.ok) {
      const errMsg = responseData?.error?.message || 'Claude API error';
      console.error('[/assemble/claude] Anthropic error:', errMsg);
      return res.status(500).json({ success: false, error: errMsg });
    }

    const rawText: string = responseData?.content?.[0]?.text ?? '';

    let parsed: any;
    try {
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/m, '')
        .replace(/\s*```\s*$/m, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (!match) {
        console.error('[/assemble/claude] invalid JSON from Claude:', rawText.slice(0, 300));
        return res.status(500).json({ success: false, error: 'Claude returned malformed JSON' });
      }
      try { parsed = JSON.parse(match[0]); }
      catch { return res.status(500).json({ success: false, error: 'Could not parse Claude response as JSON' }); }
    }

    if (!Array.isArray(parsed.resumeContent?.sections) || parsed.resumeContent.sections.length === 0) {
      return res.status(500).json({ success: false, error: 'Claude response missing resumeContent.sections' });
    }

    // Coerce to the Builder's exact shape before persisting, then sanitize the
    // resume-bound text (assembler output has no bulletSuggestions to sanitize).
    const resumeContent = sanitizeResumeContent(normalizeResumeContent(parsed.resumeContent));
    const score = typeof parsed.score === 'number' ? Math.round(parsed.score) : null;
    const changeLog = Array.isArray(parsed.changeLog)
      ? parsed.changeLog.filter((c: any) => typeof c === 'string').slice(0, 30)
      : [];

    // Write a NEW version — never overwrite the previous one. The JD travels with
    // it (so the Builder knows what to score against) and the score store is primed
    // so the Builder's first re-rank is a cache hit. Shared with /jobs/:id/generate.
    let version;
    try {
      version = await createBuilderVersion(authClient, userId, {
        resumeContent, jobDescription, company, role, score, changeLog,
        settings: latestVersion?.settings ?? {},
      });
    } catch (err: any) {
      console.error('[/assemble/claude] failed to create version:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }

    console.log(`[/assemble/claude] userId=${userId} approvedBullets=${approvedBullets.length} score=${score ?? 'n/a'} versionId=${version?.id}`);

    return res.json({ success: true, version, resumeContent, score, changeLog });
  } catch (err: any) {
    console.error('[/assemble/claude] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Cover letter (Claude writes a job-specific letter from profile + JD) ────────
// Persistence mirrors tailor_results: content-addressed on (user_id, jd_hash,
// profile_hash). A letter is also linked to an application_id when known so the
// Cover Letter tab can load it on open without calling Claude.

// POST /cover-letter/claude — generate (or regenerate) a cover letter.
// Body: { jobDescription: string, applicationId?: string, company?: string, role?: string }
// Cache: an UNEDITED stored letter for the same JD + profile is returned with no
// Claude call. A regenerate over an edited letter discards the edit and writes
// fresh (edited -> false), matching the "Generate/Regenerate is explicit" UX.
app.post('/cover-letter/claude', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const authClient = getAuthClient(req.headers.authorization as string);
  const { jobDescription, applicationId, company, role } = req.body;

  if (!jobDescription || typeof jobDescription !== 'string') {
    return res.status(400).json({ success: false, error: 'jobDescription is required' });
  }

  // Load master profile — the ONLY allowed content source (same as /tailor/claude)
  const { data: profileRow, error: profileErr } = await authClient
    .from('master_profile')
    .select('content')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileErr) return res.status(500).json({ success: false, error: profileErr.message });

  const lib = profileRow?.content;
  if (!lib?.experiences?.length && !lib?.projects?.length) {
    return res.status(400).json({ success: false, error: 'Master profile is empty. Go to the Master Information tab and build your profile first.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY is not configured on the server.' });
  }

  try {
    const { id, coverLetter, footer, fromCache } = await generateAndStoreCoverLetter({
      userId, lib, jobDescription, applicationId,
      company: typeof company === 'string' ? company : undefined,
      role: typeof role === 'string' ? role : undefined,
      apiKey,
    });
    console.log(`[/cover-letter/claude] userId=${userId} fromCache=${fromCache} len=${coverLetter.length} id=${id ?? 'n/a'}`);
    return res.json({ success: true, id, coverLetter, footer, fromCache });
  } catch (err: any) {
    console.error('[/cover-letter/claude] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /cover-letter?applicationId=<id> — load a saved letter for an application.
// Read-only, never calls Claude. Returns { coverLetter: null } when none exists.
app.get('/cover-letter', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const authClient = getAuthClient(req.headers.authorization as string);
  const applicationId = typeof req.query.applicationId === 'string' ? req.query.applicationId : '';

  if (!applicationId) {
    return res.status(400).json({ success: false, error: 'applicationId is required' });
  }

  const { data, error } = await authClient
    .from('cover_letters')
    .select('id, cover_letter, footer')
    .eq('user_id', userId)
    .eq('application_id', applicationId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, id: data?.id ?? null, coverLetter: data?.cover_letter ?? null, footer: data?.footer ?? null });
});

// PATCH /cover-letter/:id — durably save a user edit to a cover letter.
// Body: { coverLetter?: string, footer?: string } — updates whichever is provided.
// Editing the letter body flags the row edited so a later regenerate knows the
// stored text is a manual edit, not a cache hit. (A footer-only edit does not.)
app.patch('/cover-letter/:id', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const authClient = getAuthClient(req.headers.authorization as string);
  const { id } = req.params;
  const { coverLetter, footer } = req.body;

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof coverLetter === 'string') {
    update.cover_letter = sanitizeResumeText(coverLetter);
    update.edited = true;
  }
  if (typeof footer === 'string') {
    update.footer = sanitizeResumeText(footer);
  }

  if (update.cover_letter === undefined && update.footer === undefined) {
    return res.status(400).json({ success: false, error: 'coverLetter or footer is required' });
  }

  const { data, error } = await authClient
    .from('cover_letters')
    .update(update)
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data) return res.status(404).json({ success: false, error: 'Cover letter not found' });
  return res.json({ success: true, id: data.id });
});

// POST /cover-letter/pdf — render the current (edited) letter + footer to a
// business-letter PDF. Letterhead identity comes from the Master Profile header
// (server-side), so it matches the resume. Reuses the resume PDF pipeline
// (coverLetterToHtml -> generatePdf, text-native + regression-guarded).
// Body: { coverLetter: string, footer?: string, company?: string, role?: string, applicationId?: string }
app.post('/cover-letter/pdf', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const authClient = getAuthClient(req.headers.authorization as string);
  const { coverLetter, footer, company, role, applicationId } = req.body;

  if (!coverLetter || typeof coverLetter !== 'string' || !coverLetter.trim()) {
    return res.status(400).json({ success: false, error: 'coverLetter is required' });
  }

  // Letterhead identity — pulled from the Master Profile header server-side.
  const { data: profileRow, error: profileErr } = await authClient
    .from('master_profile')
    .select('content')
    .eq('user_id', userId)
    .maybeSingle();
  if (profileErr) return res.status(500).json({ success: false, error: profileErr.message });

  const h = (profileRow?.content?.header ?? {}) as Record<string, string>;
  const header = {
    name: h.name ?? '',
    phone: h.phone ?? '',
    email: h.email ?? '',
    linkedin: h.linkedin ?? '',
    portfolio: h.portfolio ?? '',
  };

  // Company / role: an applicationId is authoritative; otherwise use the body.
  let resolvedCompany = typeof company === 'string' ? company : '';
  let resolvedRole = typeof role === 'string' ? role : '';
  if (typeof applicationId === 'string' && applicationId) {
    const { data: app } = await authClient
      .from('applications')
      .select('company, position')
      .eq('user_id', userId)
      .eq('id', applicationId)
      .maybeSingle();
    if (app?.company) resolvedCompany = app.company;
    if (app?.position) resolvedRole = app.position;
  }

  try {
    const html = coverLetterToHtml({
      header,
      body: coverLetter,
      footer: typeof footer === 'string' ? footer : undefined,
      company: resolvedCompany,
      role: resolvedRole,
    });

    // The PDF regression guard (assertTextLayer) wants the candidate name + >=5
    // real keywords in the extracted text. Feed it a synthetic resume-shaped
    // object whose keywords are genuine words from the letter, so the guard
    // legitimately validates the letter has an ATS-readable text layer.
    const keywords = Array.from(new Set(
      coverLetter.toLowerCase().match(/[a-z]{4,14}/g) ?? [],
    )).slice(0, 15).join(', ');

    const guardContent = {
      header: { name: header.name, title: '', phone: '', email: '', linkedin: '', github: '', portfolio: '' },
      summary: '',
      showSummary: false,
      sections: [
        { id: 'cl', type: 'skills', title: 'Letter', visible: true, items: [{ id: 'kw', category: 'Letter', items: keywords }] },
      ],
    };

    const pdfBuffer = await generatePdf(html, guardContent);

    const slug = (resolvedCompany || resolvedRole || 'cover-letter').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slug}-cover-letter.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    return res.end(pdfBuffer);
  } catch (err: any) {
    console.error('[/cover-letter/pdf] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Scores live only in the tailor/builder flow now (resume_scores, content-addressed).
// The old Applications-tab badge endpoint (GET /scores/claude) has been removed;
// tailor_results remains purely as the generation cache.

// ── PDF Export (Puppeteer — text-native, ATS-safe) ─────────────────────────────

app.post('/export/pdf', requireAuth, async (req, res) => {
  const { content: rawContent, settings: rawSettings } = req.body;

  if (!rawContent || !rawSettings) {
    return res.status(400).json({ success: false, error: 'content and settings are required' });
  }

  try {
    // Coerce to a guaranteed-valid shape — resumeContentToHtml and the
    // regression guard dereference nested fields unconditionally
    const content = normalizeResumeContent(rawContent);
    const settings = normalizeResumeSettings(rawSettings);
    const html = resumeContentToHtml(content, settings);
    const pdfBuffer = await generatePdf(html, content);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="resume.pdf"',
      'Content-Length': pdfBuffer.length,
    });
    return res.end(pdfBuffer);
  } catch (err: any) {
    console.error('[/export/pdf] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Job-triage board (Stage 4) — paste a JD, get a cheap automatic fit score,
// generate a tailored resume (+ optional cover letter) per job on click.
// scraped_jobs is content-addressed on (user_id, jd_hash) via hashJD.
// ════════════════════════════════════════════════════════════════════════════

// Coerce a score field to a rounded int or null (the scorer always returns ints,
// but normalizeReview may leave a field absent).
const numOrNull = (n: any) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null);
// The scorer emits laneWarning as "null", "", or a sentence — store only real warnings.
const laneWarningOrNull = (s: any) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t && t.toLowerCase() !== 'null' ? t : null;
};

// Write the scorer's review onto a scraped_jobs row (status -> 'scored').
function scoredJobFields(review: any) {
  return {
    match_score: numOrNull(review?.matchScore),
    ats_score: numOrNull(review?.atsScore),
    recruiter_score: numOrNull(review?.recruiterScore),
    bucket_verdict: review?.bucketFit?.verdict ?? null,
    lane_warning: laneWarningOrNull(review?.laneWarning),
    status: 'scored',
    scored_at: new Date().toISOString(),
  };
}

// ── Internal machine-path hardening (Phase 2 prep) ─────────────────────────────
// Shared by /internal/score-job (singular) and /internal/score-jobs (batch). All
// of this is ADDITIVE: scoring logic and the auth model are unchanged.

// Shared guard for the internal endpoints. Validates the shared-secret header and
// that the server is configured, then returns the server-side owner + Anthropic
// key. On any failure it sends the (unchanged) error response and returns null, so
// the singular endpoint keeps its exact status codes for backward compat.
function resolveInternalAuth(
  req: express.Request, res: express.Response,
): { ownerId: string; apiKey: string } | null {
  const expectedKey = process.env.INTERNAL_API_KEY;
  if (!expectedKey) {
    res.status(500).json({ success: false, error: 'INTERNAL_API_KEY is not configured on the server.' });
    return null;
  }
  if (req.header('x-internal-key') !== expectedKey) {
    res.status(401).json({ success: false, error: 'Invalid internal key' });
    return null;
  }
  const ownerId = process.env.INTERNAL_USER_ID;
  if (!ownerId) {
    res.status(500).json({ success: false, error: 'INTERNAL_USER_ID is not configured on the server.' });
    return null;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY is not configured on the server.' });
    return null;
  }
  return { ownerId, apiKey };
}

// Input-safety helpers for scraper traffic.
const INTERNAL_JD_MAX = 15000; // cap so one runaway paste can't blow up token cost
// Known scrape sources; anything else is normalized to 'other' rather than stored raw.
const KNOWN_SOURCES = new Set(['manual', 'wellfound', 'builtin', 'linkedin', 'indeed', 'glassdoor', 'apify', 'n8n', 'other']);
const normalizeSource = (s: any): string => (typeof s === 'string' && KNOWN_SOURCES.has(s) ? s : 'other');
// Trim, drop blanks (→ ''), and truncate over the cap. The stored (possibly
// truncated) text is what gets hashed, so dedupe stays consistent.
const cleanJdText = (jd: any): string => {
  if (typeof jd !== 'string') return '';
  const t = jd.trim();
  return t.length > INTERNAL_JD_MAX ? t.slice(0, INTERNAL_JD_MAX) : t;
};
// Accept a caller-provided posted_at only if it parses as a real date.
const postedAtOrNull = (v: any): string | null => {
  if (typeof v !== 'string' || !v.trim()) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

// Dedupe-aware score for ONE inline job under the configured owner — the core
// shared by both internal endpoints. Caller must pass a non-empty cleaned jd_text
// (via cleanJdText) and the owner's loaded master profile. DEDUPE: if a row for
// (owner, jd_hash) is already status='scored', it is returned untouched with
// deduped:true and the scorer is NOT called (re-scraped postings cost nothing).
async function scoreInlineJobForOwner(
  ownerId: string, apiKey: string, lib: any,
  input: { jd_text: string; title?: any; company?: any; location?: any; url?: any; source?: any; posted_at?: any },
): Promise<{ jd_hash: string; status: string; match_score: number | null; deduped: boolean; job: any }> {
  const jdText = cleanJdText(input.jd_text);
  const jdHash = hashJD(jdText);

  const { data: existing, error: exErr } = await supabase
    .from('scraped_jobs').select('*').eq('user_id', ownerId).eq('jd_hash', jdHash).maybeSingle();
  if (exErr) throw new Error(exErr.message);
  if (existing && existing.status === 'scored') {
    return { jd_hash: jdHash, status: existing.status, match_score: existing.match_score, deduped: true, job: existing };
  }

  // Insert new / refresh an unscored row's metadata, then score it.
  const { data: job, error: upErr } = await supabase
    .from('scraped_jobs')
    .upsert({
      user_id: ownerId,
      source: normalizeSource(input.source),
      title: typeof input.title === 'string' ? input.title : null,
      company: typeof input.company === 'string' ? input.company : null,
      location: typeof input.location === 'string' ? input.location : null,
      url: typeof input.url === 'string' ? input.url : null,
      posted_at: postedAtOrNull(input.posted_at),
      jd_text: jdText,
      jd_hash: jdHash,
    }, { onConflict: 'user_id,jd_hash' })
    .select().single();
  if (upErr) throw new Error(upErr.message);

  const review = await runProfileScorer(lib, job.jd_text, apiKey);
  const { data: updated, error: updErr } = await supabase
    .from('scraped_jobs')
    .update(scoredJobFields(review))
    .eq('id', job.id).eq('user_id', ownerId).select().single();
  if (updErr) throw new Error(updErr.message);

  return { jd_hash: jdHash, status: updated.status, match_score: updated.match_score, deduped: false, job: updated };
}

// Load the owner's master profile (service-role), or send a 400 and return null
// if it's empty (can't score against nothing). Shared by both internal endpoints.
async function loadOwnerProfileOr400(ownerId: string, res: express.Response): Promise<any | null> {
  const { data: profileRow } = await supabase
    .from('master_profile').select('content').eq('user_id', ownerId).maybeSingle();
  const lib = profileRow?.content;
  if (!lib?.experiences?.length && !lib?.projects?.length) {
    res.status(400).json({ success: false, error: 'Owner master profile is empty; cannot score.' });
    return null;
  }
  return lib;
}

// ── POST /internal/score-job ──────────────────────────────────────────────────
// Machine-auth path for Phase 2 (n8n / Apify). Authed by a shared secret in the
// 'x-internal-key' header; the OWNER is derived from INTERNAL_USER_ID server-side
// and is NEVER read from the body. Body: { jobId } OR { jd_text, title, company,
// location, url, source, posted_at }. The inline path is dedupe-aware + input-safe;
// the jobId path always re-scores (explicit request) for backward compat.
app.post('/internal/score-job', async (req, res) => {
  const auth = resolveInternalAuth(req, res);
  if (!auth) return;
  const { ownerId, apiKey } = auth;

  const { jobId, jd_text, title, company, location, url, source, posted_at } = req.body ?? {};

  try {
    const lib = await loadOwnerProfileOr400(ownerId, res);
    if (!lib) return;

    // Backward-compat: explicit re-score of an existing owned row (always scores).
    if (typeof jobId === 'string' && jobId) {
      const { data: job, error } = await supabase
        .from('scraped_jobs').select('*').eq('id', jobId).eq('user_id', ownerId).maybeSingle();
      if (error) return res.status(500).json({ success: false, error: error.message });
      if (!job) return res.status(404).json({ success: false, error: 'Job not found for the configured owner.' });

      const review = await runProfileScorer(lib, job.jd_text, apiKey);
      const { data: updated, error: updErr } = await supabase
        .from('scraped_jobs')
        .update(scoredJobFields(review))
        .eq('id', job.id).eq('user_id', ownerId).select().single();
      if (updErr) return res.status(500).json({ success: false, error: updErr.message });

      console.log(`[/internal/score-job] ownerId=${ownerId} jobId=${updated.id} match=${updated.match_score} verdict=${updated.bucket_verdict} deduped=false`);
      return res.json({ success: true, job: updated, deduped: false });
    }

    // Inline JD: dedupe-aware upsert + score.
    if (!cleanJdText(jd_text)) {
      return res.status(400).json({ success: false, error: 'jobId or jd_text is required' });
    }
    const result = await scoreInlineJobForOwner(ownerId, apiKey, lib, { jd_text, title, company, location, url, source, posted_at });
    console.log(`[/internal/score-job] ownerId=${ownerId} jobId=${result.job.id} match=${result.match_score} verdict=${result.job.bucket_verdict} deduped=${result.deduped}`);
    return res.json({ success: true, job: result.job, deduped: result.deduped });
  } catch (err: any) {
    console.error('[/internal/score-job] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Shared batch-scoring core. Scores an array of inline jobs sequentially and is
// fault-isolated: a blank jd_text → { status:'skipped' }; a job that throws →
// { status:'error', error } — neither aborts the batch. Dedupe-aware via
// scoreInlineJobForOwner (already-scored postings return free). Used by BOTH
// /internal/score-jobs and /internal/scrape-and-score so there is ONE loop.
async function runScoreBatch(
  ownerId: string, apiKey: string, lib: any, jobs: any[],
): Promise<{ results: any[]; scored: number; deduped: number; skipped: number; errored: number }> {
  const results: any[] = [];
  let scored = 0, deduped = 0, skipped = 0, errored = 0;
  for (const j of jobs) {
    const jdText = cleanJdText(j?.jd_text);
    if (!jdText) {
      results.push({ jd_hash: null, status: 'skipped', error: 'jd_text is empty' });
      skipped++;
      continue;
    }
    try {
      const r = await scoreInlineJobForOwner(ownerId, apiKey, lib, { ...j, jd_text: jdText });
      results.push({ jd_hash: r.jd_hash, status: r.status, match_score: r.match_score, deduped: r.deduped });
      if (r.deduped) deduped++; else scored++;
    } catch (err: any) {
      results.push({ jd_hash: null, status: 'error', error: err.message });
      errored++;
    }
  }
  return { results, scored, deduped, skipped, errored };
}

// ── POST /internal/score-jobs (batch) ──────────────────────────────────────────
// Batch sibling of /internal/score-job: a scraper hands off a whole morning's
// scrape in one call. Same x-internal-key auth + INTERNAL_USER_ID owner. Body:
// { jobs: [{ jd_text, title?, company?, location?, url?, source?, posted_at? }, ...] }.
// Scores sequentially and is fault-isolated: a blank jd_text is reported
// { status:'skipped' } and a job that throws is reported { status:'error', error }
// — neither fails the batch. Dedupe-aware (already-scored postings return free).
// Guarded by INTERNAL_BATCH_MAX (default 150): a larger batch is rejected 400 so a
// runaway scrape can't fan out into hundreds of scorer calls by accident.
app.post('/internal/score-jobs', async (req, res) => {
  const auth = resolveInternalAuth(req, res);
  if (!auth) return;
  const { ownerId, apiKey } = auth;

  const batchMax = Number(process.env.INTERNAL_BATCH_MAX) || 150;
  const jobs = Array.isArray(req.body?.jobs) ? req.body.jobs : null;
  if (!jobs || jobs.length === 0) {
    return res.status(400).json({ success: false, error: 'jobs must be a non-empty array' });
  }
  if (jobs.length > batchMax) {
    return res.status(400).json({ success: false, error: `Batch of ${jobs.length} exceeds INTERNAL_BATCH_MAX (${batchMax}).` });
  }

  try {
    const lib = await loadOwnerProfileOr400(ownerId, res);
    if (!lib) return;

    const { results, scored, deduped, skipped, errored } = await runScoreBatch(ownerId, apiKey, lib, jobs);

    console.log(`[/internal/score-jobs] ownerId=${ownerId} count=${jobs.length} scored=${scored} deduped=${deduped} skipped=${skipped} errored=${errored}`);
    return res.json({ success: true, count: jobs.length, scored, deduped, skipped, errored, results });
  } catch (err: any) {
    console.error('[/internal/score-jobs] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /internal/scrape-and-score ─────────────────────────────────────────────
// One-call scrape→score for the proven BuiltIn source. Scrapes builtin.com (with
// descriptions enabled), normalizes onto our job shape, drops postings that came
// back with no description (can't be scored), then runs the SAME batch core as
// /internal/score-jobs. Same x-internal-key auth + INTERNAL_USER_ID owner. Body:
// { searchQueries: string[], searchLocation?: string, maxResults?: number }.
// Guarded by INTERNAL_BATCH_MAX so a big scrape can't fan out unlimited scorer calls.
app.post('/internal/scrape-and-score', async (req, res) => {
  const auth = resolveInternalAuth(req, res);
  if (!auth) return;
  const { ownerId, apiKey } = auth;

  const { searchQueries, searchLocation, maxResults } = req.body ?? {};
  const queries = Array.isArray(searchQueries)
    ? searchQueries.filter((q: any) => typeof q === 'string' && q.trim())
    : [];
  if (queries.length === 0) {
    return res.status(400).json({ success: false, error: 'searchQueries must be a non-empty string array' });
  }

  const batchMax = Number(process.env.INTERNAL_BATCH_MAX) || 150;

  try {
    const lib = await loadOwnerProfileOr400(ownerId, res);
    if (!lib) return;

    const raw = await runBuiltinScrape({ searchQueries: queries, searchLocation, maxResults });

    // Normalize; count + drop jobs that came back without a description.
    const normalized: any[] = [];
    let missingDescription = 0;
    for (const r of raw) {
      const n = normalizeBuiltinJob(r);
      if (!n) { missingDescription++; continue; }
      normalized.push(n);
    }

    if (normalized.length > batchMax) {
      return res.status(400).json({ success: false, error: `Scraped ${normalized.length} scorable jobs exceeds INTERNAL_BATCH_MAX (${batchMax}).` });
    }

    const { results, scored, deduped, skipped, errored } = await runScoreBatch(ownerId, apiKey, lib, normalized);

    console.log(`[/internal/scrape-and-score] ownerId=${ownerId} scraped=${raw.length} missingDescription=${missingDescription} scorable=${normalized.length} scored=${scored} deduped=${deduped} skipped=${skipped} errored=${errored}`);
    return res.json({ success: true, scraped: raw.length, missingDescription, count: normalized.length, scored, deduped, skipped, errored, results });
  } catch (err: any) {
    console.error('[/internal/scrape-and-score] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /jobs ────────────────────────────────────────────────────────────────
// Manual paste. Content-addressed on (user_id, jd_hash): re-pasting the same JD
// returns the existing row (status/scores preserved) instead of erroring. A brand
// new row takes the DB default status 'new'.
app.post('/jobs', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const authClient = getAuthClient(req.headers.authorization as string);
  const { jd_text, title, company, url } = req.body ?? {};
  if (!jd_text || typeof jd_text !== 'string' || !jd_text.trim()) {
    return res.status(400).json({ success: false, error: 'jd_text is required' });
  }

  const { data, error } = await authClient
    .from('scraped_jobs')
    .upsert({
      user_id: userId,
      source: 'manual',
      title: typeof title === 'string' ? title : null,
      company: typeof company === 'string' ? company : null,
      url: typeof url === 'string' ? url : null,
      jd_text,
      jd_hash: hashJD(jd_text),
    }, { onConflict: 'user_id,jd_hash' })
    .select().single();

  if (error) return res.status(400).json({ success: false, error: error.message });
  return res.json({ success: true, job: data });
});

// ── GET /jobs?status=&sort= ───────────────────────────────────────────────────
// The user's jobs, ranked best-fit-first by default (match_score desc, then most
// recently scored). ?sort=recent orders by creation. ?status= filters the lane.
app.get('/jobs', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const authClient = getAuthClient(req.headers.authorization as string);
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const sort = typeof req.query.sort === 'string' ? req.query.sort : '';

  let query = authClient.from('scraped_jobs').select('*').eq('user_id', userId);
  if (status) query = query.eq('status', status);

  if (sort === 'recent') {
    query = query.order('created_at', { ascending: false });
  } else {
    query = query
      .order('match_score', { ascending: false, nullsFirst: false })
      .order('scored_at', { ascending: false, nullsFirst: false });
  }

  const { data, error } = await query;
  if (error) return res.status(400).json({ success: false, error: error.message });
  return res.json({ success: true, jobs: data ?? [] });
});

// ── POST /jobs/:id/score ──────────────────────────────────────────────────────
// Score one of the user's jobs against their master profile (same scorer path as
// /internal/score-job and /rerank/claude), writing the triage scores + 'scored'.
app.post('/jobs/:id/score', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const authClient = getAuthClient(req.headers.authorization as string);
  const { id } = req.params;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY is not configured on the server.' });
  }

  const { data: job, error: jobErr } = await authClient
    .from('scraped_jobs').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (jobErr) return res.status(500).json({ success: false, error: jobErr.message });
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' });

  const { data: profileRow, error: profileErr } = await authClient
    .from('master_profile').select('content').eq('user_id', userId).maybeSingle();
  if (profileErr) return res.status(500).json({ success: false, error: profileErr.message });
  const lib = profileRow?.content;
  if (!lib?.experiences?.length && !lib?.projects?.length) {
    return res.status(400).json({ success: false, error: 'Master profile is empty. Build your profile first.' });
  }

  try {
    const review = await runProfileScorer(lib, job.jd_text, apiKey);
    const { data: updated, error: updErr } = await authClient
      .from('scraped_jobs')
      .update(scoredJobFields(review))
      .eq('id', id).eq('user_id', userId).select().single();
    if (updErr) return res.status(500).json({ success: false, error: updErr.message });
    console.log(`[/jobs/:id/score] userId=${userId} jobId=${id} match=${updated.match_score} verdict=${updated.bucket_verdict}`);
    return res.json({ success: true, job: updated, review });
  } catch (err: any) {
    console.error('[/jobs/:id/score] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /jobs/:id/generate ───────────────────────────────────────────────────
// Body: { includeCoverLetter?: boolean }. Reuses the exact tailor cache
// (tailorWithCache -> tailor_results) and the assemble persistence path
// (createBuilderVersion -> resume_builder) so the result opens directly in the
// Builder. The cover letter (generateAndStoreCoverLetter -> cover_letters) runs
// ONLY when includeCoverLetter is true. Returns the version id for deep-linking.
app.post('/jobs/:id/generate', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const authClient = getAuthClient(req.headers.authorization as string);
  const { id } = req.params;
  const includeCoverLetter = req.body?.includeCoverLetter === true;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY is not configured on the server.' });
  }

  const { data: job, error: jobErr } = await authClient
    .from('scraped_jobs').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (jobErr) return res.status(500).json({ success: false, error: jobErr.message });
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' });

  const { data: profileRow, error: profileErr } = await authClient
    .from('master_profile').select('content').eq('user_id', userId).maybeSingle();
  if (profileErr) return res.status(500).json({ success: false, error: profileErr.message });
  const lib = profileRow?.content;
  if (!lib?.experiences?.length && !lib?.projects?.length) {
    return res.status(400).json({ success: false, error: 'Master profile is empty. Build your profile first.' });
  }

  try {
    // 1) Tailor (cached in tailor_results, exactly like /tailor/claude).
    const { resumeContent, review, fromCache } = await tailorWithCache({
      userId, lib, jobDescription: job.jd_text, applicationId: null, apiKey,
    });
    const score = typeof review?.matchScore === 'number' ? Math.round(review.matchScore) : null;

    // 2) Persist a Builder version the same way /assemble/claude does (inherits the
    //    latest version's formatting settings), so it opens in the Resume Builder.
    const { data: latestVersion } = await authClient
      .from('resume_builder').select('settings')
      .eq('user_id', userId).order('updated_at', { ascending: false }).limit(1).maybeSingle();

    const version = await createBuilderVersion(authClient, userId, {
      resumeContent,
      jobDescription: job.jd_text,
      company: job.company ?? undefined,
      role: job.title ?? undefined,
      score,
      settings: latestVersion?.settings ?? {},
    });

    // 3) Optional cover letter — reuse the cover-letter path, keyed to the same JD.
    let coverLetter: { id: string | null; coverLetter: string; fromCache: boolean } | null = null;
    if (includeCoverLetter) {
      const cl = await generateAndStoreCoverLetter({
        userId, lib, jobDescription: job.jd_text, applicationId: null,
        company: job.company ?? undefined, role: job.title ?? undefined, apiKey,
      });
      coverLetter = { id: cl.id, coverLetter: cl.coverLetter, fromCache: cl.fromCache };
    }

    const { data: updated } = await authClient
      .from('scraped_jobs').update({ status: 'generated' }).eq('id', id).eq('user_id', userId).select().single();

    console.log(`[/jobs/:id/generate] userId=${userId} jobId=${id} versionId=${version?.id} cover=${includeCoverLetter} tailorCache=${fromCache}`);
    return res.json({ success: true, job: updated, versionId: version?.id ?? null, score, review, coverLetter });
  } catch (err: any) {
    console.error('[/jobs/:id/generate] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH /jobs/:id ───────────────────────────────────────────────────────────
// Move a job through its lifecycle (e.g. applied / skipped). Ownership-scoped.
app.patch('/jobs/:id', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const authClient = getAuthClient(req.headers.authorization as string);
  const { id } = req.params;
  const { status } = req.body ?? {};
  const ALLOWED = ['new', 'scored', 'generated', 'applied', 'skipped'];
  if (typeof status !== 'string' || !ALLOWED.includes(status)) {
    return res.status(400).json({ success: false, error: `status must be one of: ${ALLOWED.join(', ')}` });
  }

  const { data, error } = await authClient
    .from('scraped_jobs').update({ status }).eq('id', id).eq('user_id', userId).select().single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  return res.json({ success: true, job: data });
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`API Server running on port ${PORT} (bound 0.0.0.0)`);
});