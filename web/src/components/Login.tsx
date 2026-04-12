import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Briefcase, Loader2, ArrowRight, BarChart3, Sparkles, Shield } from "lucide-react";

const FEATURES = [
  { icon: BarChart3, label: "Analytics & Insights" },
  { icon: Sparkles,  label: "AI Resume Matching"   },
  { icon: Shield,    label: "Secure & Private"      },
];

export default function Login() {
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      alert(error.message);
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background overflow-hidden">

      {/* ── Ambient orbs — dark mode only ────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden hidden dark:block">
        <div
          className="absolute -top-[20%] -left-[10%] h-[600px] w-[600px] rounded-full animate-glow-pulse"
          style={{ background: "radial-gradient(circle, hsl(167 76% 57% / 0.10) 0%, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-[20%] -right-[10%] h-[500px] w-[500px] rounded-full animate-glow-pulse [animation-delay:1.5s]"
          style={{ background: "radial-gradient(circle, hsl(167 76% 57% / 0.06) 0%, transparent 70%)" }}
        />
      </div>

      {/* ── Subtle grid pattern ───────────────────────────────────────── */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03] dark:opacity-[0.015]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
          backgroundSize: "52px 52px",
        }}
      />

      {/* ── Content ──────────────────────────────────────────────────── */}
      <div className="relative z-10 w-full max-w-[420px] px-5 animate-slide-up">

        {/* Logo + headline */}
        <div className="mb-10 text-center">
          <div className="mx-auto mb-6 inline-flex h-[72px] w-[72px] items-center justify-center rounded-3xl bg-primary shadow-2xl shadow-primary/20 ring-1 ring-primary/10">
            <Briefcase className="h-9 w-9 text-primary-foreground" />
          </div>

          <h1 className="text-[42px] font-black leading-none tracking-tight mb-3">
            Job{" "}
            <span className="gradient-text">Tracker</span>
          </h1>
          <p className="text-muted-foreground text-[15px] leading-relaxed">
            Your AI-powered command center for
            <br />a smarter, faster job search.
          </p>

          {/* Feature chips */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {FEATURES.map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 py-1.5 text-xs font-medium text-muted-foreground dark:border-white/[0.08] dark:bg-white/[0.04]"
              >
                <Icon className="h-3 w-3 text-primary" />
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* ── Auth card ────────────────────────────────────────────── */}
        <div className="glass-strong rounded-2xl p-7">
          <p className="mb-1 text-[17px] font-bold">Welcome</p>
          <p className="mb-6 text-sm text-muted-foreground">
            Sign in to continue to your dashboard
          </p>

          <button
            onClick={handleLogin}
            disabled={loading}
            className="group relative w-full flex items-center gap-3 rounded-xl border border-border bg-background px-5 py-4 text-sm font-semibold text-foreground transition-all duration-200 hover:bg-muted hover:shadow-md disabled:pointer-events-none disabled:opacity-50 active:scale-[0.99] dark:border-white/[0.1] dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            ) : (
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            <span className="flex-1 text-left">
              {loading ? "Redirecting…" : "Continue with Google"}
            </span>
            {!loading && (
              <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            )}
          </button>

          <p className="mt-5 text-center text-xs text-muted-foreground">
            No account?{" "}
            <button
              onClick={handleLogin}
              disabled={loading}
              className="font-semibold text-primary transition-opacity hover:opacity-80"
            >
              Sign up free
            </button>
          </p>
        </div>

        <p className="mt-5 text-center text-[11px] text-muted-foreground/40 tracking-wide uppercase">
          End-to-end encrypted · Powered by Supabase
        </p>
      </div>
    </div>
  );
}
