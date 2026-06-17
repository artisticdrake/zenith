import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TailorTab from '@/components/tabs/TailorTab';

const session: any = { access_token: 'tok', user: { id: 'u1' } };

const apps: any[] = [
  { id: 'a1', company: 'Acme', position: 'ML Engineer', jobDescription: 'Build ML systems with Python.' },
  { id: 'a2', company: 'NoJD Co', position: 'Analyst', jobDescription: '' },
];

const goodResult = {
  success: true,
  resumeContent: { header: { name: 'X' }, summary: 's', showSummary: true, sections: [{ type: 'experience', items: [] }] },
  review: {
    summary: 'Tailored narrative.',
    keptItems: ['Experience: ML at Acme — relevant'],
    droppedItems: ['Old retail job'],
    skillsSurfaced: ['Python', 'PyTorch'],
    suggestions: ['Add metrics'],
    bulletSuggestions: [
      { section: 'experience', target: 'Acme', guidance: 'Surface ML impact', bullet: 'Shipped ML pipeline serving [X] users' },
    ],
    fitAssessment: { level: 'strong', rationale: 'Great overlap.' },
    recommendation: 'Apply now.',
    genuineGaps: ['Kubernetes'],
    matchScore: 82,
  },
  fromCache: false,
};

const assembleResult = {
  success: true,
  version: { id: 'v-new' },
  resumeContent: goodResult.resumeContent,
  score: 88,
  changeLog: ['Replaced weak retail bullet with ML pipeline bullet'],
};

function mockFetchOnce(payload: any) {
  (global.fetch as any) = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  });
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('TailorTab — generate flow', () => {
  it('generates and shows Claude review + score', async () => {
    const user = userEvent.setup();
    mockFetchOnce(goodResult);
    render(<TailorTab apps={apps} session={session} onAssembled={vi.fn()} />);

    const textarea = screen.getByPlaceholderText(/Paste the full job description/i);
    await user.type(textarea, 'We need a Python ML engineer.');

    await user.click(screen.getByRole('button', { name: /Generate with Claude AI/i }));

    await waitFor(() => expect(screen.getByText('Claude Review')).toBeInTheDocument());
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('Apply now.')).toBeInTheDocument();
    expect(screen.getByText(/Great overlap/)).toBeInTheDocument();
    // editable candidate bullets are shown; no approve gate / create-app modal
    expect(screen.getByText(/Candidate bullets — edit & approve/i)).toBeInTheDocument();
    expect(screen.queryByText(/Approve & Open in Builder/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Create an Application/i)).not.toBeInTheDocument();
  });

  it('does not call fetch when JD is empty (button disabled)', async () => {
    mockFetchOnce(goodResult);
    render(<TailorTab apps={apps} session={session} onAssembled={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /Generate with Claude AI/i });
    expect(btn).toBeDisabled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('surfaces server error', async () => {
    const user = userEvent.setup();
    (global.fetch as any) = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ success: false, error: 'Profile empty' }) });
    render(<TailorTab apps={apps} session={session} onAssembled={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/Paste the full job description/i), 'jd text');
    await user.click(screen.getByRole('button', { name: /Generate with Claude AI/i }));
    await waitFor(() => expect(screen.getByText('Profile empty')).toBeInTheDocument());
  });

  it('checking a bullet + Send to Builder calls /assemble/claude with the edited text and fires onAssembled', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => goodResult })       // /tailor/claude
      .mockResolvedValueOnce({ ok: true, json: async () => assembleResult });  // /assemble/claude
    (global.fetch as any) = fetchMock;
    const onAssembled = vi.fn();

    render(<TailorTab apps={apps} session={session} onAssembled={onAssembled} />);
    await user.type(screen.getByPlaceholderText(/Paste the full job description/i), 'jd');
    await user.click(screen.getByRole('button', { name: /Generate with Claude AI/i }));
    await waitFor(() => screen.getByText('Claude Review'));

    // Send is disabled until at least one bullet is approved
    const sendBtn = screen.getByRole('button', { name: /to Builder/i });
    expect(sendBtn).toBeDisabled();

    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: /Send 1 to Builder/i })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /Send 1 to Builder/i }));

    await waitFor(() => expect(onAssembled).toHaveBeenCalled());

    // The second fetch call hit /assemble/claude with the approved bullet
    const assembleCall = fetchMock.mock.calls.find(c => String(c[0]).includes('/assemble/claude'));
    expect(assembleCall).toBeTruthy();
    const body = JSON.parse(assembleCall![1].body);
    expect(body.approvedBullets).toHaveLength(1);
    expect(body.approvedBullets[0].text).toContain('ML pipeline');
    expect(body.approvedBullets[0].section).toBe('experience');
    expect(onAssembled).toHaveBeenCalledWith(expect.objectContaining({ score: 88 }));
  });
});

describe('TailorTab — saved-application pull', () => {
  it('pulling a saved app fills the JD', async () => {
    const user = userEvent.setup();
    render(<TailorTab apps={apps} session={session} onAssembled={vi.fn()} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    await user.selectOptions(select, 'a1');
    const textarea = screen.getByPlaceholderText(/Paste the full job description/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Build ML systems with Python.');
  });
});

describe('TailorTab — state retention (sessionStorage)', () => {
  it('restores the JD after an unmount/remount (page reload)', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TailorTab apps={apps} session={session} onAssembled={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/Paste the full job description/i), 'Persisted JD body');

    await waitFor(() => {
      const raw = sessionStorage.getItem('jt.tailor_session');
      expect(raw && JSON.parse(raw).jobDescription).toBe('Persisted JD body');
    });

    unmount();
    render(<TailorTab apps={apps} session={session} onAssembled={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/Paste the full job description/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Persisted JD body');
  });

  it('Reset clears JD, result, and sessionStorage', async () => {
    const user = userEvent.setup();
    mockFetchOnce(goodResult);
    render(<TailorTab apps={apps} session={session} onAssembled={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/Paste the full job description/i), 'jd');
    await user.click(screen.getByRole('button', { name: /Generate with Claude AI/i }));
    await waitFor(() => screen.getByText('Claude Review'));

    await user.click(screen.getByRole('button', { name: /Reset/i }));
    const textarea = screen.getByPlaceholderText(/Paste the full job description/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
    expect(screen.queryByText('Claude Review')).not.toBeInTheDocument();
    await waitFor(() => {
      const raw = sessionStorage.getItem('jt.tailor_session');
      const parsed = raw ? JSON.parse(raw) : {};
      expect(parsed.jobDescription ?? '').toBe('');
      expect(parsed.result ?? null).toBeNull();
    });
  });
});
