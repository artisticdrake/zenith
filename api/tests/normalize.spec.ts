// Run with: npm run test --workspace=api   (tsx tests/normalize.spec.ts)
// Guards the Claude-tailor → cache → Builder pipeline: hostile/malformed JSON
// must normalize into render-safe shapes and never crash resumeContentToHtml.

import assert from 'node:assert/strict';
import { normalizeResumeContent, normalizeResumeSettings, normalizeReview } from '../src/lib/normalizeResume';
import { resumeContentToHtml } from '../src/export/resumeToHtml';
import { isSeniorTitle } from '../src/lib/apifyBuiltin';

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

// ── normalizeResumeContent ────────────────────────────────────────────────────

test('garbage inputs produce an empty but valid ResumeContent', () => {
  for (const input of [null, undefined, 42, 'hello', [], { header: null, sections: 'nope' }]) {
    const c = normalizeResumeContent(input);
    assert.equal(typeof c.header.name, 'string');
    assert.equal(typeof c.summary, 'string');
    assert.ok(Array.isArray(c.sections));
  }
});

test('a sloppy Claude response is coerced into the Builder shape', () => {
  const c = normalizeResumeContent({
    header: { name: 'Jane', email: 'j@x.com' }, // missing fields
    summary: 'Did things.',
    sections: [
      {
        type: 'experience', // no id, no title, no visible
        items: [
          { organization: 'Acme', bullets: ['shipped it', { text: 'scaled it' }, null] }, // string + object + junk bullets
          'not-an-item',
          { role: 'Engineer', bullets: null },
        ],
      },
      { id: 's1', type: 'skills', items: [{ category: 'ML', items: ['PyTorch', 'JAX'] }] }, // items as array
      { id: 's1', type: 'mystery', title: 'Extras', items: [{ content: 'hi' }] }, // dup id + unknown type
    ],
  });

  assert.equal(c.header.name, 'Jane');
  assert.equal(c.header.phone, '');
  assert.equal(c.showSummary, true); // inferred from summary presence
  assert.equal(c.sections.length, 3);

  const exp = c.sections[0];
  assert.ok(exp.id);
  assert.equal(exp.title, 'Experience');
  assert.equal(exp.visible, true);
  assert.equal(exp.items.length, 2); // string item dropped
  assert.deepEqual(exp.items[0].bullets.map((b) => b.text), ['shipped it', 'scaled it']);
  assert.ok(exp.items[0].bullets.every((b) => b.id));
  assert.deepEqual(exp.items[1].bullets, []);

  assert.equal(c.sections[1].items[0].items, 'PyTorch, JAX'); // array joined
  assert.equal(c.sections[2].type, 'custom'); // unknown type demoted
  assert.notEqual(c.sections[2].id, c.sections[1].id); // dup id regenerated
});

test('valid content round-trips unchanged where it matters', () => {
  const input = {
    header: { name: 'A', title: 'B', phone: 'C', email: 'D', linkedin: 'E', github: 'F', portfolio: 'G' },
    summary: 'S',
    showSummary: false,
    sections: [{ id: 'x', type: 'projects', title: 'Projects', visible: false, items: [{ id: 'p1', projectName: 'P', techStack: 'T', dateRange: '2024', bullets: [{ id: 'b1', text: 'did' }] }] }],
  };
  const c = normalizeResumeContent(input);
  // JSON round-trip strips `undefined` optional keys the normalizer adds
  assert.deepEqual(JSON.parse(JSON.stringify(c)), input);
});

// ── normalizeResumeSettings ───────────────────────────────────────────────────

test('settings: nulls and junk fall back to defaults, numbers clamp', () => {
  const d = normalizeResumeSettings(null);
  assert.equal(d.fontSize, 10.5);
  assert.equal(d.headerAlign, 'center');

  const s = normalizeResumeSettings({ fontSize: '999', lineSpacing: null, marginSize: 'abc', headerAlign: 'left', autoFitOnePage: 'yes' });
  assert.equal(s.fontSize, 24); // clamped
  assert.equal(s.lineSpacing, 1.15); // null → default, not 0.8
  assert.equal(s.marginSize, 0.5);
  assert.equal(s.headerAlign, 'left');
  assert.equal(s.autoFitOnePage, false); // only literal true enables
});

