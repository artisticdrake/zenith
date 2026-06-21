import express from 'express';
import cors from 'cors';
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

dotenv.config({ path: require('path').resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;

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

app.use(cors());
app.use(express.json({ limit: '20mb' }));

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

  const jdHash = hashJD(jobDescription);
  const profileHash = hashProfile(lib);

  // Cache check — same JD + same profile → return the stored result
  try {
    const { data: cached } = await supabase
      .from('tailor_results')
      .select('resume_content, review')
      .eq('user_id', userId)
      .eq('jd_hash', jdHash)
      .eq('profile_hash', profileHash)
      .maybeSingle();

    if (cached?.resume_content) {
      console.log(`[/tailor/claude] cache hit userId=${userId} jdHash=${jdHash}`);
      return res.json({
        success: true,
        // Normalize on read too — rows cached before normalization existed
        resumeContent: normalizeResumeContent(cached.resume_content),
        review: normalizeReview(cached.review),
        fromCache: true,
      });
    }
  } catch (err: any) {
    console.warn('[/tailor/claude] cache lookup failed (continuing without cache):', err.message);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY is not configured on the server.' });
  }

  const masterProfileJson = JSON.stringify(lib, null, 2);

  const { system: systemPrompt, user: userMessage } = buildTailorPrompt(masterProfileJson, jobDescription);

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
      console.error('[/tailor/claude] Anthropic error:', errMsg);
      return res.status(500).json({ success: false, error: errMsg });
    }

    const rawText: string = responseData?.content?.[0]?.text ?? '';

    // Defensive JSON parse — strip code fences if present
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
        console.error('[/tailor/claude] invalid JSON from Claude:', rawText.slice(0, 300));
        return res.status(500).json({ success: false, error: 'Claude returned malformed JSON', raw: rawText.slice(0, 300) });
      }
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        return res.status(500).json({ success: false, error: 'Could not parse Claude response as JSON', raw: rawText.slice(0, 300) });
      }
    }

    if (!Array.isArray(parsed.resumeContent?.sections) || parsed.resumeContent.sections.length === 0) {
      console.error('[/tailor/claude] missing resumeContent.sections in:', JSON.stringify(parsed).slice(0, 300));
      return res.status(500).json({ success: false, error: 'Claude response missing resumeContent.sections', raw: rawText.slice(0, 300) });
    }

    // Coerce to the exact ResumeContent shape the Builder depends on BEFORE
    // caching — a creative Claude response must never poison tailor_results
    // or crash the Builder render.
    // Sanitize resume-bound text only (bullets, summary, titles + paste-ready
    // bulletSuggestions). Analytical prose in the review is left untouched.
    const resumeContent = sanitizeResumeContent(normalizeResumeContent(parsed.resumeContent));
    const review = normalizeReview(parsed.review);
    if (review && Array.isArray((review as any).bulletSuggestions)) {
      (review as any).bulletSuggestions = sanitizeBulletSuggestions((review as any).bulletSuggestions);
    }

    // Persist to cache — score lives here so it is never recomputed for an unchanged JD+profile
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

    if (saveErr) console.warn('[/tailor/claude] failed to cache result:', saveErr.message);

    console.log(`[/tailor/claude] userId=${userId} sections=${resumeContent.sections.length} fit=${(review as any)?.fitAssessment?.level ?? 'none'} score=${review?.matchScore ?? 'n/a'}`);

    return res.json({
      success: true,
      resumeContent,
      review,
      fromCache: false,
    });
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

    // The JD travels with the version so the Builder knows what to score against.
    const jdHash = hashJD(jobDescription);

    // Write a NEW version — never overwrite the previous one
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
        settings: latestVersion?.settings ?? {},
        job_description: jobDescription,
        jd_hash: jdHash,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr) {
      console.error('[/assemble/claude] failed to create version:', insertErr.message);
      return res.status(500).json({ success: false, error: insertErr.message });
    }

    // Prime the score store so the freshly assembled resume is already scored —
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
      console.warn('[/assemble/claude] failed to prime score (continuing):', err.message);
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

  const jdHash = hashJD(jobDescription);
  const profileHash = hashProfile(lib);

  // Cache check — same JD + same profile + not manually edited => return stored letter
  try {
    const { data: cached } = await supabase
      .from('cover_letters')
      .select('id, cover_letter, footer, edited')
      .eq('user_id', userId)
      .eq('jd_hash', jdHash)
      .eq('profile_hash', profileHash)
      .maybeSingle();

    if (cached?.cover_letter && !cached.edited) {
      console.log(`[/cover-letter/claude] cache hit userId=${userId} jdHash=${jdHash}`);
      return res.json({ success: true, id: cached.id, coverLetter: cached.cover_letter, footer: cached.footer ?? null, fromCache: true });
    }
  } catch (err: any) {
    console.warn('[/cover-letter/claude] cache lookup failed (continuing without cache):', err.message);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY is not configured on the server.' });
  }

  const masterProfileJson = JSON.stringify(lib, null, 2);
  const { system: systemPrompt, user: userMessage } = buildCoverLetterPrompt(
    masterProfileJson, jobDescription,
    typeof company === 'string' ? company : undefined,
    typeof role === 'string' ? role : undefined,
  );

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
        max_tokens: 1500,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    const responseData = await response.json() as any;
    if (!response.ok) {
      const errMsg = responseData?.error?.message || 'Claude API error';
      console.error('[/cover-letter/claude] Anthropic error:', errMsg);
      return res.status(500).json({ success: false, error: errMsg });
    }

    const rawText: string = responseData?.content?.[0]?.text ?? '';

    // Defensive JSON parse — strip code fences if present
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
        console.error('[/cover-letter/claude] invalid JSON from Claude:', rawText.slice(0, 300));
        return res.status(500).json({ success: false, error: 'Claude returned malformed JSON', raw: rawText.slice(0, 300) });
      }
      try { parsed = JSON.parse(match[0]); }
      catch { return res.status(500).json({ success: false, error: 'Could not parse Claude response as JSON', raw: rawText.slice(0, 300) }); }
    }

    if (typeof parsed.coverLetter !== 'string' || !parsed.coverLetter.trim()) {
      console.error('[/cover-letter/claude] missing coverLetter in:', JSON.stringify(parsed).slice(0, 300));
      return res.status(500).json({ success: false, error: 'Claude response missing coverLetter', raw: rawText.slice(0, 300) });
    }

    // Same hygiene the resume-bound text gets: strip em dashes / arrows.
    const coverLetter = sanitizeResumeText(parsed.coverLetter.trim());

    // Persist — service-role upsert keyed on (user_id, jd_hash, profile_hash),
    // exactly like tailor_results. A fresh generation is never "edited".
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

    if (saveErr) console.warn('[/cover-letter/claude] failed to persist:', saveErr.message);

    console.log(`[/cover-letter/claude] userId=${userId} len=${coverLetter.length} id=${saved?.id ?? 'n/a'}`);
    return res.json({ success: true, id: saved?.id ?? null, coverLetter, footer: saved?.footer ?? null, fromCache: false });
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

app.listen(PORT, () => {
  console.log(`API Server running on http://localhost:${PORT}`);
});