export const STATUSES = [
  "Applied",
  "Screening",
  "Interview Scheduled",
  "Interview Completed",
  "Offer",
  "Rejected",
  "Ghosted",
  "Withdrawn",
] as const;

export const SOURCES = [
  "LinkedIn",
  "Handshake",
  "Jobright",
  "Glassdoor",
  "Indeed",
  "Interstride",
  "Other/Custom",
] as const;

export const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string }> = {
  Applied:               { color: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/30" },
  Screening:             { color: "text-amber-400",  bg: "bg-amber-500/10",  border: "border-amber-500/30" },
  "Interview Scheduled": { color: "text-primary",    bg: "bg-primary/10",    border: "border-primary/30"    },
  "Interview Completed": { color: "text-teal-300",   bg: "bg-teal-500/10",   border: "border-teal-500/30"   },
  Offer:                 { color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  Rejected:              { color: "text-red-400",    bg: "bg-red-500/10",    border: "border-red-500/30" },
  Ghosted:               { color: "text-zinc-400",   bg: "bg-zinc-500/10",   border: "border-zinc-500/30" },
  Withdrawn:             { color: "text-slate-400",  bg: "bg-slate-500/10",  border: "border-slate-500/30" },
};

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
