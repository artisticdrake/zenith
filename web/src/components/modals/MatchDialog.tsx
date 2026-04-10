import { Sparkles, Loader2, CheckCircle, XCircle, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/lib/useCountUp";
import type { JobApplication, Resume, MatchResult } from "@/lib/types";

interface MatchDialogProps {
  app: JobApplication | null;
  onClose: () => void;
  resumes: Resume[];
  matchResumeId: string;
  setMatchResumeId: (id: string) => void;
  matchLoading: boolean;
  matchResult: MatchResult | null;
  matchError: string | null;
  onRunMatch: () => void;
  onReset: () => void;
}

function ScoreRing({ score }: { score: number }) {
  const animated = useCountUp(score, 1000);
  const isStrong  = score >= 75;
  const isPartial = score >= 50;

  const ringColor  = isStrong ? "#10b981" : isPartial ? "#f59e0b" : "#ef4444";
  const glowColor  = isStrong ? "shadow-emerald-500/20" : isPartial ? "shadow-amber-500/20" : "shadow-red-500/20";
  const textColor  = isStrong ? "text-emerald-300" : isPartial ? "text-amber-300" : "text-red-300";
  const label      = isStrong ? "Strong Match"  : isPartial ? "Partial Match" : "Weak Match";
  const badgeCls   = isStrong
    ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
    : isPartial
    ? "bg-amber-500/10 border-amber-500/25 text-amber-400"
    : "bg-red-500/10 border-red-500/25 text-red-400";

  // SVG circle
  const r = 48;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className={cn("relative flex items-center justify-center shadow-2xl", glowColor)}>
        <svg width="130" height="130" className="-rotate-90">
          <circle cx="65" cy="65" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
          <circle
            cx="65" cy="65" r={r}
            fill="none"
            stroke={ringColor}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
            style={{ filter: `drop-shadow(0 0 6px ${ringColor}60)`, transition: "stroke-dasharray 1s cubic-bezier(0.16,1,0.3,1)" }}
          />
        </svg>
        <div className="absolute text-center">
          <span className={cn("text-4xl font-black tabular-nums leading-none", textColor)}>
            {animated}
          </span>
          <span className="block text-[10px] text-muted-foreground/50 mt-0.5">/100</span>
        </div>
      </div>
      <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold", badgeCls)}>
        {label}
      </span>
    </div>
  );
}

