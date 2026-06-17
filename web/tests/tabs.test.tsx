import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Sidebar from '@/components/layout/Sidebar';
import DeleteConfirmDialog from '@/components/modals/DeleteConfirmDialog';
import ProfileTab from '@/components/tabs/ProfileTab';

describe('Sidebar', () => {
  function props(overrides = {}) {
    return {
      activeTab: 'applications' as const,
      onTabChange: vi.fn(),
      onLogout: vi.fn(),
      displayName: 'Jane Doe',
      googleEmail: 'jane@x.io',
      googleAvatarUrl: null,
      appCount: 3,
      ...overrides,
    };
  }

  it('renders all nav items and the app count badge', () => {
    render(<Sidebar {...props()} />);
    for (const label of ['Applications', 'Master Info', 'Analytics', 'Resume Builder', 'Tailor', 'Profile']) {
      expect(screen.getByRole('button', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    }
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('fires onTabChange for each tab', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<Sidebar {...props({ onTabChange })} />);
    await user.click(screen.getByRole('button', { name: /Tailor/i }));
    expect(onTabChange).toHaveBeenCalledWith('tailor');
    await user.click(screen.getByRole('button', { name: /Resume Builder/i }));
    expect(onTabChange).toHaveBeenCalledWith('resume-builder');
  });

  it('shows initials when no avatar', () => {
    render(<Sidebar {...props()} />);
    expect(screen.getByText('JD')).toBeInTheDocument();
  });
});

describe('DeleteConfirmDialog', () => {
  it('renders when open and wires Cancel/Delete', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<DeleteConfirmDialog open onClose={onClose} onConfirm={onConfirm} />);
    expect(screen.getByText('Delete Application?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^Delete$/i }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(<DeleteConfirmDialog open={false} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByText('Delete Application?')).not.toBeInTheDocument();
  });
});

describe('ProfileTab', () => {
  function props(overrides = {}) {
    return {
      displayName: 'Jane Doe',
      googleEmail: 'jane@x.io',
      googleAvatarUrl: null,
      joinedAt: '2026-01-01',
      appCount: 5,
      onSaveName: vi.fn(),
      onLogout: vi.fn(),
      onExportCsv: vi.fn(),
      onDeleteAccount: vi.fn(),
      theme: 'dark' as const,
      onThemeToggle: vi.fn(),
      ...overrides,
    };
  }

  it('toggles theme and exports csv', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<ProfileTab {...p} />);
    await user.click(screen.getByRole('switch', { name: /Toggle theme/i }));
    expect(p.onThemeToggle).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Export CSV/i }));
    expect(p.onExportCsv).toHaveBeenCalled();
  });

  it('edits and saves the display name', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<ProfileTab {...p} />);
    // pencil edit button (icon-only) — find by the heading then its sibling button
    const pencil = screen.getAllByRole('button').find(b => b.querySelector('svg'));
    expect(pencil).toBeTruthy();
    // open edit via the pencil next to the name
    await user.click(screen.getByText('Jane Doe').parentElement!.querySelector('button')!);
    const input = screen.getByDisplayValue('Jane Doe');
    await user.clear(input);
    await user.type(input, 'Jane Smith{Enter}');
    expect(p.onSaveName).toHaveBeenCalledWith('Jane Smith');
  });

  it('requires a second confirm to delete the account', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<ProfileTab {...p} />);
    await user.click(screen.getByRole('button', { name: /Delete My Account/i }));
    expect(p.onDeleteAccount).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Yes, Delete Everything/i }));
    expect(p.onDeleteAccount).toHaveBeenCalled();
  });
});
