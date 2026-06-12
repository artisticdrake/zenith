import { useState, useCallback, useEffect } from "react";
import {
  Wand2, Loader2, XCircle, Sparkles, ArrowRight, RefreshCw,
  CheckCircle2, ChevronDown, ChevronUp, Plus, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { JobApplication } from "@/lib/types";
import type { ResumeContent } from "@/types/resume.types";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const SESSION_KEY = "jt.tailor_session"; // must not collide with jt.pending_tailor

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClaudeReview {
  summary: string;
  keptItems: string[];
  droppedItems: string[];
  skillsSurfaced: string[];
  suggestions: string[];
  fitAssessment?: { level: "strong" | "moderate" | "weak"; rationale: string };
  recommendation?: string;
  genuineGaps?: string[];
  matchScore?: number;
}

interface ClaudeResult {
  resumeContent: ResumeContent;
  review: ClaudeReview | null;
  fromCache?: boolean;
}

interface Props {
  apps: JobApplication[];
  session: any;
  onOpenInBuilder: (content: ResumeContent, company?: string, role?: string) => void;
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

// ── Main Component ────────────────────────────────────────────────────────────

export default function TailorTab({ apps, session, onOpenInBuilder }: Props) {
  const [jdText, setJdText] = useState("");
  const [linkedAppId, setLinkedAppId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaudeResult | null>(null);

  // Approve gate
  const [approved, setApproved] = useState(false);

  // Post-approve: create/link application
  const [showAppOffer, setShowAppOffer] = useState(false);
  const [offerCompany, setOfferCompany] = useState("");
  const [offerRole, setOfferRole] = useState("");
  const [creatingApp, setCreatingApp] = useState(false);
  const [appCreated, setAppCreated] = useState(false);
  const [appCreateError, setAppCreateError] = useState<string | null>(null);

  // ── sessionStorage: restore on mount ────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.jobDescription) setJdText(saved.jobDescription);
      if (saved.linkedAppId) setLinkedAppId(saved.linkedAppId);
      if (saved.result) setResult(saved.result);
      if (saved.approved) {
        setApproved(true);
        setShowAppOffer(true);
      }
    } catch {}
  }, []);

  // ── sessionStorage: persist on change ───────────────────────────────────────
  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        jobDescription: jdText,
        linkedAppId,
        result,
        approved,
      }));
    } catch {}
  }, [jdText, linkedAppId, result, approved]);

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
    setApproved(false);
    setShowAppOffer(false);
    setAppCreated(false);
    setGenError(null);
    setOfferCompany("");
    setOfferRole("");
  };

  const handleGenerate = useCallback(async () => {
    if (!jdText.trim()) return;
    setGenerating(true);
    setGenError(null);
    setResult(null);
    setApproved(false);
    setShowAppOffer(false);
    setAppCreated(false);

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

  const handleApprove = () => {
    if (!result) return;
    // Atomic handoff for useResumeData — must not collide with SESSION_KEY
    localStorage.setItem("jt.pending_tailor", JSON.stringify(result.resumeContent));
    setApproved(true);
    setShowAppOffer(true);
  };

  const handleOpenInBuilder = () => {
    if (!result) return;
    const linkedApp = linkedAppId ? apps.find(a => a.id === linkedAppId) : null;
    onOpenInBuilder(result.resumeContent, linkedApp?.company, linkedApp?.position);
  };

  const handleCreateApp = async () => {
    if (!offerCompany.trim() || !offerRole.trim() || !result) return;
    setCreatingApp(true);
    setAppCreateError(null);
    try {
      const now = new Date().toISOString();
      const res = await fetch(`${API}/applications`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          company: offerCompany.trim(),
          position: offerRole.trim(),
          date_applied: now.slice(0, 10),
          status: "Applied",
          job_description: jdText,
          timeline: [{ status: "Applied", ts: Date.now() }],
          last_updated: now,
          notes: "Created from Tailor tab — tailored resume loaded in Builder.",
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setAppCreated(true);
    } catch (e: any) {
      setAppCreateError(e.message);
    } finally {
      setCreatingApp(false);
    }
  };

  const handleLinkExisting = async () => {
    if (!linkedAppId || !result) return;
    setCreatingApp(true);
    setAppCreateError(null);
    try {
      const res = await fetch(`${API}/applications/${linkedAppId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          notes: `Tailored resume generated and loaded in Builder on ${new Date().toLocaleDateString()}.`,
          last_updated: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setAppCreated(true);
    } catch (e: any) {
      setAppCreateError(e.message);
    } finally {
      setCreatingApp(false);
    }
  };

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

      {/* ── Generating state ─────────────────────────────────────────────────── */}
      {generating && (
        <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Claude is tailoring your resume…</p>
          <p className="text-[11px] text-muted-foreground/60">
            Selecting the most relevant experiences and writing your summary
          </p>
        </div>
      )}

      {/* ── Claude result panel ───────────────────────────────────────────────── */}
      {result && (
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

          {/* ── APPROVE gate — mandatory, not skippable ──────────────────── */}
          {!approved && (
            <div className="pt-2 border-t border-border space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Review the tailored resume above, then approve to open it in the Builder.
              </p>
              <Button onClick={handleApprove} className="w-full">
                <CheckCircle2 className="h-4 w-4 mr-2" />Approve &amp; Open in Builder
              </Button>
            </div>
          )}

          {approved && (
            <div className="pt-2 border-t border-border space-y-2">
              <div className="flex items-center gap-2 text-[12px] text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                Approved — resume ready in Builder
              </div>
              <Button variant="outline" onClick={handleOpenInBuilder} className="w-full text-xs">
                Open in Builder <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Post-approve: create / link Application ──────────────────────────── */}
      {showAppOffer && result && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm text-foreground">
              {linkedAppId ? "Link to Existing Application" : "Create an Application"}
            </h3>
          </div>

          {appCreated ? (
            <p className="text-[12px] text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              {linkedAppId ? "Application updated." : "Application created."} You can find it in the Applications tab.
            </p>
          ) : linkedAppId ? (
            <div className="space-y-3">
              <p className="text-[12px] text-muted-foreground">
                Link this tailored resume to{" "}
                <span className="text-foreground font-medium">
                  {apps.find(a => a.id === linkedAppId)?.company} — {apps.find(a => a.id === linkedAppId)?.position}
                </span>?
              </p>
              {appCreateError && (
                <p className="text-[12px] text-destructive flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5 shrink-0" />{appCreateError}
                </p>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={handleLinkExisting} disabled={creatingApp}>
                  {creatingApp ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                  Link Application
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAppOffer(false)}>
                  Skip
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[12px] text-muted-foreground">
                Optionally create an application entry to track this role. The job description will be saved automatically.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground font-label uppercase tracking-wider">Company</label>
                  <input
                    value={offerCompany}
                    onChange={e => setOfferCompany(e.target.value)}
                    placeholder="Acme Corp"
                    className="h-8 rounded-md border border-input bg-input px-2 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground font-label uppercase tracking-wider">Role</label>
                  <input
                    value={offerRole}
                    onChange={e => setOfferRole(e.target.value)}
                    placeholder="Software Engineer"
                    className="h-8 rounded-md border border-input bg-input px-2 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
              {appCreateError && (
                <p className="text-[12px] text-destructive flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5 shrink-0" />{appCreateError}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleCreateApp}
                  disabled={!offerCompany.trim() || !offerRole.trim() || creatingApp}
                >
                  {creatingApp ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                  Create Application
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAppOffer(false)}>
                  Skip
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
