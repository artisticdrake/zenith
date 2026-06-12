// Job Tracker — Background Service Worker
// Handles auth (Supabase Google OAuth), API bridge, and message routing.
//
// SETUP (one-time, after loading the extension):
//   1. Go to chrome://extensions, copy the extension ID
//   2. In Supabase dashboard → Auth → URL Configuration, add:
//      https://<extensionId>.chromiumapp.org/**
//   3. Replace SUPABASE_URL and SUPABASE_ANON_KEY below if they change.
//   4. Update API_URL / APP_URL for production deployment.

const SUPABASE_URL    = 'https://mkbhzvjllgnponlzwfok.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IbOPCZ2NzUVoen9MFCl8hQ_oM5FO0kT';
const API_URL         = 'http://localhost:3000';
const APP_URL         = 'http://localhost:5173';

// ─── PKCE helpers ────────────────────────────────────────────────────────────

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─── Extraction cache (chrome.storage.session, cleared on browser close) ─────

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function getCachedExtraction(url) {
  try {
    const { jtCache } = await chrome.storage.session.get('jtCache');
    const entry = (jtCache || {})[url];
    if (!entry || Date.now() - entry.ts > CACHE_TTL_MS) return null;
    return entry.data;
  } catch (_) {
    return null;
  }
}

async function setCachedExtraction(url, data) {
  try {
    const { jtCache } = await chrome.storage.session.get('jtCache');
    const cache = jtCache || {};
    cache[url] = { data, ts: Date.now() };
    // Evict oldest entries beyond 30 URLs to keep storage small
    const entries = Object.entries(cache);
    if (entries.length > 30) {
      entries.sort((a, b) => a[1].ts - b[1].ts);
      const trimmed = Object.fromEntries(entries.slice(entries.length - 30));
      await chrome.storage.session.set({ jtCache: trimmed });
    } else {
      await chrome.storage.session.set({ jtCache: cache });
    }
  } catch (_) {}
}

// ─── Session storage ─────────────────────────────────────────────────────────

async function getSession() {
  const result = await chrome.storage.local.get('jtSession');
  return result.jtSession || null;
}

async function refreshIfNeeded(session) {
  if (!session?.refresh_token) return session;
  const expiresAtMs = (session.expires_at || 0) * 1000;
  const fiveMin = 5 * 60 * 1000;
  if (Date.now() < expiresAtMs - fiveMin) return session;

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    const data = await res.json();
    if (data.access_token) {
      const newSession = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || session.refresh_token,
        expires_at: data.expires_at || session.expires_at,
        user: data.user || session.user
      };
      await chrome.storage.local.set({ jtSession: newSession });
      return newSession;
    }
  } catch (_) {}
  return session;
}

// ─── Sign in via Google OAuth (Supabase PKCE + implicit fallback) ────────────

