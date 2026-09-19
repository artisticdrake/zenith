import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import type { AssembleResult } from '@/components/tabs/TailorTab';
import { useResumeData } from '@/hooks/useResumeData';
import { useAutoFit } from '@/hooks/useAutoFit';
import { usePDFExport } from '@/components/resume/export/generatePDF';
import { cn } from '@/lib/utils';
import { generationRequest } from '@/lib/generationRequest';
import ResumeToolbar from './toolbar/ResumeToolbar';
import EditorPanel from './editor/EditorPanel';
import PreviewPanel from './preview/PreviewPanel';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface Props {
  session: Session;
  assembleResult?: AssembleResult | null;
  onDismissAssemble?: () => void;
  targetVersionId?: string | null;
  onConsumeTargetVersion?: () => void;
}

function AssembleBanner({ result, onDismiss }: { result: AssembleResult; onDismiss?: () => void }) {
  const score = result.score;
  const tone = score == null ? "text-primary"
    : score >= 75 ? "text-emerald-400"
    : score >= 50 ? "text-amber-400"
    : "text-red-400";
  return (
    <div className="border-b border-primary/20 bg-primary/5 px-4 py-3">
      <div className="flex items-start gap-3">
        <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-foreground">Fresh resume assembled</span>
            {score != null && (
              <span className={`text-[12px] font-black tabular-nums ${tone}`}>
                {score}<span className="text-muted-foreground font-normal">/100</span>
              </span>
            )}
          </div>
          {result.changeLog.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {result.changeLog.map((c, i) => (
                <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                  <span className="text-primary/60 shrink-0">•</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-[10.5px] text-muted-foreground/70">
            Saved as a new version — your previous resume is untouched (switch versions in the toolbar to compare).
          </p>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            title="Dismiss"
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function ResumeBuilderLayout({ session, assembleResult, onDismissAssemble, targetVersionId, onConsumeTargetVersion }: Props) {
  const {
    versions,
    activeVersionId,
    content,
    settings,
    saveStatus,
    canUndo,
    canRedo,
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
  } = useResumeData(session, targetVersionId);

  // Fire once at mount to clear the parent's held target id — otherwise the
  // next normal visit to this tab (via the sidebar, not "View Resume") would
  // remount with the same stale id and wrongly re-target that old version.
  useEffect(() => {
    if (targetVersionId) onConsumeTargetVersion?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const printRef = useRef<HTMLDivElement>(null);

  useAutoFit({
    previewRef: printRef,
    settings,
    setSettings,
    enabled: settings.autoFitOnePage,
  });

  const activeVersion = versions.find((v) => v.id === activeVersionId);

  // Mobile only — the editor and preview each need the full viewport height to
  // scroll properly, so on phones they're shown one at a time instead of
  // stacked (stacking left both without a bounded height to scroll within).
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit');

  const handlePrint = usePDFExport({
    versionName: activeVersion?.version_name ?? 'Resume',
    content,
    settings,
    token: session.access_token,
  });

  // ── Live score (content-addressed, scored against this version's JD) ─────────
  const jd = (activeVersion?.job_description ?? '').trim();
  const scoringDisabledReason = jd ? null : 'No target job description for this version.';

  const [liveScore, setLiveScore] = useState<number | null>(assembleResult?.score ?? null);
  const [scoring, setScoring] = useState(false);
  const [reassembling, setReassembling] = useState(false);
  const [banner, setBanner] = useState<AssembleResult | null>(assembleResult ?? null);

  const lastScoredJson = useRef<string | null>(null);
  const prevVersionId = useRef<string | null>(activeVersionId);

  // Surface a fresh assemble banner arriving via props.
  useEffect(() => { if (assembleResult) setBanner(assembleResult); }, [assembleResult]);

  // Switching to a different version invalidates the shown score.
  useEffect(() => {
    if (prevVersionId.current && prevVersionId.current !== activeVersionId) {
      setLiveScore(null);
      lastScoredJson.current = null;
    }
    prevVersionId.current = activeVersionId;
  }, [activeVersionId]);

  // Score the LIVE rendered content against this version's JD. Only called from the
  // "Score now" button onClick — no effect/timer/on-change/on-blur may call this.
  // Cache hit (same rendered text + JD as last score) short-circuits without a Claude call.
  const scoreContent = useCallback(async (force: boolean) => {
    if (!jd) return;
    const json = JSON.stringify(content);
    if (!force && json === lastScoredJson.current) return;
    setScoring(true);
    try {
      const res = await fetch(`${API}/rerank/claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ jobDescription: jd, resumeContent: content }),
      });
      const data = await res.json();
      if (data.success) {
        setLiveScore(typeof data.score === 'number' ? data.score : (data.review?.matchScore ?? null));
        lastScoredJson.current = json;
      }
    } catch { /* leave the prior score in place */ } finally {
      setScoring(false);
    }
  }, [jd, content, session]);

  // Re-assemble: re-optimize the CURRENT content against this version's JD into a
  // NEW version (never overwrites). Pure scoring (Re-rank) never mutates content.
  const handleReassemble = useCallback(async () => {
    if (!jd) return;
    setReassembling(true);
    try {
      const data = await generationRequest(`${API}/assemble/claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          jobDescription: jd, approvedBullets: [], currentResume: content,
          applicationId: activeVersion?.application_id ?? undefined,
        }),
      });
      adoptServerVersion(data.version);
      setBanner({ score: data.score ?? null, changeLog: data.changeLog ?? [], at: Date.now() });
    } catch (e: any) {
      alert(e?.message || 'Re-assemble failed.');
    } finally {
      setReassembling(false);
    }
  }, [jd, content, session, adoptServerVersion, activeVersion?.application_id]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Loading resume...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {banner && (
        <AssembleBanner
          result={banner}
          onDismiss={() => { setBanner(null); onDismissAssemble?.(); }}
        />
      )}
      <ResumeToolbar
        versions={versions}
        activeVersionId={activeVersionId}
        content={content}
        saveStatus={saveStatus}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onSave={saveNow}
        onPrint={handlePrint}
        onSwitchVersion={switchVersion}
        onCreateVersion={createVersion}
        onDeleteVersion={deleteVersion}
        onRenameVersion={renameVersion}
        liveScore={liveScore}
        scoring={scoring}
        onRerank={() => scoreContent(true)}
        onReassemble={handleReassemble}
        reassembling={reassembling}
        scoringDisabledReason={scoringDisabledReason}
      />

      {/* Mobile-only Edit/Preview toggle */}
      <div className="md:hidden flex items-center gap-1 rounded-lg border border-border bg-card m-2 p-1 shrink-0">
        {(['edit', 'preview'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setMobileView(v)}
            className={cn(
              "flex-1 h-8 rounded-md text-[12px] font-medium capitalize transition-colors",
              mobileView === v ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {v}
          </button>
        ))}
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden md:flex-row flex-col">
        {/* Left: Editor */}
        <div className={cn(
          "md:w-[380px] w-full md:border-r border-border md:shrink-0 overflow-hidden flex-col min-h-0",
          mobileView === "edit" ? "flex flex-1 md:flex-none" : "hidden md:flex md:flex-none"
        )}>
          <EditorPanel
            content={content}
            settings={settings}
            onContentChange={setContent}
            onSettingsChange={setSettings}
          />
        </div>

        {/* Right: Preview */}
        <div className={cn(
          "flex-1 min-h-0 flex-col",
          mobileView === "preview" ? "flex" : "hidden md:flex"
        )}>
          <PreviewPanel
            previewRef={printRef}
            content={content}
            settings={settings}
          />
        </div>
      </div>
    </div>
  );
}
