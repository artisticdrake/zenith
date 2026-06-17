// Edge-case stress tests for hyperlink rendering across all three paths:
//   - renderInlineMarkdown (live preview, dangerouslySetInnerHTML)
//   - generateLatex (LaTeX copy)
// Run with: tsx web/tests/links.spec.ts

import assert from 'node:assert/strict';
import {
  renderInlineMarkdown,
  sanitizeUrl,
  contactHref,
} from '../src/components/resume/preview/inlineMarkdown';
import { generateLatex } from '../src/components/resume/export/generateLatex';
import { normalizeResumeContent } from '../src/lib/normalizeResume';

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

// ── sanitizeUrl ───────────────────────────────────────────────────────────────

test('sanitizeUrl: bare domain gets https prefix', () => {
  assert.equal(sanitizeUrl('github.com/me'), 'https://github.com/me');
});
test('sanitizeUrl: keeps explicit http(s)/mailto/tel', () => {
  assert.equal(sanitizeUrl('http://x.com'), 'http://x.com');
  assert.equal(sanitizeUrl('https://x.com'), 'https://x.com');
  assert.equal(sanitizeUrl('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(sanitizeUrl('tel:+1234'), 'tel:+1234');
});
test('sanitizeUrl: rejects javascript/data/vbscript and mixed case', () => {
  assert.equal(sanitizeUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeUrl('JaVaScRiPt:alert(1)'), null);
  assert.equal(sanitizeUrl('data:text/html,<script>'), null);
  assert.equal(sanitizeUrl('vbscript:msgbox'), null);
});
test('sanitizeUrl: rejects plain text and protocol-relative', () => {
  assert.equal(sanitizeUrl('just some text'), null);
  // protocol-relative //evil.com — no scheme, not a bare domain at start
  assert.equal(sanitizeUrl('//evil.com'), null);
});
test('sanitizeUrl: trims surrounding whitespace', () => {
  assert.equal(sanitizeUrl('  x.com  '), 'https://x.com');
});

// ── contactHref ───────────────────────────────────────────────────────────────

test('contactHref: email/phone/web', () => {
  assert.equal(contactHref('a@b.c', 'email'), 'mailto:a@b.c');
  assert.equal(contactHref('(617) 555-0000', 'phone'), 'tel:6175550000');
  assert.equal(contactHref('linkedin.com/in/me', 'web'), 'https://linkedin.com/in/me');
});
test('contactHref: empty value returns null', () => {
  assert.equal(contactHref('', 'email'), null);
  assert.equal(contactHref('   ', 'web'), null);
});
test('contactHref: phone with no digits returns null', () => {
  assert.equal(contactHref('call me', 'phone'), null);
});

// ── renderInlineMarkdown: links ────────────────────────────────────────────────

test('renderInlineMarkdown: basic link', () => {
  const h = renderInlineMarkdown('[repo](https://github.com/x)');
  assert.ok(h.includes('href="https://github.com/x"'), h);
  assert.ok(h.includes('>repo</a>'), h);
});
test('renderInlineMarkdown: two links in one line', () => {
  const h = renderInlineMarkdown('[a](x.com) and [b](y.com)');
  assert.ok(h.includes('href="https://x.com"'), h);
  assert.ok(h.includes('href="https://y.com"'), h);
  assert.ok(h.includes('>a</a>'), h);
  assert.ok(h.includes('>b</a>'), h);
});
test('renderInlineMarkdown: bold inside link label', () => {
  const h = renderInlineMarkdown('[**bold**](x.com)');
  assert.ok(h.includes('<strong>bold</strong>'), h);
  assert.ok(h.includes('<a href'), h);
});
test('renderInlineMarkdown: unsafe url dropped, label kept, no js', () => {
  const h = renderInlineMarkdown('[click](javascript:alert(document.cookie))');
  assert.ok(!h.toLowerCase().includes('javascript:'), h);
  assert.ok(!h.includes('<a'), h);
  assert.ok(h.includes('click'), h);
});
test('renderInlineMarkdown: html in label is escaped (no XSS)', () => {
  const h = renderInlineMarkdown('[<img src=x onerror=alert(1)>](x.com)');
  assert.ok(!h.includes('<img'), h);
  assert.ok(h.includes('&lt;img'), h);
});
test('renderInlineMarkdown: quote in url cannot break out of attribute', () => {
  const h = renderInlineMarkdown('[x](https://x.com/"onmouseover="alert(1))');
  // the closing paren regex stops at ), but ensure no raw quote sits in href
  assert.ok(!/href="[^"]*"[^>]*onmouseover/i.test(h), h);
});
test('renderInlineMarkdown: plain text without links untouched (bold/italic still work)', () => {
  const h = renderInlineMarkdown('plain **b** and *i*');
  assert.equal(h, 'plain <strong>b</strong> and <em>i</em>');
});
test('renderInlineMarkdown: ampersand in text is escaped', () => {
  const h = renderInlineMarkdown('A & B');
  assert.ok(h.includes('A &amp; B'), h);
});
test('BUG WATCH: asterisk inside a URL should not corrupt the href', () => {
  const h = renderInlineMarkdown('[x](https://x.com/*a*b)');
  // If italic runs over the href, we get href="...<em>a</em>b" — that is a bug.
  assert.ok(!/href="[^"]*<em>/.test(h), `italic leaked into href: ${h}`);
});

// ── generateLatex: links ────────────────────────────────────────────────────────

function texForBullet(text: string): string {
  const c = normalizeResumeContent({
    sections: [{ type: 'experience', items: [{ organization: 'O', bullets: [{ text }] }] }],
  });
  return generateLatex(c);
}

test('generateLatex: bullet link becomes \\href', () => {
  const tex = texForBullet('See [my repo](https://github.com/x/y) please');
  assert.ok(tex.includes('\\href{https://github.com/x/y}{my repo}'), tex.slice(tex.indexOf('\\href') - 20, tex.indexOf('\\href') + 60));
});
test('generateLatex: unsafe url → label only, no href, no javascript', () => {
  const tex = texForBullet('Bad [link](javascript:evil())');
  assert.ok(!tex.includes('javascript:'), 'javascript leaked');
  assert.ok(tex.includes('link'), 'label missing');
});
test('generateLatex: url with # and % and & is escaped inside href', () => {
  const tex = texForBullet('[doc](https://x.com/a#b%20c&d=1)');
  assert.ok(tex.includes('\\href{https://x.com/a\\#b\\%20c\\&d=1}'), tex.slice(tex.indexOf('\\href'), tex.indexOf('\\href') + 80));
});
test('generateLatex: numbers in surrounding text are NOT eaten by the link placeholder', () => {
  const tex = texForBullet('Boosted 26% via [tool](x.com) across 15 teams');
  assert.ok(tex.includes('26\\%'), 'percent lost');
  assert.ok(tex.includes('15 teams'), 'number 15 lost: ' + tex.slice(tex.indexOf('resumeItem'), tex.indexOf('resumeItem') + 160));
  assert.ok(tex.includes('\\href{https://x.com}{tool}'), 'href missing');
});
test('generateLatex: 11+ links restore correctly (multi-digit index)', () => {
  const parts = [];
  for (let i = 0; i < 12; i++) parts.push(`[L${i}](https://s${i}.com)`);
  const tex = texForBullet(parts.join(' '));
  for (let i = 0; i < 12; i++) {
    assert.ok(tex.includes(`\\href{https://s${i}.com}{L${i}}`), `link ${i} missing/corrupted`);
  }
});
test('generateLatex: bold inside a link label survives', () => {
  const tex = texForBullet('[**X** report](https://x.com)');
  assert.ok(tex.includes('\\href{https://x.com}{\\textbf{X} report}'), tex.slice(tex.indexOf('\\href'), tex.indexOf('\\href') + 80));
});
test('generateLatex: link in summary and custom section', () => {
  const c = normalizeResumeContent({
    summary: 'Portfolio at [site](https://me.dev)',
    sections: [{ type: 'custom', title: 'Links', items: [{ content: 'GitHub: [gh](https://github.com/me)' }] }],
  });
  const tex = generateLatex(c);
  assert.ok(tex.includes('\\href{https://me.dev}{site}'), 'summary link missing');
  assert.ok(tex.includes('\\href{https://github.com/me}{gh}'), 'custom link missing');
});

console.log(`\nlinks.spec: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
