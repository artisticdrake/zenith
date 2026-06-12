import type { ResumeSection, ResumeSettings } from '@/types/resume.types';
import PreviewExperience from './PreviewExperience';
import PreviewProject from './PreviewProject';
import PreviewSkills from './PreviewSkills';
import { renderInlineMarkdown } from './inlineMarkdown';

interface Props {
  section: ResumeSection;
  settings: ResumeSettings;
}

export default function PreviewSection({ section, settings }: Props) {
  if (!section.visible) return null;

  const { fontSize, lineSpacing, sectionSpacing } = settings;

  return (
    <div style={{ marginBottom: `${sectionSpacing * 0.5}pt` }}>
      {/* Two-element heading: text + separate rule so html2canvas renders both correctly */}
      <div style={{ marginTop: `${sectionSpacing}pt` }}>
        <div style={{
          fontSize: `${fontSize * 1.15}pt`,
          fontVariant: 'small-caps',
          fontWeight: 'bold',
          letterSpacing: '0.03em',
          lineHeight: 1.2,
        }}>{section.title}</div>
        <div style={{ borderTop: '1pt solid #000', marginBottom: '2pt' }} />
      </div>

      {(section.type === 'education' || section.type === 'experience') &&
        section.items.map((item) => (
          <PreviewExperience
            key={item.id}
            item={item}
            fontSize={fontSize}
            lineSpacing={lineSpacing}
          />
        ))}

      {section.type === 'projects' &&
        section.items.map((item) => (
          <PreviewProject
            key={item.id}
            item={item}
            fontSize={fontSize}
            lineSpacing={lineSpacing}
          />
        ))}

      {section.type === 'skills' && (
        <PreviewSkills items={section.items} fontSize={fontSize} lineSpacing={lineSpacing} />
      )}

      {section.type === 'custom' &&
        section.items.map((item) => (
          <div
            key={item.id}
            style={{ fontSize: `${fontSize}pt`, lineHeight: lineSpacing }}
            dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(item.content ?? '') }}
          />
        ))}
    </div>
  );
}
