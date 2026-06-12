import { useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useResumeData } from '@/hooks/useResumeData';
import { useAutoFit } from '@/hooks/useAutoFit';
import { usePDFExport } from '@/components/resume/export/generatePDF';
import ResumeToolbar from './toolbar/ResumeToolbar';
import EditorPanel from './editor/EditorPanel';
import PreviewPanel from './preview/PreviewPanel';

interface Props {
  session: Session;
}

export default function ResumeBuilderLayout({ session }: Props) {
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
  } = useResumeData(session);

  const printRef = useRef<HTMLDivElement>(null);

  useAutoFit({
    previewRef: printRef,
    settings,
    setSettings,
    enabled: settings.autoFitOnePage,
  });

  const activeVersion = versions.find((v) => v.id === activeVersionId);

  const handlePrint = usePDFExport({
    versionName: activeVersion?.version_name ?? 'Resume',
    content,
    settings,
    token: session.access_token,
  });

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Loading resume...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
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
      />

      <div className="flex flex-1 overflow-hidden md:flex-row flex-col">
        {/* Left: Editor */}
        <div className="md:w-[380px] w-full md:border-r border-border shrink-0 overflow-hidden flex flex-col">
          <EditorPanel
            content={content}
            settings={settings}
            onContentChange={setContent}
            onSettingsChange={setSettings}
          />
        </div>

        {/* Right: Preview */}
        <div className="flex-1 min-h-0 flex flex-col">
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
