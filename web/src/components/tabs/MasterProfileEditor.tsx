import { useState, useCallback, useEffect } from "react";
import {
  ChevronDown, ChevronUp, Plus, Trash2, Loader2, Save,
  GripVertical, ChevronRight, Check, Star, FileJson, X, Download
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// ── Bullet text sanitization ─────────────────────────────────────────────────
// Collapse hard line-breaks that enter from PDF paste. Called both on key input
// and when importing JSON so existing data is cleaned on first load.

function collapseNewlines(text: string): string {
  return (text ?? '')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeProfileBullets<T extends object>(profile: T): T {
  const walk = (val: unknown): unknown => {
    if (Array.isArray(val)) return val.map(walk);
    if (val && typeof val === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        // Only sanitize bullet `text` fields, not all strings
        out[k] = k === 'text' && typeof v === 'string' ? collapseNewlines(v) : walk(v);
      }
      return out;
    }
    return val;
  };
  return walk(profile) as T;
}

// ── Tiny helpers ──────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

function tagsFromString(s: string): string[] {
  return s.split(",").map(t => t.trim()).filter(Boolean);
}
function tagsToString(tags: string[]): string {
  return tags.join(", ");
}

// ── Types (mirrors shared/types.ts MasterProfile) ─────────────────────────────

interface LibraryBullet {
  id: string; text: string; skills: string[];
  metric?: string; strength: 1 | 2 | 3; tags: string[];
}
interface LibraryExperience {
  id: string; org: string; role: string; location?: string;
  startDate: string; endDate: string | null; current: boolean;
  defaultInclude: boolean; tags: string[]; bullets: LibraryBullet[];
}
interface LibraryProject {
  id: string; name: string; startDate?: string; endDate?: string;
  tags: string[]; techStack: string[]; bullets: LibraryBullet[];
}
interface LibraryEducation {
  id: string; institution: string; degree: string; field?: string;
  startDate?: string; endDate?: string; gpa?: string;
  defaultInclude: boolean; bullets: LibraryBullet[];
}
interface LibrarySkill {
  canonical: string; display: string; category: string; proven: boolean;
}
interface SummaryVariant { id: string; text: string; tags: string[]; }
interface LibraryAward { id: string; title: string; issuer?: string; date?: string; tags: string[]; }

interface MasterProfile {
  header: { name: string; title: string; phone: string; email: string; linkedin?: string; github?: string; portfolio?: string };
  summaries: SummaryVariant[];
  experiences: LibraryExperience[];
  projects: LibraryProject[];
  education: LibraryEducation[];
  skills: LibrarySkill[];
  awards: LibraryAward[];
}

const EMPTY_PROFILE: MasterProfile = {
  header: { name: "", title: "", phone: "", email: "", linkedin: "", github: "", portfolio: "" },
  summaries: [], experiences: [], projects: [], education: [], skills: [], awards: [],
};

// ── Shared field components ────────────────────────────────────────────────────

function Field({ label, value, onChange, placeholder, multiline, className }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; multiline?: boolean; className?: string;
}) {
  const base = "w-full bg-muted/30 border border-border rounded-md px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary";
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label className="text-[10px] text-muted-foreground font-label uppercase tracking-wider">{label}</label>
      {multiline
        ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cn(base, "resize-none h-16")} />
        : <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={base} />
      }
    </div>
  );
}

function TagField({ label, value, onChange, placeholder }: {
  label: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string;
}) {
  return (
    <Field
      label={label}
      value={tagsToString(value)}
      onChange={v => onChange(tagsFromString(v))}
      placeholder={placeholder ?? "comma-separated"}
    />
  );
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <div
        onClick={() => onChange(!checked)}
        className={cn(
          "w-8 h-4 rounded-full transition-colors relative",
          checked ? "bg-primary" : "bg-muted"
        )}
      >
        <div className={cn("absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white transition-transform", checked && "translate-x-4")} />
      </div>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </label>
  );
}

