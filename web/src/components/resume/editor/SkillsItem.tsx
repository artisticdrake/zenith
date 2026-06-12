import type { ResumeSectionItem } from '@/types/resume.types';

interface Props {
  item: ResumeSectionItem;
  onChange: (updated: ResumeSectionItem) => void;
  onDelete: () => void;
  index: number;
}

export default function SkillsItem({ item, onChange, onDelete, index }: Props) {
  return (
    <div className="flex items-start gap-2 group">
      <div className="flex-1 grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            Category
          </label>
          <input
            type="text"
            className="h-7 text-sm bg-background border border-border rounded px-2 outline-none focus:ring-1 focus:ring-primary/50"
            value={item.category ?? ''}
            placeholder="Languages"
            aria-label={`Skills category ${index + 1}`}
            onChange={(e) => onChange({ ...item, category: e.target.value })}
          />
        </div>
        <div className="col-span-2 flex flex-col gap-0.5">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            Skills (comma-separated)
          </label>
          <input
            type="text"
            className="h-7 text-sm bg-background border border-border rounded px-2 outline-none focus:ring-1 focus:ring-primary/50"
            value={item.items ?? ''}
            placeholder="Python, TypeScript, SQL..."
            aria-label={`Skills list ${index + 1}`}
            onChange={(e) => onChange({ ...item, items: e.target.value })}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="mt-5 shrink-0 opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all text-xs"
        aria-label="Delete skills row"
      >
        ✕
      </button>
    </div>
  );
}
