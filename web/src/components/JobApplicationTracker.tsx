import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { todayISO, startOfWeekISO } from "@/lib/dateUtils";
import { STATUSES, SOURCES } from "@/lib/constants";
import type { JobApplication, AppFormData, Resume, MatchResult } from "@/lib/types";

import Sidebar, { type TabId } from "@/components/layout/Sidebar";
import ApplicationsTab from "@/components/tabs/ApplicationsTab";
import FilesTab from "@/components/tabs/FilesTab";
import AnalyticsTab from "@/components/tabs/AnalyticsTab";
import ProfileTab from "@/components/tabs/ProfileTab";
import AppFormModal from "@/components/modals/AppFormModal";
import AppDetailModal from "@/components/modals/AppDetailModal";
import DeleteConfirmDialog from "@/components/modals/DeleteConfirmDialog";
import MatchDialog from "@/components/modals/MatchDialog";

// ── helpers ────────────────────────────────────────────────────────────────

function ensureTimeline(app: any) {
  if (Array.isArray(app.timeline) && app.timeline.length > 0) return app;
  const base = new Date(app.dateApplied).getTime() || Date.now();
  return { ...app, timeline: [{ ts: base, status: "Application created" }] };
}

function getLastUpdatedTs(app: any) {
  if (app.last_updated) return new Date(app.last_updated).getTime();
  const tl = Array.isArray(app.timeline) ? app.timeline : [];
  if (!tl.length) return new Date(app.dateApplied).getTime() || Date.now();
  return tl.reduce((mx: number, e: any) => Math.max(mx, Number(e?.ts || 0)), 0) || Date.now();
}

