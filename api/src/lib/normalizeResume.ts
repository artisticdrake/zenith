// ── ResumeContent / ResumeSettings / review normalization ────────────────────
// Coerce arbitrary JSON (Claude tailor output, client export requests) into the
// exact shapes the renderers and the web Builder depend on. Malformed input
// degrades to empty fields instead of crashing a render or poisoning the
// tailor_results cache.
//
// web/src/lib/normalizeResume.ts is a mirror of the content/settings part of
// this module — keep them in sync.

export interface BulletItem { id: string; text: string; }
export interface ResumeSectionItem {
  id: string;
  organization?: string; role?: string; location?: string; date?: string;
  bullets: BulletItem[];
  projectName?: string; techStack?: string; dateRange?: string;
  category?: string; items?: string;
  content?: string;
}
export type SectionType = 'education' | 'experience' | 'projects' | 'skills' | 'custom';
export interface ResumeSection {
  id: string; type: SectionType; title: string; visible: boolean; items: ResumeSectionItem[];
}
export interface ResumeContent {
  header: { name: string; title: string; phone: string; email: string; linkedin: string; github: string; portfolio: string };
  summary: string;
  showSummary: boolean;
  sections: ResumeSection[];
}
export interface ResumeSettings {
  fontSize: number; fontFamily: string; lineSpacing: number;
  sectionSpacing: number; marginSize: number; autoFitOnePage: boolean;
  headerAlign: 'center' | 'left';
}

const DEFAULT_SETTINGS: ResumeSettings = {
  fontSize: 10.5, fontFamily: 'charter', lineSpacing: 1.15,
  sectionSpacing: 6, marginSize: 0.5, autoFitOnePage: false, headerAlign: 'center',
};

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

// IDs double as React keys in the web Builder — ensure presence and uniqueness.
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

// ── Tailor review ─────────────────────────────────────────────────────────────
// The TailorTab renders these fields; coerce them so a creative Claude response
// (string instead of array, "73" instead of 73) can't crash the review panel.

// A piece of guidance paired with a concrete, ready-to-paste resume line and
// the section it belongs in, so the user can push it straight into the Builder.
export interface BulletSuggestion {
  section: 'experience' | 'projects' | 'skills' | 'summary';
  target?: string;
  guidance: string;
  bullet: string;
}

export interface TailorReview {
  summary: string;
  keptItems: string[];
  droppedItems: string[];
  skillsSurfaced: string[];
  suggestions: string[];
  bulletSuggestions: BulletSuggestion[];
  fitAssessment?: { level: 'strong' | 'moderate' | 'weak'; rationale: string };
  recommendation?: string;
  genuineGaps: string[];
  matchScore?: number;
}

const BULLET_SECTIONS = ['experience', 'projects', 'skills', 'summary'] as const;

function normalizeBulletSuggestions(v: unknown): BulletSuggestion[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw): BulletSuggestion[] => {
    if (!isRec(raw)) return [];
    const bullet = asStr(raw.bullet);
    if (!bullet) return [];
    const section = (BULLET_SECTIONS as readonly string[]).includes(asStr(raw.section))
      ? (asStr(raw.section) as BulletSuggestion['section'])
      : 'experience';
    return [{ section, target: asOpt(raw.target), guidance: asStr(raw.guidance), bullet }];
  });
}

function asStrArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(asStr).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v];
  return [];
}

export function normalizeReview(raw: unknown): TailorReview | null {
  if (!isRec(raw)) return null;
  const fitRaw = asRec(raw.fitAssessment);
  const level = fitRaw.level === 'strong' || fitRaw.level === 'weak' ? fitRaw.level : 'moderate';
  const scoreNum = raw.matchScore == null ? NaN : Number(raw.matchScore);
  return {
    summary: asStr(raw.summary),
    keptItems: asStrArray(raw.keptItems),
    droppedItems: asStrArray(raw.droppedItems),
    skillsSurfaced: asStrArray(raw.skillsSurfaced),
    suggestions: asStrArray(raw.suggestions),
    bulletSuggestions: normalizeBulletSuggestions(raw.bulletSuggestions),
    fitAssessment: isRec(raw.fitAssessment)
      ? { level, rationale: asStr(fitRaw.rationale) }
      : undefined,
    recommendation: asOpt(raw.recommendation),
    genuineGaps: asStrArray(raw.genuineGaps),
    matchScore: Number.isFinite(scoreNum) ? Math.min(100, Math.max(0, Math.round(scoreNum))) : undefined,
  };
}
