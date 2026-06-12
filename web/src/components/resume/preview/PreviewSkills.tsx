import type { ResumeSectionItem } from '@/types/resume.types';

interface Props {
  items: ResumeSectionItem[];
  fontSize: number;
  lineSpacing: number;
}

export default function PreviewSkills({ items, fontSize, lineSpacing }: Props) {
  return (
    <ul
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        lineHeight: lineSpacing,
      }}
    >
      {items
        .filter(item => item.category?.trim() && item.items?.trim())
        .map((item) => (
          <li key={item.id} style={{ fontSize: `${fontSize}pt`, marginBottom: `${fontSize * 0.15}pt` }}>
            <strong>{item.category}:</strong>
            {' '}
            <span>{item.items}</span>
          </li>
        ))}
    </ul>
  );
}
