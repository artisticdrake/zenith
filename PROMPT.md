# Claude Code Prompt — Resume Builder Tab
# Paste this entire prompt into Claude Code to begin building

---

## CONTEXT

I have an existing full-stack job tracker SaaS app with this stack:
- Frontend: React + Vite + TypeScript
- Backend: Node.js + Express
- Database: Supabase (PostgreSQL + Auth + Storage)
- Auth: Google OAuth via Supabase
- Styling: Tailwind CSS
- The app already has multiple tabs (Dashboard, Applications, etc.)

I want to add a new **Resume Builder** tab to this app. This is a fully featured
resume editor — think JobRight.ai or Resume.io — but following the exact visual
style of Jake's Resume template from Overleaf (clean, single-column, ATS-friendly,
black and white, section divider lines, no colors or icons).

Do NOT start coding yet. First read this entire prompt, then ask me any
clarifying questions about my existing codebase before writing a single line.

---

## WHAT WE ARE BUILDING

A Resume Builder with the following architecture:

### LEFT PANEL — Editor (forms + controls)
- Structured form inputs for each resume section
- Rich text controls: Bold, Italic, Underline per field
- Section management: add, delete, reorder sections via drag-and-drop
- Typography controls: font size slider (9pt–12pt), font family selector
- Spacing controls: adjust line spacing and section spacing
- One-page fit toggle: auto-scales font/spacing to fit content in exactly one page

### RIGHT PANEL — Live Preview (Jake's Resume style)
- Real-time preview that updates as user types
- Renders exactly like Jake's Resume LaTeX template (see style spec below)
- Visual page boundary indicator showing the one-page limit
- Overflow warning when content exceeds one page

### TOP BAR
- "Download PDF" button — exports the preview as a pixel-perfect PDF
- "Copy LaTeX" button — generates the full Jake's Resume .tex code from current data
- "Save" button — persists resume data to Supabase
- Version selector — user can have multiple named resume versions (ML Engineer, Data Scientist, etc.)
- Resume version name (editable inline)

---

## JAKE'S RESUME STYLE SPEC

The preview panel must match this visual spec exactly:

```
- Font: Computer Modern or fallback to Charter/Georgia serif
- Page: US Letter (8.5" x 11"), margins 0.5in all sides
- Name: Large, centered, small-caps, ~24pt
- Title line: Medium, centered, normal weight, ~11pt (e.g. "ML Engineer | NLP | LLM Applications")
- Contact line: Small, centered, pipe-separated links, ~10pt
- Section headers: Small-caps, left-aligned, with full-width horizontal rule below, ~12pt
- Company/School name: Bold, left-aligned
- Date: Bold, right-aligned (same line as company)
- Role/Degree: Italic, left-aligned
- Location: Italic, right-aligned (same line as role)
- Bullet points: Small (10pt), left-indented, tight line spacing
- Skills section: Bold category label followed by comma-separated values
- No colors, no icons, no columns — pure black and white single column
- Horizontal rules under each section header (not full border boxes)
```

---

## DATA MODEL

The resume data structure should be:

```typescript
interface ResumeData {
  id: string;
  user_id: string;
  version_name: string; // e.g. "ML Engineer", "Data Scientist"
  created_at: string;
  updated_at: string;
  content: ResumeContent;
  settings: ResumeSettings;
}

interface ResumeContent {
  header: {
    name: string;
    title: string; // the subtitle line e.g. "ML Engineer | NLP | GenAI"
    phone: string;
    email: string;
    linkedin: string;
    github: string;
    portfolio: string;
  };
  summary: string; // optional, toggle on/off
  sections: ResumeSection[]; // ordered array, user can reorder
}

interface ResumeSection {
  id: string;
  type: 'education' | 'experience' | 'projects' | 'skills' | 'custom';
  title: string; // section heading text, editable
  visible: boolean;
  items: ResumeSectionItem[];
}

interface ResumeSectionItem {
  id: string;
  // For education and experience:
  organization?: string;    // bold left
  location?: string;        // italic right
  role?: string;            // italic left
  date?: string;            // bold right
  bullets?: BulletItem[];
  // For projects:
  projectName?: string;     // bold
  techStack?: string;       // italic (pipe-separated technologies)
  dateRange?: string;       // right-aligned
  // For skills:
  category?: string;        // bold label
  items?: string;           // comma-separated values
  // For custom:
  content?: string;
}

interface BulletItem {
  id: string;
  text: string;             // supports **bold**, *italic* markdown
}

interface ResumeSettings {
  fontSize: number;         // 9-12, default 10.5
  fontFamily: string;       // 'charter' | 'georgia' | 'times' | 'helvetica'
  lineSpacing: number;      // 1.0-1.4, default 1.15
  sectionSpacing: number;   // 4-12px, default 6
  marginSize: number;       // 0.4-0.6in, default 0.5
  autoFitOnePage: boolean;  // when true, auto-adjusts fontSize/spacing
}
```

