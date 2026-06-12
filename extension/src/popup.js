// Patterns that count as "job pages" — same as manifest content_scripts matches
const JOB_PATTERNS = [
  /linkedin\.com\/jobs\/view\//,
  /indeed\.com\/viewjob/,
  /glassdoor\.com\/job-listing\//,
  /greenhouse\.io\/jobs\//,
  /lever\.co\/.+\/(jobs|apply)\//,
  /workday\.com\/.+\/job\//,
  /myworkdayjobs\.com\/.+\/job\//,
  /app\.joinhandshake\.com\/jobs\//
];

function isJobPage(url) {
  return url && JOB_PATTERNS.some(p => p.test(url));
}

function detectSource(url) {
  if (!url) return 'Job Board';
  if (url.includes('linkedin'))    return 'LinkedIn';
  if (url.includes('indeed'))      return 'Indeed';
  if (url.includes('glassdoor'))   return 'Glassdoor';
  if (url.includes('greenhouse'))  return 'Greenhouse';
  if (url.includes('lever'))       return 'Lever';
  if (url.includes('workday') || url.includes('myworkdayjobs')) return 'Workday';
  if (url.includes('joinhandshake'))  return 'Handshake';
  return 'Job Board';
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showHeader(userName) {
  const h = document.getElementById('header');
  h.style.display = 'flex';
}

// ── Main flow ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Check auth
  let session = null;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_SESSION' });
    session = res?.session;
  } catch (_) {}

  if (!session) {
    showScreen('screen-signin');
    return;
  }

  showHeader();

  // Sign out link
  document.getElementById('header-signout').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'SIGN_OUT' });
    document.getElementById('header').style.display = 'none';
    showScreen('screen-signin');
  });

  // 2. Get current tab
  let tab = null;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_) {}

  const url    = tab?.url || '';
  const tabId  = tab?.id  || null;

  if (!isJobPage(url)) {
    showScreen('screen-notjob');
    document.getElementById('btn-check-anyway').addEventListener('click', () => runExtraction(url, tabId));
    return;
  }

  // Check if content script already extracted data for this page — show form instantly if so
  try {
    const cachedRes = await chrome.runtime.sendMessage({ type: 'GET_CACHED_JOB', url });
    if (cachedRes?.data) {
      populateAndShowForm(cachedRes.data, url);
      return;
    }
  } catch (_) {}

  await runExtraction(url, tabId);
});

function populateAndShowForm(extracted, url) {
  const source = detectSource(url);
  const jobDescription = extracted.jobDescription || '';
  document.getElementById('f-company').value  = extracted.company  || '';
  document.getElementById('f-position').value = extracted.position || '';
  document.getElementById('f-location').value = extracted.location || '';
  document.getElementById('f-salary').value   = extracted.salary   || '';
  document.getElementById('f-source').value   = source;
  document.getElementById('f-jd').value       = jobDescription;
  const charCount = document.getElementById('jd-char-count');
  if (charCount) charCount.textContent = jobDescription.length ? `${jobDescription.length} chars` : 'not found';
  showScreen('screen-form');

  document.getElementById('btn-reject').addEventListener('click', () => window.close());

  let dupConfirmed = false;
  document.getElementById('btn-accept').addEventListener('click', async () => {
    const acceptBtn = document.getElementById('btn-accept');

    if (!dupConfirmed) {
      acceptBtn.disabled = true;
      acceptBtn.innerHTML = '<div class="btn-spinner"></div>';

      const company  = document.getElementById('f-company').value.trim();
      const position = document.getElementById('f-position').value.trim();
      const dupRes = await chrome.runtime.sendMessage({ type: 'CHECK_DUPLICATE', jobUrl: url, company, position });

      if (dupRes?.isDuplicate) {
        const ex = dupRes.existing;
        document.getElementById('dup-warning').style.display = 'block';
        document.getElementById('dup-warning-detail').textContent =
          `"${ex.company} — ${ex.position}" is already in your tracker. Press Accept again to add anyway.`;
        acceptBtn.disabled = false;
        acceptBtn.textContent = 'Add Anyway';
        dupConfirmed = true;
        return;
      }
      acceptBtn.disabled = false;
    }

    acceptBtn.disabled = true;
    acceptBtn.innerHTML = '<div class="btn-spinner"></div> Saving…';

    const jobData = {
      company:         document.getElementById('f-company').value.trim()  || 'Unknown',
      position:        document.getElementById('f-position').value.trim() || 'Unknown',
      location:        document.getElementById('f-location').value.trim() || '',
      salary:          document.getElementById('f-salary').value.trim()   || '',
      job_url:         url,
      job_description: document.getElementById('f-jd').value.trim() || jobDescription,
      source,
      status:          'Applied',
      date_applied:    new Date().toISOString().split('T')[0],
      referral:        'No',
      timeline:        [{ status: 'Applied', ts: Date.now() }]
    };

    let saveRes = null;
    try {
      saveRes = await chrome.runtime.sendMessage({ type: 'SAVE_JOB', jobData });
      if (saveRes?.error) throw new Error(saveRes.error);
    } catch (e) {
      acceptBtn.disabled = false;
      acceptBtn.textContent = 'Accept';
      document.getElementById('error-msg').textContent = e.message || 'Save failed. Try again.';
      showScreen('screen-error');
      document.getElementById('btn-retry').addEventListener('click', () => window.location.reload());
      return;
    }

    // Success
    const company  = jobData.company !== 'Unknown' ? jobData.company : '';
    const position = jobData.position !== 'Unknown' ? jobData.position : '';
    const detail   = [position, company].filter(Boolean).join(' at ');
    document.getElementById('success-detail').textContent = detail || 'Job saved.';
    showHeader();
    showScreen('screen-success');
  });
}

async function runExtraction(url, tabId) {
  showScreen('screen-loading');

  // Grab the full rendered page text directly from the tab (authenticated, JS-rendered).
  // This is the key to getting the job description — server-side fetches miss auth-gated content.
  let pageText = null;
  if (tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.body.innerText
      });
      pageText = results?.[0]?.result || null;
    } catch (_) {}
  }

  let extracted = null;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'EXTRACT_JOB', url, pageText });
    if (res?.error) throw new Error(res.error);
    extracted = res?.data || {};
  } catch (e) {
    document.getElementById('error-msg').textContent = e.message || 'Could not extract job data. Make sure the API server is running.';
    showScreen('screen-error');
    document.getElementById('btn-retry').addEventListener('click', () => window.location.reload());
    return;
  }

  populateAndShowForm(extracted, url);
}

// ── Sign in ───────────────────────────────────────────────────────────────────

document.getElementById('btn-signin').addEventListener('click', async () => {
  const btn = document.getElementById('btn-signin');
  const err = document.getElementById('signin-error');
  err.style.display = 'none';
  btn.disabled = true;
  btn.innerHTML = '<div style="width:14px;height:14px;border:2px solid #ffffff30;border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;flex-shrink:0"></div> Signing in…';

  try {
    const res = await chrome.runtime.sendMessage({ type: 'SIGN_IN' });
    if (res?.error) throw new Error(res.error);
    // Reload the popup to kick off the main flow with the new session
    window.location.reload();
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Sign in with Google`;
    err.style.display = 'block';
    err.textContent = e.message || 'Sign in failed. Try again.';
  }
});
