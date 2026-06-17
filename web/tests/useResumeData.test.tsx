import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// ── Chainable Supabase mock ─────────────────────────────────────────────────────
const dbState: { versions: any[]; lastInsert: any; lastUpdate: any; lastDelete: any } = {
  versions: [],
  lastInsert: null,
  lastUpdate: null,
  lastDelete: null,
};

function builder() {
  let op: string | null = null;
  let insertedRow: any = null;
  const resolve = () => {
    if (op === 'select') return { data: dbState.versions, error: null };
    if (op === 'insert') return { data: { id: 'new-id', ...insertedRow }, error: null };
    return { error: null };
  };
  const b: any = {
    select() { if (!op) op = 'select'; return b; },
    insert(row: any) { op = 'insert'; insertedRow = row; dbState.lastInsert = row; return b; },
    update(patch: any) { op = 'update'; dbState.lastUpdate = patch; return b; },
    delete() { op = 'delete'; dbState.lastDelete = true; return b; },
    eq() { return b; },
    order() { return b; },
    single() { return Promise.resolve(resolve()); },
    then(onF: any, onR: any) { return Promise.resolve(resolve()).then(onF, onR); },
  };
  return b;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { setSession: vi.fn().mockResolvedValue({ data: {}, error: null }) },
    from: vi.fn(() => builder()),
  },
}));

import { useResumeData } from '@/hooks/useResumeData';
import { DEFAULT_RESUME_CONTENT } from '@/types/resume.types';

const session: any = {
  user: { id: 'user-1' },
  access_token: 'tok',
  refresh_token: 'ref',
};

function versionRow(id: string, name: string, contentOverride?: any) {
  return {
    id,
    user_id: 'user-1',
    version_name: name,
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
    content: contentOverride ?? DEFAULT_RESUME_CONTENT,
    settings: { fontSize: 11 },
  };
}

beforeEach(() => {
  dbState.versions = [];
  dbState.lastInsert = null;
  dbState.lastUpdate = null;
  dbState.lastDelete = null;
  localStorage.clear();
  sessionStorage.clear();
});

describe('useResumeData', () => {
  it('loads existing versions and normalizes content', async () => {
    dbState.versions = [versionRow('v1', 'Primary')];
    const { result } = renderHook(() => useResumeData(session));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.versions).toHaveLength(1);
    expect(result.current.activeVersionId).toBe('v1');
    expect(result.current.content.sections.length).toBeGreaterThan(0);
    // settings normalized (fontSize 11 kept, missing fields defaulted)
    expect(result.current.settings.fontSize).toBe(11);
    expect(result.current.settings.fontFamily).toBe('charter');
  });

  it('creates a default version when none exist', async () => {
    dbState.versions = [];
    const { result } = renderHook(() => useResumeData(session));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(dbState.lastInsert).toBeTruthy();
    expect(dbState.lastInsert.version_name).toBe('My Resume');
    expect(result.current.activeVersionId).toBe('new-id');
  });

  it('undo/redo walks content history', async () => {
    dbState.versions = [versionRow('v1', 'Primary')];
    const { result } = renderHook(() => useResumeData(session));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const original = result.current.content;
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);

    const edited = { ...original, summary: 'EDITED SUMMARY' };
    act(() => result.current.setContent(edited));
    expect(result.current.content.summary).toBe('EDITED SUMMARY');
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.content.summary).toBe(original.summary);
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(result.current.content.summary).toBe('EDITED SUMMARY');
  });

  it('undo is a no-op when there is no history', async () => {
    dbState.versions = [versionRow('v1', 'Primary')];
    const { result } = renderHook(() => useResumeData(session));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = result.current.content;
    act(() => result.current.undo());
    expect(result.current.content).toBe(before);
  });

  it('loads the newest version as active (assembly writes a new version server-side)', async () => {
    // fetchVersions orders by updated_at desc; the first row is the active resume.
    // The Tailor "Send to Builder" flow inserts a fresh version via the API before
    // the Builder mounts, so it simply lands here as the newest row.
    const newest = { ...DEFAULT_RESUME_CONTENT, summary: 'ASSEMBLED' };
    dbState.versions = [versionRow('v-new', 'Tailored — Acme', newest), versionRow('v1', 'Primary')];
    const { result } = renderHook(() => useResumeData(session));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.activeVersionId).toBe('v-new');
    expect(result.current.content.summary).toBe('ASSEMBLED');
  });

  it('switchVersion loads the chosen version content', async () => {
    const v2content = { ...DEFAULT_RESUME_CONTENT, summary: 'V2 SUMMARY' };
    dbState.versions = [versionRow('v1', 'Primary'), versionRow('v2', 'Second', v2content)];
    const { result } = renderHook(() => useResumeData(session));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.switchVersion('v2'));
    expect(result.current.activeVersionId).toBe('v2');
    expect(result.current.content.summary).toBe('V2 SUMMARY');
  });
});
