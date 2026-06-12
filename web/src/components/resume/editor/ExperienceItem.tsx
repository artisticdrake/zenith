import type { ResumeSectionItem, BulletItem } from '@/types/resume.types';
import BulletEditor from './BulletEditor';

// nanoid is not available — use a simple id generator
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

interface Props {
  item: ResumeSectionItem;
  onChange: (updated: ResumeSectionItem) => void;
  onDelete: () => void;
  index: number;
}

function Field({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string | undefined;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </label>
      <input
        type="text"
        className="h-7 text-sm bg-background border border-border rounded px-2 outline-none focus:ring-1 focus:ring-primary/50"
        value={value ?? ''}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export default function ExperienceItem({ item, onChange, onDelete, index }: Props) {
  const bullets = item.bullets ?? [];

  const updateBullet = (idx: number, updated: BulletItem) => {
    const next = bullets.map((b, i) => (i === idx ? updated : b));
    onChange({ ...item, bullets: next });
  };

  const deleteBullet = (idx: number) => {
    onChange({ ...item, bullets: bullets.filter((_, i) => i !== idx) });
  };

  const addBullet = () => {
    onChange({ ...item, bullets: [...bullets, { id: uid(), text: '' }] });
  };

  return (
    <div className="border border-border rounded-lg p-3 space-y-2 bg-background/50">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">Entry {index + 1}</span>
        <button
          type="button"
          onClick={onDelete}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors px-2 py-0.5 rounded hover:bg-destructive/10"
          aria-label="Delete entry"
        >
          Remove
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field
          label="Organization"
          value={item.organization}
          placeholder="Company / School"
          onChange={(v) => onChange({ ...item, organization: v })}
        />
        <Field
          label="Date"
          value={item.date}
          placeholder="Jan 2024 – Present"
          onChange={(v) => onChange({ ...item, date: v })}
        />
        <Field
          label="Role / Degree"
          value={item.role}
          placeholder="Software Engineer"
          onChange={(v) => onChange({ ...item, role: v })}
        />
        <Field
          label="Location"
          value={item.location}
          placeholder="Boston, MA"
          onChange={(v) => onChange({ ...item, location: v })}
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          Bullets
        </label>
        {bullets.map((b, idx) => (
          <BulletEditor
            key={b.id}
            bullet={b}
            onChange={(updated) => updateBullet(idx, updated)}
            onDelete={() => deleteBullet(idx)}
            onAdd={addBullet}
          />
        ))}
        <button
          type="button"
          onClick={addBullet}
          className="text-xs text-primary hover:underline mt-1"
        >
          + Add bullet
        </button>
      </div>
    </div>
  );
}
