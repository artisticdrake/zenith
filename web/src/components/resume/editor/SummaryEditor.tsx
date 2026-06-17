interface Props {
  summary: string;
  showSummary: boolean;
  onSummaryChange: (v: string) => void;
  onToggle: (v: boolean) => void;
}

export default function SummaryEditor({ summary, showSummary, onSummaryChange, onToggle }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          Summary / Objective
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={showSummary}
          onClick={() => onToggle(!showSummary)}
          className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors focus:outline-none ${
            showSummary ? 'bg-primary' : 'bg-border'
          }`}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
              showSummary ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
      {showSummary && (
        <textarea
          className="w-full text-sm bg-background border border-border rounded px-2 py-1.5 resize-none outline-none focus:ring-1 focus:ring-primary/50 min-h-[80px]"
          value={summary}
          placeholder="2–3 sentences about your background, skills, and what you're looking for. Use **bold** for keywords and [text](url) for links."
          aria-label="Summary text"
          onChange={(e) => onSummaryChange(e.target.value)}
        />
      )}
    </div>
  );
}
