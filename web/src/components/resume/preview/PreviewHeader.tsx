import type { ResumeHeader } from '@/types/resume.types';
import { contactHref } from './inlineMarkdown';
import { Fragment } from 'react';

interface Props {
  header: ResumeHeader;
  fontSize: number;
  align?: 'center' | 'left';
}

export default function PreviewHeader({ header, fontSize, align = 'center' }: Props) {
  // Phone stays plain text (matches the LaTeX output); the rest become links.
  const contactParts: { value: string; kind: 'email' | 'phone' | 'web' }[] = [];
  if (header.phone) contactParts.push({ value: header.phone, kind: 'phone' });
  if (header.email) contactParts.push({ value: header.email, kind: 'email' });
  if (header.linkedin) contactParts.push({ value: header.linkedin, kind: 'web' });
  if (header.github) contactParts.push({ value: header.github, kind: 'web' });
  if (header.portfolio) contactParts.push({ value: header.portfolio, kind: 'web' });

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
          {contactParts.map((part, i) => {
            const href = contactHref(part.value, part.kind);
            return (
              <Fragment key={i}>
                {i > 0 && ' | '}
                {href && part.kind !== 'phone' ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'inherit', textDecoration: 'underline' }}
                  >
                    {part.value}
                  </a>
                ) : (
                  part.value
                )}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
