import { useState } from 'react';
import type { ResumeContent, ResumeSettings } from '@/types/resume.types';
import HeaderEditor from './HeaderEditor';
import SummaryEditor from './SummaryEditor';
import SectionList from './SectionList';
import TypographyControls from './TypographyControls';

type EditorTab = 'content' | 'style';

interface Props {
  content: ResumeContent;
  settings: ResumeSettings;
  onContentChange: (updated: ResumeContent) => void;
  onSettingsChange: (updated: ResumeSettings) => void;
}

export default function EditorPanel({ content, settings, onContentChange, onSettingsChange }: Props) {
  const [tab, setTab] = useState<EditorTab>('content');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab switcher */}
      <div className="flex border-b border-border shrink-0">
        {(['content', 'style'] as EditorTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-[12px] font-medium capitalize transition-colors ${
              tab === t
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'content' ? 'Content' : 'Typography & Layout'}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {tab === 'content' && (
          <>
            {/* Header */}
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                Header
              </h3>
              <HeaderEditor
                header={content.header}
                onChange={(h) => onContentChange({ ...content, header: h })}
              />
            </section>

            {/* Summary */}
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                Summary
              </h3>
              <SummaryEditor
                summary={content.summary}
                showSummary={content.showSummary}
                onSummaryChange={(s) => onContentChange({ ...content, summary: s })}
                onToggle={(v) => onContentChange({ ...content, showSummary: v })}
              />
            </section>

            {/* Sections */}
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                Sections
              </h3>
              <SectionList content={content} onChange={onContentChange} />
            </section>
          </>
        )}

        {tab === 'style' && (
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              Typography & Layout
            </h3>
            <TypographyControls settings={settings} onChange={onSettingsChange} />
          </section>
        )}
      </div>
    </div>
  );
}
