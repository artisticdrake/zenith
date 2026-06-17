// Run with: npm run test --workspace=web   (tsx tests/normalize.spec.ts)
// Guards the JSON-import / tailor-handoff / version-load entry points of the
// web app: hostile or alternately-shaped JSON must normalize into render-safe
// structures, and the LaTeX export must escape correctly.

import assert from 'node:assert/strict';
import { normalizeResumeContent, normalizeResumeSettings } from '../src/lib/normalizeResume';
import { normalizeProfile } from '../src/lib/normalizeMasterProfile';
import { escapeLatex, generateLatex } from '../src/components/resume/export/generateLatex';
import { renderInlineMarkdown, sanitizeUrl, contactHref } from '../src/components/resume/preview/inlineMarkdown';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    throw err;
  }
}

// ── normalizeProfile (Master Profile JSON import) ─────────────────────────────

test('garbage inputs produce an empty but valid MasterProfile', () => {
  for (const input of [null, undefined, [], 'x', { header: null, summaries: null, skills: 12 }]) {
    const p = normalizeProfile(input);
    assert.equal(typeof p.header.name, 'string');
    for (const key of ['summaries', 'experiences', 'projects', 'education', 'skills', 'awards'] as const) {
      assert.ok(Array.isArray(p[key]), `${key} must be an array`);
    }
  }
});

test('categorized skills object is flattened into rows', () => {
  const p = normalizeProfile({
    skills: {
      languages: ['Python', 'SQL'],
      ml_dl: ['PyTorch'],
      note: 'this string key must be skipped',
    },
  });
  assert.equal(p.skills.length, 3);
  assert.deepEqual(p.skills[0], { canonical: 'python', display: 'Python', category: 'languages', proven: false });
  assert.equal(p.skills[2].category, 'ml_dl');
});

test('skills as plain strings and editor rows both survive', () => {
  const p = normalizeProfile({ skills: ['React', { canonical: 'tf', display: 'TensorFlow', category: 'ML', proven: true }, '', null] });
  assert.deepEqual(p.skills.map((s) => s.display), ['React', 'TensorFlow']);
  assert.equal(p.skills[1].proven, true);
});

test('header/title/email aliases and project tech_stack aliases are mapped', () => {
  const p = normalizeProfile({
    header: { name: 'N', headline_linkedin: 'ML Engineer', email_primary: 'a@b.c' },
    projects: [{ name: 'P', dates: '2024', tech_stack: ['Flask', 'SQLite'] }],
    experiences: [{ org: 'O', bullets: [{ text: 'line one\nline two', skills: 'python, sql' }] }],
  });
  assert.equal(p.header.title, 'ML Engineer');
  assert.equal(p.header.email, 'a@b.c');
  assert.equal(p.projects[0].startDate, '2024');
  assert.deepEqual(p.projects[0].techStack, ['Flask', 'SQLite']);
  const b = p.experiences[0].bullets[0];
  assert.equal(b.text, 'line one line two'); // newlines collapsed
  assert.deepEqual(b.skills, ['python', 'sql']); // comma string accepted
  assert.equal(b.strength, 2); // missing strength defaults
  assert.ok(b.id);
});

// ── normalizeResumeContent / settings (Builder entry points) ──────────────────

test('tailor handoff junk cannot produce an unrenderable resume', () => {
  const c = normalizeResumeContent({
    sections: [
      { type: 'experience', items: [{ organization: 'Acme', bullets: [{ text: 'x' }, 'y', 0] }] },
      { type: 'skills', items: [{ category: 'ML', items: ['a', 'b'] }] },
    ],
  });
  assert.equal(c.sections.length, 2);
  assert.deepEqual(c.sections[0].items[0].bullets.map((b) => b.text), ['x', 'y']);
  assert.equal(c.sections[1].items[0].items, 'a, b');
  assert.equal(c.header.name, '');
});

test('empty/garbage handoff normalizes to zero sections (caller must reject it)', () => {
  assert.equal(normalizeResumeContent({ foo: 'bar' }).sections.length, 0);
  assert.equal(normalizeResumeContent(null).sections.length, 0);
});

