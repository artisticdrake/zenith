import { forwardRef } from 'react';
import type { ResumeContent, ResumeSettings } from '@/types/resume.types';
import PreviewHeader from './PreviewHeader';
import PreviewSection from './PreviewSection';
import { renderInlineMarkdown } from './inlineMarkdown';

interface Props {
  content: ResumeContent;
  settings: ResumeSettings;
}

export const FONT_MAP: Record<string, string> = {
  charter:      "'Charter', 'Bitstream Charter', Georgia, serif",
  garamond:     "'EB Garamond', Garamond, serif",
  baskerville:  "'Libre Baskerville', Baskerville, Georgia, serif",
  merriweather: "'Merriweather', Georgia, serif",
  ptserif:      "'PT Serif', Georgia, serif",
  palatino:     "'Palatino Linotype', Palatino, 'Book Antiqua', serif",
  georgia:      "Georgia, serif",
  times:        "'Times New Roman', Times, serif",
  lato:         "'Lato', 'Helvetica Neue', Arial, sans-serif",
  sourcesans:   "'Source Sans 3', 'Source Sans Pro', 'Helvetica Neue', Arial, sans-serif",
  helvetica:    "'Helvetica Neue', Arial, sans-serif",
};

const ResumePreview = forwardRef<HTMLDivElement, Props>(({ content, settings }, ref) => {
  const { fontSize, fontFamily, lineSpacing, marginSize, headerAlign = 'center' } = settings;

  const fontStack = FONT_MAP[fontFamily] ?? FONT_MAP.charter;
  const marginPt = marginSize * 72;

  const pageStyle: React.CSSProperties = {
    fontFamily: fontStack,
    fontSize: `${fontSize}pt`,
    lineHeight: lineSpacing,
    color: '#000',
    background: '#fff',
    width: '8.5in',
    minHeight: '11in',
    padding: `${marginPt}pt`,
    boxSizing: 'border-box',
    position: 'relative',
  };

  return (
    <div ref={ref} style={pageStyle}>
      <PreviewHeader header={content.header} fontSize={fontSize} align={headerAlign} />

      {content.showSummary && content.summary && (
        <div style={{ marginBottom: `${settings.sectionSpacing * 0.5}pt` }}>
          <div style={{ marginTop: `${settings.sectionSpacing}pt` }}>
            <div style={{
              fontSize: `${fontSize * 1.15}pt`,
              fontVariant: 'small-caps',
              fontWeight: 'bold',
              letterSpacing: '0.03em',
              lineHeight: 1.2,
            }}>Summary</div>
            <div style={{ borderTop: '1pt solid #000', marginBottom: '2pt' }} />
          </div>
          <div
            style={{ fontSize: `${fontSize}pt`, lineHeight: lineSpacing }}
            dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(content.summary) }}
          />
        </div>
      )}

      {content.sections.map((section) => (
        <PreviewSection key={section.id} section={section} settings={settings} />
      ))}
    </div>
  );
});

ResumePreview.displayName = 'ResumePreview';

export default ResumePreview;
