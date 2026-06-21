/**
 * sanitizeResumeText.ts
 *
 * Deterministic safety net for resume-BOUND text (paste-ready bullets and the
 * generated resumeContent). The OUTPUT HYGIENE prompt rules keep model output
 * naturally clean, so this rarely fires — but when the model slips an em dash or
 * arrow into a resume line, this guarantees it never reaches the resume.
 *
 * Applied to resume text ONLY. Analytical prose (summary, recruiterReadReasons,
 * recommendation, genuineGaps) is left alone and may use normal punctuation.
 */

/**
 * Replace presentation-hostile glyphs in a single string:
 *   - em dash U+2014 (—)            -> " - "
 *   - arrow  U+2192 (→) and " -> "  -> " to "
 * En dash U+2013 (–), hyphens, and every other character are left untouched.
 */
export function sanitizeResumeText(text: string): string {
  if (typeof text !== 'string') return text;
  return text
    .replace(/ -> /g, ' to ')   // literal " -> "
    .replace(/→/g, ' to ') // arrow →
    .replace(/—/g, ' - '); // em dash —
}

/** Recursively sanitize every string in a value, returning a sanitized clone. */
function deepSanitize<T>(value: T): T {
  if (typeof value === 'string') return sanitizeResumeText(value) as unknown as T;
  if (Array.isArray(value)) return value.map(deepSanitize) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepSanitize(v);
    return out as T;
  }
  return value;
}

/**
 * Deep-sanitize every string in a resumeContent object (bullets, summary, titles,
 * skills, etc.). The whole object is resume-bound text, so all of it is sanitized.
 */
export function sanitizeResumeContent<T>(content: T): T {
  return deepSanitize(content);
}

/** Sanitize the paste-ready `bullet` text of each bulletSuggestions entry. */
export function sanitizeBulletSuggestions<T>(bullets: T): T {
  if (!Array.isArray(bullets)) return bullets;
  return bullets.map((b: any) =>
    b && typeof b === 'object' && typeof b.bullet === 'string'
      ? { ...b, bullet: sanitizeResumeText(b.bullet) }
      : b,
  ) as unknown as T;
}
