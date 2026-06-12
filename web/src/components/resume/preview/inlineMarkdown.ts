// Simple inline markdown parser — no external library
// Supports **bold** and *italic* only

export function renderInlineMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const withBold = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const withItalic = withBold.replace(/\*(.+?)\*/g, '<em>$1</em>');

  return withItalic;
}

/**
 * Collapse embedded newlines so a bullet always renders as one sentence,
 * matching the normalization applied in resumeToHtml.ts on the PDF path.
 */
export function normalizeBulletText(raw: string | undefined | null): string {
  return (raw ?? '')
    .replace(/\r\n|\r/g, '\n')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
