import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Target, Loader2, XCircle, Sparkles, FileText, Mail,
  RefreshCw, Check, SkipForward, Plus, AlertTriangle,
  Search, ExternalLink, ChevronDown, ChevronRight, Layers, List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// ── Types ─────────────────────────────────────────────────────────────────────

type JobStatus = "new" | "scored" | "generated" | "applied" | "skipped";

interface ScrapedJob {
  id: string;
  source: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  url: string | null;
  jd_text: string;
  status: JobStatus;
  match_score: number | null;
  ats_score: number | null;
  recruiter_score: number | null;
  bucket_verdict: string | null;
  lane_warning: string | null;
  scored_at: string | null;
  scraped_at: string | null;
  scrape_session_id: string | null;
  created_at: string;
}

interface Props {
  session: any;
  onOpenBuilder: () => void;
}

// ── Visual helpers ────────────────────────────────────────────────────────────

function scoreColor(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 75) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-red-400";
}

// Short, locale-friendly date (e.g. "Jun 27") for the history view. Prefers when the
// job was scored; falls back to when it landed on the board.
function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Date + time for a scrape-session divider (e.g. "Jun 27, 2026, 2:14 PM").
function sessionStamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
    ", " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}

// in-bucket vs reach vs off-lane / over-qualified — the triage signal.
const VERDICT_CONFIG: Record<string, { label: string; cls: string }> = {
  "in-bucket":      { label: "In bucket",      cls: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
  "reach":          { label: "Reach",          cls: "text-amber-400 border-amber-500/30 bg-amber-500/10" },
  "out-of-pool":    { label: "Out of pool",    cls: "text-red-400 border-red-500/30 bg-red-500/10" },
  "over-qualified": { label: "Over-qualified", cls: "text-sky-400 border-sky-500/30 bg-sky-500/10" },
};

const STATUS_CONFIG: Record<JobStatus, { label: string; cls: string }> = {
  new:       { label: "New",       cls: "text-muted-foreground border-border bg-muted/40" },
  scored:    { label: "Scored",    cls: "text-primary border-primary/30 bg-primary/10" },
  generated: { label: "Generated", cls: "text-violet-400 border-violet-500/30 bg-violet-500/10" },
  applied:   { label: "Applied",   cls: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
  skipped:   { label: "Skipped",   cls: "text-zinc-400 border-zinc-500/30 bg-zinc-500/10" },
};

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={cn("text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border shrink-0", cls)}>
      {label}
    </span>
  );
}

// ── Scrape panel ──────────────────────────────────────────────────────────────

const SCRAPE_COUNTS = [5, 10, 25];
const SCRAPE_PLATFORMS: { id: string; label: string; disabled?: boolean }[] = [
  { id: "builtin", label: "BuiltIn" },
  { id: "linkedin", label: "LinkedIn (coming soon)", disabled: true },
  { id: "indeed", label: "Indeed (coming soon)", disabled: true },
];

