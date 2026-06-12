import type { ResumeSection, ResumeSectionItem, SectionType } from '@/types/resume.types';
import ExperienceItem from './ExperienceItem';
import ProjectItem from './ProjectItem';
import SkillsItem from './SkillsItem';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function newItem(type: SectionType): ResumeSectionItem {
  const id = uid();
  if (type === 'education' || type === 'experience') {
    return { id, organization: '', location: '', role: '', date: '', bullets: [] };
  }
  if (type === 'projects') {
    return { id, projectName: '', techStack: '', dateRange: '', bullets: [] };
  }
  if (type === 'skills') {
    return { id, category: '', items: '' };
  }
  return { id, content: '' };
}

interface Props {
  section: ResumeSection;
  onChange: (updated: ResumeSection) => void;
}

export default function SectionEditor({ section, onChange }: Props) {
  const updateItem = (idx: number, updated: ResumeSectionItem) => {
    const items = section.items.map((it, i) => (i === idx ? updated : it));
    onChange({ ...section, items });
  };

  const deleteItem = (idx: number) => {
    onChange({ ...section, items: section.items.filter((_, i) => i !== idx) });
  };

  const addItem = () => {
    onChange({ ...section, items: [...section.items, newItem(section.type)] });
  };

  return (
    <div className="space-y-2">
      {section.items.map((item, idx) => {
        if (section.type === 'education' || section.type === 'experience') {
          return (
            <ExperienceItem
              key={item.id}
              item={item}
              index={idx}
              onChange={(u) => updateItem(idx, u)}
              onDelete={() => deleteItem(idx)}
            />
          );
        }
        if (section.type === 'projects') {
          return (
            <ProjectItem
              key={item.id}
              item={item}
              index={idx}
              onChange={(u) => updateItem(idx, u)}
              onDelete={() => deleteItem(idx)}
            />
          );
        }
        if (section.type === 'skills') {
          return (
            <SkillsItem
              key={item.id}
              item={item}
              index={idx}
              onChange={(u) => updateItem(idx, u)}
              onDelete={() => deleteItem(idx)}
            />
          );
        }
        // custom
        return (
          <div key={item.id} className="flex items-start gap-2 group">
            <textarea
              className="flex-1 text-sm bg-background border border-border rounded px-2 py-1.5 resize-none outline-none focus:ring-1 focus:ring-primary/50 min-h-[3rem]"
              value={item.content ?? ''}
              placeholder="Custom content... Use **bold** and *italic*"
              aria-label={`Custom section content ${idx + 1}`}
              onChange={(e) => updateItem(idx, { ...item, content: e.target.value })}
            />
            <button
              type="button"
              onClick={() => deleteItem(idx)}
              className="mt-1 shrink-0 opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all text-xs"
              aria-label="Delete item"
            >
              ✕
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addItem}
        className="w-full text-xs text-primary border border-dashed border-primary/30 hover:border-primary/60 rounded-md py-1.5 transition-colors hover:bg-primary/5"
      >
        + Add {section.type === 'skills' ? 'skill category' : section.type === 'projects' ? 'project' : 'entry'}
      </button>
    </div>
  );
}
