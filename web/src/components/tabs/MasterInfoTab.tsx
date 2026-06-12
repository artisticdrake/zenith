import { useState, useRef } from "react";
import {
  UploadCloud, Sparkles, Loader2, X, Check, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import MasterProfileEditor from "./MasterProfileEditor";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

interface Props {
  session: any;
}

export default function MasterInfoTab({ session }: Props) {
  const [seedOpen, setSeedOpen] = useState(false);
  const [seedText, setSeedText] = useState("");
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [seedSuccess, setSeedSuccess] = useState(false);
  const [pendingProfile, setPendingProfile] = useState<any | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (file: File) => {
    setSeedError(null);
    setFileLoading(true);
    try {
      if (file.type === "text/plain") {
        const text = await file.text();
        setSeedText(text);
        setFileLoading(false);
      } else {
        const reader = new FileReader();
        reader.onload = async (e) => {
          const b64 = (e.target?.result as string).split(",")[1];
          try {
            const res = await fetch(`${API}/parse-text`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session?.access_token}`,
              },
              body: JSON.stringify({ fileName: file.name, fileType: file.type, fileData: b64 }),
            });
            const data = await res.json();
            if (data.success) {
              setSeedText(data.text);
            } else {
              setSeedError(data.error || "Failed to extract text from file");
            }
          } catch (e: any) {
            setSeedError(e.message);
          } finally {
            setFileLoading(false);
          }
        };
        reader.readAsDataURL(file);
      }
    } catch (e: any) {
      setSeedError(e.message);
      setFileLoading(false);
    }
  };

  const handleSeed = async () => {
    if (!seedText.trim()) return;
    setSeedLoading(true);
    setSeedError(null);
    setSeedSuccess(false);
    setPendingProfile(null);
    try {
      const res = await fetch(`${API}/master-profile/seed-from-text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ text: seedText }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setPendingProfile(data.data);
      setSeedSuccess(true);
    } catch (e: any) {
      setSeedError(e.message);
    } finally {
      setSeedLoading(false);
    }
  };

  return (
    <div className="space-y-6">

      {/* ── Seed from existing resume ─────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <button
          onClick={() => setSeedOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-[13px] font-semibold text-foreground">
              Seed from Existing Resume
            </span>
            <span className="text-[11px] text-muted-foreground font-label ml-1">
              — paste or upload to pre-fill your profile
            </span>
          </div>
          {seedOpen
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />
          }
        </button>

        {seedOpen && (
          <div className="border-t border-border p-4 space-y-3">
            <p className="text-[12px] text-muted-foreground">
              Paste your resume text below or upload a PDF/DOCX file. AI will parse it into your
              Master Profile so you can review, enrich, and save it.
            </p>

            <div className="flex items-center gap-2">
              <input
                type="file"
                ref={fileInputRef}
                accept=".pdf,.doc,.docx,.txt"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleFileChange(f);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={fileLoading}
                onClick={() => fileInputRef.current?.click()}
              >
                {fileLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  : <UploadCloud className="h-3.5 w-3.5 mr-1.5" />
                }
                Upload File
              </Button>
              {seedText && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => { setSeedText(""); setSeedSuccess(false); setPendingProfile(null); }}
                >
                  <X className="h-3.5 w-3.5 mr-1" />Clear
                </Button>
              )}
            </div>

            <textarea
              value={seedText}
              onChange={e => { setSeedText(e.target.value); setSeedSuccess(false); }}
              placeholder="Paste your resume text here (or upload a file above)…"
              className="w-full h-40 rounded-lg border border-border bg-muted/20 p-3 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary resize-none font-mono"
            />

            {seedError && (
              <p className="text-[12px] text-destructive flex items-center gap-1.5">
                <X className="h-3.5 w-3.5 shrink-0" />{seedError}
              </p>
            )}

            {seedSuccess && (
              <p className="text-[12px] text-emerald-400 flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 shrink-0" />
                Parsed! The profile editor below has been pre-filled — review and click Save Library.
              </p>
            )}

            <Button
              size="sm"
              onClick={handleSeed}
              disabled={!seedText.trim() || seedLoading}
            >
              {seedLoading
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Parsing…</>
                : <><Sparkles className="h-3.5 w-3.5 mr-1.5" />Parse &amp; Import</>
              }
            </Button>
          </div>
        )}
      </div>

      {/* ── Master Profile editor (always expanded here) ─────────────────── */}
      <MasterProfileEditor
        session={session}
        alwaysOpen={true}
        seedProfile={pendingProfile}
      />

    </div>
  );
}
