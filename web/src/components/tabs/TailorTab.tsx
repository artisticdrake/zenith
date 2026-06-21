import { useState, useCallback, useEffect, useRef } from "react";
import {
  Wand2, Loader2, XCircle, Sparkles, ArrowRight, RefreshCw,
  ChevronDown, ChevronUp, RotateCcw,
  Lightbulb, Copy, Check, CheckSquare, Square,
  FileText, Mail, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { JobApplication } from "@/lib/types";
import type { ApprovedBullet, BulletSuggestion } from "@/lib/bulletSuggestions";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const SESSION_KEY = "jt.tailor_session";

const uid = () => Math.random().toString(36).slice(2, 9);

// Stable empty array so child effects keyed on `items` don't re-fire each render.
const EMPTY_BULLETS: BulletSuggestion[] = [];

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClaudeReview {
  summary: string;
  keptItems: string[];
  droppedItems: string[];
  skillsSurfaced: string[];
  suggestions: string[];
  bulletSuggestions?: BulletSuggestion[];
  fitAssessment?: { level: "strong" | "moderate" | "weak"; rationale: string };
  recommendation?: string;
  genuineGaps?: string[];
  matchScore?: number;
}

interface ClaudeResult {
  resumeContent: unknown;
  review: ClaudeReview | null;
  fromCache?: boolean;
}

// Result of a server-side assembly pass (POST /assemble/claude).
export interface AssembleResult {
  score: number | null;
  changeLog: string[];
  at: number;
}

interface Props {
  apps: JobApplication[];
  session: any;
  onAssembled: (result: AssembleResult) => void;
}

// ── Score Ring (Claude-generated) ─────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const isStrong  = score >= 75;
  const isPartial = score >= 50;
  const ringColor = isStrong ? "#10b981" : isPartial ? "#f59e0b" : "#ef4444";
  const textColor = isStrong ? "text-emerald-400" : isPartial ? "text-amber-400" : "text-red-400";
  const label     = isStrong ? "Strong Match" : isPartial ? "Partial Match" : "Weak Match";
  const r = 44;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative flex items-center justify-center">
        <svg width="110" height="110" className="-rotate-90">
          <circle cx="55" cy="55" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
          <circle
            cx="55" cy="55" r={r} fill="none"
            stroke={ringColor} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
            style={{ filter: `drop-shadow(0 0 5px ${ringColor}60)` }}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className={cn("text-2xl font-black tabular-nums", textColor)}>{score}</span>
          <span className="text-[9px] text-muted-foreground font-label uppercase tracking-wider">/100</span>
        </div>
      </div>
      <span className={cn("text-[11px] font-semibold font-label", textColor)}>{label}</span>
      <span className="text-[10px] text-muted-foreground font-label">Claude's assessment</span>
    </div>
  );
}

// ── Collapsible list section ──────────────────────────────────────────────────

