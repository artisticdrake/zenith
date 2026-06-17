import type { Session } from '@supabase/supabase-js';
import type { AssembleResult } from '@/components/tabs/TailorTab';
import ResumeBuilderLayout from '@/components/resume/ResumeBuilderLayout';

interface Props {
  session: Session;
  assembleResult?: AssembleResult | null;
  onDismissAssemble?: () => void;
}

export default function ResumeBuilder({ session, assembleResult, onDismissAssemble }: Props) {
  return (
    <ResumeBuilderLayout
      session={session}
      assembleResult={assembleResult}
      onDismissAssemble={onDismissAssemble}
    />
  );
}
