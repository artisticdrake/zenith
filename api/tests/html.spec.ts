// Edge-case tests for the PDF HTML path: link rendering in bullets/summary and
// header contact links. Run with: tsx api/tests/html.spec.ts

import assert from 'node:assert/strict';
import { resumeContentToHtml, resumeContentToText } from '../src/export/resumeToHtml';
import { normalizeResumeContent, normalizeResumeSettings } from '../src/lib/normalizeResume';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error('        ' + (err as Error).message.split('\n').join('\n        '));
  }
}

const S = normalizeResumeSettings({});

function htmlForBullet(text: string): string {
  const c = normalizeResumeContent({
    sections: [{ type: 'experience', items: [{ organization: 'O', bullets: [{ text }] }] }],
  });
  return resumeContentToHtml(c, S);
}

test('bullet link renders as <a href>', () => {
  const h = htmlForBullet('See [repo](https://github.com/x)');
  assert.ok(h.includes('href="https://github.com/x"'), h.slice(h.indexOf('href') - 10, h.indexOf('href') + 40));
  assert.ok(h.includes('>repo</a>'));
});

test('unsafe url dropped, no javascript in output', () => {
  const h = htmlForBullet('[x](javascript:alert(1))');
  assert.ok(!h.toLowerCase().includes('javascript:'), 'javascript leaked');
  assert.ok(h.includes('x'));
});

test('BUG WATCH: asterisk in url does not leak <em> into href', () => {
  const h = htmlForBullet('[x](https://x.com/*a*b)');
  assert.ok(!/href="[^"]*<em>/.test(h), `italic leaked into href: ${h}`);
});

test('bold inside link label works', () => {
  const h = htmlForBullet('[**X** y](https://x.com)');
  assert.ok(h.includes('<strong>X</strong>'), h);
  assert.ok(h.includes('href="https://x.com"'), h);
});

test('html in label is escaped (no XSS)', () => {
  const h = htmlForBullet('[<script>alert(1)</script>](x.com)');
  assert.ok(!h.includes('<script>'), 'raw script tag present!');
});

test('header email/linkedin/github/portfolio are links, phone is plain', () => {
  const c = normalizeResumeContent({
    header: { name: 'A', phone: '617-555-0000', email: 'a@b.c', linkedin: 'linkedin.com/in/a', github: 'github.com/a', portfolio: 'a.dev' },
    sections: [],
  });
  const h = resumeContentToHtml(c, S);
  assert.ok(h.includes('href="mailto:a@b.c"'), 'email not linked');
  assert.ok(h.includes('href="https://linkedin.com/in/a"'), 'linkedin not linked');
  assert.ok(h.includes('href="https://github.com/a"'), 'github not linked');
  assert.ok(h.includes('href="https://a.dev"'), 'portfolio not linked');
  // phone plain — should not be an anchor with tel:
  assert.ok(!h.includes('tel:'), 'phone should stay plain text');
  assert.ok(h.includes('617-555-0000'), 'phone text missing');
});

test('header contacts joined with separator', () => {
  const c = normalizeResumeContent({
    header: { name: 'A', email: 'a@b.c', linkedin: 'linkedin.com/in/a' },
    sections: [],
  });
  const h = resumeContentToHtml(c, S);
  assert.ok(h.includes(' | '), 'separator missing between contacts');
});

test('does not throw on hostile/garbage content', () => {
  const c = normalizeResumeContent({ header: null, summary: 42, sections: [{ type: 'x', items: [{}] }] });
  assert.doesNotThrow(() => resumeContentToHtml(c, S));
});

test('link in summary renders', () => {
  const c = normalizeResumeContent({ summary: 'Site: [me](https://me.dev)', showSummary: true, sections: [] });
  const h = resumeContentToHtml(c, S);
  assert.ok(h.includes('href="https://me.dev"'), 'summary link missing');
});

// ── resumeContentToText (the hashed + scored ATS-visible text) ────────────────

test('text: strips markdown emphasis and keeps link label only', () => {
  const c = normalizeResumeContent({
    sections: [{ type: 'experience', items: [{ organization: 'O', bullets: [{ text: 'Shipped **fast** [api](https://x.com)' }] }] }],
  });
  const t = resumeContentToText(c);
  assert.ok(t.includes('Shipped fast api'), t);
  assert.ok(!t.includes('**'), 'asterisks leaked');
  assert.ok(!t.includes('https://x.com'), 'raw url leaked into ATS text');
});

test('text: skips empty skill categories (matches HTML guard)', () => {
  const c = normalizeResumeContent({
    sections: [{ type: 'skills', items: [
      { category: 'Languages', items: 'Python, Go' },
      { category: 'Empty', items: '' },
    ] }],
  });
  const t = resumeContentToText(c);
  assert.ok(t.includes('Languages: Python, Go'), t);
  assert.ok(!t.includes('Empty'), 'empty skill category leaked');
});

test('text: identical content is stable (hash input is deterministic)', () => {
  const c = normalizeResumeContent({
    header: { name: 'A', email: 'a@b.c' },
    summary: 'Hi', showSummary: true,
    sections: [{ type: 'experience', items: [{ organization: 'O', role: 'R', bullets: [{ text: 'did x' }] }] }],
  });
  assert.equal(resumeContentToText(c), resumeContentToText(normalizeResumeContent(JSON.parse(JSON.stringify(c)))));
});

test('text: does not throw on hostile/garbage content', () => {
  const c = normalizeResumeContent({ header: null, summary: 42, sections: [{ type: 'x', items: [{}] }] });
  assert.doesNotThrow(() => resumeContentToText(c));
});

console.log(`\nhtml.spec: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
