import { useState } from 'react';
import type { ResumeBuilderData, ResumeContent } from '@/types/resume.types';
import type { SaveStatus } from '@/hooks/useResumeData';
import VersionSelector from './VersionSelector';
import { generateLatex } from '@/components/resume/export/generateLatex';

interface Props {
  versions: ResumeBuilderData[];
  activeVersionId: string | null;
  content: ResumeContent;
  saveStatus: SaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => Promise<void>;
  onPrint: (() => void) | ((e?: unknown) => void);
  onSwitchVersion: (id: string) => void;
  onCreateVersion: (name: string) => Promise<void>;
  onDeleteVersion: (id: string) => Promise<void>;
  onRenameVersion: (id: string, name: string) => Promise<void>;
  // Live scoring (content-addressed, against this version's JD)
  liveScore: number | null;
  scoring: boolean;
  scoreStale: boolean;
  liveScoreOn: boolean;
  onToggleLiveScore: () => void;
  onRerank: () => void;       // force a fresh score of the live content
  onReassemble: () => void;   // re-optimize into a NEW version
  reassembling: boolean;
  scoringDisabledReason: string | null;
}

function ScoreChip({ score, stale }: { score: number | null; stale: boolean }) {
  if (score == null) return null;
  const cls =
    score >= 75 ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : score >= 50 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    : 'bg-red-500/15 text-red-400 border-red-500/30';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums ${cls} ${stale ? 'opacity-50' : ''}`}
      title={stale ? 'Resume changed since this score — re-ranking…' : 'Score of the live resume against this version’s job description'}
    >
      {score}<span className="font-normal opacity-70">/100</span>
    </span>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'saving') return <span className="text-xs text-muted-foreground animate-pulse">Saving...</span>;
  if (status === 'saved') return <span className="text-xs text-green-500">✓ Saved</span>;
  if (status === 'error') return <span className="text-xs text-destructive">Save failed</span>;
  return null;
}

export default function ResumeToolbar({
  versions,
  activeVersionId,
  content,
  saveStatus,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
  onPrint,
  onSwitchVersion,
  onCreateVersion,
  onDeleteVersion,
  onRenameVersion,
  liveScore,
  scoring,
  scoreStale,
  liveScoreOn,
  onToggleLiveScore,
  onRerank,
  onReassemble,
  reassembling,
  scoringDisabledReason,
}: Props) {
  const [copyLatexDone, setCopyLatexDone] = useState(false);

  const handleCopyLatex = () => {
    const latex = generateLatex(content);
    navigator.clipboard.writeText(latex).then(() => {
      setCopyLatexDone(true);
      setTimeout(() => setCopyLatexDone(false), 2000);
    });
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-background shrink-0 flex-wrap">
      {/* Version selector */}
      <VersionSelector
        versions={versions}
        activeVersionId={activeVersionId}
        onSwitch={onSwitchVersion}
        onCreate={onCreateVersion}
        onDelete={onDeleteVersion}
        onRename={onRenameVersion}
      />

      <div className="h-5 w-px bg-border" />

      {/* Undo / Redo */}
      <button
        type="button"
        disabled={!canUndo}
        onClick={onUndo}
        className="h-7 w-7 flex items-center justify-center rounded text-sm text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Undo"
        aria-label="Undo"
      >↩</button>
      <button
        type="button"
        disabled={!canRedo}
        onClick={onRedo}
        className="h-7 w-7 flex items-center justify-center rounded text-sm text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Redo"
        aria-label="Redo"
      >↪</button>

      <div className="h-5 w-px bg-border" />

      {/* Save status + Save button */}
      <SaveIndicator status={saveStatus} />
      <button
        type="button"
        onClick={onSave}
        className="h-7 px-3 text-xs font-medium border border-border rounded-md text-foreground hover:bg-muted transition-colors"
      >
        Save
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* ── Live score ──────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2"
        title={scoringDisabledReason ?? undefined}
      >
        <ScoreChip score={liveScore} stale={scoreStale} />

        {/* Live score toggle (controls automatic LLM spend) */}
        <label
          className={`flex items-center gap-1 text-xs select-none ${scoringDisabledReason ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer text-muted-foreground'}`}
          title={scoringDisabledReason ?? 'Automatically re-score after edits settle'}
        >
          <input
            type="checkbox"
            checked={liveScoreOn}
            disabled={!!scoringDisabledReason}
            onChange={onToggleLiveScore}
            className="h-3 w-3 accent-primary"
          />
          Live score
        </label>

        {/* Manual force-refresh score (pure scoring — never mutates content) */}
        <button
          type="button"
          onClick={onRerank}
          disabled={scoring || !!scoringDisabledReason}
          title={scoringDisabledReason ?? 'Re-score the current resume against this version’s job description'}
          className="h-7 px-3 text-xs font-medium border border-primary/40 text-primary rounded-md hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
        >
          {scoring ? (
            <>
              <span className="h-3 w-3 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
              Scoring…
            </>
          ) : (
            <>⟳ Re-rank</>
          )}
        </button>

        {/* Re-assemble → NEW version (separate from scoring) */}
        <button
          type="button"
          onClick={onReassemble}
          disabled={reassembling || !!scoringDisabledReason}
          title={scoringDisabledReason ?? 'Re-optimize this resume against the job description into a new version'}
          className="h-7 px-3 text-xs font-medium border border-border rounded-md text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
        >
          {reassembling ? (
            <>
              <span className="h-3 w-3 border-2 border-muted-foreground/40 border-t-foreground rounded-full animate-spin" />
              Re-assembling…
            </>
          ) : (
            <>✦ Re-assemble</>
          )}
        </button>
      </div>

      <div className="h-5 w-px bg-border" />

      {/* Copy LaTeX */}
      <button
        type="button"
        onClick={handleCopyLatex}
        className="h-7 px-3 text-xs font-medium border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        {copyLatexDone ? '✓ Copied!' : 'Copy LaTeX'}
      </button>

      {/* Download PDF */}
      <button
        type="button"
        onClick={onPrint}
        className="h-7 px-3 text-xs font-semibold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
      >
        Download PDF
      </button>
    </div>
  );
}
