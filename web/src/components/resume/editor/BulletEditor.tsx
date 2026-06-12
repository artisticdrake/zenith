import type { BulletItem } from '@/types/resume.types';

interface Props {
  bullet: BulletItem;
  onChange: (updated: BulletItem) => void;
  onDelete: () => void;
  onAdd: () => void;
}

export default function BulletEditor({ bullet, onChange, onDelete, onAdd }: Props) {
  return (
    <div className="flex items-start gap-1 group">
      <span className="mt-2 text-muted-foreground text-xs shrink-0">•</span>
      <textarea
        className="flex-1 text-sm bg-transparent border border-transparent focus:border-border focus:bg-background rounded px-2 py-1 resize-none outline-none transition-colors min-h-[2rem]"
        value={bullet.text}
        rows={2}
        placeholder="Describe an achievement... Use **bold** and *italic*"
        aria-label="Bullet point text"
        onChange={(e) => onChange({ ...bullet, text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onAdd();
          }
        }}
      />
      <button
        type="button"
        onClick={onDelete}
        className="mt-1 shrink-0 opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all text-xs"
        aria-label="Delete bullet"
      >
        ✕
      </button>
    </div>
  );
}
