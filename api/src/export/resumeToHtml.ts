/**
 * resumeToHtml.ts
 *
 * Converts ResumeContent + ResumeSettings into a fully self-contained HTML string
 * that Puppeteer can render to a text-native PDF.
 *
 * Field mapping (must never be violated):
 *   experience / education item:
 *     Row 1 left  → item.organization   (bold)
 *     Row 1 right → item.date           (bold)
 *     Row 2 left  → item.role           (italic)
 *     Row 2 right → item.location       (italic)
 *     Below       → item.bullets[].text (disc list, markdown rendered)
 *
 *   project item:
 *     Row 1 left  → item.projectName (bold) + " | " + item.techStack (italic)
 *     Row 1 right → item.dateRange   (bold)
 *     Below       → item.bullets[].text
 *
 *   skills item:
 *     "Category: item1, item2, ..."
 *
 * Each item is wrapped in its own <div class="item"> block so items can never
 * bleed into each other's headers or bullet lists.
 */

// ── Types (mirrors web/src/types/resume.types.ts) ────────────────────────────

interface BulletItem { id: string; text: string; }
interface ResumeSectionItem {
  id: string;
  organization?: string; role?: string; location?: string; date?: string;
  bullets?: BulletItem[];
  projectName?: string; techStack?: string; dateRange?: string;
  category?: string; items?: string;
  content?: string;
}
interface ResumeSection { id: string; type: string; title: string; visible: boolean; items: ResumeSectionItem[]; }
interface ResumeHeader { name: string; title: string; phone: string; email: string; linkedin: string; github: string; portfolio: string; }
interface ResumeContent { header: ResumeHeader; summary: string; showSummary: boolean; sections: ResumeSection[]; }
interface ResumeSettings { fontSize: number; fontFamily: string; lineSpacing: number; sectionSpacing: number; marginSize: number; headerAlign: 'center' | 'left'; }

// ── Font mapping ─────────────────────────────────────────────────────────────

const FONT_MAP: Record<string, string> = {
  charter:      "Charter, 'Bitstream Charter', Georgia, 'Times New Roman', serif",
  garamond:     "'EB Garamond', Garamond, Georgia, serif",
  baskerville:  "'Libre Baskerville', Baskerville, Georgia, serif",
  merriweather: "'Merriweather', Georgia, serif",
  ptserif:      "'PT Serif', Georgia, serif",
  palatino:     "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  georgia:      "Georgia, 'Times New Roman', serif",
  times:        "'Times New Roman', Times, Georgia, serif",
  lato:         "'Lato', 'Helvetica Neue', Arial, sans-serif",
  sourcesans:   "'Source Sans 3', 'Source Sans Pro', 'Helvetica Neue', Arial, sans-serif",
  helvetica:    "'Helvetica Neue', Helvetica, Arial, sans-serif",
};

// Google Fonts for fonts not available as system fonts
const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600' +
  '&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400' +
  '&family=Merriweather:ital,wght@0,300;0,400;0,700;1,300;1,400' +
  '&family=PT+Serif:ital,wght@0,400;0,700;1,400;1,700' +
  '&family=Lato:ital,wght@0,300;0,400;0,700;1,300;1,400;1,700' +
  '&family=Source+Sans+3:ital,wght@0,300;0,400;0,600;0,700;1,400' +
  '&display=swap';

// ── HTML escaping and inline markdown ────────────────────────────────────────

