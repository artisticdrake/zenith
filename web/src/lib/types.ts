export type AppStatus =
  | "Applied"
  | "Screening"
  | "Interview Scheduled"
  | "Interview Completed"
  | "Offer"
  | "Rejected"
  | "Withdrawn";

export type AppSource =
  | "LinkedIn"
  | "Handshake"
  | "Jobright"
  | "Glassdoor"
  | "Indeed"
  | "Interstride"
  | "Other/Custom";

export interface TimelineEntry {
  status: string;
  ts: number;
}

export interface Document {
  name: string;
  dateApplied: string;
}

export interface JobApplication {
  id: string;
  company: string;
  position: string;
  location: string;
  salary: string;
  dateApplied: string;
  status: AppStatus;
  source: AppSource;
  referral: "Yes" | "No";
  jobUrl: string;
  jobDescription: string;
  notes: string;
  documents: Document[];
  timeline: TimelineEntry[];
  last_updated: string;
}

export interface Resume {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  uploaded_at: string;
  extracted_text: string;
  is_active: boolean;
}

export interface AppFormData {
  company: string;
  position: string;
  location: string;
  salary: string;
  dateApplied: string;
  status: string;
  jobUrl: string;
  source: string;
  referral: string;
  notes: string;
  jobDescription: string;
  documents: Document[];
}

export interface MatchResult {
  score: number;
  label: string;
  breakdown: {
    required: number;
    preferred: number;
    experience: number;
  };
  summary: string;
  matched_skills: string[];
  missing_skills: string[];
  observations: string[];
  suggested_rewrites: Array<{ original: string; rewrite: string }>;
  action_steps: string[];
}