export default function MatchDialog({
  app, onClose, resumes, matchResumeId, setMatchResumeId,
  matchLoading, matchResult, matchError, onRunMatch, onReset,
}: MatchDialogProps) {
  if (!app) return null;

  const parsedResumes = resumes.filter((r) => r.extracted_text);
  const hasJD = !!app.jobDescription?.trim();

  return (
    <Dialog open={!!app} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col p-0 gap-0 border border-white/[0.08] bg-card overflow-hidden">

        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-5 border-b border-white/[0.06] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-violet-500/20 ring-1 ring-primary/20">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-[15px] font-bold">Resume Match</DialogTitle>
              <DialogDescription className="text-[12px] mt-0.5 text-muted-foreground/60">
                {app.company} — {app.position}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1">
          <div className="px-6 py-5 space-y-5">

            {/* ── Setup ──────────────────────────────────────────────── */}
            {!matchResult && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-semibold text-muted-foreground/70">Select Resume</label>
                  {resumes.length === 0 ? (
                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-[13px] text-muted-foreground/60">
                      No resumes uploaded. Go to the Files tab to add one.
                    </div>
                  ) : parsedResumes.length === 0 ? (
                    <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3 text-[13px] text-amber-400">
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      Resume is still being parsed — please wait.
                    </div>
                  ) : (
                    <Select value={matchResumeId} onValueChange={setMatchResumeId}>
                      <SelectTrigger className="bg-white/[0.04] border-white/[0.08] text-[13px]">
                        <SelectValue placeholder="Select a resume…" />
                      </SelectTrigger>
                      <SelectContent className="border-white/[0.08] bg-popover">
                        {parsedResumes.map((r) => (
                          <SelectItem key={r.id} value={r.id} className="text-[13px]">{r.file_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className={cn(
                  "flex items-center gap-2.5 rounded-xl px-4 py-3 text-[13px]",
                  hasJD
                    ? "border border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-400"
                    : "border border-blue-500/20 bg-blue-500/[0.07] text-blue-400"
                )}>
                  {hasJD
                    ? <CheckCircle className="h-4 w-4 shrink-0" />
                    : <AlertCircle className="h-4 w-4 shrink-0" />}
                  {hasJD
                    ? "Job description found — ready for matching"
                    : "No job description — add one for a more accurate score"}
                </div>

                {matchError && (
                  <div className="flex items-center gap-2.5 rounded-xl border border-destructive/25 bg-destructive/[0.07] px-4 py-3 text-[13px] text-destructive">
                    <XCircle className="h-4 w-4 shrink-0" />
                    {matchError}
                  </div>
                )}

                <Button
                  className="w-full gap-2 bg-gradient-to-r from-primary to-violet-500 hover:from-primary/90 hover:to-violet-500/90 text-white border-0 shadow-lg shadow-primary/20 font-semibold"
                  onClick={onRunMatch}
                  disabled={matchLoading || !matchResumeId || parsedResumes.length === 0}
                >
                  {matchLoading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing… 10–15 seconds</>
                  ) : (
                    <><Sparkles className="h-4 w-4" /> Run Match</>
                  )}
                </Button>
              </div>
            )}

            {/* ── Results ────────────────────────────────────────────── */}
            {matchResult && (
              <div className="space-y-5">
                <div className="flex justify-center py-3">
                  <ScoreRing score={matchResult.score} />
                </div>

                {/* Breakdown */}
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4 space-y-4">
                  <h4 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground/50">Score Breakdown</h4>
                  {[
                    { label: "Required Skills",  val: matchResult.breakdown?.required  ?? 0, max: 50, color: "bg-primary"       },
                    { label: "Preferred Skills", val: matchResult.breakdown?.preferred ?? 0, max: 30, color: "bg-violet-500"    },
                    { label: "Experience",       val: matchResult.breakdown?.experience?? 0, max: 20, color: "bg-emerald-500"   },
                  ].map(({ label, val, max, color }) => (
                    <div key={label} className="space-y-2">
                      <div className="flex justify-between text-[12px]">
                        <span className="font-medium text-muted-foreground/60">{label}</span>
                        <span className="font-bold tabular-nums text-foreground/60">{val} / {max}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className={cn("h-full rounded-full transition-all duration-700", color)}
                          style={{ width: `${(val / max) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Summary */}
                {matchResult.summary && (
                  <>
                    <div className="h-px bg-white/[0.06]" />
                    <div>
                      <h4 className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2.5">Summary</h4>
                      <p className="text-[13px] text-muted-foreground/70 leading-relaxed">{matchResult.summary}</p>
                    </div>
                  </>
                )}

                {/* Skills */}
                {(matchResult.matched_skills?.length > 0 || matchResult.missing_skills?.length > 0) && (
                  <>
                    <div className="h-px bg-white/[0.06]" />
                    <div className="grid grid-cols-2 gap-4">
                      {matchResult.matched_skills?.length > 0 && (
                        <div>
                          <h4 className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/80 mb-2.5">✓ Matched</h4>
                          <div className="flex flex-wrap gap-1.5">
                            {matchResult.matched_skills.map((s) => (
                              <span key={s} className="text-[11px] px-2.5 py-0.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.08] text-emerald-400">{s}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {matchResult.missing_skills?.length > 0 && (
                        <div>
                          <h4 className="text-[10px] font-bold uppercase tracking-wider text-red-400/80 mb-2.5">✗ Missing</h4>
                          <div className="flex flex-wrap gap-1.5">
                            {matchResult.missing_skills.map((s) => (
                              <span key={s} className="text-[11px] px-2.5 py-0.5 rounded-full border border-red-500/20 bg-red-500/[0.08] text-red-400">{s}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Observations */}
                {matchResult.observations?.length > 0 && (
                  <>
                    <div className="h-px bg-white/[0.06]" />
                    <div>
                      <h4 className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2.5">Observations</h4>
                      <ul className="space-y-2">
                        {matchResult.observations.map((o, i) => (
                          <li key={i} className="flex gap-2.5 text-[13px] text-muted-foreground/60">
                            <span className="mt-0.5 text-primary/60 font-bold shrink-0">•</span>{o}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}

                {/* Suggested Rewrites */}
                {matchResult.suggested_rewrites?.length > 0 && (
                  <>
                    <div className="h-px bg-white/[0.06]" />
                    <div>
                      <h4 className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2.5">Suggested Rewrites</h4>
                      <div className="space-y-3">
                        {matchResult.suggested_rewrites.map((rw, i) => (
                          <div key={i} className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3.5 space-y-2 text-[13px]">
                            <p className="line-through text-muted-foreground/35">{rw.original}</p>
                            <p className="text-emerald-400">{rw.rewrite}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Action Steps */}
                {matchResult.action_steps?.length > 0 && (
                  <>
                    <div className="h-px bg-white/[0.06]" />
                    <div>
                      <h4 className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2.5">Action Steps</h4>
                      <ol className="space-y-2.5">
                        {matchResult.action_steps.map((step, i) => (
                          <li key={i} className="flex gap-3 text-[13px] text-muted-foreground/60">
                            <span className="flex h-5 w-5 shrink-0 mt-0.5 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-violet-500/15 text-primary text-[10px] font-black">
                              {i + 1}
                            </span>
                            {step}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </>
                )}

                <Button variant="outline" className="w-full gap-2 border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-[13px]" onClick={onReset}>
                  <RefreshCw className="h-3.5 w-3.5" /> Re-run with different resume
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