---

## SUPABASE SCHEMA

Create this table in Supabase:

```sql
CREATE TABLE resumes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  version_name TEXT NOT NULL DEFAULT 'My Resume',
  content JSONB NOT NULL DEFAULT '{}',
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS policies
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own resumes"
ON resumes FOR ALL
USING (auth.uid() = user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ language 'plpgsql';

CREATE TRIGGER update_resumes_updated_at
BEFORE UPDATE ON resumes
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
```

---

## FILE STRUCTURE TO CREATE

```
src/
  pages/
    ResumeBuilder.tsx          # Main page component
  components/
    resume/
      ResumeBuilderLayout.tsx  # Two-panel layout wrapper
      editor/
        EditorPanel.tsx        # Left panel container
        HeaderEditor.tsx       # Name, title, contact fields
        SummaryEditor.tsx      # Summary textarea with toggle
        SectionEditor.tsx      # Generic section editor
        ExperienceItem.tsx     # Experience/Education item form
        ProjectItem.tsx        # Project item form
        SkillsItem.tsx         # Skills category + items form
        BulletEditor.tsx       # Individual bullet with formatting toolbar
        SectionList.tsx        # Drag-and-drop section reordering
        TypographyControls.tsx # Font size, family, spacing controls
      preview/
        PreviewPanel.tsx       # Right panel container
        ResumePreview.tsx      # The actual rendered resume
        PreviewHeader.tsx      # Name + title + contact render
        PreviewSection.tsx     # Generic section render
        PreviewExperience.tsx  # Experience/Education render
        PreviewProject.tsx     # Project render
        PreviewSkills.tsx      # Skills render
        PageOverflowWarning.tsx # Red warning when > 1 page
      toolbar/
        ResumeToolbar.tsx      # Top bar with buttons + version selector
        VersionSelector.tsx    # Dropdown for resume versions
      export/
        generatePDF.ts         # PDF export logic using react-to-print
        generateLatex.ts       # LaTeX code generation
  hooks/
    useResumeData.ts           # Supabase CRUD for resume data
    useResumeSettings.ts       # Settings state management
    useAutoFit.ts              # One-page auto-fit logic
  types/
    resume.types.ts            # All TypeScript interfaces above
```

---

## KEY TECHNICAL DECISIONS

### PDF Export
Use `react-to-print` library for PDF export:
```bash
npm install react-to-print
```
- Print the PreviewPanel div directly
- Use `@media print` CSS to hide editor panel and toolbar
- Set page size to US Letter in print CSS
- This gives pixel-perfect PDF matching the preview

### LaTeX Generation
The `generateLatex.ts` file should output valid Jake's Resume .tex code
from the current ResumeContent data. Template strings mapping each section
type to the corresponding LaTeX commands. The output should be copyable
and paste directly into Overleaf and compile without errors.

### Inline Formatting
For bullet text and summary, support minimal markdown:
- `**text**` → `<strong>text</strong>` in preview, `\textbf{text}` in LaTeX
- `*text*` → `<em>text</em>` in preview, `\textit{text}` in LaTeX
- Plain text otherwise

Build a simple parser — do NOT use a full markdown library for this.

### One-Page Auto Fit
In `useAutoFit.ts`:
- Attach a ResizeObserver to the resume preview div
- When content height > 1056px (11in at 96dpi), trigger auto-fit
- Binary search between fontSize 9–11 and lineSpacing 1.0–1.15 to find
  the largest settings where content fits in one page
- Show a green checkmark "Fits one page" or red warning "Exceeds one page"

