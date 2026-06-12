import type { ResumeSectionItem } from '@/types/resume.types';
import { renderInlineMarkdown, normalizeBulletText } from './inlineMarkdown';

interface Props {
  item: ResumeSectionItem;
  fontSize: number;
  lineSpacing: number;
}

export default function PreviewExperience({ item, fontSize, lineSpacing }: Props) {
  return (
    <div style={{ marginBottom: `${fontSize * 0.5}pt` }}>
      {/* Row 1: org (bold left) + date (bold right) — only if at least one is present */}
      {(item.organization || item.date) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 'bold', fontSize: `${fontSize}pt` }}>
            {item.organization}
          </span>
          <span style={{ fontWeight: 'bold', fontSize: `${fontSize}pt` }}>
            {item.date}
          </span>
        </div>
      )}
      {/* Row 2: role (italic left) + location (italic right) — only if at least one is present */}
      {(item.role || item.location) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontStyle: 'italic', fontSize: `${fontSize}pt` }}>
            {item.role}
          </span>
          <span style={{ fontStyle: 'italic', fontSize: `${fontSize}pt` }}>
            {item.location}
          </span>
        </div>
      )}
      {/* Bullets */}
      {item.bullets && item.bullets.length > 0 && (
        <ul
          style={{
            listStyleType: 'disc',
            listStylePosition: 'outside',
            marginTop: `${fontSize * 0.15}pt`,
            marginBottom: 0,
            paddingLeft: `${fontSize * 1.2}pt`,
            lineHeight: lineSpacing,
          }}
        >
          {item.bullets.map((b) => (
            <li
              key={b.id}
              style={{
                fontSize: `${fontSize}pt`,
                marginBottom: `${fontSize * 0.1}pt`,
                paddingLeft: '2pt',
              }}
            >
              <span dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(normalizeBulletText(b.text)) }} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
