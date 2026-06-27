// BuiltIn (builtin.com) scrape source via the Apify actor `solidcode/builtin-scraper`.
// This actor is the first source proven to return full job descriptions (with
// `fetchDescription: true`), so it can feed the content-addressed scoring pipeline.
// Additive: nothing here touches the scorer or existing routes.

// Actor id in Apify API path form ("/" → "~").
const BUILTIN_ACTOR = 'solidcode~builtin-scraper';

export interface BuiltinScrapeParams {
  searchQueries: string[];
  searchLocation?: string;
  maxResults?: number;
}

// Our internal job shape — the same fields scoreInlineJobForOwner accepts.
export interface NormalizedJob {
  jd_text: string;
  title: string | null;
  company: string | null;
  url: string | null;
  location: string | null;
  posted_at: string | null;
  source: 'builtin';
}

// Read the Apify token from env. Primary name is APIFY_TOKEN (what we document);
// falls back to APIFY_API_KEY (what the existing .env already uses). Never logged.
function getApifyToken(): string {
  const token = (process.env.APIFY_TOKEN || process.env.APIFY_API_KEY || '').trim();
  if (!token) {
    throw new Error('APIFY_TOKEN (or APIFY_API_KEY) is not configured on the server.');
  }
  return token;
}

// Run the BuiltIn actor and return the raw dataset items. Results are clamped:
// default 25 total, hard-capped by APIFY_MAX_RESULTS (default 100) so a single call
// can't trigger an unbounded (and costly) scrape. The token is sent as a Bearer
// header — never in the URL/query string — so it can't leak via logged URLs.
//
// Each query is scraped in its OWN run, because the actor processes a multi-query
// `searchQueries` sequentially and ignores `maxResultsPerQuery` — so a single
// combined run lets the first query consume the whole limit and starves the rest.
// Per-query runs make maxResults a true TOTAL cap split evenly across queries.
export async function runBuiltinScrape(params: BuiltinScrapeParams): Promise<any[]> {
  const token = getApifyToken();
  const hardMax = Number(process.env.APIFY_MAX_RESULTS) || 100;
  const requested = Number(params.maxResults) || 25;
  const maxResults = Math.max(1, Math.min(requested, hardMax));
  const queries = params.searchQueries;
  const perQuery = Math.max(1, Math.ceil(maxResults / queries.length));
  const location =
    typeof params.searchLocation === 'string' && params.searchLocation.trim()
      ? params.searchLocation.trim()
      : undefined;

  const all: any[] = [];
  for (const q of queries) {
    if (all.length >= maxResults) break;
    const input: Record<string, unknown> = {
      searchQueries: [q],
      fetchDescription: true, // REQUIRED for jd_text — off by default on the actor
      maxResultsPerQuery: perQuery,
    };
    if (location) input.location = location;

    // ?limit is the only cap the actor reliably honors, so it enforces perQuery.
    const url = `https://api.apify.com/v2/acts/${BUILTIN_ACTOR}/run-sync-get-dataset-items?limit=${perQuery}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Apify BuiltIn scrape failed for "${q}": HTTP ${resp.status} ${text.slice(0, 300)}`);
    }
    const items = await resp.json();
    if (Array.isArray(items)) all.push(...items);
  }
  return all.slice(0, maxResults);
}

// ── Seniority pre-filter (cost-saving) ──────────────────────────────────────────
// Cheap title-only heuristic to skip clearly-senior roles BEFORE the (paid) scorer
// runs. Opt-in via scrapeAndNormalizeBuiltin's `skipSenior` flag, so the internal
// route is unaffected unless it asks. isSeniorTitle is exported + pure for unit tests.

// Unambiguous seniority qualifiers — matched as whole words (case-insensitive).
// `\bsr\b` covers "Sr." (the boundary sits between "r" and "."); `head\s+of` allows
// multiple spaces. "lead" is handled separately below (it needs domain-term care).
const SENIOR_TERMS_RE = /\b(senior|sr|staff|principal|manager|director|vp|head\s+of)\b/i;

// "lead"/"leads" is a seniority qualifier ONLY as a standalone title word
// ("Lead Engineer", "Engineering Lead", "Tech Lead"). It is NOT seniority in domain
// phrases where the next word makes a compound noun ("lead generation", "lead
// scoring") — those are IC/marketing terms we must not filter. A false-positive
// (filtering an IC role) costs a job; a false-negative costs one scorer call, so we
// bias hard toward NOT matching "lead" when it's ambiguous.
const LEAD_WORD_RE = /\blead(?:s)?\b/gi;
const LEAD_DOMAIN_FOLLOWERS = new Set(['generation', 'gen', 'scoring']);

// True when a TITLE clearly indicates a senior-level role. Title-level only — never
// scans the JD body. Returns false for empty/non-string input.
export function isSeniorTitle(title: string | null | undefined): boolean {
  if (typeof title !== 'string') return false;
  const t = title.trim();
  if (!t) return false;

  if (SENIOR_TERMS_RE.test(t)) return true;

  // "lead": seniority unless immediately followed by a domain noun (lead generation /
  // lead scoring). Scan every "lead"/"leads" occurrence; a single standalone one wins.
  const lower = t.toLowerCase();
  LEAD_WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LEAD_WORD_RE.exec(lower)) !== null) {
    const after = lower.slice(m.index + m[0].length).trimStart();
    const nextWord = after.match(/^[a-z]+/)?.[0] ?? '';
    if (!LEAD_DOMAIN_FOLLOWERS.has(nextWord)) return true;
  }
  return false;
}

// Scrape BuiltIn and normalize in one step — the shared scrape→normalize core used
// by both the internal machine route and the user-facing /jobs/scrape. Returns the
// raw count, the scorable (description-bearing) jobs, how many were dropped for
// having no description, and — when `skipSenior` is on — how many were dropped by the
// seniority pre-filter (NOT scored, NOT stored). `skipSenior` defaults OFF so the
// internal route's behaviour is unchanged; only /jobs/scrape opts in. Scoring is
// intentionally left to the caller (each route owns its owner + batch guard).
export async function scrapeAndNormalizeBuiltin(
  params: BuiltinScrapeParams,
  opts: { skipSenior?: boolean } = {},
): Promise<{ scraped: number; normalized: NormalizedJob[]; missingDescription: number; seniorityFiltered: number }> {
  const raw = await runBuiltinScrape(params);
  const normalized: NormalizedJob[] = [];
  let missingDescription = 0;
  let seniorityFiltered = 0;
  for (const r of raw) {
    const n = normalizeBuiltinJob(r);
    if (!n) { missingDescription++; continue; }
    if (opts.skipSenior && isSeniorTitle(n.title)) { seniorityFiltered++; continue; }
    normalized.push(n);
  }
  return { scraped: raw.length, normalized, missingDescription, seniorityFiltered };
}

// Map one raw BuiltIn job onto our NormalizedJob. Returns null when the description
// is empty/missing — those can't be scored (the pipeline is keyed on jd_text), so
// the caller counts and skips them rather than storing an unscorable row.
export function normalizeBuiltinJob(raw: any): NormalizedJob | null {
  const description = typeof raw?.description === 'string' ? raw.description.trim() : '';
  if (!description) return null;
  const str = (v: any): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    jd_text: description,
    title: str(raw?.title),
    company: str(raw?.company),
    url: str(raw?.jobUrl),
    location: str(raw?.location),
    posted_at: str(raw?.postedDate), // ISO date string (e.g. "2026-06-24"); parsed downstream
    source: 'builtin',
  };
}
