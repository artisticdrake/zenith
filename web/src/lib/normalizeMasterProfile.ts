// ── MasterProfile types + normalization ──────────────────────────────────────
// Coerce arbitrary parsed JSON (imports, seeds, stored rows) into a valid
// MasterProfile. Every field the editor dereferences (tags.join, bullets.map,
// header.name, …) is guaranteed to exist afterwards, so malformed input shows
// up as empty fields instead of crashing the render tree. Also accepts common
// alternate shapes (categorized skills objects, snake_case tech stacks,
// header email/title aliases) seen in externally generated profile JSON.

export interface LibraryBullet {
  id: string; text: string; skills: string[];
  metric?: string; strength: 1 | 2 | 3; tags: string[];
}
export interface LibraryExperience {
  id: string; org: string; role: string; location?: string;
  startDate: string; endDate: string | null; current: boolean;
  defaultInclude: boolean; tags: string[]; bullets: LibraryBullet[];
}
export interface LibraryProject {
  id: string; name: string; startDate?: string; endDate?: string;
  tags: string[]; techStack: string[]; bullets: LibraryBullet[];
}
export interface LibraryEducation {
  id: string; institution: string; degree: string; field?: string;
  startDate?: string; endDate?: string; gpa?: string;
  defaultInclude: boolean; bullets: LibraryBullet[];
}
export interface LibrarySkill {
  canonical: string; display: string; category: string; proven: boolean;
}
export interface SummaryVariant { id: string; text: string; tags: string[]; }
export interface LibraryAward { id: string; title: string; issuer?: string; date?: string; tags: string[]; }

export interface MasterProfile {
  header: { name: string; title: string; phone: string; email: string; linkedin?: string; github?: string; portfolio?: string };
  summaries: SummaryVariant[];
  experiences: LibraryExperience[];
  projects: LibraryProject[];
  education: LibraryEducation[];
  skills: LibrarySkill[];
  awards: LibraryAward[];
}

export const EMPTY_PROFILE: MasterProfile = {
  header: { name: "", title: "", phone: "", email: "", linkedin: "", github: "", portfolio: "" },
  summaries: [], experiences: [], projects: [], education: [], skills: [], awards: [],
};

const uid = () => Math.random().toString(36).slice(2, 9);

// Collapse hard line-breaks that enter from PDF paste. Applied to all bullet
// and summary text during normalization.
export function collapseNewlines(text: string): string {
  return (text ?? '')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function tagsFromString(s: string): string[] {
  return s.split(",").map(t => t.trim()).filter(Boolean);
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}
function asStrArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(asStr).filter(Boolean);
  if (typeof v === "string") return tagsFromString(v);
  return [];
}
function asObjArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)) : [];
}

// Skills arrive in three shapes: the editor's own rows, plain string lists,
// or a categorized object like { ml_dl: ["PyTorch", …], … } (with stray
// non-array keys such as notes, which are skipped).
function normalizeSkills(v: unknown): LibrarySkill[] {
  if (Array.isArray(v)) {
    return v.flatMap((item): LibrarySkill[] => {
      if (typeof item === "string") {
        const s = item.trim();
        return s ? [{ canonical: s.toLowerCase(), display: s, category: "", proven: false }] : [];
      }
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        const display = asStr(o.display) || asStr(o.name) || asStr(o.canonical);
        if (!display) return [];
        return [{
          canonical: (asStr(o.canonical) || display).toLowerCase(),
          display,
          category: asStr(o.category),
          proven: !!o.proven,
        }];
      }
      return [];
    });
  }
  if (v && typeof v === "object") {
    return Object.entries(v as Record<string, unknown>).flatMap(([category, list]) =>
      Array.isArray(list)
        ? asStrArray(list).map(name => ({ canonical: name.toLowerCase(), display: name, category, proven: false }))
        : []
    );
  }
  return [];
}

function normalizeBullet(raw: Record<string, unknown>): LibraryBullet {
  const strength = raw.strength === 1 || raw.strength === 3 ? raw.strength : 2;
  return {
    id: asStr(raw.id) || uid(),
    text: collapseNewlines(asStr(raw.text)),
    skills: asStrArray(raw.skills),
    metric: asStr(raw.metric) || undefined,
    strength,
    tags: asStrArray(raw.tags),
  };
}

export function normalizeProfile(raw: unknown): MasterProfile {
  const p = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const header = (p.header && typeof p.header === "object" ? p.header : {}) as Record<string, unknown>;
  return {
    header: {
      name: asStr(header.name),
      title: asStr(header.title) || asStr(header.headline) || asStr(header.headline_linkedin),
      phone: asStr(header.phone),
      email: asStr(header.email) || asStr(header.email_primary),
      linkedin: asStr(header.linkedin), github: asStr(header.github), portfolio: asStr(header.portfolio),
    },
    summaries: asObjArray(p.summaries).map(s => ({
      id: asStr(s.id) || uid(), text: collapseNewlines(asStr(s.text)), tags: asStrArray(s.tags),
    })),
    experiences: asObjArray(p.experiences).map(e => ({
      id: asStr(e.id) || uid(), org: asStr(e.org), role: asStr(e.role),
      location: asStr(e.location) || undefined,
      startDate: asStr(e.startDate), endDate: asStr(e.endDate) || null,
      current: !!e.current, defaultInclude: !!e.defaultInclude,
      tags: asStrArray(e.tags), bullets: asObjArray(e.bullets).map(normalizeBullet),
    })),
    projects: asObjArray(p.projects).map(pr => ({
      id: asStr(pr.id) || uid(), name: asStr(pr.name),
      startDate: asStr(pr.startDate) || asStr(pr.dates) || undefined,
      endDate: asStr(pr.endDate) || undefined,
      tags: asStrArray(pr.tags),
      techStack: asStrArray(pr.techStack ?? pr.tech_stack ?? pr.tech_stack_actual_repo),
      bullets: asObjArray(pr.bullets).map(normalizeBullet),
    })),
    education: asObjArray(p.education).map(ed => ({
      id: asStr(ed.id) || uid(), institution: asStr(ed.institution), degree: asStr(ed.degree),
      field: asStr(ed.field) || undefined,
      startDate: asStr(ed.startDate) || undefined, endDate: asStr(ed.endDate) || undefined,
      gpa: asStr(ed.gpa) || undefined,
      defaultInclude: ed.defaultInclude !== false, bullets: asObjArray(ed.bullets).map(normalizeBullet),
    })),
    skills: normalizeSkills(p.skills),
    awards: asObjArray(p.awards).map(a => ({
      id: asStr(a.id) || uid(), title: asStr(a.title),
      issuer: asStr(a.issuer) || asStr(a.detail) || undefined,
      date: asStr(a.date) || undefined,
      tags: asStrArray(a.tags),
    })),
  };
}
