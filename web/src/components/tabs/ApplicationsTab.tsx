import {
  Plus, Search, Edit2, Trash2, ExternalLink, Sparkles, Wand2,
  Loader2, Building2, LayoutList, Send, Eye, CalendarDays, Trophy, Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/lib/useCountUp";
import { STATUS_CONFIG } from "@/lib/constants";
import { formatDate, formatShortDate } from "@/lib/dateUtils";
import type { JobApplication } from "@/lib/types";

interface Stats {
  total: number;
  statusCounts: Record<string, number>;
}

interface ApplicationsTabProps {
  apps: JobApplication[];
  sortedApps: JobApplication[];
  stats: Stats;
  loading: boolean;
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  onAddNew: () => void;
  onEdit: (app: JobApplication) => void;
  onDelete: (id: string) => void;
  onRowClick: (app: JobApplication) => void;
  onMatch: (app: JobApplication) => void;
  appScores: Record<string, number>;
  aiSummary: string;
  loadingSummary: boolean;
  onRefreshSummary: () => void;
}

/* ── Stat card config ───────────────────────────────────────────────────── */
const STAT_CARDS = [
  {
    key: "total",
    label: "Total",
    icon: LayoutList,
    accent: "from-white/[0.03] to-transparent",
    iconBg: "bg-primary/10",
    iconColor: "text-primary",
    numClass: "text-foreground",
    border: "border-white/[0.06]",
  },
  {
    key: "Applied",
    label: "Applied",
    icon: Send,
    accent: "from-blue-500/10 to-transparent",
    iconBg: "bg-blue-500/15",
    iconColor: "text-blue-400",
    numClass: "gradient-text-cyan",
    border: "border-white/[0.06]",
  },
  {
    key: "Screening",
    label: "Screening",
    icon: Eye,
    accent: "from-amber-500/10 to-transparent",
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-400",
    numClass: "text-amber-600 dark:text-amber-300",
    border: "border-white/[0.06]",
  },
  {
    key: "Interview",
    label: "Interview",
    icon: CalendarDays,
    accent: "from-primary/10 to-transparent",
    iconBg: "bg-primary/15",
    iconColor: "text-primary",
    numClass: "gradient-text",
    border: "border-white/[0.06]",
  },
  {
    key: "Offer",
    label: "Offers",
    icon: Trophy,
    accent: "from-emerald-500/10 to-transparent",
    iconBg: "bg-emerald-500/15",
    iconColor: "text-emerald-400",
    numClass: "text-emerald-600 dark:text-emerald-300",
    border: "border-white/[0.06]",
  },
  {
    key: "Rejected",
    label: "Rejected",
    icon: Ban,
    accent: "from-red-500/10 to-transparent",
    iconBg: "bg-red-500/15",
    iconColor: "text-red-400",
    numClass: "text-red-500 dark:text-red-300",
    border: "border-white/[0.06]",
  },
];

const STAGGER = ["stagger-1", "stagger-2", "stagger-3", "stagger-4", "stagger-5", "stagger-6"];

/* ── Sub-components ─────────────────────────────────────────────────────── */
function AnimatedStatCard({
  cfg, value, index,
}: {
  cfg: typeof STAT_CARDS[0];
  value: number;
  index: number;
}) {
  const animated = useCountUp(value);
  const Icon = cfg.icon;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border transition-all duration-300 hover:border-white/[0.12] animate-slide-up cursor-default tonal-lift",
        cfg.border,
        STAGGER[index]
      )}
    >
      {/* Subtle accent gradient overlay */}
      <div className={cn("absolute inset-0 bg-gradient-to-br opacity-50", cfg.accent)} />

      {/* Left accent notch — appears on hover */}
      <div className="absolute left-0 top-0 h-full w-0.5 bg-primary opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {cfg.label}
          </span>
          <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", cfg.iconBg)}>
            <Icon className={cn("h-3.5 w-3.5", cfg.iconColor)} />
          </span>
        </div>
        <span
          className={cn(
            "block text-5xl font-black tabular-nums leading-none tracking-tighter number-pop",
            cfg.numClass
          )}
        >
          {animated}
        </span>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 75
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : score >= 50
      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
      : "bg-red-500/15 text-red-400 border-red-500/30";
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums", cls)}>
      {score}
    </span>
  );
}

function CompanyAvatar({ company }: { company: string }) {
  const letter = company.trim()[0]?.toUpperCase() ?? "?";
  const palettes = [
    "bg-blue-500/15 text-blue-300 border-blue-500/15",
    "bg-primary/15 text-primary border-primary/15",
    "bg-emerald-500/15 text-emerald-300 border-emerald-500/15",
    "bg-amber-500/15 text-amber-300 border-amber-500/15",
    "bg-pink-500/15 text-pink-300 border-pink-500/15",
    "bg-cyan-500/15 text-cyan-300 border-cyan-500/15",
    "bg-blue-400/15 text-blue-200 border-blue-400/15",
  ];
  const i = ((letter.charCodeAt(0) - 65) % palettes.length + palettes.length) % palettes.length;
  return (
    <span className={cn(
      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[11px] font-black",
      palettes[i]
    )}>
      {letter}
    </span>
  );
}

