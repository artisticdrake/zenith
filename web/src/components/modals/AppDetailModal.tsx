import { ExternalLink, Edit2, Clock, MapPin, DollarSign, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { STATUS_CONFIG } from "@/lib/constants";
import { formatDate, formatShortDate } from "@/lib/dateUtils";
import type { JobApplication } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AppDetailModalProps {
  app: JobApplication | null;
  onClose: () => void;
  onEdit: (app: JobApplication) => void;
}

const AVATAR_PALETTES = [
  { bg: "from-blue-500/30 to-indigo-600/20",   text: "text-blue-300",   border: "border-blue-500/20"   },
  { bg: "from-violet-500/30 to-purple-600/20", text: "text-violet-300", border: "border-violet-500/20" },
  { bg: "from-emerald-500/30 to-teal-600/20",  text: "text-emerald-300",border: "border-emerald-500/20"},
  { bg: "from-amber-500/30 to-orange-600/20",  text: "text-amber-300",  border: "border-amber-500/20"  },
  { bg: "from-pink-500/30 to-rose-600/20",     text: "text-pink-300",   border: "border-pink-500/20"   },
  { bg: "from-cyan-500/30 to-sky-600/20",      text: "text-cyan-300",   border: "border-cyan-500/20"   },
];

function CompanyAvatar({ company }: { company: string }) {
  const letter = company.trim()[0]?.toUpperCase() ?? "?";
  const idx = ((letter.charCodeAt(0) - 65) % AVATAR_PALETTES.length + AVATAR_PALETTES.length) % AVATAR_PALETTES.length;
  const p = AVATAR_PALETTES[idx];
  return (
    <div className={cn(
      "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border bg-gradient-to-br text-2xl font-black",
      p.bg, p.text, p.border
    )}>
      {letter}
    </div>
  );
}

export default function AppDetailModal({ app, onClose, onEdit }: AppDetailModalProps) {
  if (!app) return null;
  const cfg = STATUS_CONFIG[app.status] ?? STATUS_CONFIG["Applied"];

  return (
    <Dialog open={!!app} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col p-0 gap-0 border border-white/[0.08] bg-card overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-5 border-b border-white/[0.06] flex-shrink-0">
          <div className="flex items-start gap-4 pr-8">
            <CompanyAvatar company={app.company} />
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-[18px] font-bold leading-tight">{app.company}</DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">{app.position}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <span className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                  cfg.color, cfg.bg, cfg.border
                )}>
                  {app.status}
                </span>
                {app.referral === "Yes" && <Badge variant="success" className="text-[10px]">Referral</Badge>}
                {app.source && <Badge variant="outline" className="text-[10px] border-white/[0.1]">{app.source}</Badge>}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              {app.jobUrl && (
                <Button variant="outline" size="sm" asChild className="gap-1.5 border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-[12px] h-8">
                  <a href={app.jobUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3 w-3" /> Job Post
                  </a>
                </Button>
              )}
              <Button size="sm" variant="outline"
                onClick={() => { onClose(); onEdit(app); }}
                className="gap-1.5 border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-[12px] h-8">
                <Edit2 className="h-3 w-3" /> Edit
              </Button>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1">
          <div className="px-6 py-5 space-y-5">

            {/* Info grid */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Calendar,   label: "Applied",      value: formatDate(app.dateApplied),       iconBg: "bg-blue-500/10",    iconColor: "text-blue-400"    },
                { icon: Clock,      label: "Last Updated", value: formatShortDate(app.last_updated), iconBg: "bg-violet-500/10",  iconColor: "text-violet-400"  },
                { icon: MapPin,     label: "Location",     value: app.location || "—",               iconBg: "bg-emerald-500/10", iconColor: "text-emerald-400" },
                { icon: DollarSign, label: "Salary",       value: app.salary || "—",                 iconBg: "bg-amber-500/10",   iconColor: "text-amber-400"   },
              ].map(({ icon: Icon, label, value, iconBg, iconColor }) => (
                <div key={label} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3">
                  <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", iconBg)}>
                    <Icon className={cn("h-3.5 w-3.5", iconColor)} />
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">{label}</p>
                    <p className="text-[13px] font-semibold text-foreground/80 mt-0.5">{value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Job Description */}
            {app.jobDescription && (
              <>
                <div className="h-px bg-white/[0.06]" />
                <div>
                  <h4 className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-3">Job Description</h4>
                  <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-4 max-h-40 overflow-y-auto">
                    <p className="text-[13px] text-muted-foreground/70 whitespace-pre-wrap leading-relaxed">{app.jobDescription}</p>
                  </div>
                </div>
              </>
            )}

            {/* Notes */}
            {app.notes && (
              <>
                <div className="h-px bg-white/[0.06]" />
                <div>
                  <h4 className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-3">Notes</h4>
                  <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-4">
                    <p className="text-[13px] text-muted-foreground/70 whitespace-pre-wrap leading-relaxed">{app.notes}</p>
                  </div>
                </div>
              </>
            )}

            {/* Timeline */}
            {app.timeline && app.timeline.length > 0 && (
              <>
                <div className="h-px bg-white/[0.06]" />
                <div>
                  <h4 className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-4">Timeline</h4>
                  <div className="space-y-0">
                    {[...app.timeline].reverse().map((entry, i, arr) => {
                      const c2 = STATUS_CONFIG[entry.status];
                      return (
                        <div key={i} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <div className={cn(
                              "mt-1 h-2.5 w-2.5 rounded-full shrink-0 ring-2 ring-background",
                              c2 ? c2.bg.replace("/10", "/60") : "bg-muted/60"
                            )} />
                            {i < arr.length - 1 && <div className="w-px flex-1 bg-white/[0.06] mt-1 min-h-[16px]" />}
                          </div>
                          <div className="flex items-baseline justify-between flex-1 pb-3 min-w-0 gap-2">
                            <span className="text-[13px] font-medium text-foreground/70">{entry.status}</span>
                            <span className="text-[11px] tabular-nums text-muted-foreground/40 shrink-0">{formatShortDate(entry.ts)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Documents */}
            {app.documents && app.documents.length > 0 && (
              <>
                <div className="h-px bg-white/[0.06]" />
                <div>
                  <h4 className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-3">Documents</h4>
                  <div className="flex flex-wrap gap-2">
                    {app.documents.map((doc, i) => (
                      <Badge key={i} variant="outline" className="text-[11px] border-white/[0.1] cursor-default">{doc.name}</Badge>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
