// Simple inline markdown parser — no external library
// Supports **bold**, *italic*, and [label](url) links

const SAFE_URL = /^(?:https?:\/\/|mailto:|tel:)/i;
const BARE_DOMAIN = /^[\w.-]+\.[a-z]{2,}(?:[/?#].*)?$/i;
// Matches a markdown link, capturing the label and the URL (URL may not contain
// whitespace or a closing paren).
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/**
 * Normalize a user-supplied URL to a safe, absolute form, or return null if it
 * uses an unsafe scheme (e.g. javascript:). A bare domain gets an https:// prefix.
 */
export function sanitizeUrl(raw: string): string | null {
  const url = raw.trim();
  if (SAFE_URL.test(url)) return url;
  if (BARE_DOMAIN.test(url)) return `https://${url}`;
  return null;
}

/** Build the contact href for a header field. */
export function contactHref(value: string, kind: 'email' | 'phone' | 'web'): string | null {
  const v = value.trim();
  if (!v) return null;
  if (kind === 'email') return `mailto:${v}`;
  if (kind === 'phone') {
    const digits = v.replace(/[^\d+]/g, '');
    return digits ? `tel:${digits}` : null;
  }
  return sanitizeUrl(v);
}

function emphasis(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

// Private-use sentinels bracket a link index so the generated <a> tag (and its
// href) is never seen by the bold/italic passes — a URL containing * or ** must
// not be mangled into <em>/<strong>.
const L_OPEN = '';
const L_CLOSE = '';

export function renderInlineMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const links: string[] = [];
  const withPlaceholders = escaped.replace(LINK_RE, (_match, label: string, url: string) => {
    const idx = links.length;
    const renderedLabel = emphasis(label); // bold/italic still work inside labels
    const safe = sanitizeUrl(url);
    links.push(
      safe
        ? `<a href="${safe.replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline">${renderedLabel}</a>`
        : renderedLabel // unsafe URL: drop the link, keep the visible label text
    );
    return `${L_OPEN}${idx}${L_CLOSE}`;
  });

  const emphasized = emphasis(withPlaceholders);
  return emphasized.replace(new RegExp(`${L_OPEN}(\\d+)${L_CLOSE}`, 'g'), (_m, i) => links[Number(i)]);
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
