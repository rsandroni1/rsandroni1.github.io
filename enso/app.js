// Enso — app entry. Today / Stats / Train / Journal / Settings.
// Day-flexible: you decide when, where, and what. The app suggests and tracks.

import { storage, dt } from './storage.js';
import { PHASES, SESSION_META, LOGGABLE_TYPES, suggestNext, weekProgress, whyFor } from './plan.js';
import { renderEnso } from './enso-svg.js';
import * as strava from './strava.js';
import { getSuggestions, getWeeklySummaries, formatPace, formatMiles } from './suggestions.js';
import { quoteFor, randomQuote } from './quotes.js';
import { buildTrainingSummary, copyToClipboard } from './claude-export.js';

// ── Service worker ────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ── Element helpers ───────────────────────────────────────────────
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

// ── Screen routing ────────────────────────────────────────────────
const RENDERERS = {
  today: renderToday,
  stats: renderStats,
  train: renderTrain,
  journal: renderJournal,
  settings: renderSettings
};

function showScreen(name) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  const target = $(`#screen-${name}`);
  if (target) target.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === name));
  RENDERERS[name]?.();
}

$$('.nav-btn').forEach(b => b.addEventListener('click', () => showScreen(b.dataset.screen)));

// ── First-run setup ──────────────────────────────────────────────
function bindSetup() {
  let phaseSel = 'build';
  $$('#setup-phase-choice button').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#setup-phase-choice button').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      phaseSel = btn.dataset.phase;
    });
  });
  $('#setup-start').addEventListener('click', () => {
    storage.setProfile({
      phase: phaseSel,
      startedOn: dt.today(),
      raceDate: null
    });
    $('#bottom-nav').classList.remove('hidden');
    showScreen('today');
  });
}

// ── Today screen ──────────────────────────────────────────────────
function renderToday() {
  const today = dt.today();
  const profile = storage.getProfile() || { phase: 'build' };
  const weekStart = dt.startOfWeek(today);
  const progress = weekProgress(weekStart);

  $('#today-date').textContent = dt.prettyDay(today);

  // Enso ring fills proportionally to weekly target completion
  const targets = PHASES[profile.phase].targets;
  const totalTarget = targets.easy_run + targets.long_run + targets.intervals + targets.strength;
  const totalDone = progress.easy_run + progress.long_run + progress.intervals + progress.strength_done;
  const ratio = totalTarget > 0 ? Math.min(1, totalDone / totalTarget) : 0;
  let ensoState = 'outline';
  if (ratio === 0) ensoState = 'outline';
  else if (ratio < 1) ensoState = 'filled';
  else ensoState = 'completed';
  renderEnso($('#today-enso'), { size: 220, state: ensoState });

  // Suggested next
  const next = suggestNext(profile, progress);
  $('#today-day').textContent = next.type
    ? `Today: ${next.label.toLowerCase()}`
    : 'All targets met';
  $('#week-suggested').textContent = next.reason || '';

  // Why this matters — keyed to the suggested next type, or any incomplete target
  const why = next.type ? whyFor(next.type) : whyFor('mobility');
  $('#today-why').textContent = why;

  // Quote of the day (stable per ISO date)
  const q = quoteFor(today);
  $('#quote-text').textContent = `“${q.t}”`;
  $('#quote-author').textContent = q.a;

  // Weekly progress visual
  renderWeekProgress(profile, progress);

  // Log grid
  renderLogGrid();

  // Strava nudge
  $('#strava-nudge').style.display = strava.isConnected() ? 'none' : '';
}

function renderWeekProgress(profile, progress) {
  const root = $('#week-progress');
  const targets = PHASES[profile.phase].targets;
  const rows = [
    { type: 'easy_run', label: 'Easy run', done: progress.easy_run, target: targets.easy_run },
    { type: 'long_run', label: 'Long run', done: progress.long_run, target: targets.long_run },
    { type: 'intervals', label: 'Intervals', done: progress.intervals, target: targets.intervals },
    { type: 'strength', label: 'Strength', done: progress.strength_done, target: targets.strength }
  ].filter(r => r.target > 0);

  root.innerHTML = rows.map(r => {
    const dots = Array.from({ length: r.target }, (_, i) => {
      const filled = i < r.done;
      return `<span class="dot ${filled ? 'on' : ''}"></span>`;
    }).join('');
    const extra = r.done > r.target ? `<span class="dot on extra">+${r.done - r.target}</span>` : '';
    return `
      <div class="week-row">
        <div class="week-row-label">${r.label}</div>
        <div class="week-row-dots">${dots}${extra}</div>
        <div class="week-row-count">${r.done}/${r.target}</div>
      </div>`;
  }).join('');
}

