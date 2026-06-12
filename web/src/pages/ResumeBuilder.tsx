import type { Session } from '@supabase/supabase-js';
import ResumeBuilderLayout from '@/components/resume/ResumeBuilderLayout';

interface Props {
  session: Session;
}

export default function ResumeBuilder({ session }: Props) {
  return <ResumeBuilderLayout session={session} />;
}
