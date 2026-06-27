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