test('settings junk falls back to defaults and clamps', () => {
  const s = normalizeResumeSettings({ fontSize: 1, sectionSpacing: '12', headerAlign: 'middle' });
  assert.equal(s.fontSize, 6); // clamped up
  assert.equal(s.sectionSpacing, 12); // numeric string accepted
  assert.equal(s.headerAlign, 'center'); // invalid → default
});

// ── LaTeX export ──────────────────────────────────────────────────────────────

test('escapeLatex escapes every special char in a single pass', () => {
  assert.equal(escapeLatex('C:\\dir_100% & {ok} #1 $5 ~x ^y'),
    'C:\\textbackslash{}dir\\_100\\% \\& \\{ok\\} \\#1 \\$5 \\textasciitilde{}x \\textasciicircum{}y');
  // The braces inserted for one escape must never be re-escaped
  assert.ok(!escapeLatex('\\').includes('\\{'));
  assert.equal(escapeLatex(undefined as unknown as string), '');
});

test('generateLatex tolerates bullets without text and normalized hostile content', () => {
  const c = normalizeResumeContent({
    header: { name: 'A_B' },
    sections: [
      { type: 'experience', items: [{ organization: 'O', bullets: [{ id: 'b', text: '' }, { text: 'real **bold**' }] }] },
      { type: 'custom', title: 'Notes', items: [{}] },
    ],
  });
  const tex = generateLatex(c);
  assert.ok(tex.includes('\\textbf{bold}'));
  assert.ok(tex.includes('A\\_B'));
  assert.ok(!tex.includes('\\resumeItem{}')); // empty bullet dropped
});

// ── Hyperlinks (markdown links + header contacts) ─────────────────────────────

test('renderInlineMarkdown turns [text](url) into a safe anchor', () => {
  const html = renderInlineMarkdown('See [my repo](github.com/me/proj) for details');
  assert.ok(html.includes('<a href="https://github.com/me/proj"'));
  assert.ok(html.includes('>my repo</a>'));
  // bold still works alongside links
  assert.ok(renderInlineMarkdown('[**x**](https://a.co)').includes('<strong>x</strong>'));
});

test('renderInlineMarkdown drops unsafe URLs but keeps the label text', () => {
  const html = renderInlineMarkdown('[click](javascript:alert(1))');
  assert.ok(!html.includes('<a'));
  assert.ok(!html.toLowerCase().includes('javascript:'));
  assert.ok(html.includes('click'));
});

test('sanitizeUrl normalizes schemes and rejects unsafe ones', () => {
  assert.equal(sanitizeUrl('x.com/a'), 'https://x.com/a');
  assert.equal(sanitizeUrl('https://x.com'), 'https://x.com');
  assert.equal(sanitizeUrl('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(sanitizeUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeUrl('not a url'), null);
});

test('contactHref builds mailto/tel/web links', () => {
  assert.equal(contactHref('a@b.c', 'email'), 'mailto:a@b.c');
  assert.equal(contactHref('617-000-0000', 'phone'), 'tel:6170000000');
  assert.equal(contactHref('linkedin.com/in/me', 'web'), 'https://linkedin.com/in/me');
});

test('generateLatex renders [text](url) as \\href and stays ATS-safe on unsafe URLs', () => {
  const c = normalizeResumeContent({
    sections: [
      { type: 'experience', items: [{ organization: 'O', bullets: [
        { text: 'Built [the API](https://api.example.com/v1?a=1) end to end' },
        { text: 'Bad [link](javascript:evil())' },
      ] }] },
    ],
  });
  const tex = generateLatex(c);
  assert.ok(tex.includes('\\href{https://api.example.com/v1?a=1}{the API}'));
  assert.ok(!tex.includes('javascript:'));
  assert.ok(tex.includes('{link}') || tex.includes('link')); // label kept, no href
});

console.log(`\nweb normalize.spec: ${passed} tests passed`);
