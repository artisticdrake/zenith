import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ResumeContent, ResumeSection, SectionType } from '@/types/resume.types';
import SectionEditor from './SectionEditor';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ── Sortable section card ────────────────────────────────────────────────────

interface SortableCardProps {
  section: ResumeSection;
  onUpdate: (updated: ResumeSection) => void;
  onDelete: () => void;
}

function SortableCard({ section, onUpdate, onDelete }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.id });

  const [expanded, setExpanded] = useState(true);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="border border-border rounded-lg overflow-hidden bg-card"
    >
      {/* Section header bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
        {/* Drag handle */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5"
          aria-label="Drag to reorder"
        >
          ⠿
        </button>

        {/* Section title (editable) */}
        <input
          type="text"
          className="flex-1 text-sm font-semibold bg-transparent outline-none border-none"
          value={section.title}
          aria-label="Section title"
          onChange={(e) => onUpdate({ ...section, title: e.target.value })}
          onClick={(e) => e.stopPropagation()}
        />

        {/* Visibility toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={section.visible}
          onClick={() => onUpdate({ ...section, visible: !section.visible })}
          className={`text-xs px-2 py-0.5 rounded transition-colors ${
            section.visible
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {section.visible ? 'Visible' : 'Hidden'}
        </button>

        {/* Expand/collapse */}
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="text-muted-foreground hover:text-foreground text-xs w-5 h-5 flex items-center justify-center"
          aria-label={expanded ? 'Collapse section' : 'Expand section'}
        >
          {expanded ? '▲' : '▼'}
        </button>

        {/* Delete */}
        <button
          type="button"
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive text-xs w-5 h-5 flex items-center justify-center"
          aria-label="Delete section"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="p-3">
          <SectionEditor section={section} onChange={onUpdate} />
        </div>
      )}
    </div>
  );
}

// ── Section type options ─────────────────────────────────────────────────────

const SECTION_TYPES: { type: SectionType; label: string }[] = [
  { type: 'education', label: 'Education' },
  { type: 'experience', label: 'Experience' },
  { type: 'projects', label: 'Projects' },
  { type: 'skills', label: 'Skills' },
  { type: 'custom', label: 'Custom' },
];

// ── Main component ───────────────────────────────────────────────────────────

interface Props {
  content: ResumeContent;
  onChange: (updated: ResumeContent) => void;
}

export default function SectionList({ content, onChange }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIdx = content.sections.findIndex((s) => s.id === active.id);
    const newIdx = content.sections.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(content.sections, oldIdx, newIdx);
    onChange({ ...content, sections: reordered });
  };

  const updateSection = (idx: number, updated: ResumeSection) => {
    const sections = content.sections.map((s, i) => (i === idx ? updated : s));
    onChange({ ...content, sections });
  };

  const deleteSection = (idx: number) => {
    onChange({ ...content, sections: content.sections.filter((_, i) => i !== idx) });
  };

  const addSection = (type: SectionType) => {
    const defaults: Record<SectionType, string> = {
      education: 'Education',
      experience: 'Experience',
      projects: 'Projects',
      skills: 'Technical Skills',
      custom: 'Custom Section',
    };
    const newSection: ResumeSection = {
      id: uid(),
      type,
      title: defaults[type],
      visible: true,
      items: [],
    };
    onChange({ ...content, sections: [...content.sections, newSection] });
  };

  return (
    <div className="space-y-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={content.sections.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          {content.sections.map((section, idx) => (
            <SortableCard
              key={section.id}
              section={section}
              onUpdate={(u) => updateSection(idx, u)}
              onDelete={() => deleteSection(idx)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* Add section */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {SECTION_TYPES.map(({ type, label }) => (
          <button
            key={type}
            type="button"
            onClick={() => addSection(type)}
            className="text-xs px-2.5 py-1 border border-dashed border-border rounded-full text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            + {label}
          </button>
        ))}
      </div>
    </div>
  );
}
