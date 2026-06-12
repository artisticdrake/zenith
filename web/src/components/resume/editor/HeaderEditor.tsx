import type { ResumeHeader } from '@/types/resume.types';

interface Props {
  header: ResumeHeader;
  onChange: (updated: ResumeHeader) => void;
}

function Field({
  label,
  value,
  placeholder,
  type = 'text',
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  type?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </label>
      <input
        type={type}
        className="h-7 text-sm bg-background border border-border rounded px-2 outline-none focus:ring-1 focus:ring-primary/50"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export default function HeaderEditor({ header, onChange }: Props) {
  const set = (key: keyof ResumeHeader) => (v: string) =>
    onChange({ ...header, [key]: v });

  return (
    <div className="space-y-2">
      <Field label="Full Name" value={header.name} placeholder="Jane Doe" onChange={set('name')} />
      <Field
        label="Professional Title"
        value={header.title}
        placeholder="ML Engineer | NLP | LLM Applications"
        onChange={set('title')}
      />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Phone" value={header.phone} placeholder="617-000-0000" onChange={set('phone')} type="tel" />
        <Field label="Email" value={header.email} placeholder="you@email.com" onChange={set('email')} type="email" />
        <Field label="LinkedIn" value={header.linkedin} placeholder="linkedin.com/in/yourname" onChange={set('linkedin')} />
        <Field label="GitHub" value={header.github} placeholder="github.com/yourusername" onChange={set('github')} />
        <div className="col-span-2">
          <Field
            label="Portfolio (optional)"
            value={header.portfolio}
            placeholder="yourportfolio.com"
            onChange={set('portfolio')}
          />
        </div>
      </div>
    </div>
  );
}
