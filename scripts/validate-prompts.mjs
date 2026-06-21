/**
 * validate-prompts.mjs
 *
 * Automated validation suite for the resume-AI prompts. Imports the REAL shipped
 * builders from api/dist/lib/prompts.js (run `npm run build --workspace=api` first
 * so dist is current), runs them against synthetic fixtures via the Anthropic API,
 * and asserts 8 behavioural checks. Exits 1 if any check FAILs.
 *
 * Run:  node scripts/validate-prompts.mjs
 * Cost: 5 Anthropic calls (claude-sonnet-4-6), a few cents.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.resolve(root, 'api/.env') });

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is not configured (looked in api/.env).');
  process.exit(1);
}

let builders;
try {
  builders = await import(pathToFileURL(path.resolve(root, 'api/dist/lib/prompts.js')).href);
} catch (e) {
  console.error('Could not import api/dist/lib/prompts.js — run `npm run build --workspace=api` first.');
  console.error(e.message);
  process.exit(1);
}
const { buildScorerPrompt, buildTailorPrompt, buildAssemblerPrompt } = builders;

let sanitizers;
try {
  sanitizers = await import(pathToFileURL(path.resolve(root, 'api/dist/lib/sanitizeResumeText.js')).href);
} catch (e) {
  console.error('Could not import api/dist/lib/sanitizeResumeText.js — run `npm run build --workspace=api` first.');
  console.error(e.message);
  process.exit(1);
}
const { sanitizeResumeContent, sanitizeBulletSuggestions } = sanitizers;

// ── Synthetic fixtures (no real personal data, safe to commit) ──────────────────
// Candidate: zero full-time professional-engineering roles. Two research
// internships + one non-engineering ops job. ML / computer-vision / signal lane.
const MASTER_PROFILE = {
  header: {
    name: 'Alex Rivera',
    title: 'MS Computer Science Candidate | Computer Vision, PyTorch, Signal Processing',
    email: 'alex.rivera@example.edu',
    linkedin: 'linkedin.com/in/example-alex',
    github: 'github.com/example-alex',
  },
  summaries: [
    'MS CS candidate specializing in computer vision and signal processing. Research experience building and evaluating deep-learning models for image and audio tasks; deployed inference pipelines to edge hardware.',
  ],
  experiences: [
    {
      role: 'Research Intern, Computer Vision Lab',
      organization: 'State University Vision Lab',
      type: 'internship',
      dates: 'Jun 2024 - Aug 2024',
      bullets: [
        'Trained and evaluated CNN and ViT models (PyTorch) for object detection on a 40k-image dataset, improving mAP by 6 points over the lab baseline.',
        'Built a reproducible training harness with experiment tracking across 30+ runs.',
      ],
    },
    {
      role: 'Research Intern, Signal Processing Group',
      organization: 'Institute for Acoustics Research',
      type: 'internship',
      dates: 'May 2023 - Aug 2023',
      bullets: [
        'Implemented DSP feature extraction (MFCC, spectrogram) feeding a speech-classification model; presented results to 15+ researchers.',
        'Deployed an inference pipeline to a Raspberry Pi for real-time edge classification.',
      ],
    },
    {
      role: 'Library Services Assistant',
      organization: 'University Library',
      type: 'ops',
      dates: 'Sep 2022 - May 2024',
      bullets: [
        'Wrote a small Python script to validate and de-duplicate catalog records, reducing manual cleanup time ~20%.',
      ],
    },
  ],
  projects: [
    {
      name: 'EdgeVision',
      techStack: 'PyTorch, OpenCV, ONNX, NumPy, Raspberry Pi',
      bullets: [
        'Real-time object detection on edge hardware; quantized model to run at 12 FPS on a Pi 4.',
        'Validated each pipeline stage (capture, preprocess, inference) with structured test inputs and expected-output checks.',
      ],
    },
    {
      name: 'AudioTagger',
      techStack: 'PyTorch, librosa, scikit-learn, pandas',
      bullets: [
        'Multi-label audio classification over a 10-class dataset; 0.88 macro-F1 on held-out data.',
      ],
    },
  ],
  awards: [
    {
      title: 'University AI Hackathon - 1st Place',
      placement: '1st of 22 teams',
      amount: '$2,000',
      validatedBy: 'judged by faculty and an industry panel',
    },
  ],
  certifications: [],
  education: [
    { organization: 'State University', role: 'MS Computer Science (in progress)', dates: '2024 - 2026' },
    { organization: 'State University', role: 'BS Computer Science', dates: '2020 - 2024' },
  ],
  skills: {
    'Machine Learning': 'PyTorch, scikit-learn, CNNs, Vision Transformers, model evaluation, ONNX',
    'Computer Vision': 'OpenCV, object detection, image classification, edge deployment',
    'Signal Processing': 'DSP, MFCC, spectrograms, librosa, audio classification',
    'Languages & Tools': 'Python, NumPy, pandas, Git, Linux',
  },
};

// Plain-text resume that mirrors the profile (what resumeContentToText would emit).
const RESUME_TEXT = `Alex Rivera
MS Computer Science Candidate | Computer Vision, PyTorch, Signal Processing
alex.rivera@example.edu | linkedin.com/in/example-alex | github.com/example-alex

Summary
MS CS candidate specializing in computer vision and signal processing. Research experience building and evaluating deep-learning models for image and audio tasks; deployed inference pipelines to edge hardware.

Experience
State University Vision Lab  Jun 2024 - Aug 2024
Research Intern, Computer Vision Lab
- Trained and evaluated CNN and ViT models (PyTorch) for object detection on a 40k-image dataset, improving mAP by 6 points over the lab baseline.
- Built a reproducible training harness with experiment tracking across 30+ runs.
Institute for Acoustics Research  May 2023 - Aug 2023
Research Intern, Signal Processing Group
- Implemented DSP feature extraction (MFCC, spectrogram) feeding a speech-classification model; presented results to 15+ researchers.
- Deployed an inference pipeline to a Raspberry Pi for real-time edge classification.
University Library  Sep 2022 - May 2024
Library Services Assistant
- Wrote a small Python script to validate and de-duplicate catalog records, reducing manual cleanup time ~20%.

Projects
EdgeVision | PyTorch, OpenCV, ONNX, NumPy, Raspberry Pi
- Real-time object detection on edge hardware; quantized model to run at 12 FPS on a Pi 4.
- Validated each pipeline stage (capture, preprocess, inference) with structured test inputs and expected-output checks.
AudioTagger | PyTorch, librosa, scikit-learn, pandas
- Multi-label audio classification over a 10-class dataset; 0.88 macro-F1 on held-out data.

Awards
University AI Hackathon - 1st Place (1st of 22 teams, $2,000; judged by faculty and an industry panel)

Education
State University - MS Computer Science (in progress), 2024 - 2026
State University - BS Computer Science, 2020 - 2024

Technical Skills
Machine Learning: PyTorch, scikit-learn, CNNs, Vision Transformers, model evaluation, ONNX
Computer Vision: OpenCV, object detection, image classification, edge deployment
Signal Processing: DSP, MFCC, spectrograms, librosa, audio classification
Languages & Tools: Python, NumPy, pandas, Git, Linux`;

// Off-lane JD: gated on 1+ year of professional QA / testing experience.
const JD_SDET = `Software Engineer in Test (SDET). Join our quality engineering team building and maintaining automated test frameworks for cloud web services.
Required: 1+ year of professional experience in software testing, quality engineering, or a related professional engineering role after a CS degree; experience writing automated tests for web apps or APIs; working knowledge of a test automation framework (Selenium, Cypress, Playwright, or similar); familiarity with CI/CD pipelines.
Desired: REST API testing, Docker, JavaScript or C#, experience maintaining test environments.
Responsibilities: design and maintain automated test suites; run and monitor tests in CI/CD; partner with developers to close coverage gaps.`;

// In-lane JD: machine-learning engineer, skill-based requirements (no hard tenure gate).
const JD_ML = `Machine Learning Engineer (Computer Vision). Work on perception models for edge devices.
Required: strong Python and PyTorch; experience training and evaluating computer-vision models (detection or classification); familiarity with model optimization / deployment to edge hardware (ONNX, quantization); solid grasp of DSP or image preprocessing.
Desired: OpenCV, experiment tracking, audio or signal processing exposure, Raspberry Pi / embedded inference.
Responsibilities: build and evaluate CV models; optimize and deploy them to constrained hardware; validate inference pipelines.`;

// ── Anthropic call ──────────────────────────────────────────────────────────────
async function callClaude({ system, user }, maxTokens) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'Anthropic API error');
  const rawText = data?.content?.[0]?.text ?? '';
  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(rawText.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim());
  } catch (e) {
    parseError = e.message;
  }
  return { stopReason: data?.stop_reason, outputTokens: data?.usage?.output_tokens, rawText, parsed, parseError };
}

// ── Helpers ─────────────────────────────────────────────────────────────────────
const isInt0to100 = (n) => Number.isInteger(n) && n >= 0 && n <= 100;

// Collect every string value reachable in an object/array tree.
function collectStrings(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) for (const v of node) collectStrings(v, out);
  else if (node && typeof node === 'object') for (const v of Object.values(node)) collectStrings(v, out);
  return out;
}
function bannedIn(strings) {
  const offenders = [];
  for (const s of strings) {
    if (typeof s !== 'string') continue;
    if (s.includes('—')) offenders.push(`em-dash: "${s.slice(0, 60)}"`);
    if (s.includes('→')) offenders.push(`arrow →: "${s.slice(0, 60)}"`);
    if (s.includes(' -> ')) offenders.push(`arrow ->: "${s.slice(0, 60)}"`);
  }
  return offenders;
}
// Resume-bound fields only: paste-ready bullets + the generated resumeContent.
// Analytical prose (summary, recruiterReadReasons, recommendation, genuineGaps) is NOT scanned.
function bulletTexts(parsed) {
  const bs = parsed?.review?.bulletSuggestions;
  return Array.isArray(bs) ? bs.map(b => b?.bullet).filter(s => typeof s === 'string') : [];
}
function resumeStrings(parsed) {
  return parsed?.resumeContent ? collectStrings(parsed.resumeContent) : [];
}

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
}

// ── Run the routes ──────────────────────────────────────────────────────────────
console.log('Running prompts against synthetic fixtures (5 Anthropic calls)...\n');

const masterProfileJson = JSON.stringify(MASTER_PROFILE, null, 2);

const [scorerSdet1, scorerSdet2, scorerMl, tailorSdet, assembleSdet] = await Promise.all([
  callClaude(buildScorerPrompt(JD_SDET, RESUME_TEXT), 3000),
  callClaude(buildScorerPrompt(JD_SDET, RESUME_TEXT), 3000),
  callClaude(buildScorerPrompt(JD_ML, RESUME_TEXT), 3000),
  callClaude(buildTailorPrompt(masterProfileJson, JD_SDET), 6000),
  callClaude(buildAssemblerPrompt(MASTER_PROFILE, null, [], JD_SDET), 6000),
]);

// Mirror the SHIPPED behavior: routes sanitize resume-bound text after parsing
// (resumeContent for tailor/assembler, bulletSuggestions[].bullet for scorer/tailor).
// The suite validates that post-sanitization output, not raw model output.
function applyShippedSanitization(parsed) {
  if (!parsed) return;
  if (parsed.resumeContent) parsed.resumeContent = sanitizeResumeContent(parsed.resumeContent);
  if (parsed.review && Array.isArray(parsed.review.bulletSuggestions)) {
    parsed.review.bulletSuggestions = sanitizeBulletSuggestions(parsed.review.bulletSuggestions);
  }
}
applyShippedSanitization(scorerSdet1.parsed);
applyShippedSanitization(scorerSdet2.parsed);
applyShippedSanitization(scorerMl.parsed);
applyShippedSanitization(tailorSdet.parsed);
applyShippedSanitization(assembleSdet.parsed);

const sReview = scorerSdet1.parsed?.review;
const tReview = tailorSdet.parsed?.review;
const aOut = assembleSdet.parsed;

// 1. Scorer parses; scores are ints 0-100; bucketFit + recruiterReadReasons present.
{
  const ok = !scorerSdet1.parseError && sReview &&
    isInt0to100(sReview.matchScore) && isInt0to100(sReview.atsScore) && isInt0to100(sReview.recruiterScore) &&
    sReview.bucketFit != null && sReview.recruiterReadReasons != null;
  check('1. scorer JSON valid; scores int 0-100; bucketFit + recruiterReadReasons present', ok,
    `match=${sReview?.matchScore} ats=${sReview?.atsScore} recruiter=${sReview?.recruiterScore} bucketFit=${sReview?.bucketFit ? 'yes' : 'no'} reasons=${Array.isArray(sReview?.recruiterReadReasons) ? sReview.recruiterReadReasons.length : sReview?.recruiterReadReasons}`);
}

// 2. Scorer stop_reason === 'end_turn'.
check('2. scorer stop_reason === end_turn (no truncation)', scorerSdet1.stopReason === 'end_turn',
  `stop_reason=${scorerSdet1.stopReason}, output_tokens=${scorerSdet1.outputTokens}`);

// 3. bulletSuggestions.length <= 5.
{
  const n = Array.isArray(sReview?.bulletSuggestions) ? sReview.bulletSuggestions.length : -1;
  check('3. scorer bulletSuggestions.length <= 5', n >= 0 && n <= 5, `length=${n}`);
}

// 4. No em-dash / arrow chars in RESUME-BOUND text only: every bulletSuggestions[].bullet
//    across the routes that produce them, plus the generated resumeContent (tailor + assembler).
//    Analytical prose is intentionally excluded — a failure means a real leak into resume text.
{
  const groups = [
    ['scorer.bulletSuggestions', bulletTexts(scorerSdet1.parsed)],
    ['tailor.bulletSuggestions', bulletTexts(tailorSdet.parsed)],
    ['tailor.resumeContent', resumeStrings(tailorSdet.parsed)],
    ['assembler.resumeContent', resumeStrings(assembleSdet.parsed)],
  ];
  const allOffenders = [];
  for (const [label, strings] of groups) {
    for (const o of bannedIn(strings)) allOffenders.push(`${label} ${o}`);
  }
  const scanned = groups.reduce((n, [, s]) => n + s.length, 0);
  check('4. no em-dash/arrow in resume-bound text (bullets + resumeContent)', allOffenders.length === 0,
    allOffenders.length ? `${allOffenders.length} offender(s); first: ${allOffenders[0]}` : `clean across ${scanned} resume-bound strings`);
}

// 5. candidateBucket === 'new-grad' in scorer, tailor, AND assembler.
{
  const sb = sReview?.bucketFit?.candidateBucket;
  const tb = tReview?.bucketFit?.candidateBucket;
  const ab = aOut?.bucketFit?.candidateBucket;
  const norm = (b) => String(b ?? '').toLowerCase();
  const ok = norm(sb) === 'new-grad' && norm(tb) === 'new-grad' && norm(ab) === 'new-grad';
  check('5. candidateBucket === new-grad in scorer, tailor, assembler', ok,
    `scorer=${sb} tailor=${tb} assembler=${ab}`);
}

// 6. Any output with verdict reach/out-of-pool must have matchScore <= 60.
{
  const outs = [
    ['scorer', sReview?.bucketFit?.verdict, sReview?.matchScore],
    ['tailor', tReview?.bucketFit?.verdict, tReview?.matchScore],
    ['assembler', aOut?.bucketFit?.verdict, aOut?.score], // assembler's blended score field is "score"
  ];
  const violations = [];
  for (const [label, verdict, score] of outs) {
    const v = String(verdict ?? '').toLowerCase();
    if ((v === 'reach' || v === 'out-of-pool') && !(typeof score === 'number' && score <= 60)) {
      violations.push(`${label}(verdict=${verdict}, score=${score})`);
    }
  }
  check('6. reach/out-of-pool verdict => matchScore <= 60', violations.length === 0,
    violations.length ? `violations: ${violations.join(', ')}` : `checked: scorer=${sReview?.bucketFit?.verdict}/${sReview?.matchScore}, tailor=${tReview?.bucketFit?.verdict}/${tReview?.matchScore}, assembler=${aOut?.bucketFit?.verdict}/${aOut?.score}`);
}

// 7. Scorer decision stability across the two identical runs.
//    The DECISION must be deterministic — matchScore (the callback verdict) tight
//    and bucketFit.verdict identical. The diagnostic sub-scores (atsScore,
//    recruiterScore) may wobble at rounding boundaries: at temperature 0 Claude is
//    not bit-deterministic, and a borderline recruiterScore can flip order between
//    runs (e.g. 20<->30). We assert decision stability, not sub-score equality.
{
  const r2 = scorerSdet2.parsed?.review;
  const dMatch = Math.abs((sReview?.matchScore ?? 0) - (r2?.matchScore ?? 0));
  const dAts = Math.abs((sReview?.atsScore ?? 0) - (r2?.atsScore ?? 0));
  const dRec = Math.abs((sReview?.recruiterScore ?? 0) - (r2?.recruiterScore ?? 0));
  const v1 = String(sReview?.bucketFit?.verdict ?? '').toLowerCase();
  const v2 = String(r2?.bucketFit?.verdict ?? '').toLowerCase();
  const verdictSame = v1 !== '' && v1 === v2;
  const ok = !scorerSdet2.parseError && dMatch <= 2 && verdictSame && dAts <= 10 && dRec <= 10;
  check('7. scorer decision stability (matchScore Δ<=2 + verdict identical; diagnostic ats/recruiter Δ<=10)', ok,
    `run1=[${sReview?.matchScore},${sReview?.atsScore},${sReview?.recruiterScore}] run2=[${r2?.matchScore},${r2?.atsScore},${r2?.recruiterScore}] Δ=[${dMatch},${dAts},${dRec}] verdict=${v1}/${v2}`);
}

// 8. In-lane ML matchScore >= off-lane SDET matchScore + 5; AND SDET is reach/out-of-pool with laneWarning.
{
  const mlMatch = scorerMl.parsed?.review?.matchScore;
  const sdetMatch = sReview?.matchScore;
  const sdetVerdict = String(sReview?.bucketFit?.verdict ?? '').toLowerCase();
  const sdetLane = sReview?.laneWarning;
  const laneNonNull = sdetLane != null && String(sdetLane).trim() !== '' && String(sdetLane).toLowerCase() !== 'null';
  const ok = typeof mlMatch === 'number' && typeof sdetMatch === 'number' &&
    mlMatch >= sdetMatch + 5 &&
    (sdetVerdict === 'reach' || sdetVerdict === 'out-of-pool') &&
    laneNonNull;
  check('8. ML matchScore >= SDET+5 AND SDET reach/out-of-pool with laneWarning', ok,
    `ml=${mlMatch} sdet=${sdetMatch} (need ml>=${sdetMatch + 5}); sdetVerdict=${sReview?.bucketFit?.verdict}; laneWarning=${laneNonNull ? 'set' : 'missing'}`);
}

// ── Summary ─────────────────────────────────────────────────────────────────────
const passed = results.filter(r => r.passed).length;
const failed = results.length - passed;
console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ''}`);
console.log('─'.repeat(60));
process.exit(failed ? 1 : 0);
