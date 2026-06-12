import type { ResumeHeader } from '@/types/resume.types';

interface Props {
  header: ResumeHeader;
  fontSize: number;
  align?: 'center' | 'left';
}

export default function PreviewHeader({ header, fontSize, align = 'center' }: Props) {
  const contactParts: string[] = [];
  if (header.phone) contactParts.push(header.phone);
  if (header.email) contactParts.push(header.email);
  if (header.linkedin) contactParts.push(header.linkedin);
  if (header.github) contactParts.push(header.github);
  if (header.portfolio) contactParts.push(header.portfolio);

  return (
    <div style={{ textAlign: align, marginBottom: `${fontSize * 0.6}pt` }}>
      <div
        style={{
          fontSize: `${fontSize * 2.2}pt`,
          fontVariant: 'small-caps',
          fontWeight: 'bold',
          letterSpacing: '0.04em',
          marginBottom: `${fontSize * 0.25}pt`,
          lineHeight: 1.1,
        }}
      >
        {header.name || 'Your Name'}
      </div>
      {header.title && (
        <div
          style={{
            fontSize: `${fontSize * 1.05}pt`,
            fontWeight: 'normal',
            marginBottom: `${fontSize * 0.2}pt`,
            lineHeight: 1.2,
          }}
        >
          {header.title}
        </div>
      )}
      {contactParts.length > 0 && (
        <div
          style={{
            fontSize: `${fontSize * 0.95}pt`,
            color: '#222',
            lineHeight: 1.3,
          }}
        >
          {contactParts.join(' | ')}
        </div>
      )}
    </div>
  );
}
