// ── ResumeContent / ResumeSettings normalization ─────────────────────────────
// Coerce arbitrary JSON (Claude tailor output, localStorage handoff, DB rows)
// into a valid ResumeContent/ResumeSettings. Every field the preview, editor,
// LaTeX export, and PDF export dereference is guaranteed to exist afterwards,
// so malformed input degrades to empty fields instead of crashing the Builder.
//
// api/src/lib/normalizeResume.ts is a mirror of this module — keep them in sync.

import {
  DEFAULT_SETTINGS,
  type BulletItem,
  type ResumeContent,
  type ResumeSection,
  type ResumeSectionItem,
  type ResumeSettings,
  type SectionType,
} from '../types/resume.types';

const uid = () => Math.random().toString(36).slice(2, 9);

const SECTION_TYPES: SectionType[] = ['education', 'experience', 'projects', 'skills', 'custom'];

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}
function asOpt(v: unknown): string | undefined {
  return asStr(v) || undefined;
}
// Strings are expected, but LLMs sometimes emit arrays for list-like fields
// (techStack, skill items) — join those instead of dropping them.
function asJoined(v: unknown): string | undefined {
  if (Array.isArray(v)) return v.map(asStr).filter(Boolean).join(', ') || undefined;
  return asOpt(v);
}
function asRec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function isRec(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// IDs double as React keys — make sure they exist and are unique within a list.
function uniqueId(candidate: string, seen: Set<string>): string {
  let id = candidate;
  while (!id || seen.has(id)) id = uid();
  seen.add(id);
  return id;
}

function normalizeBullets(v: unknown): BulletItem[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  return v.flatMap((b): BulletItem[] => {
    if (typeof b === 'string') {
      return b.trim() ? [{ id: uniqueId('', seen), text: b }] : [];
    }
    if (isRec(b)) return [{ id: uniqueId(asStr(b.id), seen), text: asStr(b.text) }];
    return [];
  });
}

function normalizeItem(raw: Record<string, unknown>, seen: Set<string>): ResumeSectionItem {
  return {
    id: uniqueId(asStr(raw.id), seen),
    organization: asOpt(raw.organization),
    location: asOpt(raw.location),
    role: asOpt(raw.role),
    date: asOpt(raw.date),
    bullets: normalizeBullets(raw.bullets),
    projectName: asOpt(raw.projectName),
    techStack: asJoined(raw.techStack),
    dateRange: asOpt(raw.dateRange),
    category: asOpt(raw.category),
    items: asJoined(raw.items),
    content: asOpt(raw.content),
  };
}

function normalizeSection(raw: Record<string, unknown>, seen: Set<string>): ResumeSection {
  const type: SectionType = SECTION_TYPES.includes(raw.type as SectionType)
    ? (raw.type as SectionType)
    : 'custom';
  const itemSeen = new Set<string>();
  return {
    id: uniqueId(asStr(raw.id), seen),
    type,
    title: asStr(raw.title) || type.charAt(0).toUpperCase() + type.slice(1),
    visible: raw.visible !== false,
    items: Array.isArray(raw.items)
      ? raw.items.filter(isRec).map((it) => normalizeItem(it, itemSeen))
      : [],
  };
}

export function normalizeResumeContent(raw: unknown): ResumeContent {
  const p = asRec(raw);
  const h = asRec(p.header);
  const sectionSeen = new Set<string>();
  return {
    header: {
      name: asStr(h.name),
      title: asStr(h.title),
      phone: asStr(h.phone),
      email: asStr(h.email),
      linkedin: asStr(h.linkedin),
      github: asStr(h.github),
      portfolio: asStr(h.portfolio),
    },
    summary: asStr(p.summary),
    showSummary: typeof p.showSummary === 'boolean' ? p.showSummary : Boolean(asStr(p.summary)),
    sections: Array.isArray(p.sections)
      ? p.sections.filter(isRec).map((s) => normalizeSection(s, sectionSeen))
      : [],
  };
}

function asNum(v: unknown, fallback: number, min: number, max: number): number {
  // Number(null) and Number('') are 0 — treat absent values as absent
  const n = typeof v === 'number' ? v : v == null || v === '' ? NaN : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeResumeSettings(raw: unknown): ResumeSettings {
  const p = asRec(raw);
  return {
    fontSize: asNum(p.fontSize, DEFAULT_SETTINGS.fontSize, 6, 24),
    fontFamily: asStr(p.fontFamily) || DEFAULT_SETTINGS.fontFamily,
    lineSpacing: asNum(p.lineSpacing, DEFAULT_SETTINGS.lineSpacing, 0.8, 3),
    sectionSpacing: asNum(p.sectionSpacing, DEFAULT_SETTINGS.sectionSpacing, 0, 40),
    marginSize: asNum(p.marginSize, DEFAULT_SETTINGS.marginSize, 0.2, 2),
    autoFitOnePage: p.autoFitOnePage === true,
    headerAlign: p.headerAlign === 'left' ? 'left' : 'center',
  };
}
