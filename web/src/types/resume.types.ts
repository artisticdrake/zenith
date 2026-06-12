// ── Resume Builder — TypeScript interfaces ─────────────────────────────────

export interface BulletItem {
  id: string;
  text: string; // supports **bold** and *italic* markdown
}

export interface ResumeSectionItem {
  id: string;
  // Education / Experience
  organization?: string;
  location?: string;
  role?: string;
  date?: string;
  bullets?: BulletItem[];
  // Projects
  projectName?: string;
  techStack?: string;
  dateRange?: string;
  // Skills
  category?: string;
  items?: string;
  // Custom
  content?: string;
}

export type SectionType = 'education' | 'experience' | 'projects' | 'skills' | 'custom';

export interface ResumeSection {
  id: string;
  type: SectionType;
  title: string;
  visible: boolean;
  items: ResumeSectionItem[];
}

export interface ResumeHeader {
  name: string;
  title: string;
  phone: string;
  email: string;
  linkedin: string;
  github: string;
  portfolio: string;
}

export interface ResumeContent {
  header: ResumeHeader;
  summary: string;
  showSummary: boolean;
  sections: ResumeSection[];
}

export interface ResumeSettings {
  fontSize: number;
  fontFamily: string;
  lineSpacing: number;
  sectionSpacing: number;
  marginSize: number;
  autoFitOnePage: boolean;
  headerAlign: 'center' | 'left';
}

export interface ResumeBuilderData {
  id: string;
  user_id: string;
  version_name: string;
  created_at: string;
  updated_at: string;
  content: ResumeContent;
  settings: ResumeSettings;
}

// ── Undo/Redo state ─────────────────────────────────────────────────────────

export interface ResumeEditorState {
  past: ResumeContent[];
  present: ResumeContent;
  future: ResumeContent[];
}

export type ResumeEditorAction =
  | { type: 'SET'; payload: ResumeContent }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'RESET'; payload: ResumeContent };

// ── Default values ──────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: ResumeSettings = {
  fontSize: 10.5,
  fontFamily: 'charter',
  lineSpacing: 1.15,
  sectionSpacing: 6,
  marginSize: 0.5,
  autoFitOnePage: false,
  headerAlign: 'center',
};

export const DEFAULT_RESUME_CONTENT: ResumeContent = {
  header: {
    name: 'Your Name',
    title: 'ML Engineer | NLP | LLM Applications',
    phone: '617-000-0000',
    email: 'you@email.com',
    linkedin: 'linkedin.com/in/yourname',
    github: 'github.com/yourusername',
    portfolio: 'yourportfolio.com',
  },
  summary:
    'MS Computer Science candidate specializing in ML Engineering. Built production NLP systems and end-to-end LLM-powered products. Seeking ML Engineer roles — STEM OPT eligible.',
  showSummary: true,
  sections: [
    {
      id: 'education',
      type: 'education',
      title: 'Education',
      visible: true,
      items: [
        {
          id: 'edu1',
          organization: 'Boston University — Metropolitan College',
          location: 'Boston, MA',
          role: 'Master of Science, Computer Science — Concentration: Data Analytics',
          date: 'Aug 2024 – May 2026',
          bullets: [
            {
              id: 'b1',
              text: 'Relevant coursework: Advanced Machine Learning, Data Mining, Web Mining & Graph Analytics, Software Engineering',
            },
          ],
        },
      ],
    },
    {
      id: 'experience',
      type: 'experience',
      title: 'Experience',
      visible: true,
      items: [
        {
          id: 'exp1',
          organization: 'Boston University Housing',
          location: 'Boston, MA',
          role: 'Mailroom Assistant',
          date: 'Jan 2025 – Present',
          bullets: [
            {
              id: 'b1',
              text: 'Engineered Python automation tool generating scannable barcode PDFs, reducing mail processing time by **26%**; tool in active production use for 15+ months',
            },
          ],
        },
      ],
    },
    {
      id: 'projects',
      type: 'projects',
      title: 'Projects',
      visible: true,
      items: [
        {
          id: 'proj1',
          projectName: 'CHATALOGUE — Intelligent Campus Assistant',
          techStack: 'Python, BERT, spaCy, FastAPI, RAG, FAISS, Docker, Redis',
          dateRange: '2024–2025',
          bullets: [
            {
              id: 'b1',
              text: 'Fine-tuned BERT-based NER model on 3,000–4,000 labeled campus queries achieving **98% intent classification accuracy** and **96% semantic routing precision**',
            },
            {
              id: 'b2',
              text: 'Deployed to **30+ real BU campus users**; built RAG pipeline with FAISS vector search and FastAPI microservices backend',
            },
            {
              id: 'b3',
              text: 'Reduced query latency by **35%** through Redis caching; deployed via Docker and Jenkins CI/CD',
            },
          ],
        },
      ],
    },
    {
      id: 'skills',
      type: 'skills',
      title: 'Technical Skills',
      visible: true,
      items: [
        { id: 's1', category: 'Languages', items: 'Python, R, SQL, Java, C/C++, JavaScript, TypeScript' },
        {
          id: 's2',
          category: 'ML/DL',
          items: 'PyTorch, TensorFlow, scikit-learn, BERT Fine-tuning, Transfer Learning, Neural Networks',
        },
        {
          id: 's3',
          category: 'NLP & GenAI',
          items: 'LangChain, Hugging Face, OpenAI API, RAG, spaCy, FAISS, NER, LLMs',
        },
        {
          id: 's4',
          category: 'MLOps & Tools',
          items: 'Docker, FastAPI, Git, Linux, Jenkins, Redis, PostgreSQL, GCP, CI/CD',
        },
      ],
    },
  ],
};
