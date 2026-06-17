import type { ResumeContent, BulletItem, ResumeSection, ResumeSectionItem } from '@/types/resume.types';

// ── Helpers ──────────────────────────────────────────────────────────────────

const LATEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  '$': '\\$',
  '#': '\\#',
  '_': '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};

export function escapeLatex(text: string): string {
  // Single pass so escape sequences inserted for one character (e.g. the
  // braces in \textbackslash{}) are never re-escaped by a later rule.
  return (text ?? '').replace(/[\\&%$#_{}~^]/g, (ch) => LATEX_ESCAPES[ch]);
}

const SAFE_URL = /^(?:https?:\/\/|mailto:|tel:)/i;
const BARE_DOMAIN = /^[\w.-]+\.[a-z]{2,}(?:[/?#].*)?$/i;
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;

function sanitizeUrl(raw: string): string | null {
  const url = raw.trim();
  if (SAFE_URL.test(url)) return url;
  if (BARE_DOMAIN.test(url)) return `https://${url}`;
  return null;
}

// \href's first argument is mostly verbatim, but #, %, & and \ must be escaped.
function escapeLatexUrl(url: string): string {
  return url.replace(/\\/g, '\\\\').replace(/([#%&])/g, '\\$1');
}

function markdownToLatex(text: string): string {
  // [label](url) → \href{url}{label}
  // **bold** → \textbf{...}
  // *italic* → \textit{...}
  //
  // Links are extracted BEFORE escaping (so URL characters like _ and # aren't
  // mangled) and replaced with private-use placeholder tokens that survive the
  // escape/bold/italic passes, then restored at the end.
  const links: string[] = [];
  let result = (text ?? '').replace(LINK_RE, (_m, label: string, url: string) => {
    const safe = sanitizeUrl(url);
    const idx = links.length;
    links.push(safe ? `\\href{${escapeLatexUrl(safe)}}{${markdownToLatex(label)}}` : markdownToLatex(label));
    return `${idx}`;
  });

  result = escapeLatex(result);
  result = result.replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}');
  result = result.replace(/\*(.+?)\*/g, '\\textit{$1}');
  result = result.replace(/(\d+)/g, (_m, i) => links[Number(i)]);
  return result;
}

function renderBullets(bullets: BulletItem[]): string {
  const withText = (bullets ?? []).filter((b) => b.text?.trim());
  if (!withText.length) return '';
  const items = withText.map((b) => `      \\resumeItem{${markdownToLatex(b.text)}}`).join('\n');
  return `    \\resumeItemListStart\n${items}\n    \\resumeItemListEnd`;
}

// ── Section renderers ────────────────────────────────────────────────────────

function renderEducationItem(item: ResumeSectionItem): string {
  const org = escapeLatex(item.organization ?? '');
  const loc = escapeLatex(item.location ?? '');
  const role = escapeLatex(item.role ?? '');
  const date = escapeLatex(item.date ?? '');
  const bullets = renderBullets(item.bullets ?? []);
  return `    \\resumeSubheading
      {${org}}{${date}}
      {${role}}{${loc}}
${bullets}`;
}

function renderExperienceItem(item: ResumeSectionItem): string {
  return renderEducationItem(item); // same structure
}

function renderProjectItem(item: ResumeSectionItem): string {
  const name = escapeLatex(item.projectName ?? '');
  const tech = escapeLatex(item.techStack ?? '');
  const date = escapeLatex(item.dateRange ?? '');
  const bullets = renderBullets(item.bullets ?? []);
  return `    \\resumeProjectHeading
      {\\textbf{${name}} $|$ \\emph{${tech}}}{${date}}
${bullets}`;
}

function renderSkillsItem(item: ResumeSectionItem): string {
  const cat = escapeLatex(item.category ?? '');
  const val = escapeLatex(item.items ?? '');
  return `      \\item{\\textbf{${cat}}{: ${val}}}`;
}

function renderSection(section: ResumeSection): string {
  if (!section.visible) return '';
  const title = escapeLatex(section.title);
  let body = '';

  if (section.type === 'education') {
    body = `  \\resumeSubHeadingListStart\n${section.items.map(renderEducationItem).join('\n')}\n  \\resumeSubHeadingListEnd`;
  } else if (section.type === 'experience') {
    body = `  \\resumeSubHeadingListStart\n${section.items.map(renderExperienceItem).join('\n')}\n  \\resumeSubHeadingListEnd`;
  } else if (section.type === 'projects') {
    body = `  \\resumeSubHeadingListStart\n${section.items.map(renderProjectItem).join('\n')}\n  \\resumeSubHeadingListEnd`;
  } else if (section.type === 'skills') {
    const items = section.items.map(renderSkillsItem).join('\n');
    body = `  \\begin{itemize}[leftmargin=0.15in, label={}]\n    \\small{\\item{\n${items}\n    }}\n  \\end{itemize}`;
  } else {
    // custom
    body = section.items
      .map((item) => `  ${markdownToLatex(item.content ?? '')}`)
      .join('\n');
  }

  return `\\section{${title}}\n${body}`;
}

// ── Main export ──────────────────────────────────────────────────────────────

export function generateLatex(content: ResumeContent): string {
  const { header, summary, showSummary, sections } = content;

  const contactParts: string[] = [];
  if (header.phone) contactParts.push(escapeLatex(header.phone));
  if (header.email) contactParts.push(`\\href{mailto:${escapeLatex(header.email)}}{\\underline{${escapeLatex(header.email)}}}`);
  if (header.linkedin) contactParts.push(`\\href{https://${escapeLatex(header.linkedin)}}{\\underline{${escapeLatex(header.linkedin)}}}`);
  if (header.github) contactParts.push(`\\href{https://${escapeLatex(header.github)}}{\\underline{${escapeLatex(header.github)}}}`);
  if (header.portfolio) contactParts.push(`\\href{https://${escapeLatex(header.portfolio)}}{\\underline{${escapeLatex(header.portfolio)}}}`);

  const contactLine = contactParts.join(' $|$ ');

  const summarySection =
    showSummary && summary
      ? `\\section{Summary}\n  \\small{${markdownToLatex(summary)}}\n`
      : '';

  const sectionsLatex = sections.map(renderSection).filter(Boolean).join('\n\n');

  return `%-------------------------
% Resume in Jake's style
% Generated by Job Tracker — Resume Builder
%-------------------------

\\documentclass[letterpaper,11pt]{article}

\\usepackage{latexsym}
\\usepackage[empty]{fullpage}
\\usepackage{titlesec}
\\usepackage{marvosym}
\\usepackage[usenames,dvipsnames]{color}
\\usepackage{verbatim}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{fancyhdr}
\\usepackage[english]{babel}
\\usepackage{tabularx}
\\input{glyphtounicode}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyfoot{}
\\renewcommand{\\headrulewidth}{0pt}
\\renewcommand{\\footrulewidth}{0pt}

% Adjust margins
\\addtolength{\\oddsidemargin}{-0.5in}
\\addtolength{\\evensidemargin}{-0.5in}
\\addtolength{\\textwidth}{1in}
\\addtolength{\\topmargin}{-.5in}
\\addtolength{\\textheight}{1.0in}

\\urlstyle{same}
\\raggedbottom
\\raggedright
\\setlength{\\tabcolsep}{0in}

% Sections formatting
\\titleformat{\\section}{
  \\vspace{-4pt}\\scshape\\raggedright\\large
}{}{0em}{}[\\color{black}\\titlerule \\vspace{-5pt}]

\\pdfgentounicode=1

%----------CUSTOM COMMANDS----------
\\newcommand{\\resumeItem}[1]{
  \\item\\small{
    {#1 \\vspace{-2pt}}
  }
}

\\newcommand{\\resumeSubheading}[4]{
  \\vspace{-2pt}\\item
    \\begin{tabular*}{0.97\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}
      \\textbf{#1} & #2 \\\\
      \\textit{\\small#3} & \\textit{\\small #4} \\\\
    \\end{tabular*}\\vspace{-7pt}
}

\\newcommand{\\resumeProjectHeading}[2]{
    \\item
    \\begin{tabular*}{0.97\\textwidth}{l@{\\extracolsep{\\fill}}r}
      \\small#1 & #2 \\\\
    \\end{tabular*}\\vspace{-7pt}
}

\\newcommand{\\resumeSubItem}[1]{\\resumeItem{#1}\\vspace{-4pt}}
\\renewcommand\\labelitemii{$\\vcenter{\\hbox{\\tiny$\\bullet$}}$}

\\newcommand{\\resumeSubHeadingListStart}{\\begin{itemize}[leftmargin=0.15in, label={}]}
\\newcommand{\\resumeSubHeadingListEnd}{\\end{itemize}}
\\newcommand{\\resumeItemListStart}{\\begin{itemize}}
\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{-5pt}}

%-------------------------------------------
\\begin{document}

%----------HEADING----------
\\begin{center}
    {\\Huge \\scshape ${escapeLatex(header.name)}} \\\\ \\vspace{4pt}
    \\small ${escapeLatex(header.title)} \\\\ \\vspace{2pt}
    \\small ${contactLine}
\\end{center}

${summarySection}
${sectionsLatex}

%-------------------------------------------
\\end{document}
`;
}