function ReviewList({ title, items, colorClass }: { title: string; items: string[]; colorClass: string }) {
  const [open, setOpen] = useState(true);
  if (!items.length) return null;
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[11px] font-semibold mb-1.5 w-full text-left"
      >
        <span className={colorClass}>{title}</span>
        <span className="text-muted-foreground/50 ml-auto">
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </span>
      </button>
      {open && (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
              <span className={cn("shrink-0 mt-0.5", colorClass)}>•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Editable, approvable candidate bullets ────────────────────────────────────
// Each suggestion is an editable line + an approve checkbox. "Send to Builder"
// collects only the checked rows (with their current text) and hands them to the
// server-side assembly pass.

const SECTION_LABEL: Record<BulletSuggestion["section"], string> = {
  experience: "Experience",
  projects: "Projects",
  skills: "Skills",
  summary: "Summary",
};

function EditableBulletList({
  items,
  sending,
  onSend,
}: {
  items: BulletSuggestion[];
  sending: boolean;
  onSend: (approved: ApprovedBullet[]) => void;
}) {
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState(() => items.map(it => ({ text: it.bullet, checked: false })));
  const [copied, setCopied] = useState<number | null>(null);

  // Reset rows when a new set of suggestions arrives (stable `items` reference
  // means user edits survive re-renders; only a genuinely new list resets them).
  useEffect(() => {
    setRows(items.map(it => ({ text: it.bullet, checked: false })));
  }, [items]);

  if (!items.length) return null;

  const checkedCount = rows.filter(r => r.checked).length;
  const allChecked = checkedCount === rows.length && rows.length > 0;

  const toggle = (i: number) =>
    setRows(rs => rs.map((r, idx) => (idx === i ? { ...r, checked: !r.checked } : r)));
  const edit = (i: number, text: string) =>
    setRows(rs => rs.map((r, idx) => (idx === i ? { ...r, text } : r)));
  const toggleAll = () =>
    setRows(rs => rs.map(r => ({ ...r, checked: !allChecked })));

  const copyOne = async (i: number) => {
    try {
      await navigator.clipboard.writeText(rows[i].text);
      setCopied(i);
      setTimeout(() => setCopied(c => (c === i ? null : c)), 1500);
    } catch { /* clipboard blocked */ }
  };

  const send = () => {
    const approved: ApprovedBullet[] = rows
      .map((row, i) => ({ row, it: items[i] }))
      .filter(({ row }) => row.checked && row.text.trim())
      .map(({ row, it }) => ({
        id: uid(),
        text: row.text.trim(),
        section: it.section,
        target: it.target,
      }));
    if (approved.length) onSend(approved);
  };

  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3.5 space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-400 flex-1 text-left"
        >
          <Lightbulb className="h-3.5 w-3.5" />
          Candidate bullets — edit &amp; approve
          <span className="text-amber-400/50 ml-auto">
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </span>
        </button>
      </div>

      {open && (
        <>
          <p className="text-[10.5px] text-muted-foreground -mt-1">
            Edit any line (keep <code className="text-amber-400/80">[X]</code> placeholders), check the ones
            to include, then Send to Builder. Claude assembles a fresh one-page resume from your Master
            Profile, your current resume, and the bullets you approve.
          </p>

          <div className="space-y-2.5">
            {items.map((it, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-md border p-2.5 space-y-2 transition-colors",
                  rows[i]?.checked ? "border-amber-500/50 bg-amber-500/[0.06]" : "border-border bg-card/60",
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-400 shrink-0 mt-0.5">
                    {SECTION_LABEL[it.section] ?? it.section}
                    {it.target ? <span className="text-muted-foreground font-medium normal-case tracking-normal"> · {it.target}</span> : null}
                  </span>
                </div>

                {it.guidance && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{it.guidance}</p>
                )}

                <textarea
                  value={rows[i]?.text ?? ""}
                  onChange={e => edit(i, e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-border bg-muted/20 p-2 text-[11.5px] text-foreground leading-relaxed focus:outline-none focus:ring-1 focus:ring-amber-500/50 resize-y min-h-[44px]"
                />

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[11px] font-medium cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rows[i]?.checked ?? false}
                      onChange={() => toggle(i)}
                      className="h-3.5 w-3.5 accent-amber-500"
                    />
                    <span className={rows[i]?.checked ? "text-amber-400" : "text-muted-foreground"}>
                      {rows[i]?.checked ? "Approved" : "Approve"}
                    </span>
                  </label>
                  <button
                    onClick={() => copyOne(i)}
                    title="Copy bullet text"
                    className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                  >
                    {copied === i ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied === i ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={toggleAll}
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
            >
              {allChecked ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
              {allChecked ? "Uncheck all" : "Check all"}
            </button>
            <Button
              size="sm"
              disabled={checkedCount === 0 || sending}
              onClick={send}
              className="ml-auto h-8 text-[11px]"
            >
              {sending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Assembling…</>
                : <>Send {checkedCount > 0 ? `${checkedCount} ` : ""}to Builder<ArrowRight className="h-3.5 w-3.5 ml-1.5" /></>}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Fit Dashboard (Claude's match assessment) ─────────────────────────────────

const FIT_CONFIG = {
  strong:   { color: "text-emerald-400", border: "border-emerald-500/30", bg: "bg-emerald-500/10", label: "Strong Fit" },
  moderate: { color: "text-amber-400",   border: "border-amber-500/30",   bg: "bg-amber-500/10",   label: "Moderate Fit" },
  weak:     { color: "text-red-400",     border: "border-red-500/30",     bg: "bg-red-500/10",     label: "Weak Fit" },
} as const;

function FitDashboard({ review }: { review: ClaudeReview }) {
  const { fitAssessment, recommendation, genuineGaps } = review;
  if (!fitAssessment) return null;

  const cfg = FIT_CONFIG[fitAssessment.level] ?? FIT_CONFIG.moderate;

  return (
    <div className={cn("rounded-lg border p-3.5 space-y-3", cfg.border, cfg.bg)}>
      {/* Badge + rationale */}
      <div className="flex items-start gap-2.5">
        <span className={cn(
          "text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border shrink-0 mt-0.5",
          cfg.color, cfg.border,
        )}>
          {cfg.label}
        </span>
        <span className="text-[12px] text-muted-foreground leading-relaxed">
          {fitAssessment.rationale}
        </span>
      </div>

      {/* Recommendation — prominent one-liner */}
      {recommendation && (
        <p className={cn("text-[13px] font-semibold border-l-2 pl-3", cfg.color, cfg.border)}>
          {recommendation}
        </p>
      )}

      {/* Gaps Claude did NOT fill */}
      {(genuineGaps ?? []).length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2">
            Gaps Claude did NOT fill
          </p>
          <ul className="space-y-1">
            {(genuineGaps ?? []).map((gap, i) => (
              <li key={i} className="text-[11px] text-muted-foreground flex gap-2">
                <span className="text-red-400/70 shrink-0">✗</span>
                <span>{gap}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Cover Letter panel ────────────────────────────────────────────────────────
// Generates a job-specific cover letter from the Master Profile + JD (server-side).
// Durable content lives in the DB: on open it loads any saved letter for the linked
// application (GET), and user edits are debounce-saved (PATCH). It never
// auto-generates — generation is an explicit button click.

function CoverLetterPanel({
  jobDescription,
  applicationId,
  company,
  role,
  accessToken,
}: {
  jobDescription: string;
  applicationId: string;
  company?: string;
  role?: string;
  accessToken?: string;
}) {
  const [coverLetter, setCoverLetter] = useState("");
  const [footer, setFooter] = useState("");
  // Role/company are prefilled from autofill (props) but user-editable, so the
  // user can supply a role when extraction missed it. They drive both Generate
  // and Download PDF.
  const [roleInput, setRoleInput] = useState(role ?? "");
  const [companyInput, setCompanyInput] = useState(company ?? "");
  const [letterId, setLetterId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  // Guards so the debounced PATCH never fires for the just-loaded/generated text.
  const lastSavedLetter = useRef<string>("");
  const lastSavedFooter = useRef<string>("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-prefill role/company when the linked application (and thus autofill) changes.
  useEffect(() => { setRoleInput(role ?? ""); }, [role]);
  useEffect(() => { setCompanyInput(company ?? ""); }, [company]);

  // ── Load any saved letter for the linked application (no Claude call) ────────
  useEffect(() => {
    let cancelled = false;
    if (!applicationId || !accessToken) return;
    setLoadingExisting(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${API}/cover-letter?applicationId=${encodeURIComponent(applicationId)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await res.json();
        if (cancelled) return;
        if (data.success && typeof data.coverLetter === "string") {
          setCoverLetter(data.coverLetter);
          setFooter(data.footer ?? "");
          setLetterId(data.id ?? null);
          lastSavedLetter.current = data.coverLetter;
          lastSavedFooter.current = data.footer ?? "";
        }
      } catch {
        /* non-fatal — user can still generate */
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [applicationId, accessToken]);

  // ── Debounced durable save of edits (PATCH) ─────────────────────────────────
  // Sends only the field(s) that actually changed, so a footer-only edit never
  // flips the letter's `edited` flag on the server.
  useEffect(() => {
    if (!letterId) return;                         // nothing persisted yet to update
    const letterChanged = coverLetter !== lastSavedLetter.current;
    const footerChanged = footer !== lastSavedFooter.current;
    if (!letterChanged && !footerChanged) return;
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const payload: { coverLetter?: string; footer?: string } = {};
      if (letterChanged) payload.coverLetter = coverLetter;
      if (footerChanged) payload.footer = footer;
      try {
        const res = await fetch(`${API}/cover-letter/${letterId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.success) {
          lastSavedLetter.current = coverLetter;
          lastSavedFooter.current = footer;
          setSaveState("saved");
          setTimeout(() => setSaveState(s => (s === "saved" ? "idle" : s)), 1500);
        } else {
          setSaveState("idle");
        }
      } catch {
        setSaveState("idle");
      }
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [coverLetter, footer, letterId, accessToken]);

  const handleGenerate = useCallback(async () => {
    if (!jobDescription.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`${API}/cover-letter/claude`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          jobDescription,
          applicationId: applicationId || undefined,
          company: companyInput.trim() || undefined,
          role: roleInput.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Generation failed.");
      setCoverLetter(data.coverLetter ?? "");
      setFooter(data.footer ?? "");
      setLetterId(data.id ?? null);
      lastSavedLetter.current = data.coverLetter ?? "";
      lastSavedFooter.current = data.footer ?? "";
    } catch (e: any) {
      setError(e?.message || "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }, [jobDescription, applicationId, companyInput, roleInput, accessToken]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(coverLetter);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  }, [coverLetter]);

  // Renders the CURRENT edited body + footer to a business-letter PDF server-side
  // (letterhead identity comes from the Master Profile), then downloads it.
  const handleDownloadPdf = useCallback(async () => {
    if (!coverLetter.trim()) return;
    setDownloadingPdf(true);
    setError(null);
    try {
      const res = await fetch(`${API}/cover-letter/pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          coverLetter,
          footer,
          company: companyInput.trim() || undefined,
          role: roleInput.trim() || undefined,
          applicationId: applicationId || undefined,
        }),
      });
      if (!res.ok) {
        let msg = "PDF export failed.";
        try { msg = (await res.json()).error || msg; } catch { /* non-JSON error body */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const slug = (companyInput.trim() || roleInput.trim() || "cover-letter").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      a.href = url;
      a.download = `${slug}-cover-letter.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || "PDF export failed.");
    } finally {
      setDownloadingPdf(false);
    }
  }, [coverLetter, footer, companyInput, roleInput, applicationId, accessToken]);

  const hasLetter = coverLetter.trim().length > 0;

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm text-foreground">Cover Letter</h3>
          {loadingExisting && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        {hasLetter && (
          <button
            onClick={handleGenerate}
            disabled={generating || !jobDescription.trim()}
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors disabled:opacity-50"
          >
            <RefreshCw className="h-3 w-3" />Re-generate
          </button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground -mt-1">
        Written from your Master Profile and the job description. Generate, then tweak freely; edits save automatically.
      </p>

      {/* Role / Company — prefilled from autofill, editable. Supply a role here if
          extraction missed it so the letter names it instead of staying generic. */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] text-muted-foreground font-label uppercase tracking-wider mb-1 block">
            Role (optional)
          </label>
          <input
            type="text"
            value={roleInput}
            onChange={e => setRoleInput(e.target.value)}
            placeholder="e.g. AI Engineer"
            className="w-full h-8 rounded-md border border-input bg-input px-2 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground font-label uppercase tracking-wider mb-1 block">
            Company (optional)
          </label>
          <input
            type="text"
            value={companyInput}
            onChange={e => setCompanyInput(e.target.value)}
            placeholder="e.g. Anthropic"
            className="w-full h-8 rounded-md border border-input bg-input px-2 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {!hasLetter && (
        <Button
          onClick={handleGenerate}
          disabled={!jobDescription.trim() || generating}
          className="w-full"
        >
          {generating
            ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Claude is writing…</>
            : <><Sparkles className="h-4 w-4 mr-2" />Generate Cover Letter</>}
        </Button>
      )}

      {!jobDescription.trim() && (
        <p className="text-[11px] text-muted-foreground">Paste a job description above to generate a cover letter.</p>
      )}

      {hasLetter && (
        <>
          <textarea
            value={coverLetter}
            onChange={e => setCoverLetter(e.target.value)}
            rows={18}
            className="w-full rounded-lg border border-border bg-muted/20 p-3.5 text-[12.5px] text-foreground leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary resize-y min-h-[300px]"
          />

          {/* Signature line — a credential rendered UNDER the name in the PDF.
              Must NOT contain the name (the template renders the name itself). */}
          <div>
            <label className="text-[11px] text-muted-foreground font-label uppercase tracking-wider mb-1.5 block">
              Signature line (optional) — credential printed under your name
            </label>
            <input
              type="text"
              value={footer}
              onChange={e => setFooter(e.target.value)}
              placeholder="e.g. M.S. Computer Science, 2026 (do not include your name)"
              className="w-full h-9 rounded-lg border border-border bg-muted/20 px-2.5 text-[11.5px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10.5px] text-muted-foreground">
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
            </span>
            <button
              onClick={handleCopy}
              className="ml-auto text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadPdf}
              disabled={downloadingPdf}
              className="h-8 text-[11px]"
            >
              {downloadingPdf
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Rendering…</>
                : <><Download className="h-3.5 w-3.5 mr-1.5" />Download PDF</>}
            </Button>
          </div>
        </>
      )}

      {error && (
        <p className="text-[12px] text-destructive flex items-center gap-1.5">
          <XCircle className="h-3.5 w-3.5 shrink-0" />{error}
        </p>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

type SubTab = "resume" | "cover";

function readSession(): {
  jobDescription?: string;
  linkedAppId?: string;
  result?: ClaudeResult | null;
  subTab?: SubTab;
} {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export default function TailorTab({ apps, session, onAssembled }: Props) {
  // Restore via lazy state initializers (read once on first render) so there is
  // no mount-time race between a restore effect and the persist effect.
  const savedRef = useRef<ReturnType<typeof readSession> | null>(null);
  if (!savedRef.current) savedRef.current = readSession();
  const saved = savedRef.current;

  const [jdText, setJdText] = useState(saved.jobDescription ?? "");
  const [linkedAppId, setLinkedAppId] = useState(saved.linkedAppId ?? "");
  const [subTab, setSubTab] = useState<SubTab>(saved.subTab ?? "resume");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaudeResult | null>(saved.result ?? null);

  // Server-side assembly ("Send to Builder")
  const [assembling, setAssembling] = useState(false);
  const [assembleError, setAssembleError] = useState<string | null>(null);

  // ── sessionStorage: persist on change ───────────────────────────────────────
  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        jobDescription: jdText,
        linkedAppId,
        result,
        subTab,
      }));
    } catch {}
  }, [jdText, linkedAppId, result, subTab]);

  const appsWithJd = apps.filter(a => a.jobDescription?.trim());

  const handleLinkApp = (appId: string) => {
    setLinkedAppId(appId);
    if (appId) {
      const app = apps.find(a => a.id === appId);
      if (app?.jobDescription) setJdText(app.jobDescription);
    }
  };

  const handleReset = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setJdText("");
    setLinkedAppId("");
    setResult(null);
    setGenError(null);
    setAssembleError(null);
  };

  const handleGenerate = useCallback(async () => {
    if (!jdText.trim()) return;
    setGenerating(true);
    setGenError(null);
    setResult(null);
    setAssembleError(null);

    try {
      const res = await fetch(`${API}/tailor/claude`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          jobDescription: jdText,
          applicationId: linkedAppId || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setResult(data);
    } catch (e: any) {
      setGenError(e.message);
    } finally {
      setGenerating(false);
    }
  }, [jdText, linkedAppId, session]);

  // ── Send approved bullets to the server-side assembly pass ──────────────────
  const handleSendToBuilder = useCallback(async (approved: ApprovedBullet[]) => {
    if (!jdText.trim()) return;
    setAssembling(true);
    setAssembleError(null);
    try {
      const linkedApp = linkedAppId ? apps.find(a => a.id === linkedAppId) : null;
      const res = await fetch(`${API}/assemble/claude`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          jobDescription: jdText,
          approvedBullets: approved,
          company: linkedApp?.company,
          role: linkedApp?.position,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Assembly failed.");
      onAssembled({ score: data.score ?? null, changeLog: data.changeLog ?? [], at: Date.now() });
    } catch (e: any) {
      setAssembleError(e?.message || "Assembly failed.");
    } finally {
      setAssembling(false);
    }
  }, [jdText, linkedAppId, apps, session, onAssembled]);

  return (
    <div className="space-y-5">

      {/* ── JD Input ─────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm text-foreground">Job Description</h2>
          </div>
          {(jdText || result) && (
            <button
              onClick={handleReset}
              title="Clear session and start over"
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <RotateCcw className="h-3 w-3" />Reset
            </button>
          )}
        </div>

        {appsWithJd.length > 0 && (
          <div>
            <label className="text-[11px] text-muted-foreground font-label uppercase tracking-wider mb-1.5 block">
              Pull from saved application (optional)
            </label>
            <select
              value={linkedAppId}
              onChange={e => handleLinkApp(e.target.value)}
              aria-label="Pull from saved application"
              className="w-full h-8 rounded-md border border-input bg-input px-2 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">— paste manually —</option>
              {appsWithJd.map(a => (
                <option key={a.id} value={a.id}>{a.company} — {a.position}</option>
              ))}
            </select>
          </div>
        )}

        <textarea
          value={jdText}
          onChange={e => {
            setJdText(e.target.value);
            if (linkedAppId) setLinkedAppId("");
          }}
          placeholder="Paste the full job description here…"
          className="w-full h-52 rounded-lg border border-border bg-muted/20 p-3 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary resize-none font-mono"
        />

        <Button
          onClick={handleGenerate}
          disabled={!jdText.trim() || generating}
          className="w-full"
        >
          {generating
            ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Claude is tailoring…</>
            : <><Sparkles className="h-4 w-4 mr-2" />Generate with Claude AI</>
          }
        </Button>

        {genError && (
          <p className="text-[12px] text-destructive flex items-center gap-1.5">
            <XCircle className="h-3.5 w-3.5 shrink-0" />{genError}
          </p>
        )}
      </div>

      {/* ── Sub-tab bar: Resume | Cover Letter ───────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
        <button
          onClick={() => setSubTab("resume")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md text-[12px] font-medium transition-colors",
            subTab === "resume" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <FileText className="h-3.5 w-3.5" />Resume
        </button>
        <button
          onClick={() => setSubTab("cover")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md text-[12px] font-medium transition-colors",
            subTab === "cover" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Mail className="h-3.5 w-3.5" />Cover Letter
        </button>
      </div>

      {/* ── Cover Letter tab ─────────────────────────────────────────────────── */}
      {subTab === "cover" && (
        <CoverLetterPanel
          jobDescription={jdText}
          applicationId={linkedAppId}
          company={linkedAppId ? apps.find(a => a.id === linkedAppId)?.company : undefined}
          role={linkedAppId ? apps.find(a => a.id === linkedAppId)?.position : undefined}
          accessToken={session?.access_token}
        />
      )}

      {/* ── Generating state ─────────────────────────────────────────────────── */}
      {subTab === "resume" && generating && (
        <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Claude is tailoring your resume…</p>
          <p className="text-[11px] text-muted-foreground/60">
            Selecting the most relevant experiences and writing your summary
          </p>
        </div>
      )}

      {/* ── Claude result panel ───────────────────────────────────────────────── */}
      {subTab === "resume" && result && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-5">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm text-foreground">Claude Review</h3>
              {result.fromCache && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground border border-border font-label" title="Same JD + unchanged Master Profile — returned the stored result instead of calling Claude again">
                  cached
                </span>
              )}
            </div>
            <button
              onClick={handleGenerate}
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <RefreshCw className="h-3 w-3" />Re-generate
            </button>
          </div>

          {/* Claude's review */}
          {result.review && (
            <div className="space-y-4">

              {/* Score ring — Claude-generated */}
              {result.review.matchScore != null && (
                <ScoreRing score={result.review.matchScore} />
              )}

              {/* Fit Dashboard — verdict, recommendation, gaps */}
              <FitDashboard review={result.review} />

              {/* Tailoring narrative */}
              {result.review.summary && (
                <p className="text-[12px] text-muted-foreground italic border-l-2 border-primary/40 pl-3">
                  {result.review.summary}
                </p>
              )}

              <div className="space-y-3">
                <ReviewList
                  title="Kept"
                  items={result.review.keptItems ?? []}
                  colorClass="text-emerald-400"
                />
                <ReviewList
                  title="Dropped"
                  items={result.review.droppedItems ?? []}
                  colorClass="text-zinc-400"
                />
                {(result.review.skillsSurfaced ?? []).length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-primary mb-1.5">Skills surfaced</p>
                    <div className="flex flex-wrap gap-1">
                      {result.review.skillsSurfaced.map(s => (
                        <span key={s} className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary border border-primary/20 font-label">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <ReviewList
                  title="Suggestions"
                  items={result.review.suggestions ?? []}
                  colorClass="text-amber-400"
                />
              </div>
            </div>
          )}

          {/* ── Candidate bullets: edit, approve, send to Builder ──────────── */}
          <div className="pt-2 border-t border-border space-y-2">
            <EditableBulletList
              items={result.review?.bulletSuggestions ?? EMPTY_BULLETS}
              sending={assembling}
              onSend={handleSendToBuilder}
            />
            {(result.review?.bulletSuggestions ?? []).length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                Claude didn't surface any new bullets for this role.
              </p>
            )}
            {assembleError && (
              <p className="text-[12px] text-destructive flex items-center gap-1.5">
                <XCircle className="h-3.5 w-3.5 shrink-0" />{assembleError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
