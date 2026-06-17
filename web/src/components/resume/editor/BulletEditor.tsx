import { useRef } from 'react';
import type { BulletItem } from '@/types/resume.types';

interface Props {
  bullet: BulletItem;
  onChange: (updated: BulletItem) => void;
  onDelete: () => void;
  onAdd: () => void;
}

export default function BulletEditor({ bullet, onChange, onDelete, onAdd }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Wrap the current selection (or insert a template) as a markdown link.
  const insertLink = () => {
    const el = textareaRef.current;
    const text = bullet.text;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const selected = text.slice(start, end);
    const label = selected || 'link text';
    const snippet = `[${label}](https://)`;
    const next = text.slice(0, start) + snippet + text.slice(end);
    onChange({ ...bullet, text: next });
    // Re-focus and select the URL placeholder so the user can type it.
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const urlStart = start + label.length + 3; // after "[label]("
      el.setSelectionRange(urlStart, urlStart + 'https://'.length);
    });
  };

  return (
    <div className="flex items-start gap-1 group">
      <span className="mt-2 text-muted-foreground text-xs shrink-0">•</span>
      <textarea
        ref={textareaRef}
        className="flex-1 text-sm bg-transparent border border-transparent focus:border-border focus:bg-background rounded px-2 py-1 resize-none outline-none transition-colors min-h-[2rem]"
        value={bullet.text}
        rows={2}
        placeholder="Describe an achievement... Use **bold**, *italic*, and [text](url) for links"
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
        onClick={insertLink}
        title="Insert hyperlink"
        className="mt-1 shrink-0 opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all text-xs"
        aria-label="Insert hyperlink"
      >
        🔗
      </button>
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
