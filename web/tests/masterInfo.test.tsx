import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
      setSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
    },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    })),
  },
}));

import MasterInfoTab from '@/components/tabs/MasterInfoTab';

const session: any = { access_token: 'tok', user: { id: 'u1' } };

beforeEach(() => {
  (global.fetch as any) = vi.fn(async (url: any) => ({
    ok: true,
    json: async () => {
      if (String(url).includes('/master-profile')) return { success: true, data: { header: { name: 'Existing User' } } };
      return { success: true };
    },
  }));
});

describe('MasterInfoTab', () => {
  it('renders the seed panel and the profile editor without crashing', async () => {
    render(<MasterInfoTab session={session} />);
    expect(screen.getByText(/Seed from Existing Resume/i)).toBeInTheDocument();
    // editor loads the master profile on mount
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/master-profile'), expect.anything())
    );
  });

  it('expands the seed panel and accepts pasted resume text', async () => {
    const user = userEvent.setup();
    render(<MasterInfoTab session={session} />);
    await user.click(screen.getByText(/Seed from Existing Resume/i));
    const ta = screen.getByPlaceholderText(/Paste your resume text/i);
    await user.type(ta, 'John Doe — Engineer');
    expect((ta as HTMLTextAreaElement).value).toBe('John Doe — Engineer');
    // Parse button enabled once there is text
    expect(screen.getByRole('button', { name: /Parse & Import/i })).toBeEnabled();
  });
});