function esc(raw: string | undefined | null): string {
  return (raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SAFE_URL = /^(?:https?:\/\/|mailto:|tel:)/i;
const BARE_DOMAIN = /^[\w.-]+\.[a-z]{2,}(?:[/?#].*)?$/i;
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Normalize a URL to a safe absolute form, or null for unsafe schemes. */
function sanitizeUrl(raw: string): string | null {
  const url = raw.trim();
  if (SAFE_URL.test(url)) return url;
  if (BARE_DOMAIN.test(url)) return `https://${url}`;
  return null;
}

function emphasis(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

// Private-use sentinels keep the generated <a> tag (and its href) away from the
// bold/italic passes, so a URL containing * or ** is never mangled.
const L_OPEN = String.fromCharCode(0xe000);
const L_CLOSE = String.fromCharCode(0xe001);
const L_RESTORE = new RegExp(`${L_OPEN}(\\d+)${L_CLOSE}`, 'g');

function md(raw: string | undefined | null): string {
  const escaped = esc(raw);
  const links: string[] = [];
  const withPlaceholders = escaped.replace(LINK_RE, (_m, label: string, url: string) => {
    const idx = links.length;
    const renderedLabel = emphasis(label);
    const safe = sanitizeUrl(url);
    links.push(
      safe
        ? `<a href="${safe.replace(/"/g, '%22')}" style="color:inherit;text-decoration:underline">${renderedLabel}</a>`
        : renderedLabel
    );
    return `${L_OPEN}${idx}${L_CLOSE}`;
  });
  return emphasis(withPlaceholders).replace(L_RESTORE, (_m, i) => links[Number(i)]);
}

/** Render a header contact value as a link (email/web) or plain text (phone). */
function contactPart(value: string, kind: 'email' | 'phone' | 'web'): string {
  if (kind === 'phone') return esc(value);
  const href = kind === 'email' ? `mailto:${value.trim()}` : sanitizeUrl(value);
  if (!href) return esc(value);
  return `<a href="${href.replace(/"/g, '%22')}" style="color:inherit;text-decoration:underline">${esc(value)}</a>`;
}

// ── Text normalization ────────────────────────────────────────────────────────

/**
 * Collapse any embedded newlines so a bullet always renders as one sentence,
 * even if the stored text contains hard-wraps from PDF paste.
 */
function normalizeBulletText(raw: string | undefined | null): string {
  return (raw ?? '')
    .replace(/\r\n|\r/g, '\n')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ── Section renderers ─────────────────────────────────────────────────────────

function renderBullets(bullets: BulletItem[], fs: number, ls: number): string {
  if (!bullets || !bullets.length) return '';
  const items = bullets
    .filter(b => b.text?.trim())
    .map(b => {
      const clean = normalizeBulletText(b.text);
      return `<li style="font-size:${fs}pt;margin-bottom:${fs * 0.1}pt;padding-left:2pt">${md(clean)}</li>`;
    })
    .join('\n');
  if (!items) return '';
  return `
    <ul style="list-style-type:disc;list-style-position:outside;margin:${fs * 0.15}pt 0 0 0;padding-left:${fs * 1.2}pt;line-height:${ls}">
      ${items}
    </ul>`;
}

function renderExperienceItem(item: ResumeSectionItem, fs: number, ls: number): string {
  // Guard: skip entirely if no identifying fields
  if (!item.organization && !item.role && !item.date) return '';

  const row1 = (item.organization || item.date)
    ? `<div style="display:flex;justify-content:space-between;align-items:baseline">
         <span style="font-weight:bold;font-size:${fs}pt">${esc(item.organization)}</span>
         <span style="font-weight:bold;font-size:${fs}pt">${esc(item.date)}</span>
       </div>`
    : '';

  const row2 = (item.role || item.location)
    ? `<div style="display:flex;justify-content:space-between;align-items:baseline">
         <span style="font-style:italic;font-size:${fs}pt">${esc(item.role)}</span>
         <span style="font-style:italic;font-size:${fs}pt">${esc(item.location)}</span>
       </div>`
    : '';

  return `
    <div style="margin-bottom:${fs * 0.5}pt;page-break-inside:avoid">
      ${row1}
      ${row2}
      ${renderBullets(item.bullets ?? [], fs, ls)}
    </div>`;
}

function renderProjectItem(item: ResumeSectionItem, fs: number, ls: number): string {
  if (!item.projectName && !item.techStack && !item.dateRange) return '';

  const nameAndStack = [
    item.projectName ? `<strong>${esc(item.projectName)}</strong>` : '',
    item.techStack   ? ` | <em>${esc(item.techStack)}</em>` : '',
  ].join('');

  const row1 = (item.projectName || item.techStack || item.dateRange)
    ? `<div style="display:flex;justify-content:space-between;align-items:baseline">
         <span style="font-size:${fs}pt">${nameAndStack}</span>
         <span style="font-weight:bold;font-size:${fs}pt">${esc(item.dateRange)}</span>
       </div>`
    : '';

  return `
    <div style="margin-bottom:${fs * 0.5}pt;page-break-inside:avoid">
      ${row1}
      ${renderBullets(item.bullets ?? [], fs, ls)}
    </div>`;
}

function renderSkillsItem(item: ResumeSectionItem, fs: number, ls: number): string {
  // Bug B guard: skip empty skill categories entirely — no "Infrastructure:" header with nothing after it
  if (!item.category?.trim() || !item.items?.trim()) return '';
  return `
    <div style="font-size:${fs}pt;line-height:${ls};margin-bottom:${fs * 0.15}pt">
      <strong>${esc(item.category)}:</strong> ${esc(item.items)}
    </div>`;
}

function renderSection(section: ResumeSection, fs: number, ls: number, sectionSpacing: number): string {
  if (!section.visible) return '';

  const heading = `
    <div style="margin-top:${sectionSpacing}pt;margin-bottom:2pt">
      <div style="font-size:${fs * 1.15}pt;font-variant:small-caps;font-weight:bold;letter-spacing:0.03em;line-height:1.2">${esc(section.title)}</div>
      <div style="border-top:1pt solid #000;margin-bottom:2pt"></div>
    </div>`;

  let body = '';

  if (section.type === 'experience' || section.type === 'education') {
    // Each item is its own self-contained block — headers and bullets are NEVER mixed
    body = section.items.map(item => renderExperienceItem(item, fs, ls)).join('\n');
  } else if (section.type === 'projects') {
    body = section.items.map(item => renderProjectItem(item, fs, ls)).join('\n');
  } else if (section.type === 'skills') {
    // Skills render as "Category: item1, item2" lines — no bullets
    body = `<div style="line-height:${ls}">${section.items.map(item => renderSkillsItem(item, fs, ls)).join('\n')}</div>`;
  } else if (section.type === 'custom') {
    body = section.items.map(item =>
      `<div style="font-size:${fs}pt;line-height:${ls}">${md(item.content)}</div>`
    ).join('\n');
  }

  return `
    <div style="margin-bottom:${sectionSpacing * 0.5}pt">
      ${heading}
      ${body}
    </div>`;
}

// ── Plain-text export (ATS-visible text) ───────────────────────────────────────

/**
 * Strip inline markdown + link syntax to the visible text a reader (or an ATS
 * text extractor) actually sees: a [label](url) link becomes its label, and
 * bold / italic emphasis markers are removed.
 */
function plain(raw: string | undefined | null): string {
  const collapsed = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  return collapsed
    .replace(LINK_RE, (_m, label: string) => label)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1');
}

/**
 * Render ResumeContent to the same plain text the exported PDF exposes to an ATS.
 * This is the canonical object that gets HASHED and SCORED — so the score always
 * reflects exactly what a recruiter's parser reads, and is independent of fonts
 * / spacing / other presentation-only settings.
 *
 * Mirrors the field mapping in resumeContentToHtml (header → summary → sections),
 * applying the same "skip empty item / empty skill category" guards.
 */
export function resumeContentToText(content: ResumeContent): string {
  const lines: string[] = [];
  const h = content.header ?? ({} as ResumeHeader);

  if (h.name) lines.push(plain(h.name));
  if (h.title) lines.push(plain(h.title));
  const contact = [h.phone, h.email, h.linkedin, h.github, h.portfolio]
    .filter(Boolean).map(v => plain(v));
  if (contact.length) lines.push(contact.join(' | '));

  if (content.showSummary && content.summary?.trim()) {
    lines.push('Summary');
    lines.push(plain(content.summary));
  }

  for (const section of content.sections ?? []) {
    if (!section.visible) continue;
    lines.push(plain(section.title));

    for (const item of section.items ?? []) {
      if (section.type === 'skills') {
        if (item.category?.trim() && item.items?.trim()) {
          lines.push(`${plain(item.category)}: ${plain(item.items)}`);
        }
      } else if (section.type === 'projects') {
        if (!item.projectName && !item.techStack && !item.dateRange) continue;
        const head = [item.projectName, item.techStack].filter(Boolean).map(v => plain(v)).join(' | ');
        const row = [head, item.dateRange ? plain(item.dateRange) : ''].filter(Boolean).join('  ');
        if (row) lines.push(row);
        for (const b of item.bullets ?? []) { const t = plain(b.text); if (t) lines.push(`- ${t}`); }
      } else if (section.type === 'custom') {
        const t = plain(item.content); if (t) lines.push(t);
      } else { // experience / education
        if (!item.organization && !item.role && !item.date) continue;
        const r1 = [item.organization, item.date].filter(Boolean).map(v => plain(v)).join('  ');
        const r2 = [item.role, item.location].filter(Boolean).map(v => plain(v)).join('  ');
        if (r1) lines.push(r1);
        if (r2) lines.push(r2);
        for (const b of item.bullets ?? []) { const t = plain(b.text); if (t) lines.push(`- ${t}`); }
      }
    }
  }

  return lines.join('\n').replace(/\n{2,}/g, '\n').trim();
}

// ── Main export ───────────────────────────────────────────────────────────────

export function resumeContentToHtml(content: ResumeContent, settings: ResumeSettings): string {
  const {
    fontSize: fs,
    fontFamily,
    lineSpacing: ls,
    sectionSpacing,
    marginSize,
    headerAlign = 'center',
  } = settings;

  const fontStack = FONT_MAP[fontFamily] ?? FONT_MAP.charter;
  const marginPt = marginSize * 72;

  // Header contact line — email/web fields render as links, phone stays plain.
  const contactParts = [
    content.header.phone   ? contactPart(content.header.phone, 'phone') : '',
    content.header.email   ? contactPart(content.header.email, 'email') : '',
    content.header.linkedin ? contactPart(content.header.linkedin, 'web') : '',
    content.header.github  ? contactPart(content.header.github, 'web') : '',
    content.header.portfolio ? contactPart(content.header.portfolio, 'web') : '',
  ].filter(Boolean);

  const headerHtml = `
    <div style="text-align:${headerAlign};margin-bottom:${fs * 0.6}pt">
      <div style="font-size:${fs * 2.2}pt;font-variant:small-caps;font-weight:bold;letter-spacing:0.04em;margin-bottom:${fs * 0.25}pt;line-height:1.1">
        ${esc(content.header.name) || 'Your Name'}
      </div>
      ${content.header.title
        ? `<div style="font-size:${fs * 1.05}pt;font-weight:normal;margin-bottom:${fs * 0.2}pt;line-height:1.2">${esc(content.header.title)}</div>`
        : ''}
      ${contactParts.length > 0
        ? `<div style="font-size:${fs * 0.95}pt;color:#222;line-height:1.3">${contactParts.join(' | ')}</div>`
        : ''}
    </div>`;

  const summaryHtml = (content.showSummary && content.summary)
    ? `<div style="margin-bottom:${sectionSpacing * 0.5}pt">
         <div style="margin-top:${sectionSpacing}pt">
           <div style="font-size:${fs * 1.15}pt;font-variant:small-caps;font-weight:bold;letter-spacing:0.03em;line-height:1.2">Summary</div>
           <div style="border-top:1pt solid #000;margin-bottom:2pt"></div>
         </div>
         <div style="font-size:${fs}pt;line-height:${ls}">${md(content.summary)}</div>
       </div>`
    : '';

  const sectionsHtml = content.sections
    .map(section => renderSection(section, fs, ls, sectionSpacing))
    .join('\n');

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
  body {
    font-family: ${fontStack};
    font-size: ${fs}pt;
    line-height: ${ls};
    color: #000;
    background: #fff;
  }
  strong { font-weight: bold; }
  em { font-style: italic; }
  ul { margin: 0; padding: 0; }
  li { margin: 0; }
  .page {
    width: 8.5in;
    min-height: 11in;
    padding: ${marginPt}pt;
    background: #fff;
    position: relative;
  }
</style>
</head>
<body>
<div class="page">
  ${headerHtml}
  ${summaryHtml}
  ${sectionsHtml}
</div>
</body>
</html>`;
}
