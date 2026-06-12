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
