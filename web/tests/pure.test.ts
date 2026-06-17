import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { todayISO, parseLocalYYYYMMDD, formatDate, startOfWeekISO } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';
import { useCountUp } from '@/lib/useCountUp';
import {
  normalizeProfile,
  collapseNewlines,
  tagsFromString,
  EMPTY_PROFILE,
} from '@/lib/normalizeMasterProfile';

// ── dateUtils ────────────────────────────────────────────────────────────────

describe('dateUtils', () => {
  it('todayISO returns YYYY-MM-DD', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('parseLocalYYYYMMDD parses valid and rejects junk', () => {
    const d = parseLocalYYYYMMDD('2026-06-13')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // June = 5
    expect(d.getDate()).toBe(13);
    expect(parseLocalYYYYMMDD('')).toBeNull();
    expect(parseLocalYYYYMMDD(null)).toBeNull();
    expect(parseLocalYYYYMMDD('not-a-date')).toBeNull();
    expect(parseLocalYYYYMMDD('2026-00-00')).toBeNull();
  });

  it('formatDate returns empty string for bad input', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('2026-06-13')).not.toBe('');
  });

  it('startOfWeekISO snaps to the Monday of that week', () => {
    expect(startOfWeekISO('2024-01-03')).toBe('2024-01-01'); // Wed → Mon
    expect(startOfWeekISO('2024-01-01')).toBe('2024-01-01'); // Mon → Mon
    expect(startOfWeekISO('2024-01-07')).toBe('2024-01-01'); // Sun → prior Mon
    expect(startOfWeekISO('')).toBe('');
  });
});

// ── utils.cn ──────────────────────────────────────────────────────────────────

describe('cn', () => {
  it('joins truthy classes and drops falsy', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c');
  });
  it('resolves conflicting tailwind classes (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });
});

// ── normalizeMasterProfile ────────────────────────────────────────────────────

describe('collapseNewlines / tagsFromString', () => {
  it('collapses CRLF/LF and extra spaces', () => {
    expect(collapseNewlines('a\r\nb\n c   d')).toBe('a b c d');
    expect(collapseNewlines(undefined as any)).toBe('');
  });
  it('splits comma strings into trimmed tags', () => {
    expect(tagsFromString(' a, b ,,c ')).toEqual(['a', 'b', 'c']);
    expect(tagsFromString('')).toEqual([]);
  });
});

describe('normalizeProfile', () => {
  it('garbage inputs degrade to an empty-but-valid profile', () => {
    for (const bad of [null, undefined, 42, 'x', []]) {
      const p = normalizeProfile(bad);
      expect(typeof p.header.name).toBe('string');
      for (const k of ['summaries', 'experiences', 'projects', 'education', 'skills', 'awards'] as const) {
        expect(Array.isArray(p[k])).toBe(true);
      }
    }
    expect(normalizeProfile(null).header).toEqual(EMPTY_PROFILE.header);
  });

  it('maps header aliases (headline_linkedin, email_primary)', () => {
    const p = normalizeProfile({ header: { name: 'N', headline_linkedin: 'ML Eng', email_primary: 'a@b.c' } });
    expect(p.header.title).toBe('ML Eng');
    expect(p.header.email).toBe('a@b.c');
  });

  it('flattens categorized skills object and skips non-array keys', () => {
    const p = normalizeProfile({ skills: { languages: ['Python', 'SQL'], note: 'skip me', ml: ['PyTorch'] } });
    expect(p.skills.map(s => s.display).sort()).toEqual(['PyTorch', 'Python', 'SQL']);
    expect(p.skills.find(s => s.display === 'Python')!.category).toBe('languages');
  });

  it('accepts project tech_stack aliases and dates alias', () => {
    const p = normalizeProfile({ projects: [{ name: 'P', dates: '2024', tech_stack: ['Flask', 'SQLite'] }] });
    expect(p.projects[0].startDate).toBe('2024');
    expect(p.projects[0].techStack).toEqual(['Flask', 'SQLite']);
  });

  it('education defaultInclude defaults to true, awards issuer alias', () => {
    const p = normalizeProfile({
      education: [{ institution: 'BU', degree: 'MS' }],
      awards: [{ title: 'Best', detail: 'ACME' }],
    });
    expect(p.education[0].defaultInclude).toBe(true);
    expect(p.awards[0].issuer).toBe('ACME');
  });

  it('bullet strength defaults to 2 and newlines collapse', () => {
    const p = normalizeProfile({ experiences: [{ org: 'O', bullets: [{ text: 'line\nbreak' }] }] });
    const b = p.experiences[0].bullets[0];
    expect(b.strength).toBe(2);
    expect(b.text).toBe('line break');
    expect(b.id).toBeTruthy();
  });
});

// ── useCountUp ────────────────────────────────────────────────────────────────

describe('useCountUp', () => {
  it('stays at 0 for a target of 0', () => {
    const { result } = renderHook(() => useCountUp(0, 50));
    expect(result.current).toBe(0);
  });

  it('animates up to the target', async () => {
    const { result } = renderHook(() => useCountUp(42, 50));
    await waitFor(() => expect(result.current).toBe(42), { timeout: 2000 });
  });
});