function median(values: number[]) {
  const arr = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 === 1 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function calcResponseRate(apps: JobApplication[]) {
  const responded = apps.filter((a) => !["Applied", "Withdrawn"].includes(a.status)).length;
  return apps.length > 0 ? ((responded / apps.length) * 100).toFixed(1) : 0;
}

function calcAvgResponseTime(apps: JobApplication[]) {
  const times = apps
    .filter((a) => a.timeline && a.timeline.length > 1)
    .map((a) => {
      const applied = a.timeline[0]?.ts;
      const responded = a.timeline.find((t) => t.status !== "Application created")?.ts;
      return responded && applied ? (responded - applied) / (1000 * 60 * 60 * 24) : null;
    })
    .filter((t): t is number => t !== null);
  return times.length > 0 ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : null;
}

function calcConversionRate(apps: JobApplication[], from: string, to: string) {
  const fromIdx = STATUSES.indexOf(from as any);
  const toIdx = STATUSES.indexOf(to as any);
  const reachedFrom = apps.filter((a) => STATUSES.indexOf(a.status as any) >= fromIdx).length;
  const reachedTo = apps.filter((a) => STATUSES.indexOf(a.status as any) >= toIdx).length;
  return reachedFrom > 0 ? ((reachedTo / reachedFrom) * 100).toFixed(1) : 0;
}

const THEME_KEY = (uid: string) => `jt.theme.v4.${uid}`;
const PROFILE_KEY = (uid: string) => `jt.profile.v1.${uid}`;

// ── component ──────────────────────────────────────────────────────────────

export default function JobApplicationTracker({ session }: { session: any }) {
  const userId: string = session?.user?.id ?? "";
  const googleName: string = session?.user?.user_metadata?.full_name ?? session?.user?.email ?? "";
  const googleEmail: string = session?.user?.email ?? "";
  const googleAvatarUrl: string | null = session?.user?.user_metadata?.avatar_url ?? null;

  // ── core state ──────────────────────────────────────────────────────────
  const [apps, setApps] = useState<JobApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("applications");

  // ── profile ─────────────────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState("");
  const [joinedAt, setJoinedAt] = useState<string | null>(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameInput, setNameInput] = useState("");

  // ── form ────────────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formData, setFormData] = useState<AppFormData>({
    company: "", position: "", location: "", salary: "",
    dateApplied: todayISO(), status: "Applied", jobUrl: "",
    source: "LinkedIn", referral: "No", notes: "", jobDescription: "", documents: [],
  });
  const [dupWarning, setDupWarning] = useState<any>(null);
  const dupConfirmedRef = useRef(false);
  const [autofillLoading, setAutofillLoading] = useState(false);

  // ── suggestions ─────────────────────────────────────────────────────────
  const [companySuggestions, setCompanySuggestions] = useState<string[]>([]);
  const [positionSuggestions, setPositionSuggestions] = useState<string[]>([]);
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([]);

  // ── app detail / delete ─────────────────────────────────────────────────
  const [expandedApp, setExpandedApp] = useState<JobApplication | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ── search ──────────────────────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState("");

  // ── AI summary ──────────────────────────────────────────────────────────
  const [aiSummary, setAiSummary] = useState("");
  const [loadingSummary, setLoadingSummary] = useState(false);

  // ── resumes ─────────────────────────────────────────────────────────────
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [resumesLoading, setResumesLoading] = useState(false);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumeParseStatus, setResumeParseStatus] = useState<Record<string, "idle" | "parsing" | "done" | "error">>({});

  // ── match ────────────────────────────────────────────────────────────────
  const [matchDialogApp, setMatchDialogApp] = useState<JobApplication | null>(null);
  const [matchResumeId, setMatchResumeId] = useState("");
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [appScores, setAppScores] = useState<Record<string, number>>({});

  const API = import.meta.env.VITE_API_URL;
  const token = () => session?.access_token ?? "";

  // ── derived ──────────────────────────────────────────────────────────────
  const filteredApps = useMemo(() => {
    const t = searchTerm.toLowerCase();
    return apps.filter(
      (a) =>
        a.company?.toLowerCase().includes(t) ||
        a.position?.toLowerCase().includes(t) ||
        a.location?.toLowerCase().includes(t)
    );
  }, [apps, searchTerm]);

  const sortedApps = useMemo(
    () => [...filteredApps].sort((a, b) => getLastUpdatedTs(b) - getLastUpdatedTs(a)),
    [filteredApps]
  );

  const stats = useMemo(() => {
    const statusCounts: Record<string, number> = {};
    STATUSES.forEach((s) => (statusCounts[s] = 0));
    apps.forEach((a) => { if (statusCounts[a.status] !== undefined) statusCounts[a.status]++; });

    const sourceCounts: Record<string, number> = {};
    SOURCES.forEach((s) => (sourceCounts[s] = 0));
    apps.forEach((a) => { if (sourceCounts[a.source] !== undefined) sourceCounts[a.source]++; });

    const weekMap: Record<string, number> = {};
    apps.forEach((a) => {
      const wk = startOfWeekISO(a.dateApplied);
      if (wk) weekMap[wk] = (weekMap[wk] || 0) + 1;
    });
    const weeks = Object.entries(weekMap)
      .map(([week, count]) => ({ week, count }))
      .sort((a, b) => a.week.localeCompare(b.week));

    const salaries = apps
      .filter((a) => a.status === "Offer" && a.salary)
      .map((a) => parseFloat(String(a.salary).replace(/[^0-9.]/g, "")))
      .filter((v) => Number.isFinite(v));

    return {
      total: apps.length,
      statusCounts,
      sourceCounts,
      weeks,
      medianSalary: median(salaries),
      responseRate: calcResponseRate(apps),
      avgResponseTime: calcAvgResponseTime(apps),
      screeningConversion: calcConversionRate(apps, "Applied", "Screening"),
      interviewConversion: calcConversionRate(apps, "Screening", "Interview Scheduled"),
      offerConversion: calcConversionRate(apps, "Interview Completed", "Offer"),
    };
  }, [apps]);

  const pieData = useMemo(
    () => Object.entries(stats.statusCounts).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })),
    [stats.statusCounts]
  );
  const sourceData = useMemo(
    () => Object.entries(stats.sourceCounts).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })),
    [stats.sourceCounts]
  );

  // ── autofill suggestions ──────────────────────────────────────────────────
  useEffect(() => {
    setCompanySuggestions([...new Set(apps.map((a) => a.company).filter(Boolean))]);
    setPositionSuggestions([...new Set(apps.map((a) => a.position).filter(Boolean))]);
    setLocationSuggestions([...new Set(apps.map((a) => a.location).filter(Boolean))]);
  }, [apps]);

  // ── data fetching ─────────────────────────────────────────────────────────

  const fetchApps = async () => {
    if (!session?.access_token) { setApps([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/applications`, { headers: { Authorization: `Bearer ${token()}` } });
      if (!res.ok) throw new Error(`Failed to fetch (${res.status})`);
      const data = await res.json();
      const mapped = (data?.data || []).map((app: any) => {
        const dateApplied = (app.date_applied || app.dateApplied || "").slice(0, 10) || todayISO();
        const existingTimeline =
          Array.isArray(app.timeline) && app.timeline.length > 0
            ? app.timeline
            : [{ status: app.status || "Applied", ts: new Date(dateApplied).getTime() }];
        return ensureTimeline({
          ...app,
          jobUrl: app.job_url ?? app.jobUrl ?? "",
          jobDescription: app.job_description ?? app.jobDescription ?? "",
          referral: app.referral ?? "No",
          dateApplied,
          documents: app.documents ?? [],
          timeline: existingTimeline,
        });
      });
      setApps(mapped);
      loadCachedScores(mapped);
    } catch (err: any) {
      console.error(err);
      setApps([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchProfile = async () => {
    if (!userId) return;
    try {
      const { data: { session: cs } } = await supabase.auth.getSession();
      if (!cs) return;
      try {
        const cm = JSON.parse(localStorage.getItem(PROFILE_KEY(userId)) || "{}");
        if (cm.displayName) setDisplayName(cm.displayName);
      } catch {}
      const res = await fetch(`${API}/profile`, { headers: { Authorization: `Bearer ${cs.access_token}` } });
      if (!res.ok) { setNameInput(googleName); setShowNameModal(true); return; }
      const data = await res.json();
      if (data?.success && data?.data) {
        const p = data.data;
        if (p.display_name) {
          setDisplayName(p.display_name);
          try {
            const cm = JSON.parse(localStorage.getItem(PROFILE_KEY(userId)) || "{}");
            localStorage.setItem(PROFILE_KEY(userId), JSON.stringify({ ...cm, displayName: p.display_name }));
          } catch {}
        } else { setNameInput(googleName); setShowNameModal(true); }
        if (p.created_at) setJoinedAt(p.created_at);
      } else { setNameInput(googleName); setShowNameModal(true); }
    } catch { setNameInput(googleName); setShowNameModal(true); }
  };

  const fetchResumes = async () => {
    if (!session?.access_token) return;
    setResumesLoading(true);
    try {
      const res = await fetch(`${API}/resumes`, { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (data.success) setResumes(data.data || []);
    } catch (err) { console.error(err); }
    finally { setResumesLoading(false); }
  };

  const loadCachedScores = async (appList: JobApplication[]) => {
    const scores: Record<string, number> = {};
    await Promise.all(
      appList.map(async (app) => {
        try {
          const res = await fetch(`${API}/match/${app.id}`, { headers: { Authorization: `Bearer ${token()}` } });
          if (res.ok) {
            const d = await res.json();
            if (d.success && d.data?.score != null) scores[app.id] = d.data.score;
          }
        } catch {}
      })
    );
    setAppScores(scores);
  };

  useEffect(() => {
    if (session?.access_token) { fetchApps(); fetchProfile(); }
  }, [session]);

  useEffect(() => {
    if (apps.length > 0 && !aiSummary && !loadingSummary) generateAiSummary();
  }, [apps]);

  // ── actions ──────────────────────────────────────────────────────────────

  const generateAiSummary = async () => {
    if (!apps.length || !session?.access_token) return;
    setLoadingSummary(true);
    try {
      const res = await fetch(`${API}/summary`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          apps: apps.map((a) => ({ company: a.company, position: a.position, status: a.status, dateApplied: a.dateApplied, jobDescription: a.jobDescription || "" })),
        }),
      });
      const data = await res.json();
      if (data.success) setAiSummary(data.summary);
    } catch {}
    finally { setLoadingSummary(false); }
  };

  const handleLogout = () => supabase.auth.signOut();

  const resetForm = () => {
    setFormData({ company: "", position: "", location: "", salary: "", dateApplied: todayISO(), status: "Applied", jobUrl: "", source: "LinkedIn", referral: "No", notes: "", jobDescription: "", documents: [] });
    setShowForm(false);
    setEditId(null);
    setDupWarning(null);
    dupConfirmedRef.current = false;
  };

  const handleEdit = (app: JobApplication) => {
    setFormData({ ...app, jobDescription: app.jobDescription ?? "", documents: app.documents ?? [] });
    setEditId(app.id);
    setExpandedApp(null);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editId && !dupConfirmedRef.current) {
      const dup = apps.find((a) => {
        if (a.id === editId) return false;
        if (formData.jobUrl && (a as any).job_url === formData.jobUrl) return true;
        return a.company?.toLowerCase() === formData.company?.toLowerCase() && a.position?.toLowerCase() === formData.position?.toLowerCase();
      });
      if (dup) { setDupWarning(dup); return; }
    }
    dupConfirmedRef.current = false;
    setDupWarning(null);

    const now = Date.now();
    let updatedTimeline: any[];
    if (editId) {
      const existing = apps.find((a) => a.id === editId);
      const prevTl = existing?.timeline ?? [];
      const lastStatus = prevTl[prevTl.length - 1]?.status;
      updatedTimeline = lastStatus !== formData.status ? [...prevTl, { status: formData.status, ts: now }] : prevTl;
    } else {
      updatedTimeline = [{ status: formData.status || "Applied", ts: now }];
    }

    const payload = {
      company: formData.company, position: formData.position, location: formData.location,
      salary: formData.salary, date_applied: formData.dateApplied, status: formData.status,
      job_url: formData.jobUrl, source: formData.source, referral: formData.referral ?? "No",
      notes: formData.notes, job_description: formData.jobDescription,
      timeline: updatedTimeline, last_updated: new Date(now).toISOString(),
    };

    try {
      const url = editId ? `${API}/applications/${editId}` : `${API}/applications`;
      const res = await fetch(url, {
        method: editId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      await fetchApps();
      resetForm();
    } catch (err: any) {
      alert(err?.message || "Failed to save application.");
    }
  };

  const handleDelete = (id: string) => setDeleteConfirmId(id);

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    const id = deleteConfirmId;
    setDeleteConfirmId(null);
    setApps((prev) => prev.filter((a) => a.id !== id));
    try {
      const res = await fetch(`${API}/applications/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token()}` } });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
    } catch (err: any) {
      alert(err?.message || "Failed to delete.");
      await fetchApps();
    }
  };

  const handleAutofill = async () => {
    if (!formData.jobUrl?.startsWith("http")) { alert("Paste a valid job URL first."); return; }
    setAutofillLoading(true);
    try {
      const res = await fetch(`${API}/autofill`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: formData.jobUrl }),
      });
      const data = await res.json();
      if (data.success) {
        const { company, position, location, salary, jobDescription } = data.data;
        setFormData((p) => ({ ...p, ...(company && { company }), ...(position && { position }), ...(location && { location }), ...(salary && { salary }), ...(jobDescription && { jobDescription }) }));
      } else { alert(data.error || "Autofill failed."); }
    } catch (err: any) { alert(err.message || "Autofill failed."); }
    finally { setAutofillLoading(false); }
  };

  const handleResumeUpload = async (file: File) => {
    setResumeError(null);
    const allowed = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    if (!allowed.includes(file.type)) { setResumeError("Only PDF, DOC, and DOCX files are accepted."); return; }
    if (resumes.length >= 3) { setResumeError("You've reached the 3-resume limit. Delete one to upload a new one."); return; }
    setResumeUploading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = (e.target?.result as string).split(",")[1];
      const res = await fetch(`${API}/resumes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ fileName: file.name, fileType: file.type, fileData: base64, fileSize: file.size }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchResumes();
        await handleResumeParse(data.data.id);
        await fetchResumes();
      } else { setResumeError(data.error || "Upload failed."); }
      setResumeUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleResumeDelete = async (id: string) => {
    const res = await fetch(`${API}/resumes/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token()}` } });
    const data = await res.json();
    if (data.success) setResumes((p) => p.filter((r) => r.id !== id));
    else setResumeError(data.error || "Delete failed.");
  };

  const handleResumeDownload = async (id: string) => {
    const res = await fetch(`${API}/resumes/${id}/download`, { headers: { Authorization: `Bearer ${token()}` } });
    const data = await res.json();
    if (data.success) {
      const a = document.createElement("a");
      a.href = data.url; a.download = data.fileName; a.target = "_blank"; a.click();
    } else setResumeError(data.error || "Download failed.");
  };

  const handleResumeParse = async (id: string) => {
    setResumeParseStatus((p) => ({ ...p, [id]: "parsing" }));
    const res = await fetch(`${API}/resumes/${id}/parse`, { method: "POST", headers: { Authorization: `Bearer ${token()}` } });
    const data = await res.json();
    setResumeParseStatus((p) => ({ ...p, [id]: data.success ? "done" : "error" }));
    if (!data.success) setResumeError(data.error || "Parse failed.");
  };

  const openMatchDialog = async (app: JobApplication) => {
    setMatchDialogApp(app);
    setMatchResult(null);
    setMatchError(null);
    if (resumes.length === 0) await fetchResumes();
    try {
      const res = await fetch(`${API}/match/${app.id}`, { headers: { Authorization: `Bearer ${token()}` } });
      if (res.ok) {
        const d = await res.json();
        if (d.success && d.data) { setMatchResult(d.data); setAppScores((p) => ({ ...p, [app.id]: d.data.score })); }
      }
    } catch {}
  };

  const runMatch = async () => {
    if (!matchDialogApp) return;
    const parsedResumes = resumes.filter((r) => r.extracted_text);
    const activeResume = parsedResumes.find((r) => r.is_active) || parsedResumes[0];
    const selectedResume = resumes.find((r) => r.id === matchResumeId) || activeResume;
    if (!selectedResume) { setMatchError("No parsed resume found. Upload a resume in the Files tab first."); return; }
    setMatchLoading(true);
    setMatchError(null);
    setMatchResult(null);
    try {
      const res = await fetch(`${API}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ applicationId: matchDialogApp.id, resumeId: selectedResume.id }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || "Match failed");
      setMatchResult(d.data);
      setAppScores((p) => ({ ...p, [matchDialogApp.id]: d.data.score }));
    } catch (err: any) { setMatchError(err.message); }
    finally { setMatchLoading(false); }
  };

  const saveProfileName = async (name: string) => {
    setDisplayName(name);
    try {
      const cm = JSON.parse(localStorage.getItem(PROFILE_KEY(userId)) || "{}");
      localStorage.setItem(PROFILE_KEY(userId), JSON.stringify({ ...cm, displayName: name }));
    } catch {}
    const { data: { session: cs } } = await supabase.auth.getSession();
    if (!cs) return;
    await fetch(`${API}/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cs.access_token}` },
      body: JSON.stringify({ display_name: name, avatar_id: "" }),
    });
  };

  const handleDeleteAccount = async () => {
    try {
      const { data: { session: cs } } = await supabase.auth.getSession();
      if (cs) await fetch(`${API}/profile`, { method: "DELETE", headers: { Authorization: `Bearer ${cs.access_token}` } });
    } catch {}
    localStorage.removeItem(PROFILE_KEY(userId));
    localStorage.removeItem(THEME_KEY(userId));
    await supabase.auth.signOut();
  };

  const exportCsv = () => {
    const headers = ["Company", "Position", "Location", "Salary", "Date Applied", "Status", "Source", "Job URL", "Notes"];
    const rows = apps.map((a) => [a.company, a.position, a.location, a.salary, a.dateApplied, a.status, a.source, a.jobUrl, a.notes]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `job-applications-${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── welcome modal ─────────────────────────────────────────────────────────

  if (showNameModal) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h2 className="text-2xl font-bold">Welcome aboard! 👋</h2>
          <p className="text-muted-foreground text-sm">What should we call you?</p>
          <input
            className="flex h-10 w-full rounded-md border border-input bg-input px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Your name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && nameInput.trim() && (saveProfileName(nameInput.trim()), setShowNameModal(false))}
            autoFocus
          />
          <button
            className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground h-10 px-4 py-2 text-sm font-medium w-full disabled:opacity-50 disabled:pointer-events-none"
            disabled={!nameInput.trim()}
            onClick={() => { saveProfileName(nameInput.trim()); setShowNameModal(false); }}
          >
            Get Started
          </button>
        </div>
      </div>
    );
  }

  // ── shell ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          if (tab === "files") fetchResumes();
        }}
        onLogout={handleLogout}
        displayName={displayName}
        googleEmail={googleEmail}
        googleAvatarUrl={googleAvatarUrl}
        appCount={apps.length}
      />

      {/* Main content */}
      <main className="relative flex-1 overflow-y-auto">
        {/* Ambient background orbs — subtly shift per tab */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: 0 }}>
          <div
            className="absolute -top-[15%] right-[10%] h-[500px] w-[500px] rounded-full animate-glow-pulse"
            style={{ background: "radial-gradient(circle, hsl(252 91% 64% / 0.055) 0%, transparent 70%)" }}
          />
          <div
            className="absolute bottom-[5%] left-[15%] h-[400px] w-[400px] rounded-full animate-glow-pulse [animation-delay:2s]"
            style={{ background: "radial-gradient(circle, hsl(280 90% 65% / 0.04) 0%, transparent 70%)" }}
          />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-7 py-8">
          {/* Page header */}
          <div className="mb-8">
            <h1 className="text-[28px] font-black tracking-tight leading-tight">
              {activeTab === "applications" && (
                displayName
                  ? <>Welcome back, <span className="gradient-text">{displayName.split(" ")[0]}</span> 👋</>
                  : "Applications"
              )}
              {activeTab === "files" && "Resume Vault"}
              {activeTab === "analytics" && <>Analytics <span className="gradient-text">Dashboard</span></>}
              {activeTab === "profile" && "Your Profile"}
            </h1>
            <p className="text-[13px] text-muted-foreground/60 mt-1.5">
              {activeTab === "applications" && `${apps.length} application${apps.length !== 1 ? "s" : ""} tracked`}
              {activeTab === "files" && "Upload resumes and match them against job descriptions with AI"}
              {activeTab === "analytics" && "Performance insights across your entire job search"}
              {activeTab === "profile" && "Manage your account, data, and preferences"}
            </p>
          </div>

          {activeTab === "applications" && (
            <ApplicationsTab
              apps={apps}
              sortedApps={sortedApps}
              stats={stats}
              loading={loading}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              onAddNew={() => { resetForm(); setShowForm(true); }}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onRowClick={setExpandedApp}
              onMatch={openMatchDialog}
              appScores={appScores}
              aiSummary={aiSummary}
              loadingSummary={loadingSummary}
              onRefreshSummary={generateAiSummary}
            />
          )}

          {activeTab === "files" && (
            <FilesTab
              resumes={resumes}
              resumesLoading={resumesLoading}
              resumeUploading={resumeUploading}
              resumeError={resumeError}
              resumeParseStatus={resumeParseStatus}
              onUpload={handleResumeUpload}
              onDelete={handleResumeDelete}
              onDownload={handleResumeDownload}
            />
          )}

          {activeTab === "analytics" && (
            <AnalyticsTab stats={stats} pieData={pieData} sourceData={sourceData} />
          )}

          {activeTab === "profile" && (
            <ProfileTab
              displayName={displayName}
              googleEmail={googleEmail}
              googleAvatarUrl={googleAvatarUrl}
              joinedAt={joinedAt}
              appCount={apps.length}
              onSaveName={saveProfileName}
              onLogout={handleLogout}
              onExportCsv={exportCsv}
              onDeleteAccount={handleDeleteAccount}
            />
          )}
        </div>
      </main>

      {/* Modals */}
      <AppFormModal
        open={showForm}
        onClose={resetForm}
        onSubmit={handleSubmit}
        formData={formData}
        setFormData={setFormData}
        editId={editId}
        dupWarning={dupWarning}
        onDupConfirm={() => { dupConfirmedRef.current = true; setDupWarning(null); document.getElementById("app-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }}
        autofillLoading={autofillLoading}
        onAutofill={handleAutofill}
        companySuggestions={companySuggestions}
        positionSuggestions={positionSuggestions}
        locationSuggestions={locationSuggestions}
      />

      <AppDetailModal
        app={expandedApp}
        onClose={() => setExpandedApp(null)}
        onEdit={handleEdit}
      />

      <DeleteConfirmDialog
        open={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={confirmDelete}
      />

      <MatchDialog
        app={matchDialogApp}
        onClose={() => { setMatchDialogApp(null); setMatchResult(null); setMatchError(null); }}
        resumes={resumes}
        matchResumeId={matchResumeId}
        setMatchResumeId={setMatchResumeId}
        matchLoading={matchLoading}
        matchResult={matchResult}
        matchError={matchError}
        onRunMatch={runMatch}
        onReset={() => { setMatchResult(null); setMatchError(null); }}
      />
    </div>
  );
}