/* ── Main component ─────────────────────────────────────────────────────── */
export default function ApplicationsTab({
  apps, sortedApps, stats, loading,
  searchTerm, setSearchTerm, onAddNew,
  onEdit, onDelete, onRowClick, onMatch,
  appScores, aiSummary, loadingSummary, onRefreshSummary,
}: ApplicationsTabProps) {
  const getStatValue = (key: string) => {
    if (key === "total") return stats.total;
    if (key === "Interview")
      return (stats.statusCounts["Interview Scheduled"] ?? 0) + (stats.statusCounts["Interview Completed"] ?? 0);
    return stats.statusCounts[key] ?? 0;
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">

        {/* ── Mira AI banner ─────────────────────────────────────────── */}
        {apps.length > 0 && (
          <div className="relative animate-fade-in overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-r from-primary/8 via-primary/4 to-transparent">
            {/* Teal ambient glow */}
            <div className="pointer-events-none absolute inset-0">
              <div
                className="absolute inset-0 opacity-30 rounded-xl"
                style={{ background: "linear-gradient(90deg, hsl(167 76% 57% / 0.15), transparent 60%)" }}
              />
            </div>
            <div className="relative flex items-start gap-3.5 px-5 py-4">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-teal-900/20 ring-1 ring-primary/20">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">
                    Mira's Insight
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-primary transition-colors"
                    onClick={onRefreshSummary}
                    disabled={loadingSummary}
                  >
                    {loadingSummary
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Wand2 className="h-3 w-3" />}
                  </Button>
                </div>
                {loadingSummary ? (
                  <p className="text-[13px] text-muted-foreground italic">
                    Mira is analyzing your applications…
                  </p>
                ) : aiSummary ? (
                  <p className="text-[13px] text-muted-foreground/90 leading-relaxed whitespace-pre-line">
                    {aiSummary}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* ── Stat cards ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
          {STAT_CARDS.map((cfg, i) => (
            <AnimatedStatCard
              key={cfg.key}
              cfg={cfg}
              value={getStatValue(cfg.key)}
              index={i}
            />
          ))}
        </div>

        {/* ── Toolbar ────────────────────────────────────────────────── */}
        <div className="flex gap-3 animate-fade-in [animation-delay:200ms]">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search companies, positions, locations…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-muted/60 border-border focus:border-primary/50 focus:bg-background placeholder:text-muted-foreground/50 transition-all dark:bg-white/[0.04] dark:border-white/[0.08] dark:focus:bg-white/[0.06]"
            />
          </div>
          <Button
            onClick={onAddNew}
            className="shrink-0 gap-2 bg-gradient-to-r from-primary to-teal-700 hover:from-primary/90 hover:to-teal-700/90 text-white border-0 shadow-lg shadow-primary/20 font-semibold"
          >
            <Plus className="h-4 w-4" />
            Add Application
          </Button>
        </div>

        {/* ── Table ──────────────────────────────────────────────────── */}
        <div className="animate-fade-in [animation-delay:250ms] overflow-hidden rounded-xl glass">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/40 dark:border-white/[0.06] dark:bg-white/[0.025]">
                  {["Company", "Position", "Status", "Referral", "Updated", "Applied", "Match", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3.5 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-20 text-center">
                      <div className="flex flex-col items-center gap-3 text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin text-primary/50" />
                        <span className="text-sm">Loading applications…</span>
                      </div>
                    </td>
                  </tr>
                ) : sortedApps.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-20 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/50 bg-muted/30 dark:border-white/[0.07] dark:bg-white/[0.03]">
                          <Building2 className="h-7 w-7 text-muted-foreground/30" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-muted-foreground">
                            {searchTerm ? "No matching applications" : "No applications yet"}
                          </p>
                          <p className="text-xs text-muted-foreground/50 mt-0.5">
                            {searchTerm ? "Try a different search term" : "Click \"Add Application\" to get started"}
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  sortedApps.map((app) => {
                    const cfg = STATUS_CONFIG[app.status] ?? STATUS_CONFIG["Applied"];
                    const score = appScores[app.id];
                    return (
                      <tr
                        key={app.id}
                        className="group border-b border-border/40 last:border-0 cursor-pointer transition-colors hover:bg-muted/50 dark:border-white/[0.04] dark:hover:bg-white/[0.03]"
                        onClick={() => onRowClick(app)}
                      >
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <CompanyAvatar company={app.company} />
                            <span className="font-semibold text-[13px] text-foreground/80 group-hover:text-foreground transition-colors">
                              {app.company}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="text-[13px] text-muted-foreground">{app.position}</span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                            cfg.color, cfg.bg, cfg.border
                          )}>
                            {app.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          {app.referral === "Yes"
                            ? <Badge variant="success" className="text-[10px]">Referred</Badge>
                            : <span className="text-muted-foreground/30 text-xs">—</span>
                          }
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="text-[12px] tabular-nums text-muted-foreground/60">
                            {formatShortDate(app.last_updated)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="text-[12px] tabular-nums text-muted-foreground/60">
                            {formatDate(app.dateApplied)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          {score != null
                            ? <ScoreBadge score={score} />
                            : <span className="text-muted-foreground/30 text-xs">—</span>
                          }
                        </td>
                        <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted dark:hover:bg-white/[0.07]" onClick={() => onEdit(app)}>
                                  <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs">Edit</TooltipContent>
                            </Tooltip>
                            {app.jobUrl && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted dark:hover:bg-white/[0.07]" asChild>
                                    <a href={app.jobUrl} target="_blank" rel="noreferrer">
                                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                                    </a>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent className="text-xs">Open Job Post</TooltipContent>
                              </Tooltip>
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-primary/10" onClick={() => onMatch(app)}>
                                  <Sparkles className="h-3.5 w-3.5 text-primary/60 hover:text-primary" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs">Match Resume</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/10" onClick={() => onDelete(app.id)}>
                                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs">Delete</TooltipContent>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {sortedApps.length > 0 && (
            <div className="border-t border-border/40 px-4 py-2.5 dark:border-white/[0.04]">
              <p className="text-[11px] text-muted-foreground/40 tabular-nums">
                {sortedApps.length} {sortedApps.length === 1 ? "application" : "applications"}
                {searchTerm ? " matched" : ""}
              </p>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