function StrengthPicker({ value, onChange }: { value: 1 | 2 | 3; onChange: (v: 1 | 2 | 3) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-muted-foreground font-label uppercase tracking-wider">Strength</span>
      <div className="flex gap-1">
        {([1, 2, 3] as const).map(n => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-[11px] border transition-colors",
              value === n
                ? "bg-primary/10 border-primary/40 text-primary"
                : "border-border text-muted-foreground hover:border-border/80"
            )}
          >
            {Array.from({ length: n }).map((_, i) => <Star key={i} className="h-2.5 w-2.5 fill-current" />)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Bullet Editor ─────────────────────────────────────────────────────────────

function BulletEditor({ bullet, onChange, onDelete }: {
  bullet: LibraryBullet;
  onChange: (b: LibraryBullet) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const upd = (patch: Partial<LibraryBullet>) => onChange({ ...bullet, ...patch });

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      {/* Bullet text row */}
      <div className="flex items-start gap-2 p-2">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 mt-2 shrink-0" />
        <textarea
          value={bullet.text}
          onChange={e => {
            // Bullets are single sentences — replace any hard line-breaks with a space
            // so PDF-pasted text with visual wraps never creates split fragments
            const clean = e.target.value.replace(/\r\n|\r|\n/g, ' ').replace(/\s{2,}/g, ' ');
            upd({ text: clean });
          }}
          placeholder="Bullet text… (one sentence; paste freely — newlines collapsed)"
          className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none min-h-[40px]"
          rows={2}
        />
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Edit metadata"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={onDelete}
            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Metadata panel */}
      {expanded && (
        <div className="border-t border-border bg-muted/10 p-3 grid grid-cols-2 gap-3">
          <TagField
            label="Skills (canonical)"
            value={bullet.skills}
            onChange={v => upd({ skills: v })}
            placeholder="python, pytorch, sql"
          />
          <Field
            label="Metric (optional)"
            value={bullet.metric ?? ""}
            onChange={v => upd({ metric: v || undefined })}
            placeholder="e.g. 26% faster"
          />
          <StrengthPicker value={bullet.strength} onChange={v => upd({ strength: v })} />
          <TagField
            label="Domain tags"
            value={bullet.tags}
            onChange={v => upd({ tags: v })}
            placeholder="genai, nlp, fullstack"
          />
        </div>
      )}
    </div>
  );
}

function BulletList({ bullets, onChange }: {
  bullets: LibraryBullet[];
  onChange: (bullets: LibraryBullet[]) => void;
}) {
  const add = () => onChange([...bullets, { id: uid(), text: "", skills: [], strength: 2, tags: [] }]);
  const upd = (i: number, b: LibraryBullet) => { const next = [...bullets]; next[i] = b; onChange(next); };
  const del = (i: number) => onChange(bullets.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground font-label uppercase tracking-wider">Bullets</span>
        <button onClick={add} className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80">
          <Plus className="h-3 w-3" />Add bullet
        </button>
      </div>
      {bullets.length === 0 && (
        <p className="text-[11px] text-muted-foreground/50 italic">No bullets yet — click "Add bullet"</p>
      )}
      {bullets.map((b, i) => (
        <BulletEditor key={b.id} bullet={b} onChange={bb => upd(i, bb)} onDelete={() => del(i)} />
      ))}
    </div>
  );
}

// ── Section accordion wrapper ─────────────────────────────────────────────────

function Section({ title, count, children, onAdd, addLabel }: {
  title: string; count: number; children: React.ReactNode;
  onAdd?: () => void; addLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-foreground">{title}</span>
          <span className="text-[10px] text-muted-foreground font-label bg-muted px-1.5 py-0.5 rounded-full">{count}</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t border-border p-4 space-y-4">
          {children}
          {onAdd && (
            <button
              onClick={onAdd}
              className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-border rounded-lg text-[12px] text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />{addLabel ?? "Add item"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Item cards ────────────────────────────────────────────────────────────────

function ItemCard({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/20">
        <button onClick={() => setOpen(o => !o)} className="flex-1 text-left flex items-center gap-2">
          {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
        <button onClick={onDelete} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && <div className="p-3 space-y-3">{children}</div>}
    </div>
  );
}

// ── Experience items ──────────────────────────────────────────────────────────

function ExperienceItem({ exp, onChange, onDelete }: {
  exp: LibraryExperience; onChange: (e: LibraryExperience) => void; onDelete: () => void;
}) {
  const upd = (patch: Partial<LibraryExperience>) => onChange({ ...exp, ...patch });
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/20">
        <span className="text-[12px] font-medium text-foreground truncate max-w-[70%]">
          {exp.org || exp.role || "New Experience"}
        </span>
        <button onClick={onDelete} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Organization" value={exp.org} onChange={v => upd({ org: v })} placeholder="Boston University" />
          <Field label="Role / Title" value={exp.role} onChange={v => upd({ role: v })} placeholder="Software Engineer" />
          <Field label="Location (optional)" value={exp.location ?? ""} onChange={v => upd({ location: v })} placeholder="Boston, MA" />
          <Field label="Start Date" value={exp.startDate} onChange={v => upd({ startDate: v })} placeholder="Jan 2024" />
          {!exp.current && (
            <Field label="End Date" value={exp.endDate ?? ""} onChange={v => upd({ endDate: v || null })} placeholder="Dec 2024" />
          )}
        </div>
        <div className="flex gap-4">
          <ToggleField label="Currently working here" checked={exp.current} onChange={v => upd({ current: v, endDate: v ? null : exp.endDate })} />
          <ToggleField label="Always include" checked={exp.defaultInclude} onChange={v => upd({ defaultInclude: v })} />
        </div>
        <TagField label="Domain tags" value={exp.tags} onChange={v => upd({ tags: v })} placeholder="python, mlops, genai" />
        <BulletList bullets={exp.bullets} onChange={v => upd({ bullets: v })} />
      </div>
    </div>
  );
}

// ── Project items ─────────────────────────────────────────────────────────────

function ProjectItem({ proj, onChange, onDelete }: {
  proj: LibraryProject; onChange: (p: LibraryProject) => void; onDelete: () => void;
}) {
  const upd = (patch: Partial<LibraryProject>) => onChange({ ...proj, ...patch });
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/20">
        <span className="text-[12px] font-medium text-foreground truncate max-w-[70%]">{proj.name || "New Project"}</span>
        <button onClick={onDelete} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Project Name" value={proj.name} onChange={v => upd({ name: v })} placeholder="CHATALOGUE" className="col-span-2" />
          <Field label="Start Date (optional)" value={proj.startDate ?? ""} onChange={v => upd({ startDate: v })} placeholder="2024" />
          <Field label="End Date (optional)" value={proj.endDate ?? ""} onChange={v => upd({ endDate: v })} placeholder="2025" />
        </div>
        <TagField label="Tech Stack" value={proj.techStack} onChange={v => upd({ techStack: v })} placeholder="Python, FastAPI, Docker" />
        <TagField label="Domain tags" value={proj.tags} onChange={v => upd({ tags: v })} placeholder="nlp, genai, fullstack" />
        <BulletList bullets={proj.bullets} onChange={v => upd({ bullets: v })} />
      </div>
    </div>
  );
}

// ── Education items ───────────────────────────────────────────────────────────

function EducationItem({ edu, onChange, onDelete }: {
  edu: LibraryEducation; onChange: (e: LibraryEducation) => void; onDelete: () => void;
}) {
  const upd = (patch: Partial<LibraryEducation>) => onChange({ ...edu, ...patch });
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/20">
        <span className="text-[12px] font-medium text-foreground truncate max-w-[70%]">{edu.institution || "New Education"}</span>
        <button onClick={onDelete} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Institution" value={edu.institution} onChange={v => upd({ institution: v })} placeholder="Boston University" className="col-span-2" />
          <Field label="Degree" value={edu.degree} onChange={v => upd({ degree: v })} placeholder="MS Computer Science" />
          <Field label="Field (optional)" value={edu.field ?? ""} onChange={v => upd({ field: v })} placeholder="Data Analytics" />
          <Field label="Start Date" value={edu.startDate ?? ""} onChange={v => upd({ startDate: v })} placeholder="Aug 2024" />
          <Field label="End Date" value={edu.endDate ?? ""} onChange={v => upd({ endDate: v })} placeholder="May 2026" />
          <Field label="GPA (optional)" value={edu.gpa ?? ""} onChange={v => upd({ gpa: v })} placeholder="3.9" />
        </div>
        <ToggleField label="Always include" checked={edu.defaultInclude} onChange={v => upd({ defaultInclude: v })} />
        <BulletList bullets={edu.bullets} onChange={v => upd({ bullets: v })} />
      </div>
    </div>
  );
}

// ── Skill row ─────────────────────────────────────────────────────────────────

function SkillRow({ skill, onChange, onDelete }: {
  skill: LibrarySkill; onChange: (s: LibrarySkill) => void; onDelete: () => void;
}) {
  const upd = (patch: Partial<LibrarySkill>) => onChange({ ...skill, ...patch });
  return (
    <div className="flex items-center gap-2 p-2 border border-border rounded-lg bg-card">
      <input
        value={skill.display}
        onChange={e => upd({ display: e.target.value })}
        placeholder="PyTorch"
        className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
      />
      <input
        value={skill.canonical}
        onChange={e => upd({ canonical: e.target.value })}
        placeholder="pytorch"
        className="w-24 bg-muted/30 border border-border rounded px-1.5 py-1 text-[11px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <input
        value={skill.category}
        onChange={e => upd({ category: e.target.value })}
        placeholder="ML/DL"
        className="w-20 bg-muted/30 border border-border rounded px-1.5 py-1 text-[11px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <button
        onClick={() => upd({ proven: !skill.proven })}
        className={cn(
          "h-5 w-5 rounded border flex items-center justify-center transition-colors shrink-0",
          skill.proven ? "bg-primary border-primary text-primary-foreground" : "border-border text-transparent"
        )}
        title="Proven in experience/project bullet"
      >
        <Check className="h-3 w-3" />
      </button>
      <button onClick={onDelete} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

// ── Award row ─────────────────────────────────────────────────────────────────

function AwardRow({ award, onChange, onDelete }: {
  award: LibraryAward; onChange: (a: LibraryAward) => void; onDelete: () => void;
}) {
  const upd = (patch: Partial<LibraryAward>) => onChange({ ...award, ...patch });
  return (
    <div className="grid grid-cols-3 gap-2 p-2 border border-border rounded-lg bg-card items-center">
      <input value={award.title} onChange={e => upd({ title: e.target.value })} placeholder="Best ML Project" className="bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none col-span-1" />
      <input value={award.issuer ?? ""} onChange={e => upd({ issuer: e.target.value })} placeholder="Issuer" className="bg-muted/30 border border-border rounded px-1.5 py-1 text-[11px] text-muted-foreground focus:outline-none" />
      <div className="flex gap-2 items-center">
        <input value={award.date ?? ""} onChange={e => upd({ date: e.target.value })} placeholder="2024" className="w-16 bg-muted/30 border border-border rounded px-1.5 py-1 text-[11px] text-muted-foreground focus:outline-none" />
        <button onClick={onDelete} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors ml-auto">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ── Main Editor ───────────────────────────────────────────────────────────────

interface Props {
  session: any;
  alwaysOpen?: boolean;
  seedProfile?: MasterProfile | null;
}

export default function MasterProfileEditor({ session, alwaysOpen, seedProfile }: Props) {
  const [open, setOpen] = useState(alwaysOpen ?? false);
  const [profile, setProfile] = useState<MasterProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showJsonPanel, setShowJsonPanel] = useState(false);
  const [jsonImportText, setJsonImportText] = useState("");
  const [jsonImportError, setJsonImportError] = useState<string | null>(null);

  // Load once on mount when always-expanded (no toggle button to trigger load).
  // Empty deps intentional — session is always valid by the time this mounts,
  // and re-running on token refresh would wipe unsaved edits.
  useEffect(() => {
    if (alwaysOpen) load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When a seed profile arrives (from parse-from-resume), populate the editor
  useEffect(() => {
    if (!seedProfile) return;
    setProfile({ ...EMPTY_PROFILE, ...sanitizeProfileBullets(seedProfile) });
    if (!open) setOpen(true);
  }, [seedProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${API}/master-profile`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      if (data.data && Object.keys(data.data).length > 0) {
        setProfile({ ...EMPTY_PROFILE, ...sanitizeProfileBullets(data.data) });
      }
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  const save = useCallback(async () => {
    setSaving(true);
    setErrorMsg(null);
    setSavedMsg(false);
    try {
      const res = await fetch(`${API}/master-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify(profile),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2500);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setSaving(false);
    }
  }, [profile, session]);

  const handleOpen = () => {
    setOpen(o => {
      if (!o) load();
      return !o;
    });
  };

  const upd = (patch: Partial<MasterProfile>) => setProfile(p => ({ ...p, ...patch }));
  const updHeader = (patch: Partial<MasterProfile["header"]>) =>
    setProfile(p => ({ ...p, header: { ...p.header, ...patch } }));

  // ── Experiences ──────────────────────────────────────────────────────────
  const addExp = () => upd({ experiences: [...profile.experiences, { id: uid(), org: "", role: "", startDate: "", endDate: null, current: false, defaultInclude: false, tags: [], bullets: [] }] });
  const updExp = (i: number, e: LibraryExperience) => { const next = [...profile.experiences]; next[i] = e; upd({ experiences: next }); };
  const delExp = (i: number) => upd({ experiences: profile.experiences.filter((_, idx) => idx !== i) });

  // ── Projects ─────────────────────────────────────────────────────────────
  const addProj = () => upd({ projects: [...profile.projects, { id: uid(), name: "", tags: [], techStack: [], bullets: [] }] });
  const updProj = (i: number, p: LibraryProject) => { const next = [...profile.projects]; next[i] = p; upd({ projects: next }); };
  const delProj = (i: number) => upd({ projects: profile.projects.filter((_, idx) => idx !== i) });

  // ── Education ────────────────────────────────────────────────────────────
  const addEdu = () => upd({ education: [...profile.education, { id: uid(), institution: "", degree: "", defaultInclude: true, bullets: [] }] });
  const updEdu = (i: number, e: LibraryEducation) => { const next = [...profile.education]; next[i] = e; upd({ education: next }); };
  const delEdu = (i: number) => upd({ education: profile.education.filter((_, idx) => idx !== i) });

  // ── Skills ───────────────────────────────────────────────────────────────
  const addSkill = () => upd({ skills: [...profile.skills, { canonical: "", display: "", category: "", proven: false }] });
  const updSkill = (i: number, s: LibrarySkill) => { const next = [...profile.skills]; next[i] = s; upd({ skills: next }); };
  const delSkill = (i: number) => upd({ skills: profile.skills.filter((_, idx) => idx !== i) });

  // ── Summaries ────────────────────────────────────────────────────────────
  const addSum = () => upd({ summaries: [...profile.summaries, { id: uid(), text: "", tags: [] }] });
  const updSum = (i: number, s: SummaryVariant) => { const next = [...profile.summaries]; next[i] = s; upd({ summaries: next }); };
  const delSum = (i: number) => upd({ summaries: profile.summaries.filter((_, idx) => idx !== i) });

  // ── Awards ───────────────────────────────────────────────────────────────
  const addAward = () => upd({ awards: [...(profile.awards ?? []), { id: uid(), title: "", tags: [] }] });
  const updAward = (i: number, a: LibraryAward) => { const next = [...(profile.awards ?? [])]; next[i] = a; upd({ awards: next }); };
  const delAward = (i: number) => upd({ awards: (profile.awards ?? []).filter((_, idx) => idx !== i) });

  return (
    <div className={alwaysOpen ? "space-y-4" : "border border-border rounded-xl overflow-hidden"}>
      {/* Accordion header — hidden when alwaysOpen (MasterInfoTab renders its own header) */}
      {!alwaysOpen && (
        <button
          onClick={handleOpen}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40 transition-colors"
        >
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            Master Profile Library
          </span>
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>
      )}

      {open && (
        <div className={alwaysOpen ? "space-y-4" : "border-t border-border p-4 space-y-4"}>
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground text-xs py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading your library…
            </div>
          )}

          {!loading && (
            <>
              {/* ── Header ─────────────────────────────────────────────── */}
              <Section title="Header" count={1}>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Full Name" value={profile.header.name} onChange={v => updHeader({ name: v })} placeholder="Preetham Prathipati" />
                  <Field label="Professional Title" value={profile.header.title} onChange={v => updHeader({ title: v })} placeholder="ML Engineer | NLP" />
                  <Field label="Phone" value={profile.header.phone} onChange={v => updHeader({ phone: v })} placeholder="617-000-0000" />
                  <Field label="Email" value={profile.header.email} onChange={v => updHeader({ email: v })} placeholder="you@email.com" />
                  <Field label="LinkedIn (optional)" value={profile.header.linkedin ?? ""} onChange={v => updHeader({ linkedin: v })} placeholder="linkedin.com/in/..." />
                  <Field label="GitHub (optional)" value={profile.header.github ?? ""} onChange={v => updHeader({ github: v })} placeholder="github.com/..." />
                  <Field label="Portfolio (optional)" value={profile.header.portfolio ?? ""} onChange={v => updHeader({ portfolio: v })} placeholder="yoursite.com" className="col-span-2" />
                </div>
              </Section>

              {/* ── Summaries ───────────────────────────────────────────── */}
              <Section title="Summaries" count={profile.summaries.length} onAdd={addSum} addLabel="Add summary variant">
                <p className="text-[11px] text-muted-foreground -mt-1">
                  Add multiple variants with different tags — the engine picks the best fit for each JD.
                </p>
                {profile.summaries.map((s, i) => (
                  <div key={s.id} className="border border-border rounded-lg p-3 space-y-2">
                    <Field label="Summary Text" value={s.text} onChange={v => updSum(i, { ...s, text: v })} multiline />
                    <div className="flex gap-2 items-end">
                      <TagField label="Tags" value={s.tags} onChange={v => updSum(i, { ...s, tags: v })} placeholder="genai, nlp, mlops" />
                      <button onClick={() => delSum(i)} className="p-1.5 mb-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </Section>

              {/* ── Experiences ─────────────────────────────────────────── */}
              <Section title="Experiences" count={profile.experiences.length} onAdd={addExp} addLabel="Add experience">
                {profile.experiences.map((exp, i) => (
                  <ExperienceItem key={exp.id} exp={exp} onChange={e => updExp(i, e)} onDelete={() => delExp(i)} />
                ))}
              </Section>

              {/* ── Projects ────────────────────────────────────────────── */}
              <Section title="Projects" count={profile.projects.length} onAdd={addProj} addLabel="Add project">
                {profile.projects.map((proj, i) => (
                  <ProjectItem key={proj.id} proj={proj} onChange={p => updProj(i, p)} onDelete={() => delProj(i)} />
                ))}
              </Section>

              {/* ── Education ───────────────────────────────────────────── */}
              <Section title="Education" count={profile.education.length} onAdd={addEdu} addLabel="Add education">
                {profile.education.map((edu, i) => (
                  <EducationItem key={edu.id} edu={edu} onChange={e => updEdu(i, e)} onDelete={() => delEdu(i)} />
                ))}
              </Section>

              {/* ── Skills ──────────────────────────────────────────────── */}
              <Section title="Skills" count={profile.skills.length} onAdd={addSkill} addLabel="Add skill">
                {profile.skills.length > 0 && (
                  <div className="flex gap-1 text-[10px] text-muted-foreground font-label uppercase tracking-wider px-2 mb-1">
                    <span className="flex-1">Display name</span>
                    <span className="w-24">Canonical key</span>
                    <span className="w-20">Category</span>
                    <span className="w-8 text-center">Proven</span>
                    <span className="w-8" />
                  </div>
                )}
                {profile.skills.map((s, i) => (
                  <SkillRow key={i} skill={s} onChange={sk => updSkill(i, sk)} onDelete={() => delSkill(i)} />
                ))}
                <p className="text-[10px] text-muted-foreground/60 italic">
                  Canonical key must match the Skill Dictionary (e.g. "pytorch", "python", "docker"). Proven = appears in an experience/project bullet.
                </p>
              </Section>

              {/* ── Awards ──────────────────────────────────────────────── */}
              <Section title="Awards & Honors" count={(profile.awards ?? []).length} onAdd={addAward} addLabel="Add award">
                {(profile.awards ?? []).map((a, i) => (
                  <AwardRow key={a.id} award={a} onChange={aw => updAward(i, aw)} onDelete={() => delAward(i)} />
                ))}
              </Section>

              {/* ── JSON import panel ────────────────────────────────────── */}
              {showJsonPanel && (
                <div className="border border-border rounded-xl bg-muted/10 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] font-semibold text-foreground">Import / Export JSON</p>
                    <button
                      onClick={() => { setShowJsonPanel(false); setJsonImportError(null); setJsonImportText(""); }}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Paste a full <code className="bg-muted px-1 rounded text-[10px]">MasterProfile</code> JSON to overwrite the current library, or copy the export below to back it up.
                  </p>
                  <textarea
                    value={jsonImportText}
                    onChange={e => { setJsonImportText(e.target.value); setJsonImportError(null); }}
                    placeholder='{ "header": { ... }, "experiences": [...], ... }'
                    className="w-full h-48 font-mono text-[11px] bg-muted/30 border border-border rounded-lg p-3 resize-y text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
                    spellCheck={false}
                  />
                  {jsonImportError && (
                    <p className="text-[11px] text-destructive flex items-center gap-1.5">
                      <X className="h-3 w-3 shrink-0" />{jsonImportError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        try {
                          const parsed = JSON.parse(jsonImportText);
                          // Sanitize bullet texts on import — collapses PDF-pasted newlines
                          setProfile({ ...EMPTY_PROFILE, ...sanitizeProfileBullets(parsed) });
                          setJsonImportText("");
                          setJsonImportError(null);
                          setShowJsonPanel(false);
                        } catch (e: any) {
                          setJsonImportError(`Invalid JSON: ${e.message}`);
                        }
                      }}
                      disabled={!jsonImportText.trim()}
                    >
                      Apply JSON
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setJsonImportText(JSON.stringify(profile, null, 2))}
                    >
                      <Download className="h-3.5 w-3.5 mr-1.5" />Export current
                    </Button>
                  </div>
                </div>
              )}

              {/* ── Save bar ────────────────────────────────────────────── */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                <div className="flex items-center gap-2">
                  {errorMsg && <p className="text-[11px] text-destructive">{errorMsg}</p>}
                  {savedMsg && (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                      <Check className="h-3.5 w-3.5" />Library saved
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setShowJsonPanel(p => !p); setJsonImportError(null); }}
                  >
                    <FileJson className="h-3.5 w-3.5 mr-1.5" />JSON
                  </Button>
                  <Button onClick={save} disabled={saving} size="sm">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                    Save Library
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
