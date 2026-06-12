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

function md(raw: string | undefined | null): string {
  const escaped = esc(raw);
  const withBold = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return withBold.replace(/\*(.+?)\*/g, '<em>$1</em>');
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

  // Header contact line
  const contactParts = [
    content.header.phone,
    content.header.email,
    content.header.linkedin,
    content.header.github,
    content.header.portfolio,
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
        ? `<div style="font-size:${fs * 0.95}pt;color:#222;line-height:1.3">${contactParts.map(esc).join(' | ')}</div>`
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
