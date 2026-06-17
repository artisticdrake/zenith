import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { normalizeResumeContent, normalizeResumeSettings } from '@/lib/normalizeResume';
import type { Session } from '@supabase/supabase-js';
import {
  DEFAULT_RESUME_CONTENT,
  DEFAULT_SETTINGS,
  type ResumeBuilderData,
  type ResumeContent,
  type ResumeEditorAction,
  type ResumeEditorState,
  type ResumeSettings,
} from '@/types/resume.types';

// ── Undo/redo reducer ────────────────────────────────────────────────────────

const MAX_HISTORY = 20;

function resumeReducer(state: ResumeEditorState, action: ResumeEditorAction): ResumeEditorState {
  switch (action.type) {
    case 'SET': {
      const past = [...state.past, state.present].slice(-MAX_HISTORY);
      return { past, present: action.payload, future: [] };
    }
    case 'UNDO': {
      if (!state.past.length) return state;
      const past = state.past.slice(0, -1);
      const present = state.past[state.past.length - 1];
      const future = [state.present, ...state.future];
      return { past, present, future };
    }
    case 'REDO': {
      if (!state.future.length) return state;
      const [present, ...future] = state.future;
      const past = [...state.past, state.present];
      return { past, present, future };
    }
    case 'RESET':
      return { past: [], present: action.payload, future: [] };
    default:
      return state;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseResumeDataReturn {
  versions: ResumeBuilderData[];
  activeVersionId: string | null;
  content: ResumeContent;
  settings: ResumeSettings;
  saveStatus: SaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  loading: boolean;
  setContent: (content: ResumeContent) => void;
  setSettings: (settings: ResumeSettings) => void;
  undo: () => void;
  redo: () => void;
  saveNow: () => Promise<void>;
  createVersion: (name: string) => Promise<void>;
  deleteVersion: (id: string) => Promise<void>;
  renameVersion: (id: string, name: string) => Promise<void>;
  switchVersion: (id: string) => void;
  adoptServerVersion: (row: ResumeBuilderData) => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useResumeData(session: Session | null): UseResumeDataReturn {
  const userId = session?.user?.id ?? '';
  const token = session?.access_token ?? '';

  const [versions, setVersions] = useState<ResumeBuilderData[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [settings, setSettingsState] = useState<ResumeSettings>(DEFAULT_SETTINGS);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [loading, setLoading] = useState(true);

  const [editorState, dispatch] = useReducer(resumeReducer, {
    past: [],
    present: DEFAULT_RESUME_CONTENT,
    future: [],
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeVersionIdRef = useRef<string | null>(null);
  activeVersionIdRef.current = activeVersionId;

  // ── Fetch all versions ───────────────────────────────────────────────────
  const fetchVersions = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      await supabase.auth.setSession({ access_token: token, refresh_token: session?.refresh_token ?? '' });
      const { data, error } = await supabase
        .from('resume_builder')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      const fetched = (data ?? []) as ResumeBuilderData[];
      setVersions(fetched);

      // Load the newest version as the active resume. The Tailor "Send to
      // Builder" flow assembles a fresh version server-side (POST /assemble/claude)
      // before this runs, so it lands first here and becomes the active resume.
      if (fetched.length > 0) {
        const first = fetched[0];
        setActiveVersionId(first.id);
        dispatch({
          type: 'RESET',
          payload: first.content ? normalizeResumeContent(first.content) : DEFAULT_RESUME_CONTENT,
        });
        setSettingsState(normalizeResumeSettings(first.settings));
      } else {
        await createVersionInternal('My Resume', DEFAULT_RESUME_CONTENT, DEFAULT_SETTINGS);
      }
    } catch (err) {
      console.error('[useResumeData] fetchVersions error:', err);
    } finally {
      setLoading(false);
    }
  }, [userId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (userId && token) fetchVersions();
  }, [userId, token, fetchVersions]);

  // ── Internal create ──────────────────────────────────────────────────────
  const createVersionInternal = async (
    name: string,
    content: ResumeContent,
    s: ResumeSettings
  ) => {
    const row: Record<string, unknown> = {
      user_id: userId,
      version_name: name,
      content,
      settings: s,
    };

    const { data, error } = await supabase.from('resume_builder').insert(row).select().single();
    if (error) throw error;
    const created = data as ResumeBuilderData;
    setVersions((prev) => [created, ...prev]);
    setActiveVersionId(created.id);
    dispatch({ type: 'RESET', payload: content });
    setSettingsState(s);
    return created;
  };

  // ── Save current version ─────────────────────────────────────────────────
  const saveNow = useCallback(async () => {
    const vid = activeVersionIdRef.current;
    if (!vid || !userId) return;
    setSaveStatus('saving');
    try {
      const { error } = await supabase
        .from('resume_builder')
        .update({ content: editorState.present, settings })
        .eq('id', vid)
        .eq('user_id', userId);
      if (error) throw error;
      setSaveStatus('saved');
      setVersions((prev) =>
        prev.map((v) => (v.id === vid ? { ...v, content: editorState.present, settings } : v))
      );
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('[useResumeData] save error:', err);
      setSaveStatus('error');
    }
  }, [editorState.present, settings, userId]);

  // ── Debounced auto-save ──────────────────────────────────────────────────
  const scheduleAutoSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => saveNow(), 1500);
  }, [saveNow]);

  // ── Public content/settings setters ─────────────────────────────────────
  const setContent = useCallback(
    (newContent: ResumeContent) => {
      dispatch({ type: 'SET', payload: newContent });
      scheduleAutoSave();
    },
    [scheduleAutoSave]
  );

  const setSettings = useCallback(
    (newSettings: ResumeSettings) => {
      setSettingsState(newSettings);
      scheduleAutoSave();
    },
    [scheduleAutoSave]
  );

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);

  // ── Version management ───────────────────────────────────────────────────
  const createVersion = useCallback(
    async (name: string) => {
      await createVersionInternal(name, DEFAULT_RESUME_CONTENT, DEFAULT_SETTINGS);
    },
    [userId] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const deleteVersion = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from('resume_builder')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);
      if (error) throw error;
      setVersions((prev) => {
        const remaining = prev.filter((v) => v.id !== id);
        if (activeVersionIdRef.current === id && remaining.length > 0) {
          setActiveVersionId(remaining[0].id);
          dispatch({
            type: 'RESET',
            payload: remaining[0].content ? normalizeResumeContent(remaining[0].content) : DEFAULT_RESUME_CONTENT,
          });
          setSettingsState(normalizeResumeSettings(remaining[0].settings));
        }
        return remaining;
      });
    },
    [userId]
  );

  const renameVersion = useCallback(
    async (id: string, name: string) => {
      const { error } = await supabase
        .from('resume_builder')
        .update({ version_name: name })
        .eq('id', id)
        .eq('user_id', userId);
      if (error) throw error;
      setVersions((prev) => prev.map((v) => (v.id === id ? { ...v, version_name: name } : v)));
    },
    [userId]
  );

  const switchVersion = useCallback(
    (id: string) => {
      const version = versions.find((v) => v.id === id);
      if (!version) return;
      setActiveVersionId(id);
      dispatch({
        type: 'RESET',
        payload: version.content ? normalizeResumeContent(version.content) : DEFAULT_RESUME_CONTENT,
      });
      setSettingsState(normalizeResumeSettings(version.settings));
    },
    [versions]
  );

  // Adopt a version the server just created (e.g. /assemble's "Re-assemble").
  // The row is already persisted — we only mirror it into local state and make
  // it the active resume, without overwriting any existing version.
  const adoptServerVersion = useCallback((row: ResumeBuilderData) => {
    const normalized: ResumeBuilderData = {
      ...row,
      content: normalizeResumeContent(row.content),
      settings: normalizeResumeSettings(row.settings),
    };
    setVersions((prev) => [normalized, ...prev.filter((v) => v.id !== normalized.id)]);
    setActiveVersionId(normalized.id);
    dispatch({ type: 'RESET', payload: normalized.content });
    setSettingsState(normalized.settings);
  }, []);

  return {
    versions,
    activeVersionId,
    content: editorState.present,
    settings,
    saveStatus,
    canUndo: editorState.past.length > 0,
    canRedo: editorState.future.length > 0,
    loading,
    setContent,
    setSettings,
    undo,
    redo,
    saveNow,
    createVersion,
    deleteVersion,
    renameVersion,
    switchVersion,
    adoptServerVersion,
  };
}
