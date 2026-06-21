/**
 * coverLetterToHtml.ts
 *
 * Converts a generated cover-letter body (+ optional footer) into a fully
 * self-contained HTML string that Puppeteer renders to a text-native PDF.
 * Mirrors resumeToHtml.ts's style and HTML-escaping discipline so the letter
 * shares the candidate's identity (letterhead) with their resume.
 *
 * Layout (proper business letter, single column, guaranteed one page):
 *   Letterhead : candidate name (large) + contact line (phone, email, linkedin, portfolio)
 *   Date       : today's date
 *   Recipient  : company block + "Re: Application for <role>" — each only if known
 *                (the Re: line is OMITTED entirely when the role is unknown)
 *   Body       : the letter text, split into paragraphs on blank lines.
 *                The greeting ("Dear Hiring Manager,") is the body's first block,
 *                so it is NOT injected here (avoids a duplicate greeting).
 *   Closing    : "Sincerely," + signature space + candidate name (ONCE) + an
 *                optional credential line beneath the name. The whole closing is
 *                page-break-avoided so the signature never orphans onto page 2.
 */

export interface CoverLetterHeader {
  name?: string;
  phone?: string;
  email?: string;
  linkedin?: string;
  portfolio?: string;
}

export interface CoverLetterOptions {
  header: CoverLetterHeader;
  body: string;
  /** Optional credential line rendered UNDER the signature name (e.g. a degree).
   *  Must NOT contain the name — the template renders the name itself. Persisted
   *  in the `footer` column for backward compatibility. */
  footer?: string;
  company?: string;
  role?: string;
}

// ── Font stack (matches resumeToHtml's serif default + Google Fonts) ───────────

const FONT_STACK = "'PT Serif', Charter, 'Bitstream Charter', Georgia, 'Times New Roman', serif";
const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=PT+Serif:ital,wght@0,400;0,700;1,400;1,700&display=swap';

// ── HTML escaping (same rules as resumeToHtml.esc) ─────────────────────────────

function esc(raw: string | undefined | null): string {
  return (raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SAFE_URL = /^(?:https?:\/\/|mailto:|tel:)/i;
const BARE_DOMAIN = /^[\w.-]+\.[a-z]{2,}(?:[/?#].*)?$/i;

function sanitizeUrl(raw: string): string | null {
  const url = raw.trim();
  if (SAFE_URL.test(url)) return url;
  if (BARE_DOMAIN.test(url)) return `https://${url}`;
  return null;
}

/** Render a contact value as a link (email/web) or plain escaped text (phone). */
function contactPart(value: string, kind: 'email' | 'phone' | 'web'): string {
  if (kind === 'phone') return esc(value);
  const href = kind === 'email' ? `mailto:${value.trim()}` : sanitizeUrl(value);
  if (!href) return esc(value);
  return `<a href="${href.replace(/"/g, '%22')}" style="color:inherit;text-decoration:underline">${esc(value)}</a>`;
}

// ── Body → paragraphs ──────────────────────────────────────────────────────────

/** Split the letter into paragraphs on blank lines; collapse single newlines. */
function bodyParagraphs(raw: string): string[] {
  return (raw ?? '')
    .replace(/\r\n|\r/g, '\n')
    .split(/\n{2,}/)
    .map(p => p.split('\n').map(l => l.trim()).filter(Boolean).join(' ').trim())
    .filter(Boolean);
}

// ── Date ────────────────────────────────────────────────────────────────────────

function todayLong(): string {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ── Main export ───────────────────────────────────────────────────────────────

export function coverLetterToHtml(opts: CoverLetterOptions): string {
  const { header, body, footer } = opts;
  const company = (opts.company ?? '').trim();
  const role = (opts.role ?? '').trim();
  const name = (header.name ?? '').trim();

  const fs = 11;           // base font size, pt
  const ls = 1.35;         // line spacing — tight enough that ~300 words fit one page
  const marginPt = 72;     // 1in margins

  // Letterhead — name + contact line (email/web as links, phone plain).
  const contactParts = [
    header.phone ? contactPart(header.phone, 'phone') : '',
    header.email ? contactPart(header.email, 'email') : '',
    header.linkedin ? contactPart(header.linkedin, 'web') : '',
    header.portfolio ? contactPart(header.portfolio, 'web') : '',
  ].filter(Boolean);

  const letterheadHtml = `
    <div style="text-align:center;margin-bottom:${fs * 1.1}pt;padding-bottom:${fs * 0.5}pt;border-bottom:1pt solid #000">
      <div style="font-size:${fs * 2}pt;font-variant:small-caps;font-weight:bold;letter-spacing:0.04em;line-height:1.1">
        ${esc(name) || 'Your Name'}
      </div>
      ${contactParts.length
        ? `<div style="font-size:${fs * 0.92}pt;color:#222;line-height:1.3;margin-top:${fs * 0.25}pt">${contactParts.join(' &nbsp;|&nbsp; ')}</div>`
        : ''}
    </div>`;

  const dateHtml = `<div style="font-size:${fs}pt;margin-bottom:${fs * 0.9}pt">${esc(todayLong())}</div>`;

  // Recipient block — rendered only when the company is known.
  const recipientHtml = company
    ? `<div style="font-size:${fs}pt;line-height:1.35;margin-bottom:${fs * 0.6}pt">
         <div>Hiring Team</div>
         <div>${esc(company)}</div>
       </div>`
    : '';

  // Re: line — OMITTED entirely when the role is unknown (no generic placeholder).
  const reHtml = role
    ? `<div style="font-size:${fs}pt;font-weight:bold;margin-bottom:${fs * 0.9}pt">Re: Application for ${esc(role)}</div>`
    : '';

  // Body paragraphs (greeting is the body's first block — not injected here).
  const bodyHtml = bodyParagraphs(body)
    .map(p => `<p style="font-size:${fs}pt;line-height:${ls};margin-bottom:${fs * 0.7}pt">${esc(p)}</p>`)
    .join('\n');

  // Closing — "Sincerely," + signature space + the candidate name ONCE + an
  // optional credential line beneath it. page-break-inside:avoid keeps the whole
  // block together so the signature never orphans onto a second page.
  const credential = (footer ?? '').trim();
  const closingHtml = `
    <div style="font-size:${fs}pt;line-height:${ls};margin-top:${fs * 1.0}pt;page-break-inside:avoid">
      <div>Sincerely,</div>
      <div style="height:${fs * 2.2}pt"></div>
      <div style="font-weight:bold">${esc(name)}</div>
      ${credential
        ? `<div style="font-size:${fs * 0.9}pt;color:#333;line-height:1.3">${esc(credential)}</div>`
        : ''}
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${GOOGLE_FONTS_URL}" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: 8.5in 11in; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: ${FONT_STACK}; font-size: ${fs}pt; line-height: ${ls}; color: #000; background: #fff; }
  strong { font-weight: bold; }
  em { font-style: italic; }
  p { margin: 0; }
  .page {
    width: 8.5in;
    min-height: 11in;
    padding: ${marginPt}pt;
    background: #fff;
    position: relative;
  }
  .letter { max-width: 6.5in; margin: 0 auto; }
</style>
</head>
<body>
<div class="page">
  <div class="letter">
    ${letterheadHtml}
    ${dateHtml}
    ${recipientHtml}
    ${reHtml}
    ${bodyHtml}
    ${closingHtml}
  </div>
</div>
</body>
</html>`;
}
