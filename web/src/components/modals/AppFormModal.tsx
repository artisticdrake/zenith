import { useRef } from "react";
import { Wand2, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { STATUSES, SOURCES } from "@/lib/constants";
import type { AppFormData } from "@/lib/types";

interface AppFormModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  formData: AppFormData;
  setFormData: React.Dispatch<React.SetStateAction<AppFormData>>;
  editId: string | null;
  dupWarning: any;
  onDupConfirm: () => void;
  autofillLoading: boolean;
  onAutofill: () => void;
  companySuggestions: string[];
  positionSuggestions: string[];
  locationSuggestions: string[];
}

const inputCls = "bg-white/[0.04] border-white/[0.08] focus:border-primary/50 focus:bg-white/[0.06] placeholder:text-muted-foreground/35 transition-all text-[13px]";
const labelCls = "text-[12px] font-semibold text-muted-foreground/70";

export default function AppFormModal({
  open, onClose, onSubmit, formData, setFormData,
  editId, dupWarning, onDupConfirm,
  autofillLoading, onAutofill,
  companySuggestions, positionSuggestions, locationSuggestions,
}: AppFormModalProps) {
  const companyRef  = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef<HTMLDivElement | null>(null);
  const locationRef = useRef<HTMLDivElement | null>(null);

  const field = (key: keyof AppFormData) => ({
    value: formData[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setFormData((p) => ({ ...p, [key]: e.target.value })),
  });

  const SuggestionList = ({ suggestions, field: f }: { suggestions: string[]; field: keyof AppFormData }) => {
    const val = formData[f] as string;
    const filtered = suggestions.filter((s) => s.toLowerCase().includes(val.toLowerCase()) && s !== val);
    if (!filtered.length || !val) return null;
    return (
      <ul className="absolute z-50 top-full left-0 right-0 mt-1 max-h-44 overflow-y-auto rounded-xl border border-white/[0.08] bg-popover shadow-2xl shadow-black/40 text-[13px]">
        {filtered.map((s) => (
          <li
            key={s}
            className="px-3.5 py-2.5 cursor-pointer hover:bg-white/[0.06] transition-colors first:rounded-t-xl last:rounded-b-xl"
            onMouseDown={(e) => { e.preventDefault(); setFormData((p) => ({ ...p, [f]: s })); }}
          >
            {s}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto gap-0 p-0 border border-white/[0.08] bg-card">
        <DialogHeader className="px-6 pt-6 pb-5 border-b border-white/[0.06]">
          <DialogTitle className="text-[16px] font-bold">
            {editId ? "Edit Application" : "New Application"}
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          {dupWarning && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3.5 text-[13px]">
              <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-amber-300">Possible duplicate</p>
                <p className="text-muted-foreground/70 mt-0.5">
                  Similar entry for <strong className="text-foreground/70">{dupWarning.company}</strong> — <strong className="text-foreground/70">{dupWarning.position}</strong> already exists.
                </p>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="outline" className="border-white/[0.1] text-[12px] h-7" onClick={onClose}>Cancel</Button>
                  <Button size="sm" className="text-[12px] h-7" onClick={onDupConfirm}>Add Anyway</Button>
                </div>
              </div>
            </div>
          )}

          <form id="app-form" onSubmit={onSubmit} className="space-y-4">
            {/* Job URL */}
            <div className="space-y-1.5">
              <Label className={labelCls}>Job URL</Label>
              <div className="flex gap-2">
                <Input placeholder="https://…" {...field("jobUrl")} className={`flex-1 ${inputCls}`} />
                <Button type="button" variant="outline" size="sm"
                  className="shrink-0 gap-1.5 border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-[12px] h-9"
                  onClick={onAutofill} disabled={autofillLoading}>
                  {autofillLoading
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Wand2 className="h-3.5 w-3.5 text-primary" />}
                  Autofill
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 relative" ref={companyRef}>
                <Label className={labelCls}>Company <span className="text-destructive">*</span></Label>
                <Input placeholder="Acme Corp" required {...field("company")} className={inputCls} />
                <SuggestionList suggestions={companySuggestions} field="company" />
              </div>
              <div className="space-y-1.5 relative" ref={positionRef}>
                <Label className={labelCls}>Position <span className="text-destructive">*</span></Label>
                <Input placeholder="Software Engineer" required {...field("position")} className={inputCls} />
                <SuggestionList suggestions={positionSuggestions} field="position" />
              </div>
              <div className="space-y-1.5 relative" ref={locationRef}>
                <Label className={labelCls}>Location</Label>
                <Input placeholder="San Francisco, CA" {...field("location")} className={inputCls} />
                <SuggestionList suggestions={locationSuggestions} field="location" />
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>Salary</Label>
                <Input placeholder="$120,000" {...field("salary")} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>Date Applied <span className="text-destructive">*</span></Label>
                <Input type="date" required {...field("dateApplied")} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>Status <span className="text-destructive">*</span></Label>
                <Select value={formData.status} onValueChange={(v) => setFormData((p) => ({ ...p, status: v }))}>
                  <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
                  <SelectContent className="border-white/[0.08] bg-popover">
                    {STATUSES.map((s) => <SelectItem key={s} value={s} className="text-[13px]">{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>Source</Label>
                <Select value={formData.source} onValueChange={(v) => setFormData((p) => ({ ...p, source: v }))}>
                  <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
                  <SelectContent className="border-white/[0.08] bg-popover">
                    {SOURCES.map((s) => <SelectItem key={s} value={s} className="text-[13px]">{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>Referral</Label>
                <Select value={formData.referral} onValueChange={(v) => setFormData((p) => ({ ...p, referral: v }))}>
                  <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
                  <SelectContent className="border-white/[0.08] bg-popover">
                    <SelectItem value="No" className="text-[13px]">No</SelectItem>
                    <SelectItem value="Yes" className="text-[13px]">Yes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className={labelCls}>Job Description</Label>
              <Textarea
                placeholder="Paste the full job description here for AI resume matching…"
                className={`min-h-[110px] resize-y ${inputCls}`}
                {...field("jobDescription")}
              />
            </div>
            <div className="space-y-1.5">
              <Label className={labelCls}>Notes</Label>
              <Textarea
                placeholder="Interviews, contacts, impressions…"
                className={`min-h-[70px] resize-y ${inputCls}`}
                {...field("notes")}
              />
            </div>
          </form>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-white/[0.06] bg-white/[0.01] gap-2">
          <Button variant="outline" onClick={onClose}
            className="border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-[13px]">
            Cancel
          </Button>
          <Button type="submit" form="app-form"
            className="bg-gradient-to-r from-primary to-teal-700 hover:from-primary/90 hover:to-teal-700/90 text-white border-0 shadow-lg shadow-primary/20 font-semibold text-[13px]">
            {editId ? "Update" : "Create"} Application
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
