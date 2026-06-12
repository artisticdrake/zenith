import { LayoutDashboard, BookOpen, BarChart3, User, LogOut, Briefcase, FileText, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type TabId = "applications" | "master-info" | "analytics" | "profile" | "resume-builder" | "tailor";

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onLogout: () => void;
  displayName: string;
  googleEmail: string;
  googleAvatarUrl: string | null;
  appCount: number;
}

const NAV_ITEMS: { id: TabId; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: "applications",    label: "Applications",   icon: ({ className }) => <LayoutDashboard className={className} /> },
  { id: "master-info",     label: "Master Info",    icon: ({ className }) => <BookOpen className={className} />     },
  { id: "analytics",      label: "Analytics",      icon: ({ className }) => <BarChart3 className={className} />      },
  { id: "resume-builder", label: "Resume Builder", icon: ({ className }) => <FileText className={className} />       },
  { id: "tailor",         label: "Tailor",         icon: ({ className }) => <Wand2 className={className} />          },
  { id: "profile",        label: "Profile",        icon: ({ className }) => <User className={className} />           },
];

export default function Sidebar({
  activeTab, onTabChange, onLogout,
  displayName, googleEmail, googleAvatarUrl, appCount,
}: SidebarProps) {
  const initials = (displayName || googleEmail || "?")
    .split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="flex h-screen w-[220px] flex-col bg-sidebar/90 backdrop-blur-xl border-r border-border">

        {/* ── Logo ───────────────────────────────────────────────────── */}
        <div className="flex h-[60px] items-center gap-2.5 px-4 border-b border-border">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary shadow-md shadow-primary/20">
            <Briefcase className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <span className="font-bold text-[14px] tracking-tight text-foreground font-headline">
              Job Tracker
            </span>
            <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground font-label leading-tight">
              Executive Portal
            </p>
          </div>
        </div>

        {/* ── Nav ────────────────────────────────────────────────────── */}
        <nav className="flex-1 space-y-0.5 px-2 py-3">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id;
            return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onTabChange(id)}
                    className={cn(
                      "relative w-full flex items-center gap-3 px-3 py-2.5 text-[13px] font-medium transition-all duration-150 rounded-lg",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm dark:bg-primary/[0.08] dark:text-primary dark:shadow-none"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-white/[0.04] dark:hover:text-foreground"
                    )}
                  >
                    {/* Accent notch — dark mode only */}
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-[18px] w-0.5 rounded-r-full hidden dark:block dark:bg-primary" />
                    )}

                    <span className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                      isActive ? "bg-white/20 dark:bg-primary/15" : "bg-transparent"
                    )}>
                      <Icon className={cn(
                        "h-3.5 w-3.5",
                        isActive ? "text-primary-foreground dark:text-primary" : ""
                      )} />
                    </span>

                    <span className="font-label">{label}</span>

                    {id === "applications" && appCount > 0 && (
                      <span className={cn(
                        "ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums font-label",
                        isActive
                          ? "bg-white/25 text-primary-foreground dark:bg-primary/20 dark:text-primary"
                          : "bg-muted-foreground/10 text-muted-foreground dark:bg-white/[0.06]"
                      )}>
                        {appCount}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* ── User footer ────────────────────────────────────────────── */}
        <div className="border-t border-border p-2">
          <div className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-muted dark:hover:bg-white/[0.04] cursor-default">
            <Avatar className="h-7 w-7 shrink-0 ring-1 ring-border">
              {googleAvatarUrl && <AvatarImage src={googleAvatarUrl} alt={displayName} />}
              <AvatarFallback className="text-[10px] font-bold bg-primary/10 text-primary dark:bg-primary/20">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-foreground truncate leading-tight">
                {displayName || "User"}
              </p>
              <p className="text-[10px] text-muted-foreground truncate font-label">{googleEmail}</p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  onClick={onLogout}
                >
                  <LogOut className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">Sign out</TooltipContent>
            </Tooltip>
          </div>
        </div>

      </aside>
    </TooltipProvider>
  );
}
