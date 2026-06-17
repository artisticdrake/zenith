import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ResumeToolbar from '@/components/resume/toolbar/ResumeToolbar';
import VersionSelector from '@/components/resume/toolbar/VersionSelector';
import { DEFAULT_RESUME_CONTENT, type ResumeBuilderData } from '@/types/resume.types';

function makeVersions(): ResumeBuilderData[] {
  return [
    { id: 'v1', user_id: 'u', version_name: 'Primary', created_at: '', updated_at: '', content: DEFAULT_RESUME_CONTENT, settings: {} as any },
    { id: 'v2', user_id: 'u', version_name: 'Backup', created_at: '', updated_at: '', content: DEFAULT_RESUME_CONTENT, settings: {} as any },
  ];
}

function toolbarProps(overrides: Partial<React.ComponentProps<typeof ResumeToolbar>> = {}) {
  return {
    versions: makeVersions(),
    activeVersionId: 'v1',
    content: DEFAULT_RESUME_CONTENT,
    saveStatus: 'idle' as const,
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    onPrint: vi.fn(),
    onSwitchVersion: vi.fn(),
    onCreateVersion: vi.fn().mockResolvedValue(undefined),
    onDeleteVersion: vi.fn().mockResolvedValue(undefined),
    onRenameVersion: vi.fn().mockResolvedValue(undefined),
    liveScore: null,
    scoring: false,
    scoreStale: false,
    liveScoreOn: true,
    onToggleLiveScore: vi.fn(),
    onRerank: vi.fn(),
    onReassemble: vi.fn(),
    reassembling: false,
    scoringDisabledReason: null,
    ...overrides,
  };
}

describe('ResumeToolbar', () => {
  it('disables Re-rank and Re-assemble when there is no JD to score against', () => {
    render(<ResumeToolbar {...toolbarProps({ scoringDisabledReason: 'No target job description for this version.' })} />);
    expect(screen.getByRole('button', { name: /Re-rank$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Re-assemble/i })).toBeDisabled();
  });

  it('shows the live score chip when a score is present', () => {
    render(<ResumeToolbar {...toolbarProps({ liveScore: 82 })} />);
    expect(screen.getByText('82')).toBeInTheDocument();
  });

  it('Re-rank (force) calls onRerank when enabled', async () => {
    const user = userEvent.setup();
    const onRerank = vi.fn();
    render(<ResumeToolbar {...toolbarProps({ onRerank })} />);
    await user.click(screen.getByRole('button', { name: /Re-rank$/i }));
    expect(onRerank).toHaveBeenCalledTimes(1);
  });

  it('Re-assemble calls onReassemble when enabled', async () => {
    const user = userEvent.setup();
    const onReassemble = vi.fn();
    render(<ResumeToolbar {...toolbarProps({ onReassemble })} />);
    await user.click(screen.getByRole('button', { name: /Re-assemble/i }));
    expect(onReassemble).toHaveBeenCalledTimes(1);
  });

  it('disables Re-rank and shows spinner text while scoring', () => {
    render(<ResumeToolbar {...toolbarProps({ scoring: true })} />);
    const btn = screen.getByRole('button', { name: /Scoring/i });
    expect(btn).toBeDisabled();
  });

  it('toggling Live score calls onToggleLiveScore', async () => {
    const user = userEvent.setup();
    const onToggleLiveScore = vi.fn();
    render(<ResumeToolbar {...toolbarProps({ onToggleLiveScore })} />);
    await user.click(screen.getByRole('checkbox'));
    expect(onToggleLiveScore).toHaveBeenCalledTimes(1);
  });

  it('Copy LaTeX writes to clipboard and shows confirmation', async () => {
    const user = userEvent.setup(); // installs a clipboard stub we can read back
    render(<ResumeToolbar {...toolbarProps()} />);
    await user.click(screen.getByRole('button', { name: /Copy LaTeX/i }));
    await waitFor(() => expect(screen.getByText(/Copied!/)).toBeInTheDocument());
    const text = await navigator.clipboard.readText();
    expect(text).toContain('\\documentclass');
  });

  it('Download PDF and Save call their handlers', async () => {
    const user = userEvent.setup();
    const p = toolbarProps();
    render(<ResumeToolbar {...p} />);
    await user.click(screen.getByRole('button', { name: /Download PDF/i }));
    expect(p.onPrint).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^Save$/i }));
    expect(p.onSave).toHaveBeenCalled();
  });

  it('undo/redo disabled state reflects props', () => {
    render(<ResumeToolbar {...toolbarProps({ canUndo: false, canRedo: true })} />);
    expect(screen.getByLabelText('Undo')).toBeDisabled();
    expect(screen.getByLabelText('Redo')).not.toBeDisabled();
  });

  it('shows saving/saved indicators', () => {
    const { rerender } = render(<ResumeToolbar {...toolbarProps({ saveStatus: 'saving' })} />);
    expect(screen.getByText(/Saving/)).toBeInTheDocument();
    rerender(<ResumeToolbar {...toolbarProps({ saveStatus: 'saved' })} />);
    expect(screen.getByText(/Saved/)).toBeInTheDocument();
  });
});

describe('VersionSelector', () => {
  it('opens the dropdown and switches version', async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    render(<VersionSelector versions={makeVersions()} activeVersionId="v1" onSwitch={onSwitch} onCreate={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Select resume version/i }));
    await user.click(screen.getByText('Backup'));
    expect(onSwitch).toHaveBeenCalledWith('v2');
  });

  it('creates a new version', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<VersionSelector versions={makeVersions()} activeVersionId="v1" onSwitch={vi.fn()} onCreate={onCreate} onDelete={vi.fn()} onRename={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Select resume version/i }));
    await user.click(screen.getByRole('button', { name: /New version/i }));
    await user.type(screen.getByLabelText('New version name'), 'Targeted');
    await user.click(screen.getByRole('button', { name: /^Create$/i }));
    expect(onCreate).toHaveBeenCalledWith('Targeted');
  });

  it('deletes a version (only when more than one exists)', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<VersionSelector versions={makeVersions()} activeVersionId="v1" onSwitch={vi.fn()} onCreate={vi.fn()} onDelete={onDelete} onRename={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Select resume version/i }));
    const deleteButtons = screen.getAllByLabelText('Delete version');
    await user.click(deleteButtons[0]);
    expect(onDelete).toHaveBeenCalled();
  });

  it('hides delete buttons when only one version exists', async () => {
    const user = userEvent.setup();
    const one = [makeVersions()[0]];
    render(<VersionSelector versions={one} activeVersionId="v1" onSwitch={vi.fn()} onCreate={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Select resume version/i }));
    expect(screen.queryByLabelText('Delete version')).not.toBeInTheDocument();
  });

  it('renames a version on Enter', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<VersionSelector versions={makeVersions()} activeVersionId="v1" onSwitch={vi.fn()} onCreate={vi.fn()} onDelete={vi.fn()} onRename={onRename} />);
    await user.click(screen.getByRole('button', { name: /Select resume version/i }));
    await user.click(screen.getAllByLabelText('Rename')[0]);
    const input = screen.getByLabelText('Rename version');
    await user.clear(input);
    await user.type(input, 'Renamed{Enter}');
    expect(onRename).toHaveBeenCalledWith('v1', 'Renamed');
  });
});