function renderLogGrid() {
  const grid = $('#log-grid');
  const tiles = LOGGABLE_TYPES.map(type => {
    const meta = SESSION_META[type];
    return `
      <button class="log-tile" data-type="${type}">
        <span class="log-tile-label">${meta.short}</span>
        <span class="log-tile-sub">${meta.label}</span>
      </button>`;
  }).join('');
  grid.innerHTML = tiles;
  $$('#log-grid .log-tile').forEach(b => b.addEventListener('click', () => openLogModal(b.dataset.type)));
}

function bindToday() {
  $('#open-strava-settings').addEventListener('click', e => {
    e.preventDefault();
    showScreen('settings');
  });

  $('#quote-shuffle').addEventListener('click', () => {
    const q = randomQuote();
    $('#quote-text').textContent = `“${q.t}”`;
    $('#quote-author').textContent = q.a;
  });
}

// ── Log modal ──────────────────────────────────────────────────────
let logModalType = null;
function openLogModal(type) {
  logModalType = type;
  const meta = SESSION_META[type];
  $('#log-modal-title').textContent = meta.label;
  $('#log-modal-why').textContent = meta.why;
  $('#log-date').value = dt.today();
  $('#log-thoughts').value = '';
  $('#log-modal').classList.add('show');
}
function closeLogModal() {
  $('#log-modal').classList.remove('show');
  logModalType = null;
}
function bindLogModal() {
  $('#log-cancel').addEventListener('click', closeLogModal);
  $('#log-modal').addEventListener('click', e => { if (e.target.id === 'log-modal') closeLogModal(); });
  $('#log-save').addEventListener('click', () => {
    if (!logModalType) return;
    const iso = $('#log-date').value || dt.today();
    const thoughts = $('#log-thoughts').value.trim();
    storage.upsertSession(iso, {
      type: logModalType,
      completed: true,
      completedAt: new Date().toISOString(),
      source: 'manual'
    });
    if (thoughts) {
      storage.addJournalEntry({ date: iso, sessionType: logModalType, thoughts });
    }
    closeLogModal();
    renderToday();
  });
}

// ── Stats ─────────────────────────────────────────────────────────
function renderStats() {
  const weeks = getWeeklySummaries(8);
  const thisWeek = weeks[0] || { miles: 0, longestMi: 0, runs: [] };

  // This month: sum weeks whose start is within the current month
  const today = dt.today();
  const monthPrefix = today.slice(0, 7);
  let monthMi = 0;
  for (const w of weeks) {
    for (const r of w.runs) {
      if (r.iso.startsWith(monthPrefix)) monthMi += r.miles;
    }
  }

  // Avg pace across last 4 weeks of easy + long runs
  const recentEasyLong = weeks.slice(0, 4).flatMap(w => w.runs).filter(r => r.pace && (r.type === 'easy_run' || r.type === 'long_run'));
  const avgPace = recentEasyLong.length
    ? recentEasyLong.reduce((s, r) => s + r.pace, 0) / recentEasyLong.length
    : null;

  $('#stat-week-miles').textContent = formatMiles(thisWeek.miles);
  $('#stat-month-miles').textContent = formatMiles(monthMi);
  $('#stat-longest').textContent = thisWeek.longestMi > 0 ? formatMiles(thisWeek.longestMi) : '—';
  $('#stat-avg-pace').textContent = formatPace(avgPace);

  // Weekly bars (last 8 weeks, oldest first for chart reading L-to-R)
  const ordered = [...weeks].reverse();
  const maxMi = Math.max(1, ...ordered.map(w => w.miles));
  $('#weekly-bars').innerHTML = ordered.map(w => {
    const h = Math.round((w.miles / maxMi) * 100);
    const label = dt.prettyShort(w.start);
    return `
      <div class="weekly-bar">
        <div class="weekly-bar-fill" style="height: ${h}%"></div>
        <div class="weekly-bar-value">${formatMiles(w.miles)}</div>
        <div class="weekly-bar-label">${label}</div>
      </div>`;
  }).join('');

  // Recent runs list (last 2 weeks, newest first)
  const recent = weeks.slice(0, 2).flatMap(w => w.runs).sort((a, b) => a.iso < b.iso ? 1 : -1).slice(0, 15);
  $('#run-list').innerHTML = recent.length
    ? recent.map(r => {
        const elev = r.elevM > 0 ? `<span class="run-elev">+${Math.round(r.elevM * 3.28084)} ft</span>` : '';
        return `
          <li class="run-row">
            <div class="run-date">${dt.prettyShort(r.iso)}</div>
            <div class="run-meta">
              <div class="run-type">${SESSION_META[r.type]?.label || r.type}</div>
              <div class="run-numbers">${formatMiles(r.miles)} mi · ${formatPace(r.pace)} ${elev}</div>
            </div>
          </li>`;
      }).join('')
    : '<li class="muted">No runs yet. Once Strava syncs, runs land here automatically.</li>';
}