### Drag and Drop Section Reordering
Use `@dnd-kit/core` and `@dnd-kit/sortable`:
```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

### State Management
Use React useState + useReducer locally. Debounce Supabase saves by 1500ms
on any content change. Do NOT use Redux or Zustand — keep it simple.

---

## PRELOADED DEFAULT DATA

When a new user opens Resume Builder for the first time, preload this
default resume data so they see a working example immediately:

```typescript
const DEFAULT_RESUME: ResumeContent = {
  header: {
    name: "Your Name",
    title: "ML Engineer | NLP | LLM Applications",
    phone: "617-000-0000",
    email: "you@email.com",
    linkedin: "linkedin.com/in/yourname",
    github: "github.com/yourusername",
    portfolio: "yourportfolio.com"
  },
  summary: "MS Computer Science candidate specializing in ML Engineering. Built production NLP systems and end-to-end LLM-powered products. Seeking ML Engineer roles — STEM OPT eligible.",
  sections: [
    {
      id: "education",
      type: "education",
      title: "Education",
      visible: true,
      items: [
        {
          id: "edu1",
          organization: "Boston University — Metropolitan College",
          location: "Boston, MA",
          role: "Master of Science, Computer Science — Concentration: Data Analytics",
          date: "Aug 2024 – May 2026",
          bullets: [
            { id: "b1", text: "Relevant coursework: Advanced Machine Learning, Data Mining, Web Mining & Graph Analytics, Software Engineering" }
          ]
        }
      ]
    },
    {
      id: "experience",
      type: "experience",
      title: "Experience",
      visible: true,
      items: [
        {
          id: "exp1",
          organization: "Boston University Housing",
          location: "Boston, MA",
          role: "Mailroom Assistant",
          date: "Jan 2025 – Present",
          bullets: [
            { id: "b1", text: "Engineered Python automation tool generating scannable barcode PDFs, reducing mail processing time by **26%**; tool in active production use for 15+ months" }
          ]
        }
      ]
    },
    {
      id: "projects",
      type: "projects",
      title: "Projects",
      visible: true,
      items: [
        {
          id: "proj1",
          projectName: "CHATALOGUE — Intelligent Campus Assistant",
          techStack: "Python, BERT, spaCy, FastAPI, RAG, FAISS, Docker, Redis",
          dateRange: "2024–2025",
          bullets: [
            { id: "b1", text: "Fine-tuned BERT-based NER model on 3,000–4,000 labeled campus queries achieving **98% intent classification accuracy** and **96% semantic routing precision**" },
            { id: "b2", text: "Deployed to **30+ real BU campus users**; built RAG pipeline with FAISS vector search and FastAPI microservices backend" },
            { id: "b3", text: "Reduced query latency by **35%** through Redis caching; deployed via Docker and Jenkins CI/CD" }
          ]
        }
      ]
    },
    {
      id: "skills",
      type: "skills",
      title: "Technical Skills",
      visible: true,
      items: [
        { id: "s1", category: "Languages", items: "Python, R, SQL, Java, C/C++, JavaScript, TypeScript" },
        { id: "s2", category: "ML/DL", items: "PyTorch, TensorFlow, scikit-learn, BERT Fine-tuning, Transfer Learning, Neural Networks" },
        { id: "s3", category: "NLP & GenAI", items: "LangChain, Hugging Face, OpenAI API, RAG, spaCy, FAISS, NER, LLMs" },
        { id: "s4", category: "MLOps & Tools", items: "Docker, FastAPI, Git, Linux, Jenkins, Redis, PostgreSQL, GCP, CI/CD" }
      ]
    }
  ]
}
```

---

## CRITICAL CONSTRAINTS

1. **One file per component** — no giant monolithic files
2. **TypeScript throughout** — no `any` types
3. **No external CSS files** — Tailwind classes only for editor UI
4. **Preview uses inline styles only** — NOT Tailwind — because print/PDF
   rendering ignores Tailwind's purged classes
5. **Mobile responsive editor** — panels stack vertically on < 768px
6. **Auto-save indicator** — show "Saving..." and "Saved" states in toolbar
7. **Undo/redo** — implement basic undo stack (last 20 states) using useReducer
8. **Accessibility** — all form inputs must have labels
9. **Do not touch existing app files** — only ADD new files and ADD the
   new tab to the existing navigation

---

## NAVIGATION INTEGRATION

Add "Resume Builder" as a new tab in the existing navigation. Use whatever
nav pattern already exists in the app. The route should be `/resume-builder`.

---

## BUILD ORDER

Build in this exact sequence to avoid dependency issues:

1. `resume.types.ts` — all interfaces first
2. Supabase table + RLS (give me the SQL, I'll run it)
3. `useResumeData.ts` hook — CRUD operations
4. `generateLatex.ts` — pure function, no UI dependencies
5. `ResumePreview.tsx` and all preview sub-components — pure display
6. `useAutoFit.ts` — depends on preview being built
7. `generatePDF.ts` — depends on preview ref
8. All editor components — forms and controls
9. `ResumeToolbar.tsx` — depends on hooks and export functions
10. `ResumeBuilderLayout.tsx` — assembles panels
11. `ResumeBuilder.tsx` — main page
12. Wire up navigation route

---

## WHAT TO ASK ME BEFORE STARTING

Before writing any code, ask me:
1. Show me your current folder structure (run `find src -type f | head -60`)
2. Show me your current navigation component so I can match the pattern
3. Show me your existing Supabase client setup so I use the same instance
4. What port does your dev server run on?
5. Are you using React Router or another router?

Then confirm the build plan and wait for my go-ahead before writing code.