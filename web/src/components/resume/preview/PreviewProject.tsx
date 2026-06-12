import type { ResumeSectionItem } from '@/types/resume.types';
import { renderInlineMarkdown, normalizeBulletText } from './inlineMarkdown';

interface Props {
  item: ResumeSectionItem;
  fontSize: number;
  lineSpacing: number;
}

export default function PreviewProject({ item, fontSize, lineSpacing }: Props) {
  return (
    <div style={{ marginBottom: `${fontSize * 0.5}pt` }}>
      {/* Row: project name (bold) | tech stack (italic) — date right */}
      {(item.projectName || item.techStack || item.dateRange) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: `${fontSize}pt` }}>
            {item.projectName && <strong>{item.projectName}</strong>}
            {item.techStack && (
              <span style={{ fontWeight: 'normal' }}>
                {item.projectName ? ' | ' : ''}
                <em>{item.techStack}</em>
              </span>
            )}
          </span>
          {item.dateRange && (
            <span style={{ fontSize: `${fontSize}pt`, fontWeight: 'bold' }}>
              {item.dateRange}
            </span>
          )}
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