// ── Train ─────────────────────────────────────────────────────────
function renderTrain() {
  // Suggestions
  const sug = getSuggestions();
  const root = $('#suggestions-root');
  if (sug.length === 0) {
    root.innerHTML = '<p class="muted">No flags right now. Trust the rhythm.</p>';
  } else {
    root.innerHTML = sug.map(s => `
      <div class="suggestion-card">
        <div class="suggestion-head">
          <span class="suggestion-icon">${s.icon}</span>
          <h4>${s.headline}</h4>
        </div>
        <p class="suggestion-detail">${s.detail}</p>
        <p class="suggestion-action">${s.action}</p>
      </div>
    `).join('');
  }

  // Saved strategies
  renderStrategyList();
}

function renderStrategyList() {
  const list = $('#strategy-list');
  const items = storage.getStrategies();
  if (!items.length) {
    list.innerHTML = '<li class="muted">Nothing saved yet. After a Claude conversation, paste the strategy above and save it.</li>';
    return;
  }
  list.innerHTML = items.map(s => `
    <li class="strategy-row" data-id="${s.id}">
      <div class="strategy-row-head">
        <div>
          <div class="strategy-title">${escapeHtml(s.title)}</div>
          <div class="strategy-date">${new Date(s.savedAt).toLocaleDateString()}</div>
        </div>
        <button class="link-btn danger small" data-action="delete-strategy" data-id="${s.id}">delete</button>
      </div>
      <pre class="strategy-body">${escapeHtml(s.body)}</pre>
    </li>
  `).join('');
}

function bindTrain() {
  $('#btn-gen-summary').addEventListener('click', () => {
    const text = buildTrainingSummary({ weeks: 6 });
    $('#summary-text').value = text;
    $('#btn-copy-summary').disabled = false;
  });
  $('#btn-copy-summary').addEventListener('click', async () => {
    const text = $('#summary-text').value;
    if (!text) return;
    const btn = $('#btn-copy-summary');
    const original = btn.textContent;
    const ok = await copyToClipboard(text);
    btn.textContent = ok ? 'Copied!' : 'Press ⌘C';
    setTimeout(() => { btn.textContent = original; }, 1800);
  });
  $('#btn-save-strategy').addEventListener('click', () => {
    const title = $('#strategy-title').value;
    const body = $('#strategy-body').value;
    if (!body.trim()) {
      flash('#strategy-status', 'Paste a strategy first.', 'err');
      return;
    }
    storage.addStrategy({ title, body });
    $('#strategy-title').value = '';
    $('#strategy-body').value = '';
    flash('#strategy-status', 'Saved.', 'ok');
    renderStrategyList();
  });

  // delete strategy via delegation
  $('#strategy-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-action="delete-strategy"]');
    if (!btn) return;
    storage.deleteStrategy(btn.dataset.id);
    renderStrategyList();
  });
}

// ── Journal ───────────────────────────────────────────────────────
function renderJournal() {
  const list = $('#journal-list');
  const entries = storage.getJournal();
  if (!entries.length) {
    list.innerHTML = '<li class="muted">No entries yet. What were you turning over today?</li>';
    return;
  }
  list.innerHTML = entries.map(e => {
    const tag = e.sessionType ? `<span class="journal-tag">${SESSION_META[e.sessionType]?.short || e.sessionType}</span>` : '';
    return `
      <li class="journal-row" data-id="${e.id}">
        <div class="journal-row-head">
          <div class="journal-date">${dt.prettyShort(e.date)} ${tag}</div>
          <button class="link-btn danger small" data-action="delete-journal" data-id="${e.id}">delete</button>
        </div>
        <p class="journal-thoughts">${escapeHtml(e.thoughts)}</p>
      </li>`;
  }).join('');
}

