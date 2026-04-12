import { useRef } from "react";
import {
  Upload, Trash2, Download, FileText,
  Loader2, AlertCircle, CheckCircle2, Clock3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatShortDate } from "@/lib/dateUtils";
import type { Resume } from "@/lib/types";

interface FilesTabProps {
  resumes: Resume[];
  resumesLoading: boolean;
  resumeUploading: boolean;
  resumeError: string | null;
  resumeParseStatus: Record<string, "idle" | "parsing" | "done" | "error">;
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
  onDownload: (id: string) => void;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeLabel(fileType: string | undefined | null) {
  if (!fileType) return "FILE";
  if (fileType.includes("pdf")) return "PDF";
  if (fileType.includes("word") || fileType.includes("doc")) return "DOC";
  return "FILE";
}

export default function FilesTab({
  resumes, resumesLoading, resumeUploading, resumeError,
  resumeParseStatus, onUpload, onDelete, onDownload,
}: FilesTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) onUpload(file);
  };

  const slots = 3;
  const emptySlots = slots - resumes.length;
  const canUpload = !resumeUploading && resumes.length < 3;

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
      />

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] text-muted-foreground">
            Store up to 3 resumes and match them against any job
          </p>
        </div>
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={!canUpload}
          className="gap-2 bg-gradient-to-r from-primary to-teal-700 hover:from-primary/90 hover:to-teal-700/90 text-white border-0 shadow-lg shadow-primary/20 font-semibold disabled:from-muted disabled:to-muted disabled:shadow-none"
        >
          {resumeUploading ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>
          ) : (
            <><Upload className="h-4 w-4" /> Upload Resume</>
          )}
        </Button>
      </div>

      {/* ── Error ───────────────────────────────────────────────────── */}
      {resumeError && (
        <div className="flex items-center gap-2.5 rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {resumeError}
        </div>
      )}

      {/* ── Loading ─────────────────────────────────────────────────── */}
      {resumesLoading ? (
        <div className="py-16 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3 text-primary/50" />
          <span className="text-sm">Loading resumes…</span>
        </div>
      ) : (
        <div className="space-y-3">

          {/* ── Uploaded resumes ──────────────────────────────────── */}
          {resumes.map((resume, i) => {
            const parseStatus = resumeParseStatus[resume.id];
            const isParsing = parseStatus === "parsing";
            const isParsed  = parseStatus === "done" || !!resume.extracted_text;
            const isError   = parseStatus === "error";
            const typeLbl   = fileTypeLabel(resume.file_type);

            return (
              <div
                key={resume.id}
                className={cn(
                  "group flex items-center gap-4 rounded-xl border border-white/[0.07] glass px-5 py-4 transition-all duration-200 hover:border-white/[0.12] animate-slide-up",
                  i === 0 && "stagger-1",
                  i === 1 && "stagger-2",
                  i === 2 && "stagger-3",
                )}
              >
                {/* File type icon */}
                <div className={cn(
                  "flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border text-[9px] font-black tracking-wider",
                  typeLbl === "PDF"
                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                    : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                )}>
                  <FileText className="h-5 w-5 mb-0.5" />
                  <span>{typeLbl}</span>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate text-foreground/90">
                    {resume.file_name}
                  </p>
                  <p className="text-[11px] text-muted-foreground/50 mt-0.5 tabular-nums">
                    {formatBytes(resume.file_size)} · {formatShortDate(resume.uploaded_at)}
                  </p>
                </div>

                {/* Parse status pill */}
                <div className="flex items-center gap-2 shrink-0">
                  {isParsing ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Parsing…
                    </span>
                  ) : isParsed ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> Parsed
                    </span>
                  ) : isError ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/25 bg-red-500/10 px-3 py-1 text-[11px] font-semibold text-red-400">
                      <AlertCircle className="h-3 w-3" /> Error
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1 text-[11px] text-muted-foreground/50">
                      <Clock3 className="h-3 w-3" /> Queued
                    </span>
                  )}

                  <Button
                    variant="ghost" size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                    onClick={() => onDownload(resume.id)}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(resume.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}

          {/* ── Empty slots ───────────────────────────────────────── */}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/[0.07] px-4 py-10 transition-all duration-200 hover:border-primary/30 hover:bg-primary/[0.03] animate-slide-up",
                resumes.length === 0 && i === 0 ? "stagger-1" : "stagger-2"
              )}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => canUpload && fileInputRef.current?.click()}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.03] group-hover:border-primary/30 group-hover:bg-primary/[0.06] transition-all duration-200 mb-3">
                <Upload className="h-5 w-5 text-muted-foreground/30 group-hover:text-primary/60 transition-colors" />
              </div>
              <p className="text-[13px] font-medium text-muted-foreground/50 group-hover:text-muted-foreground/80 transition-colors">
                Drop a file or click to upload
              </p>
              <p className="text-[11px] text-muted-foreground/30 mt-1">
                PDF, DOC, DOCX · Max 10 MB
              </p>
            </div>
          ))}

        </div>
      )}

      {/* ── Slot indicator ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 pt-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-all duration-300",
              i < resumes.length
                ? "bg-gradient-to-r from-primary to-teal-700"
                : "bg-white/[0.06]"
            )}
          />
        ))}
        <span className="text-[11px] text-muted-foreground/40 tabular-nums ml-1 shrink-0">
          {resumes.length}/3 slots
        </span>
      </div>
    </div>
  );
}
