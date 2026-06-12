import type { ResumeSettings } from '@/types/resume.types';

interface Props {
  settings: ResumeSettings;
  onChange: (updated: ResumeSettings) => void;
}

const FONT_OPTIONS = [
  { value: 'charter',      label: 'Charter (LaTeX default)' },
  { value: 'garamond',     label: 'EB Garamond' },
  { value: 'baskerville',  label: 'Libre Baskerville' },
  { value: 'merriweather', label: 'Merriweather' },
  { value: 'ptserif',      label: 'PT Serif' },
  { value: 'palatino',     label: 'Palatino' },
  { value: 'georgia',      label: 'Georgia' },
  { value: 'times',        label: 'Times New Roman' },
  { value: 'lato',         label: 'Lato (sans-serif)' },
  { value: 'sourcesans',   label: 'Source Sans 3 (sans-serif)' },
  { value: 'helvetica',    label: 'Helvetica / Arial (sans-serif)' },
];

function SliderField({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between">
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </label>
        <span className="text-[10px] font-mono text-muted-foreground">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        className="w-full accent-primary h-1.5 rounded-full"
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export default function TypographyControls({ settings, onChange }: Props) {
  const set = <K extends keyof ResumeSettings>(key: K, value: ResumeSettings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <div className="space-y-3">
      {/* Font family */}
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          Font Family
        </label>
        <select
          className="h-7 text-sm bg-background border border-border rounded px-2 outline-none focus:ring-1 focus:ring-primary/50"
          value={settings.fontFamily}
          aria-label="Font family"
          onChange={(e) => set('fontFamily', e.target.value)}
        >
          {FONT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <SliderField
        label="Font Size"
        value={settings.fontSize}
        min={9}
        max={12}
        step={0.5}
        display={`${settings.fontSize}pt`}
        onChange={(v) => set('fontSize', v)}
      />

      <SliderField
        label="Line Spacing"
        value={settings.lineSpacing}
        min={1.0}
        max={1.4}
        step={0.05}
        display={settings.lineSpacing.toFixed(2)}
        onChange={(v) => set('lineSpacing', v)}
      />

      <SliderField
        label="Section Spacing"
        value={settings.sectionSpacing}
        min={4}
        max={12}
        step={1}
        display={`${settings.sectionSpacing}pt`}
        onChange={(v) => set('sectionSpacing', v)}
      />

      <SliderField
        label="Margin Size"
        value={settings.marginSize}
        min={0.4}
        max={0.6}
        step={0.05}
        display={`${settings.marginSize}in`}
        onChange={(v) => set('marginSize', v)}
      />

      {/* Header alignment */}
      <div className="flex flex-col gap-1 pt-1 border-t border-border">
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          Header Alignment
        </label>
        <div className="flex gap-1">
          {(['center', 'left'] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => set('headerAlign', a)}
              className={`flex-1 h-7 text-xs font-medium rounded border transition-colors ${
                settings.headerAlign === a
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {a === 'center' ? 'Centered' : 'Left'}
            </button>
          ))}
        </div>
      </div>

      {/* Auto-fit toggle */}
      <div className="flex items-center justify-between pt-1 border-t border-border">
        <div>
          <p className="text-[11px] font-medium text-foreground">Auto-fit one page</p>
          <p className="text-[10px] text-muted-foreground">Shrinks font/spacing to fit</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.autoFitOnePage}
          onClick={() => set('autoFitOnePage', !settings.autoFitOnePage)}
          className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors focus:outline-none ${
            settings.autoFitOnePage ? 'bg-primary' : 'bg-border'
          }`}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
              settings.autoFitOnePage ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