function bindJournal() {
  $('#btn-save-journal').addEventListener('click', () => {
    const thoughts = $('#journal-input').value;
    if (!thoughts.trim()) {
      flash('#journal-status', 'Write something first.', 'err');
      return;
    }
    const sessionType = $('#journal-session-type').value || null;
    storage.addJournalEntry({ date: dt.today(), sessionType, thoughts });
    $('#journal-input').value = '';
    $('#journal-session-type').value = '';
    flash('#journal-status', 'Saved.', 'ok');
    renderJournal();
  });
  $('#journal-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-action="delete-journal"]');
    if (!btn) return;
    storage.deleteJournalEntry(btn.dataset.id);
    renderJournal();
  });
}

// ── Settings ──────────────────────────────────────────────────────
function renderSettings() {
  const profile = storage.getProfile();
  if (profile) {
    $('#set-phase').value = profile.phase;
    $('#set-race').value = profile.raceDate || '';
  }
  const s = storage.getStrava();
  if (s) {
    $('#set-strava-client-id').value = s.clientId || '';
    $('#set-strava-client-secret').value = s.clientSecret || '';
    if (strava.isConnected()) {
      const last = storage.getLastSync().strava;
      $('#strava-status').className = 'status-line ok';
      $('#strava-status').textContent = `Connected. Last sync: ${last ? new Date(last * 1000).toLocaleString() : 'never'}`;
    } else {
      $('#strava-status').className = 'status-line';
      $('#strava-status').textContent = '';
    }
  }
  $('#strava-callback-domain').textContent = location.hostname;
}

function bindSettings() {
  $('#btn-save-profile').addEventListener('click', () => {
    const existing = storage.getProfile() || { startedOn: dt.today() };
    storage.setProfile({
      ...existing,
      phase: $('#set-phase').value,
      raceDate: $('#set-race').value || null
    });
    flash('#profile-status', 'Saved.', 'ok');
  });

  $('#btn-strava-connect').addEventListener('click', () => {
    try {
      strava.beginAuth($('#set-strava-client-id').value.trim(), $('#set-strava-client-secret').value.trim());
    } catch (e) {
      $('#strava-status').className = 'status-line err';
      $('#strava-status').textContent = e.message;
    }
  });
  $('#btn-strava-sync').addEventListener('click', async () => {
    const status = $('#strava-status');
    status.className = 'status-line';
    status.textContent = 'Syncing…';
    try {
      const r = await strava.sync();
      status.className = 'status-line ok';
      status.textContent = `Synced ${r.total} activities, matched ${r.matched}.`;
    } catch (e) {
      status.className = 'status-line err';
      status.textContent = e.message;
    }
  });
  $('#btn-strava-disconnect').addEventListener('click', () => {
    strava.disconnect();
    renderSettings();
  });

  $('#btn-export').addEventListener('click', () => {
    const data = storage.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `enso-${dt.today()}.json`;
    a.click();
  });
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('Reset everything? Practice history, journal, and settings will be cleared on this device.')) return;
    storage.resetAll();
    location.reload();
  });
}

// ── Utilities ─────────────────────────────────────────────────────
function flash(sel, msg, kind = 'ok') {
  const el = $(sel);
  if (!el) return;
  el.className = `status-line ${kind}`;
  el.textContent = msg;
  setTimeout(() => { el.textContent = ''; el.className = 'status-line'; }, 2200);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Bootstrap ──────────────────────────────────────────────────────
async function boot() {
  bindSetup();
  bindToday();
  bindLogModal();
  bindTrain();
  bindJournal();
  bindSettings();

  // handle Strava OAuth redirect if present
  try {
    if (new URLSearchParams(location.search).get('code')) {
      await strava.handleAuthCallback();
    }
  } catch (e) {
    console.warn('Strava auth callback failed:', e);
  }

  if (!storage.hasProfile()) {
    showScreen('setup');
    return;
  }

  $('#bottom-nav').classList.remove('hidden');
  showScreen('today');

  // background: sync strava if connected, on app open
  if (strava.isConnected()) {
    strava.sync().then(() => {
      // re-render whichever screen is currently visible
      const active = $('.screen.active')?.id?.replace('screen-', '');
      if (active && RENDERERS[active]) RENDERERS[active]();
    }).catch(() => {});
  }
}

boot();