// ── normalizeReview ───────────────────────────────────────────────────────────

test('review: strings-instead-of-arrays and string scores are coerced', () => {
  assert.equal(normalizeReview(null), null);
  assert.equal(normalizeReview('great fit'), null);

  const r = normalizeReview({
    summary: 'ok',
    keptItems: 'just one thing',
    skillsSurfaced: ['a', 7, null, 'b'],
    fitAssessment: { level: 'amazing', rationale: 'r' },
    matchScore: '73',
  })!;
  assert.deepEqual(r.keptItems, ['just one thing']);
  assert.deepEqual(r.skillsSurfaced, ['a', '7', 'b']);
  assert.equal(r.fitAssessment!.level, 'moderate'); // unknown level demoted
  assert.equal(r.matchScore, 73);
  assert.deepEqual(r.genuineGaps, []);

  assert.equal(normalizeReview({ matchScore: null })!.matchScore, undefined);
  assert.equal(normalizeReview({ matchScore: 250 })!.matchScore, 100);

  // bulletSuggestions: drop entries without a bullet, default a bad section,
  // and default to [] when absent.
  assert.deepEqual(normalizeReview({})!.bulletSuggestions, []);
  const bs = normalizeReview({
    bulletSuggestions: [
      { section: 'projects', target: 'Acme', guidance: 'g', bullet: 'Did a thing' },
      { section: 'bogus', bullet: 'No section match' }, // section coerced
      { section: 'skills', guidance: 'missing bullet' },  // dropped — no bullet
      'nope',                                              // dropped — not an object
    ],
  })!.bulletSuggestions;
  assert.equal(bs.length, 2);
  assert.deepEqual(bs[0], { section: 'projects', target: 'Acme', guidance: 'g', bullet: 'Did a thing' });
  assert.equal(bs[1].section, 'experience'); // unknown section demoted to default
});

// ── isSeniorTitle: seniority pre-filter (cost-saving scrape step) ─────────────

test('isSeniorTitle: clear seniority qualifiers ARE filtered', () => {
  for (const t of [
    'Senior ML Engineer', 'Sr. Data Engineer', 'Staff Software Engineer',
    'Principal Engineer', 'Engineering Manager', 'Product Manager',
    'Director of Data', 'VP, Engineering', 'Head of AI',
  ]) {
    assert.equal(isSeniorTitle(t), true, `expected senior: ${t}`);
  }
});

test('isSeniorTitle: "lead" filtered only as a standalone seniority word', () => {
  // Standalone seniority "lead" — filter.
  assert.equal(isSeniorTitle('Lead Data Engineer'), true);
  assert.equal(isSeniorTitle('Lead Engineer'), true);
  assert.equal(isSeniorTitle('Engineering Lead'), true);
  assert.equal(isSeniorTitle('Tech Lead'), true);
  // Domain "lead" (lead generation / lead scoring) — must NOT be filtered.
  assert.equal(isSeniorTitle('Lead Generation Engineer'), false);
  assert.equal(isSeniorTitle('Data Lead Scoring'), false);
  assert.equal(isSeniorTitle('Lead Scoring Engineer'), false);
});

test('isSeniorTitle: IC titles and junk are NOT filtered', () => {
  for (const t of ['Data Engineer', 'Machine Learning Engineer', 'Software Engineer II', '', null, undefined]) {
    assert.equal(isSeniorTitle(t as any), false, `expected not-senior: ${t}`);
  }
});

// ── resumeContentToHtml never crashes on normalized hostile input ─────────────

test('resumeContentToHtml renders normalized garbage without throwing', () => {
  const hostile = [
    null,
    { header: null, sections: null },
    { sections: [{ type: 'experience', items: [{}] }, { type: 'skills', items: [null, { category: 'X' }] }] },
    { header: { name: '<script>alert(1)</script>' }, summary: '**b** & <i>', sections: [] },
  ];
  for (const input of hostile) {
    const html = resumeContentToHtml(normalizeResumeContent(input) as any, normalizeResumeSettings(null) as any);
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(!html.includes('<script>alert')); // escaped
  }
});

console.log(`\napi normalize.spec: ${passed} tests passed`);