function ScrapePanel({
  onScrape, scraping, summary,
}: {
  onScrape: (b: { platform: string; searchQueries: string[]; searchLocation?: string; maxResults: number; skipSenior: boolean }) => void;
  scraping: boolean;
  summary: string | null;
}) {
  const [platform, setPlatform] = useState("builtin");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [count, setCount] = useState(10);
  const [skipSenior, setSkipSenior] = useState(true);

  const submit = () => {
    if (!query.trim() || scraping) return;
    onScrape({
      platform,
      searchQueries: [query.trim()],
      searchLocation: location.trim() || undefined,
      maxResults: count,
      skipSenior,
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-sm text-foreground">Scrape jobs</h2>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-1">
        Pull live postings from a job board — each is scored against your Master Profile and ranked into the board below.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <select
          value={platform}
          onChange={e => setPlatform(e.target.value)}
          className="h-8 rounded-md border border-input bg-input px-2 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {SCRAPE_PLATFORMS.map(p => (
            <option key={p.id} value={p.id} disabled={p.disabled}>{p.label}</option>
          ))}
        </select>
        <select
          value={count}
          onChange={e => setCount(Number(e.target.value))}
          className="h-8 rounded-md border border-input bg-input px-2 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {SCRAPE_COUNTS.map(c => <option key={c} value={c}>{c} jobs</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          placeholder="Keywords, e.g. machine learning engineer"
          className="h-8 rounded-md border border-input bg-input px-2 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <input
          value={location}
          onChange={e => setLocation(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          placeholder="Location (optional), e.g. Boston"
          className="h-8 rounded-md border border-input bg-input px-2 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground cursor-pointer select-none">
        <input
          type="checkbox"
          checked={skipSenior}
          onChange={e => setSkipSenior(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-input accent-primary"
        />
        Skip senior roles (Senior / Staff / Lead / Manager / Director…) — saves scoring cost
      </label>

      <Button onClick={submit} disabled={!query.trim() || scraping} className="w-full">
        {scraping
          ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Scraping &amp; ranking…</>
          : <><Search className="h-4 w-4 mr-2" />Scrape &amp; Rank</>}
      </Button>

      {summary && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Check className="h-3 w-3 text-emerald-400 shrink-0" />{summary}
        </p>
      )}
    </div>
  );
}

// ── Paste box ─────────────────────────────────────────────────────────────────

function PasteJobBox({ onAdd, adding }: { onAdd: (b: { jd_text: string; title?: string; company?: string; url?: string }) => void; adding: boolean }) {
  const [jd, setJd] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [url, setUrl] = useState("");

  const submit = () => {
    if (!jd.trim()) return;
    onAdd({
      jd_text: jd.trim(),
      title: title.trim() || undefined,
      company: company.trim() || undefined,
      url: url.trim() || undefined,
    });
    setJd(""); setTitle(""); setCompany(""); setUrl("");
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Plus className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-sm text-foreground">Paste a job</h2>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-1">
        Drop a job description in. It is scored against your Master Profile automatically — generation is per-job, on click.
      </p>

      <div className="grid grid-cols-3 gap-2">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="h-8 rounded-md border border-input bg-input px-2 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <input
          value={company}
          onChange={e => setCompany(e.target.value)}
          placeholder="Company (optional)"
          className="h-8 rounded-md border border-input bg-input px-2 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="URL (optional)"
          className="h-8 rounded-md border border-input bg-input px-2 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <textarea
        value={jd}
        onChange={e => setJd(e.target.value)}
        placeholder="Paste the full job description here…"
        className="w-full h-40 rounded-lg border border-border bg-muted/20 p-3 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary resize-none font-mono"
      />

      <Button onClick={submit} disabled={!jd.trim() || adding} className="w-full">
        {adding
          ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Adding &amp; scoring…</>
          : <><Sparkles className="h-4 w-4 mr-2" />Add &amp; score</>}
      </Button>
    </div>
  );
}

// ── Job row ───────────────────────────────────────────────────────────────────

function JobRow({
  job, busy, onGenerate, onScore, onPatch,
}: {
  job: ScrapedJob;
  busy: string | null; // null | 'score' | 'resume' | 'cover' | 'applied' | 'skipped'
  onGenerate: (id: string, includeCoverLetter: boolean) => void;
  onScore: (id: string) => void;
  onPatch: (id: string, status: JobStatus) => void;
}) {
  const verdict = job.bucket_verdict ? VERDICT_CONFIG[job.bucket_verdict] : null;
  const isTerminal = job.status === "applied" || job.status === "skipped";

  return (
    <div className={cn(
      "rounded-xl border bg-card p-4 space-y-3 transition-colors",
      isTerminal ? "border-border/60 opacity-70" : "border-border",
    )}>
      <div className="flex items-start gap-3">
        {/* Score */}
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className={cn("text-2xl font-black tabular-nums leading-none", scoreColor(job.match_score))}>
            {job.match_score ?? "—"}
          </span>
          <span className="text-[8px] text-muted-foreground font-label uppercase tracking-wider mt-0.5">match</span>
        </div>

        {/* Title / company / meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[13px] text-foreground truncate">
              {job.title || "Untitled role"}
            </span>
            {verdict && <Badge label={verdict.label} cls={verdict.cls} />}
            <Badge label={STATUS_CONFIG[job.status].label} cls={STATUS_CONFIG[job.status].cls} />
          </div>
          <p className="text-[11.5px] text-muted-foreground truncate mt-0.5">
            {job.company || "Unknown company"}
            {job.location ? ` · ${job.location}` : ""}
            {job.source && job.source !== "manual" ? ` · ${job.source}` : ""}
            {(() => {
              const d = shortDate(job.scored_at ?? job.created_at);
              return d ? ` · ${job.scored_at ? "scored" : "added"} ${d}` : "";
            })()}
          </p>
          {job.lane_warning && (
            <p className="text-[11px] text-amber-400/90 flex items-start gap-1.5 mt-1.5">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
              <span>{job.lane_warning}</span>
            </p>
          )}
          {(job.ats_score != null || job.recruiter_score != null) && (
            <p className="text-[10px] text-muted-foreground/70 font-label mt-1">
              ATS {job.ats_score ?? "—"} · Recruiter {job.recruiter_score ?? "—"}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      {!isTerminal && (
        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border">
          <Button
            size="sm" variant="outline" className="h-7 text-[11px]"
            disabled={!!busy}
            onClick={() => onGenerate(job.id, false)}
          >
            {busy === "resume"
              ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Generating…</>
              : <><FileText className="h-3 w-3 mr-1" />Generate resume</>}
          </Button>
          <Button
            size="sm" variant="outline" className="h-7 text-[11px]"
            disabled={!!busy}
            onClick={() => onGenerate(job.id, true)}
          >
            {busy === "cover"
              ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Generating…</>
              : <><Mail className="h-3 w-3 mr-1" />+ Cover letter</>}
          </Button>
          <button
            onClick={() => onScore(job.id)}
            disabled={!!busy}
            title="Re-score against your current Master Profile"
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors disabled:opacity-50"
          >
            {busy === "score" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Re-score
          </button>
          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open the job posting in a new tab"
              className="text-[11px] text-primary hover:text-primary/80 hover:underline flex items-center gap-1 transition-colors"
            >
              <ExternalLink className="h-3 w-3" />Apply
            </a>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => onPatch(job.id, "applied")}
              disabled={!!busy}
              className="text-[11px] text-emerald-400/90 hover:text-emerald-300 flex items-center gap-1 transition-colors disabled:opacity-50"
            >
              <Check className="h-3 w-3" />Mark applied
            </button>
            <button
              onClick={() => onPatch(job.id, "skipped")}
              disabled={!!busy}
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors disabled:opacity-50"
            >
              <SkipForward className="h-3 w-3" />Skip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const FILTERS: { id: string; label: string }[] = [
  { id: "", label: "All" },
  { id: "scored", label: "Scored" },
  { id: "generated", label: "Generated" },
  { id: "applied", label: "Applied" },
  { id: "skipped", label: "Skipped" },
];

export default function JobsTab({ session, onOpenBuilder }: Props) {
  const token = session?.access_token ?? "";
  const [jobs, setJobs] = useState<ScrapedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [scrapeSummary, setScrapeSummary] = useState<string | null>(null);
  const [mode, setMode] = useState<"scrape" | "paste">("scrape");
  const [view, setView] = useState<"sessions" | "all">("sessions");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Per-row busy action: { [jobId]: 'score' | 'resume' | 'cover' | 'applied' | 'skipped' }
  const [busy, setBusy] = useState<Record<string, string>>({});
  // Explicit open/closed overrides per session key; unset defaults to "newest open".
  const [sessionToggles, setSessionToggles] = useState<Record<string, boolean>>({});

  const authHeaders = useMemo(
    () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` }),
    [token],
  );

  // Fetch the FULL board once (server returns it match_score-desc), then filter and
  // count client-side — one request, accurate totals for the summary, instant lane
  // switches. GET /jobs?status= still exists server-side; this view just doesn't use it.
  const fetchJobs = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/jobs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) setJobs(data.jobs ?? []);
      else setError(data.error || "Failed to load jobs.");
    } catch (e: any) {
      setError(e?.message || "Failed to load jobs.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // Status counts across the whole board (for the history summary line).
  const counts = useMemo(() => {
    const c = { total: jobs.length, scored: 0, generated: 0, applied: 0, skipped: 0 };
    for (const j of jobs) {
      if (j.status === "scored") c.scored++;
      else if (j.status === "generated") c.generated++;
      else if (j.status === "applied") c.applied++;
      else if (j.status === "skipped") c.skipped++;
    }
    return c;
  }, [jobs]);

  const visibleJobs = useMemo(
    () => (filter ? jobs.filter(j => j.status === filter) : jobs),
    [jobs, filter],
  );

  // Group the (already status-filtered, match_score-desc) jobs by scrape session.
  // Real sessions sort newest-first by scraped_at; null-session jobs (manual pastes +
  // pre-migration rows) collect in an "Ungrouped" group pinned to the bottom. Empty
  // groups (after filtering) naturally disappear. Within a group, server order
  // (match_score desc) is preserved.
  const UNGROUPED = "__ungrouped__";
  const sessionGroups = useMemo(() => {
    const map = new Map<string, { key: string; scrapedAt: string | null; jobs: ScrapedJob[] }>();
    for (const j of visibleJobs) {
      const key = j.scrape_session_id ?? UNGROUPED;
      let g = map.get(key);
      if (!g) { g = { key, scrapedAt: j.scraped_at, jobs: [] }; map.set(key, g); }
      g.jobs.push(j);
    }
    const groups = Array.from(map.values());
    groups.sort((a, b) => {
      if (a.key === UNGROUPED) return 1;
      if (b.key === UNGROUPED) return -1;
      return (b.scrapedAt ?? "").localeCompare(a.scrapedAt ?? "");
    });
    return groups;
  }, [visibleJobs]);

  // A session is open when explicitly toggled; otherwise only the newest (index 0) is.
  const isSessionOpen = (key: string, idx: number) => sessionToggles[key] ?? (idx === 0);
  const toggleSession = (key: string, idx: number) =>
    setSessionToggles(prev => ({ ...prev, [key]: !(prev[key] ?? (idx === 0)) }));

  const countSummary = useMemo(() => {
    const parts = [`${counts.total} job${counts.total === 1 ? "" : "s"}`];
    if (counts.scored) parts.push(`${counts.scored} scored`);
    if (counts.generated) parts.push(`${counts.generated} generated`);
    if (counts.applied) parts.push(`${counts.applied} applied`);
    if (counts.skipped) parts.push(`${counts.skipped} skipped`);
    return parts.join(" · ");
  }, [counts]);

  const setRowBusy = (id: string, action: string | null) =>
    setBusy(prev => {
      const next = { ...prev };
      if (action) next[id] = action; else delete next[id];
      return next;
    });

  // Add a pasted job, then immediately score it.
  const handleAdd = useCallback(async (body: { jd_text: string; title?: string; company?: string; url?: string }) => {
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`${API}/jobs`, { method: "POST", headers: authHeaders, body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to add job.");
      const jobId = data.job.id;
      // Auto-score (cheap + automatic). Best-effort — the row still appears if scoring fails.
      try {
        await fetch(`${API}/jobs/${jobId}/score`, { method: "POST", headers: authHeaders });
      } catch { /* surfaced as an unscored row */ }
      await fetchJobs();
    } catch (e: any) {
      setError(e?.message || "Failed to add job.");
    } finally {
      setAdding(false);
    }
  }, [authHeaders, fetchJobs]);

  // Scrape a platform, score into the board, then refresh so new jobs rank in.
  const handleScrape = useCallback(async (body: { platform: string; searchQueries: string[]; searchLocation?: string; maxResults: number; skipSenior: boolean }) => {
    setScraping(true);
    setError(null);
    setScrapeSummary(null);
    try {
      const res = await fetch(`${API}/jobs/scrape`, { method: "POST", headers: authHeaders, body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Scrape failed.");
      const parts = [`Scraped ${data.scraped}`];
      if (data.seniorityFiltered) parts.push(`${data.seniorityFiltered} skipped (senior)`);
      parts.push(`${data.scored} new`);
      if (data.deduped) parts.push(`${data.deduped} already seen (deduped)`);
      if (data.skipped) parts.push(`${data.skipped} skipped`);
      if (data.errored) parts.push(`${data.errored} errored`);
      if (data.missingDescription) parts.push(`${data.missingDescription} without description`);
      setScrapeSummary(parts.join(" · "));
      await fetchJobs();
    } catch (e: any) {
      setError(e?.message || "Scrape failed.");
    } finally {
      setScraping(false);
    }
  }, [authHeaders, fetchJobs]);

  const handleScore = useCallback(async (id: string) => {
    setRowBusy(id, "score");
    setError(null);
    try {
      const res = await fetch(`${API}/jobs/${id}/score`, { method: "POST", headers: authHeaders });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Scoring failed.");
      await fetchJobs();
    } catch (e: any) {
      setError(e?.message || "Scoring failed.");
    } finally {
      setRowBusy(id, null);
    }
  }, [authHeaders, fetchJobs]);

  const handleGenerate = useCallback(async (id: string, includeCoverLetter: boolean) => {
    setRowBusy(id, includeCoverLetter ? "cover" : "resume");
    setError(null);
    try {
      const res = await fetch(`${API}/jobs/${id}/generate`, {
        method: "POST", headers: authHeaders, body: JSON.stringify({ includeCoverLetter }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Generation failed.");
      await fetchJobs();
      // The new version is the newest resume_builder row — opening the Builder loads it.
      onOpenBuilder();
    } catch (e: any) {
      setError(e?.message || "Generation failed.");
    } finally {
      setRowBusy(id, null);
    }
  }, [authHeaders, fetchJobs, onOpenBuilder]);

  const handlePatch = useCallback(async (id: string, status: JobStatus) => {
    setRowBusy(id, status);
    setError(null);
    try {
      const res = await fetch(`${API}/jobs/${id}`, { method: "PATCH", headers: authHeaders, body: JSON.stringify({ status }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Update failed.");
      await fetchJobs();
    } catch (e: any) {
      setError(e?.message || "Update failed.");
    } finally {
      setRowBusy(id, null);
    }
  }, [authHeaders, fetchJobs]);

  return (
    <div className="space-y-5">
      {/* Source toggle: Scrape vs Paste — both feed the same ranked board below. */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
        {(["scrape", "paste"] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "flex-1 h-8 rounded-md text-[12px] font-medium transition-colors capitalize flex items-center justify-center gap-1.5",
              mode === m ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "scrape" ? <Search className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {m}
          </button>
        ))}
      </div>

      {mode === "scrape"
        ? <ScrapePanel onScrape={handleScrape} scraping={scraping} summary={scrapeSummary} />
        : <PasteJobBox onAdd={handleAdd} adding={adding} />}

      {error && (
        <p className="text-[12px] text-destructive flex items-center gap-1.5">
          <XCircle className="h-3.5 w-3.5 shrink-0" />{error}
        </p>
      )}

      {/* Board view: grouped by scrape session vs one flat ranked list. */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
        {([["sessions", "Sessions", Layers], ["all", "All jobs", List]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={cn(
              "flex-1 h-8 rounded-md text-[12px] font-medium transition-colors flex items-center justify-center gap-1.5",
              view === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 overflow-x-auto">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "flex-1 h-8 rounded-md text-[12px] font-medium transition-colors px-3 whitespace-nowrap",
              filter === f.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* History summary — totals across the whole board */}
      {jobs.length > 0 && (
        <p className="text-[11.5px] text-muted-foreground font-label px-1 -mt-1">{countSummary}</p>
      )}

      {/* List */}
      {loading ? (
        <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading jobs…</p>
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 flex flex-col items-center gap-2 text-center">
          <Target className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No jobs yet.</p>
          <p className="text-[12px] text-muted-foreground/60">Scrape a board or paste a job description above to start triaging.</p>
        </div>
      ) : visibleJobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 flex flex-col items-center gap-2 text-center">
          <Target className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No jobs in this lane.</p>
          <p className="text-[12px] text-muted-foreground/60">Switch the filter above to see other jobs.</p>
        </div>
      ) : view === "all" ? (
        <div className="space-y-3">
          {visibleJobs.map(job => (
            <JobRow
              key={job.id}
              job={job}
              busy={busy[job.id] ?? null}
              onGenerate={handleGenerate}
              onScore={handleScore}
              onPatch={handlePatch}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {sessionGroups.map((g, idx) => {
            const open = isSessionOpen(g.key, idx);
            const isUngrouped = g.key === UNGROUPED;
            return (
              <div key={g.key} className="space-y-3">
                <button
                  onClick={() => toggleSession(g.key, idx)}
                  className="w-full flex items-center gap-2 text-left text-[11.5px] text-muted-foreground hover:text-foreground transition-colors border-b border-border pb-1.5"
                >
                  {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                  <span className="font-label uppercase tracking-wider">
                    {isUngrouped ? "Ungrouped" : `Scraped ${sessionStamp(g.scrapedAt)}`}
                  </span>
                  <span className="text-muted-foreground/60">· {g.jobs.length} job{g.jobs.length === 1 ? "" : "s"}</span>
                </button>
                {open && (
                  <div className="space-y-3">
                    {g.jobs.map(job => (
                      <JobRow
                        key={job.id}
                        job={job}
                        busy={busy[job.id] ?? null}
                        onGenerate={handleGenerate}
                        onScore={handleScore}
                        onPatch={handlePatch}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
