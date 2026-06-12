import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { supabase, getAuthClient } from './lib/supabase';
import { requireAuth } from './middleware/auth';
import OpenAI from 'openai';
import { resumeContentToHtml } from './export/resumeToHtml';
import { generatePdf } from './export/pdfExport';

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
- experiences: array of work experiences with id ("exp-N"), org, role, location (optional), startDate, endDate (null if current), current (boolean), defaultInclude: true, tags: [], bullets: array of { id: "b-N", text, skills: [], strength: 2, tags: [] }
- projects: array with id ("proj-N"), name, startDate, endDate, techStack (array of strings), tags: [], bullets: array of { id: "b-N", text, skills: [], strength: 2, tags: [] }
- education: array with id ("edu-N"), institution, degree, field (optional), startDate, endDate, gpa (optional), defaultInclude: true, bullets: []
- skills: flat array with display (display name e.g. "PyTorch"), canonical (lowercase no spaces e.g. "pytorch"), category (group e.g. "ML/DL"), proven: true
- summaries: if a summary/objective section exists, create one entry with id "sum-1", text, tags: []; else empty array
- awards: array with id ("award-N"), title, issuer, date, tags: []; else empty array

Return ONLY the JSON object — no markdown wrapping.

JSON shape (follow exactly):
{
  "header": { "name": "", "title": "", "phone": "", "email": "", "linkedin": "", "github": "", "portfolio": "" },
  "summaries": [],
  "experiences": [],
  "projects": [],
  "education": [],
  "skills": [],
  "awards": []
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
        resumeContent: cached.resume_content,
        review: cached.review ?? null,
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

  const systemPrompt = `You are a professional resume tailor. Your ONLY data source is the candidate's Master Profile below.

MASTER PROFILE (your sole source of truth):
${masterProfileJson}

HARD RULES — non-negotiable:
1. You may SELECT, CUT, REORDER, CONDENSE bullets, and WRITE a tailored professional summary.
2. You must ONLY use facts present in the Master Profile. NEVER invent, embellish, or add any skill, metric, tool, title, experience, or project that is not explicitly present.
3. Do NOT optimize toward any numeric match score. Focus on honest, relevant presentation.
4. Produce a ONE-PAGE resume: be selective. Max 4 bullets per experience, max 3 per project.
5. Return ONLY valid JSON — no markdown fences, no explanation, no preamble.

HONEST FIT ASSESSMENT — required in every response:
After tailoring, assess fit honestly and candidly. Judge how well the candidate's REAL background
(Master Profile only) matches this JD's core requirements. If they are a weak match — missing core
requirements, or the JD forces dropping their strongest work — say so plainly and explain why. Do NOT
inflate fit to be encouraging; you are an honest evaluator, not a cheerleader. Never invent or imply
qualifications to improve the verdict.

SCOPING (these two review fields must never duplicate each other):
- genuineGaps: specific JD requirements the candidate genuinely LACKS — the verdict's evidence
- suggestions: how to strengthen what the candidate DOES have — actionable improvements on existing strengths

matchScore: provide an integer 0–100 reflecting how well this candidate's real background meets this JD.
Calibrate honestly: 80–100 = strong fit, most core requirements met; 50–79 = partial fit, notable gaps;
below 50 = weak fit, fundamental mismatches. Must be consistent with fitAssessment.level.

REQUIRED OUTPUT JSON STRUCTURE (follow exactly — the Builder depends on these field names):
{
  "resumeContent": {
    "header": { "name": "", "title": "", "phone": "", "email": "", "linkedin": "", "github": "", "portfolio": "" },
    "summary": "2-3 sentence tailored professional summary written from facts in the Master Profile",
    "showSummary": true,
    "sections": [
      {
        "id": "experience",
        "type": "experience",
        "title": "Experience",
        "visible": true,
        "items": [
          {
            "id": "exp-1",
            "organization": "Company Name (from Master Profile)",
            "role": "Job Title (from Master Profile)",
            "location": "City, State (from Master Profile, omit if missing)",
            "date": "Jan 2023 – Present",
            "bullets": [{ "id": "b-1", "text": "Bullet text verbatim or condensed from Master Profile" }]
          }
        ]
      },
      {
        "id": "projects",
        "type": "projects",
        "title": "Projects",
        "visible": true,
        "items": [
          {
            "id": "proj-1",
            "projectName": "Project Name (from Master Profile)",
            "techStack": "Comma-separated tech stack from Master Profile",
            "dateRange": "2024",
            "bullets": [{ "id": "b-10", "text": "Bullet text from Master Profile" }]
          }
        ]
      },
      {
        "id": "education",
        "type": "education",
        "title": "Education",
        "visible": true,
        "items": [
          {
            "id": "edu-1",
            "organization": "Institution name from Master Profile",
            "role": "Degree, Field (from Master Profile)",
            "date": "Aug 2024 – May 2026",
            "bullets": []
          }
        ]
      },
      {
        "id": "skills",
        "type": "skills",
        "title": "Technical Skills",
        "visible": true,
        "items": [
          { "id": "skill-cat-1", "category": "Category from Master Profile", "items": "Skill1, Skill2, Skill3 — only from Master Profile skills" }
        ]
      }
    ]
  },
  "review": {
    "summary": "1-2 sentence narrative of what you tailored and why",
    "keptItems": ["Experience: Role at Org — reason kept", "Project: Name — reason kept"],
    "droppedItems": ["Experience: Role at Org — reason dropped"],
    "skillsSurfaced": ["skill1", "skill2"],
    "suggestions": ["How to strengthen something the candidate DOES have — do NOT list gap requirements here"],
    "fitAssessment": { "level": "strong | moderate | weak", "rationale": "1-2 sentences on fit verdict based on real evidence from Master Profile vs JD" },
    "recommendation": "One-liner: e.g. 'Strong match — apply.' or 'Weak fit; your ML edge is buried here — deprioritize.'",
    "genuineGaps": ["Specific JD requirement the candidate lacks — e.g. 'Windows Server / AD'", "3+ yrs enterprise IT (candidate has 1)"],
    "matchScore": 73
  }
}`;

  const userMessage = `Tailor a one-page resume for the following job description. Choose the most relevant experiences and projects from the Master Profile, select the best bullets, group and surface relevant skills, and write a tailored professional summary (2-3 sentences).

JOB DESCRIPTION:
${jobDescription.slice(0, 6000)}

Return ONLY the JSON object as described in the system prompt. No markdown, no extra text.`;

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

    const resumeContent = parsed.resumeContent;
    const review = parsed.review ?? null;

    if (!resumeContent?.sections) {
      console.error('[/tailor/claude] missing resumeContent.sections in:', JSON.stringify(parsed).slice(0, 300));
      return res.status(500).json({ success: false, error: 'Claude response missing resumeContent.sections', raw: rawText.slice(0, 300) });
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

// ── Batch Claude scores for application badges ─────────────────────────────────
// GET /scores/claude
// Returns: { scores: { [applicationId]: number } }
// An application gets a badge when a tailor run exists for its exact JD text
// (matched by jd_hash). One request covers all applications — no N+1.
app.get('/scores/claude', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const authClient = getAuthClient(req.headers.authorization as string);

  const { data: apps, error: appsErr } = await authClient
    .from('applications')
    .select('id, job_description')
    .eq('user_id', userId);

  if (appsErr) return res.status(400).json({ success: false, error: appsErr.message });

  const { data: results, error: resultsErr } = await supabase
    .from('tailor_results')
    .select('jd_hash, score, created_at')
    .eq('user_id', userId)
    .not('score', 'is', null)
    .order('created_at', { ascending: false });

  if (resultsErr) {
    // Table missing or query failed — return empty scores rather than breaking the UI
    console.warn('[/scores/claude] lookup failed:', resultsErr.message);
    return res.json({ success: true, scores: {} });
  }

  // Keep the most recent score per jd_hash (results are sorted newest-first)
  const scoreByHash: Record<string, number> = {};
  for (const r of results ?? []) {
    if (scoreByHash[r.jd_hash] === undefined) scoreByHash[r.jd_hash] = r.score;
  }

  const scores: Record<string, number> = {};
  for (const app of apps ?? []) {
    if (!app.job_description?.trim()) continue;
    const score = scoreByHash[hashJD(app.job_description)];
    if (score !== undefined) scores[app.id] = score;
  }

  return res.json({ success: true, scores });
});

// ── PDF Export (Puppeteer — text-native, ATS-safe) ─────────────────────────────

app.post('/export/pdf', requireAuth, async (req, res) => {
  const { content, settings } = req.body;

  if (!content || !settings) {
    return res.status(400).json({ success: false, error: 'content and settings are required' });
  }

  try {
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
