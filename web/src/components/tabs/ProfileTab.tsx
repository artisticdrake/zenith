import { useState } from "react";
import { Pencil, Mail, Shield, Download, Trash2, LogOut, Check, X, Database, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/lib/useCountUp";
import { formatDate } from "@/lib/dateUtils";

interface ProfileTabProps {
  displayName: string;
  googleEmail: string;
  googleAvatarUrl: string | null;
  joinedAt: string | null;
  appCount: number;
  onSaveName: (name: string) => void;
  onLogout: () => void;
  onExportCsv: () => void;
  onDeleteAccount: () => void;
}

function StatNumber({ value, label }: { value: number; label: string }) {
  const animated = useCountUp(value, 800);
  return (
    <div className="text-center space-y-1">
      <p className="text-4xl font-black tabular-nums gradient-text number-pop">{animated}</p>
      <p className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">{label}</p>
    </div>
  );
}

export default function ProfileTab({
  displayName, googleEmail, googleAvatarUrl, joinedAt, appCount,
  onSaveName, onLogout, onExportCsv, onDeleteAccount,
}: ProfileTabProps) {
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(displayName);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const initials = (displayName || googleEmail || "?")
    .split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  const daysActive = joinedAt
    ? Math.max(1, Math.round((Date.now() - new Date(joinedAt).getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  const handleSave = () => {
    if (nameInput.trim()) { onSaveName(nameInput.trim()); setEditing(false); }
  };

  return (
    <div className="space-y-4 animate-fade-in max-w-2xl">

      {/* ── Identity card ──────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-white/[0.07] glass animate-slide-up stagger-1">
        {/* Gradient banner */}
        <div className="relative h-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-violet-500/15 to-transparent" />
          <div
            className="absolute inset-0"
            style={{ background: "radial-gradient(ellipse at 30% 50%, hsl(252 91% 64% / 0.2) 0%, transparent 70%)" }}
          />
          {/* Subtle grid */}
          <div
            className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage: "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />
        </div>

        <div className="px-6 pb-6 -mt-10">
          <div className="flex items-end gap-4 mb-5">
            <Avatar className="h-20 w-20 shrink-0 ring-4 ring-background shadow-2xl">
              {googleAvatarUrl && <AvatarImage src={googleAvatarUrl} />}
              <AvatarFallback className="text-xl font-black bg-gradient-to-br from-primary/40 to-violet-500/30 text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 pb-1">
              {editing ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSave()}
                    autoFocus
                    className="h-8 text-sm bg-white/[0.06] border-white/[0.1]"
                  />
                  <Button size="icon" className="h-8 w-8 shrink-0 bg-primary hover:bg-primary/90" onClick={handleSave}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="outline" className="h-8 w-8 shrink-0 border-white/[0.1]"
                    onClick={() => { setEditing(false); setNameInput(displayName); }}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold truncate">{displayName || "User"}</h2>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground/40 hover:text-muted-foreground"
                    onClick={() => { setNameInput(displayName); setEditing(true); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground/50 mt-0.5">
                <Mail className="h-3 w-3 shrink-0" />
                <span className="truncate">{googleEmail}</span>
              </div>
            </div>
          </div>

          <div className="h-px bg-white/[0.06] mb-5" />

          <div className="grid grid-cols-3 gap-4 text-center">
            <StatNumber value={daysActive} label="Days Active" />
            <StatNumber value={appCount} label="Applications" />
            <div className="text-center space-y-1">
              <p className="text-[13px] font-bold text-foreground/70 mt-3">
                {joinedAt ? formatDate(joinedAt.slice(0, 10)) : "—"}
              </p>
              <p className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">Member Since</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Account Settings ───────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-white/[0.07] glass animate-slide-up stagger-2">
        <div className="px-5 pt-5 pb-1">
          <h3 className="text-[13px] font-bold text-foreground/80">Account Settings</h3>
        </div>
        <div className="divide-y divide-white/[0.05] px-5">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3 text-[13px]">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/15">
                <Shield className="h-3.5 w-3.5 text-blue-400" />
              </span>
              Sign-in Method
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted-foreground/50">Google OAuth</span>
              <Badge variant="success" className="text-[10px]">Active</Badge>
            </div>
          </div>
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3 text-[13px]">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15">
                <Database className="h-3.5 w-3.5 text-emerald-400" />
              </span>
              Data Storage
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted-foreground/50">Supabase · Encrypted</span>
              <Badge variant="info" className="text-[10px]">Secure</Badge>
            </div>
          </div>
          <div className="py-4">
            <Button variant="outline" onClick={onLogout} className="gap-2 border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.07] text-[13px]">
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </Button>
          </div>
        </div>
      </div>

      {/* ── Data Backup ────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-white/[0.07] glass animate-slide-up stagger-3 px-5 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[13px] font-bold text-foreground/80">Data Backup</h3>
            <p className="text-[12px] text-muted-foreground/50 mt-0.5">Download all applications as a CSV file</p>
          </div>
          <Button onClick={onExportCsv} className="gap-2 bg-white/[0.06] hover:bg-white/[0.1] border-white/[0.1] border text-foreground/80 text-[13px]" variant="ghost">
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* ── Danger Zone ────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-destructive/20 bg-destructive/[0.03] animate-slide-up stagger-4 px-5 py-5">
        <h3 className="text-[13px] font-bold text-destructive mb-0.5">Danger Zone</h3>
        <p className="text-[12px] text-muted-foreground/50 mb-4">
          Permanently delete your account, applications, and all resumes. Cannot be undone.
        </p>
        {!showDeleteConfirm ? (
          <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)} className="gap-2 text-[13px]">
            <Trash2 className="h-3.5 w-3.5" />
            Delete My Account
          </Button>
        ) : (
          <div className="rounded-xl border border-destructive/25 bg-destructive/[0.07] p-4 space-y-3">
            <p className="text-[12px] text-muted-foreground">
              This will permanently delete <strong className="text-foreground/70">everything</strong>. Are you absolutely sure?
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}
                className="border-white/[0.1] bg-white/[0.04] text-[12px]">
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={onDeleteAccount} className="text-[12px]">
                Yes, Delete Everything
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
