import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Supabase mock (auth + chainable query builder for the Builder) ──────────────
function qbuilder() {
  let op: string | null = null;
  let inserted: any = null;
  const resolve = () => {
    if (op === 'select') return { data: dbVersions, error: null };
    if (op === 'insert') return { data: { id: 'new-id', ...inserted }, error: null };
    return { error: null };
  };
  const b: any = {
    select() { if (!op) op = 'select'; return b; },
    insert(r: any) { op = 'insert'; inserted = r; return b; },
    update() { op = 'update'; return b; },
    delete() { op = 'delete'; return b; },
    eq() { return b; },
    order() { return b; },
    single() { return Promise.resolve(resolve()); },
    then(f: any, r: any) { return Promise.resolve(resolve()).then(f, r); },
  };
  return b;
}
let dbVersions: any[] = [];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
      setSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({}),
    },
    from: vi.fn(() => qbuilder()),
  },
}));

import JobApplicationTracker from '@/components/JobApplicationTracker';
import { DEFAULT_RESUME_CONTENT } from '@/types/resume.types';

const session: any = { user: { id: 'u1' }, access_token: 'tok', refresh_token: 'ref', user_metadata: {}, email: 'jane@x.io' };

function jsonRes(obj: any, ok = true) {
  return { ok, json: async () => obj };
}

const rerankReview = {
  summary: 'Rerank verdict.',
  skillsSurfaced: ['Python'],
  suggestions: ['Lead with ML'],
  fitAssessment: { level: 'strong', rationale: 'Strong overlap.' },
  recommendation: 'Apply.',
  genuineGaps: [],
  matchScore: 77,
};

function installFetch() {
  (global.fetch as any) = vi.fn(async (url: any, opts: any) => {
    const u = String(url);
    const method = opts?.method ?? 'GET';
    if (u.includes('/applications/auto-ghost')) return jsonRes({ success: true, ghosted: 0 });
    if (u.endsWith('/applications') && method === 'GET') return jsonRes({ data: [] });
    if (u.endsWith('/profile') && method === 'GET') return jsonRes({ success: true, data: { display_name: 'Jane', created_at: '2026-01-01' } });
    if (u.includes('/scores/claude')) return jsonRes({ success: true, scores: {} });
    if (u.includes('/summary')) return jsonRes({ success: true, summary: 'ok' });
    if (u.includes('/rerank/claude')) return jsonRes({ success: true, review: rerankReview, score: 77 });
    return jsonRes({ success: true });
  });
}

beforeEach(() => {
  dbVersions = [{ id: 'v1', user_id: 'u1', version_name: 'My Resume', created_at: '', updated_at: '', content: DEFAULT_RESUME_CONTENT, settings: {} }];
  sessionStorage.clear();
  localStorage.clear();
  installFetch();
});

describe('JobApplicationTracker — tab state retention', () => {
  it('keeps the Tailor JD when switching away and back', async () => {
    const user = userEvent.setup();
    render(<JobApplicationTracker session={session} />);

    // wait until initial profile/apps load settles
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/applications'), expect.anything()));

    // go to Tailor and type a JD
    await user.click(screen.getByRole('button', { name: /Tailor/i }));
    const ta = await screen.findByPlaceholderText(/Paste the full job description/i);
    await user.type(ta, 'Senior ML Engineer role');
    expect((ta as HTMLTextAreaElement).value).toBe('Senior ML Engineer role');

    // switch to Applications, then back to Tailor
    await user.click(screen.getByRole('button', { name: /Applications/i }));
    await user.click(screen.getByRole('button', { name: /Tailor/i }));

    const ta2 = screen.getByPlaceholderText(/Paste the full job description/i) as HTMLTextAreaElement;
    expect(ta2.value).toBe('Senior ML Engineer role'); // retained across tab switches
  });
});

describe('JobApplicationTracker — Builder live score', () => {
  it('scores the live resume against the version JD and shows the score chip (stays in the Builder)', async () => {
    // A version carrying its target JD — the Builder scores against this.
    dbVersions = [{
      id: 'v1', user_id: 'u1', version_name: 'Tailored', created_at: '', updated_at: '',
      content: DEFAULT_RESUME_CONTENT, settings: {},
      job_description: 'Build production ML systems.', jd_hash: 'h1',
    }];

    const user = userEvent.setup();
    render(<JobApplicationTracker session={session} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/applications'), expect.anything()));

    await user.click(screen.getByRole('button', { name: /Resume Builder/i }));
    const rerankBtn = await screen.findByRole('button', { name: /Re-rank$/i });
    expect(rerankBtn).toBeEnabled();
    await user.click(rerankBtn);

    // Scores the LIVE content against the version's JD; result shows in the Builder.
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/rerank/claude'), expect.anything())
    );
    await waitFor(() => expect(screen.getByText('77')).toBeInTheDocument());
    // No Tailor-tab re-rank panel anymore — the score lives in the Builder.
    expect(screen.queryByText('Re-rank — your edited resume')).not.toBeInTheDocument();

    const call = (global.fetch as any).mock.calls.find((c: any[]) => String(c[0]).includes('/rerank/claude'));
    const body = JSON.parse(call[1].body);
    expect(body.jobDescription).toBe('Build production ML systems.');
    expect(Array.isArray(body.resumeContent.sections)).toBe(true);
  });

  it('disables scoring when the current version has no JD', async () => {
    // beforeEach gives a version with no job_description.
    const user = userEvent.setup();
    render(<JobApplicationTracker session={session} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/applications'), expect.anything()));

    await user.click(screen.getByRole('button', { name: /Resume Builder/i }));
    const rerankBtn = await screen.findByRole('button', { name: /Re-rank$/i });
    expect(rerankBtn).toBeDisabled();

    const calledRerank = (global.fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes('/rerank/claude'));
    expect(calledRerank).toBe(false);
  });
});