async function signIn() {
  const redirectUrl = chrome.identity.getRedirectURL();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Persist verifier in storage so it survives service-worker restarts
  await chrome.storage.local.set({ jtPkceVerifier: codeVerifier });

  const authUrl = `${SUPABASE_URL}/auth/v1/authorize?` + new URLSearchParams({
    provider: 'google',
    redirect_to: redirectUrl,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  }).toString();

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        await chrome.storage.local.remove('jtPkceVerifier');
        return reject(new Error(chrome.runtime.lastError?.message || 'Authentication cancelled'));
      }
      try {
        const urlObj = new URL(responseUrl);
        const hashParams = new URLSearchParams(urlObj.hash.slice(1));
        const queryParams = urlObj.searchParams;

        // Implicit flow — tokens arrive in the URL hash
        const accessToken = hashParams.get('access_token') || queryParams.get('access_token');
        if (accessToken) {
          await chrome.storage.local.remove('jtPkceVerifier');
          const refreshToken = hashParams.get('refresh_token') || queryParams.get('refresh_token') || '';
          const expiresAt = parseInt(hashParams.get('expires_at') || queryParams.get('expires_at') || '0');
          const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': SUPABASE_ANON_KEY }
          });
          const user = await userRes.json();
          const session = { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt, user };
          await chrome.storage.local.set({ jtSession: session });
          return resolve(session);
        }

        // PKCE flow — exchange Supabase auth_code using Supabase-specific endpoint
        const code = queryParams.get('code');
        if (code) {
          // Retrieve verifier from storage (survives SW restart)
          const stored = await chrome.storage.local.get('jtPkceVerifier');
          const verifier = stored.jtPkceVerifier;
          await chrome.storage.local.remove('jtPkceVerifier');

          if (!verifier) {
            return reject(new Error('Auth session expired — please try signing in again'));
          }

          // Supabase PKCE exchange: grant_type=pkce, auth_code (not "code"), JSON body
          const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json;charset=UTF-8',
              'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
              auth_code: code,
              code_verifier: verifier
            })
          });
          const tokenData = await tokenRes.json();
          if (!tokenData.access_token) {
            const msg = tokenData.error_description || tokenData.msg || JSON.stringify(tokenData);
            return reject(new Error(`Supabase error: ${msg}`));
          }
          const session = {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token || '',
            expires_at: tokenData.expires_at || Math.floor(Date.now() / 1000) + 3600,
            user: tokenData.user
          };
          await chrome.storage.local.set({ jtSession: session });
          return resolve(session);
        }

        reject(new Error('No token or authorization code in response'));
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function signOut() {
  await chrome.storage.local.remove('jtSession');
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function extractJob(url, token, pageText = null) {
  const body = { url };
  if (pageText) body.pageText = pageText;
  const res = await fetch(`${API_URL}/autofill`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Extraction failed');
  return data.data;
}

async function saveJob(jobData, token) {
  const res = await fetch(`${API_URL}/applications`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(jobData)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Save failed');
  return data.data;
}

// ─── SW keepalive ─────────────────────────────────────────────────────────────
// MV3 service workers are killed after ~30s of inactivity. Ping storage every
// 20s to keep the SW alive during long async operations (e.g. AI extraction).

async function withKeepAlive(promise) {
  const id = setInterval(() => chrome.storage.local.get('_ka'), 20000);
  try {
    return await promise;
  } finally {
    clearInterval(id);
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(result => sendResponse(result))
    .catch(e => sendResponse({ error: e.message }));
  return true; // keep channel open for async response
});

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_SESSION': {
      const session = await getSession();
      if (!session) return { session: null };
      const refreshed = await refreshIfNeeded(session);
      return { session: refreshed };
    }
    case 'SIGN_IN': {
      const session = await signIn();
      return { session };
    }
    case 'SIGN_OUT': {
      await signOut();
      return { ok: true };
    }
    case 'EXTRACT_JOB': {
      // Return cached result instantly if available (populated by content script on page load)
      const cached = await getCachedExtraction(message.url);
      if (cached) return { data: cached };

      const session = await getSession();
      if (!session) return { error: 'Not signed in' };
      const refreshed = await refreshIfNeeded(session);
      // pageText is sent by content.js and popup.js (grabbed directly from the live tab)
      const data = await withKeepAlive(extractJob(message.url, refreshed.access_token, message.pageText || null));

      // Cache so the popup can read it instantly without re-extracting
      await setCachedExtraction(message.url, data);
      return { data };
    }
    case 'GET_CACHED_JOB': {
      // Read-only cache lookup — popup uses this to show data without triggering extraction
      const data = await getCachedExtraction(message.url);
      return { data: data || null };
    }
    case 'SAVE_JOB': {
      const session = await getSession();
      if (!session) return { error: 'Not signed in' };
      const refreshed = await refreshIfNeeded(session);
      const result = await withKeepAlive(saveJob(message.jobData, refreshed.access_token));
      return { id: result?.id };
    }
    case 'CHECK_DUPLICATE': {
      const session = await getSession();
      if (!session) return { isDuplicate: false };
      const refreshed = await refreshIfNeeded(session);
      const res = await fetch(`${API_URL}/applications`, {
        headers: { 'Authorization': `Bearer ${refreshed.access_token}` }
      });
      if (!res.ok) return { isDuplicate: false };
      const data = await res.json();
      const apps = data.data || [];
      const { jobUrl, company, position } = message;
      let duplicate = null;
      if (jobUrl) duplicate = apps.find(a => a.job_url && a.job_url === jobUrl);
      if (!duplicate && company && position) {
        duplicate = apps.find(a =>
          a.company?.toLowerCase() === company.toLowerCase() &&
          a.position?.toLowerCase() === position.toLowerCase()
        );
      }
      return { isDuplicate: !!duplicate, existing: duplicate };
    }
    case 'GET_APP_URL': {
      return { url: APP_URL };
    }
    default:
      return { error: 'Unknown message type' };
  }
}
