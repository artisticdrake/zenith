(function () {
  'use strict';

  // Prevent double-injection (MV3 safety)
  if (window.__jtInjected) return;
  window.__jtInjected = true;

  // Monotonic request counter — stale async results bail out when myId !== requestId
  let requestId = 0;
  // SPA navigation debounce timer
  let navTimer = null;

  function detectSource() {
    const h = location.hostname;
    if (h.includes('linkedin'))                              return 'LinkedIn';
    if (h.includes('indeed'))                               return 'Indeed';
    if (h.includes('glassdoor'))                            return 'Glassdoor';
    if (h.includes('greenhouse'))                           return 'Greenhouse';
    if (h.includes('lever'))                                return 'Lever';
    if (h.includes('workday') || h.includes('myworkdayjobs')) return 'Workday';
    if (h.includes('joinhandshake'))                        return 'Handshake';
    return 'Job Board';
  }

  // ── Panel helpers ─────────────────────────────────────────────────────────

  const PANEL_ID = 'jt-ext-panel';

  function getPanel()    { return document.getElementById(PANEL_ID); }
  function removePanel() { const el = getPanel(); if (el) el.remove(); }

  function createPanel() {
    const el = document.createElement('div');
    el.id = PANEL_ID;
    Object.assign(el.style, {
      position:     'fixed',
      bottom:       '24px',
      right:        '24px',
      width:        '310px',
      background:   '#0a0f1e',
      border:       '1px solid #1e293b',
      borderRadius: '12px',
      boxShadow:    '0 8px 32px rgba(0,0,0,0.65)',
      zIndex:       '2147483647',
      fontFamily:   "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      color:        '#f8fafc',
      overflow:     'hidden',
      transition:   'transform 0.25s ease, opacity 0.25s ease',
    });
    document.body.appendChild(el);
    return el;
  }

  function panelHeader(colorDot, source, showClose) {
    return `
      <div style="padding:12px 14px;background:#121d3a;border-bottom:1px solid #1e293b;display:flex;align-items:center;gap:9px;">
        <div style="width:8px;height:8px;border-radius:50%;background:${colorDot};flex-shrink:0;"></div>
        <span style="font-size:13px;font-weight:700;color:#f8fafc;flex:1;">Job Tracker</span>
        ${source ? `<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:999px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);color:#818cf8;">${source}</span>` : ''}
        ${showClose ? `<button id="jt-close" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:20px;line-height:1;padding:0 2px;margin-left:2px;">×</button>` : ''}
      </div>`;
  }

  function attachClose(el) {
    const btn = el.querySelector('#jt-close');
    if (btn) btn.addEventListener('click', () => dismissPanel(el));
  }

  function dismissPanel(el) {
    try { sessionStorage.setItem('jt-dismissed-' + location.href, '1'); } catch (_) {}
    el.style.opacity = '0';
    el.style.transform = 'translateX(340px)';
    setTimeout(() => el.remove(), 260);
  }

  // ── Render states ─────────────────────────────────────────────────────────

  function renderLoading(el) {
    el.innerHTML = `
      ${panelHeader('#6366f1', '', true)}
      <div style="padding:14px 16px;">
        <div style="font-size:11px;color:#64748b;margin-bottom:12px;letter-spacing:0.3px;">Extracting job details…</div>
        ${['Company','Position','Location','Salary'].map(f => `
          <div style="margin-bottom:10px;">
            <div style="font-size:10px;color:#475569;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">${f}</div>
            <div style="height:30px;background:#1e293b;border-radius:6px;
              background:linear-gradient(90deg,#1e293b 25%,#263348 50%,#1e293b 75%);
              background-size:200% 100%;animation:jt-shimmer 1.4s infinite;"></div>
          </div>`).join('')}
        <style>
          #${PANEL_ID} { animation: jt-fadein 0.2s ease; }
          @keyframes jt-fadein   { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
          @keyframes jt-shimmer  { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        </style>
      </div>`;
    attachClose(el);
  }

  function renderReady(el, data) {
    // Store the full extracted payload so handleSave can access JD without re-querying
    el.__jtExtracted = data;

    const source = detectSource();
    const val = (v) => (v || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const jdLen = (data.jobDescription || '').length;

    el.innerHTML = `
      ${panelHeader('#6366f1', source, true)}
      <div style="padding:12px 14px;">
        ${[['Company','company'],['Position','position'],['Location','location'],['Salary','salary']].map(([label, key]) => `
          <div style="margin-bottom:9px;">
            <div style="font-size:10px;color:#475569;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
            <input id="jt-${key}" type="text" value="${val(data[key])}" placeholder="${label}"
              style="width:100%;box-sizing:border-box;padding:7px 10px;background:#0a0f1e;border:1px solid #334155;border-radius:6px;color:#f8fafc;font-size:12px;outline:none;font-family:inherit;" />
          </div>`).join('')}
        ${jdLen > 0
          ? `<div style="font-size:10px;color:#475569;margin-bottom:10px;display:flex;align-items:center;gap:5px;">
               <span style="width:6px;height:6px;border-radius:50%;background:#10b981;display:inline-block;"></span>
               Job description captured (${jdLen} chars)
             </div>`
          : `<div style="font-size:10px;color:#64748b;margin-bottom:10px;">No job description found — add one in the app.</div>`
        }
        <div id="jt-err" style="display:none;color:#f87171;font-size:11px;margin-bottom:8px;"></div>
        <button id="jt-save"
          style="width:100%;padding:10px;background:#6366f1;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:700;cursor:pointer;margin-bottom:7px;display:flex;align-items:center;justify-content:center;gap:7px;">
          Save to Job Tracker
        </button>
        <button id="jt-dismiss2"
          style="width:100%;padding:8px;background:transparent;border:1px solid #1e293b;border-radius:8px;color:#64748b;font-size:12px;cursor:pointer;">
          Dismiss
        </button>
      </div>`;
    attachClose(el);
    el.querySelector('#jt-dismiss2').addEventListener('click', () => dismissPanel(el));
    el.querySelector('#jt-save').addEventListener('click', () => handleSave(el, source));
  }

  function renderAlreadyTracked(el, existing) {
    const source = detectSource();
    const label = [existing?.position, existing?.company].filter(Boolean).join(' · ') || 'This job';
    el.innerHTML = `
      ${panelHeader('#10b981', source, true)}
      <div style="padding:18px 16px;text-align:center;">
        <div style="font-size:28px;margin-bottom:6px;">✓</div>
        <div style="font-size:13px;font-weight:700;color:#10b981;margin-bottom:4px;">Already in your tracker</div>
        <div style="font-size:11px;color:#64748b;margin-bottom:14px;line-height:1.5;">${label}</div>
        <button id="jt-nudge-dismiss"
          style="padding:8px 16px;background:transparent;border:1px solid #334155;border-radius:8px;color:#94a3b8;font-size:12px;cursor:pointer;">
          Dismiss
        </button>
      </div>`;
    attachClose(el);
    el.querySelector('#jt-nudge-dismiss').addEventListener('click', () => dismissPanel(el));
    // Auto-dismiss after 4s — it's just an informational nudge
    setTimeout(() => { if (el.isConnected) dismissPanel(el); }, 4000);
  }

  function renderNotConnected(el) {
    el.innerHTML = `
      ${panelHeader('#334155', '', true)}
      <div style="padding:20px 16px;text-align:center;">
        <div style="font-size:12px;color:#64748b;margin-bottom:14px;line-height:1.5;">
          Sign in to Job Tracker to auto-save postings as you browse.
        </div>
        <button id="jt-nudge-dismiss"
          style="padding:8px 16px;background:transparent;border:1px solid #334155;border-radius:8px;color:#94a3b8;font-size:12px;cursor:pointer;">
          Dismiss
        </button>
      </div>`;
    attachClose(el);
    el.querySelector('#jt-nudge-dismiss').addEventListener('click', () => dismissPanel(el));
  }

  function renderSaved(el) {
    el.innerHTML = `
      ${panelHeader('#10b981', '', false)}
      <div style="padding:24px 16px;text-align:center;">
        <div style="font-size:32px;color:#10b981;margin-bottom:8px;line-height:1;">✓</div>
        <div style="font-size:14px;font-weight:700;color:#10b981;margin-bottom:4px;">Saved!</div>
        <div style="font-size:12px;color:#64748b;">Job added to your tracker</div>
      </div>`;
    setTimeout(() => dismissPanel(el), 2200);
  }

  function showFormError(el, msg) {
    const errEl = el.querySelector('#jt-err');
    if (errEl) { errEl.style.display = 'block'; errEl.textContent = msg; }
  }

  // ── Save handler ──────────────────────────────────────────────────────────

  async function handleSave(el, source) {
    const get = (id) => (el.querySelector(`#jt-${id}`)?.value || '').trim();
    const company     = get('company');
    const position    = get('position');
    const locationVal = get('location');
    const salary      = get('salary');

    if (!company && !position) {
      showFormError(el, 'Enter at least a company or position name.');
      return;
    }

    const saveBtn = el.querySelector('#jt-save');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = `
        <span style="width:13px;height:13px;border:2px solid #ffffff40;border-top-color:#fff;border-radius:50%;display:inline-block;animation:jt-spin 0.7s linear infinite;"></span>
        Saving…
        <style>@keyframes jt-spin{to{transform:rotate(360deg)}}</style>`;
    }

    // Include job description from the original extraction (not shown in editable fields)
    const extracted = el.__jtExtracted || {};

    const jobData = {
      company:         company     || 'Unknown',
      position:        position    || 'Unknown',
      location:        locationVal || '',
      salary:          salary      || '',
      job_url:         window.location.href,
      job_description: extracted.jobDescription || '',
      source,
      status:          'Applied',
      date_applied:    new Date().toISOString().split('T')[0],
      referral:        'No',
      timeline:        [{ status: 'Applied', ts: Date.now() }]
    };

    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: 'SAVE_JOB', jobData });
    } catch (_) {
      if (el.isConnected) {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save to Job Tracker'; }
        showFormError(el, 'Extension disconnected. Please try again.');
      }
      return;
    }

    if (!el.isConnected) return;

    if (response?.error) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save to Job Tracker'; }
      showFormError(el, response.error);
      return;
    }

    renderSaved(el);
  }

  // ── Main init ─────────────────────────────────────────────────────────────

  async function init() {
    // Skip if user already dismissed this URL in this session
    try {
      if (sessionStorage.getItem('jt-dismissed-' + location.href)) return;
    } catch (_) {}

    requestId++;
    const myId = requestId;

    removePanel();
    const el = createPanel();

    // ── 1. Auth check (fast — reads from local storage via background) ──────
    let session = null;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'GET_SESSION' });
      if (myId !== requestId || !el.isConnected) return;
      session = result?.session;
    } catch (_) {
      el.remove();
      return;
    }

    if (!session) {
      renderNotConnected(el);
      return;
    }

    // ── 2. Duplicate check (fast — reads from API cache) ───────────────────
    // Do this BEFORE starting the 10-15s AI extraction so we don't waste a
    // call on a job the user already has in their tracker.
    try {
      const dupRes = await chrome.runtime.sendMessage({
        type: 'CHECK_DUPLICATE',
        jobUrl: location.href,
      });
      if (myId !== requestId || !el.isConnected) return;
      if (dupRes?.isDuplicate) {
        renderAlreadyTracked(el, dupRes.existing);
        return;
      }
    } catch (_) {
      // Non-fatal — proceed without duplicate check
    }

    // ── 3. Show loading skeleton while AI extracts ──────────────────────────
    renderLoading(el);

    // Trim pageText to avoid sending huge payloads (15k chars is plenty for JD extraction)
    const pageText = document.body.innerText.slice(0, 15000);

    let response = null;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'EXTRACT_JOB',
        url: location.href,
        pageText,
      });
    } catch (_) {
      if (el.isConnected) {
        renderReady(el, {});
        showFormError(el, 'Could not reach Job Tracker API. Is the server running?');
      }
      return;
    }

    if (myId !== requestId || !el.isConnected) return;

    if (response?.error) {
      renderReady(el, {});
      showFormError(el, response.error);
      return;
    }

    renderReady(el, response.data || {});
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  init();

  // SPA navigation (LinkedIn, Indeed, Handshake all use client-side routing)
  // Debounce: wait 1500ms after the URL settles so the new job content has time
  // to render before we grab pageText.
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    clearTimeout(navTimer);
    navTimer = setTimeout(init, 1500);
  }).observe(document, { subtree: true, childList: true });

})();
