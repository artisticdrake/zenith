// ── Bullet suggestion types ───────────────────────────────────────────────────
// Claude's tailor/rerank review pairs each piece of guidance with a concrete,
// ready-to-paste resume line. In the Tailor tab the user edits and approves a
// subset of these; the approved bullets are sent to POST /assemble/claude, which
// rebuilds a fresh resume from the Master Profile + current resume + approved
// bullets. (The old localStorage "queue → insert into the first matching section"
// handoff has been removed — the server-side assembly pass replaces it.)

export type BulletTargetSection = 'experience' | 'projects' | 'skills' | 'summary';

export interface BulletSuggestion {
  section: BulletTargetSection;
  target?: string;   // org / role / project this line belongs under (optional)
  guidance: string;  // the advice + why it matters for this JD
  bullet: string;    // the ready-to-paste resume line / skills / summary sentence
}

// What the Tailor tab sends to POST /assemble/claude after the user edits +
// approves a subset of the suggestions above.
export interface ApprovedBullet {
  id: string;
  text: string;                 // the user's current (possibly edited) bullet text
  section: BulletTargetSection;
  target?: string;
}
