// Enso — app entry. Screen routing, today/calendar/insights/settings, all wiring.

import { storage, dt } from './storage.js';
import { generatePlan, planFor, SESSION_META, isRunSession } from './plan.js';
import { renderEnso, ensoGlyph, restGlyph } from './enso-svg.js';
import * as strava from './strava.js';
import * as claude from './claude.js';

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
function showScreen(name) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  const target = $(`#screen-${name}`);
  if (target) target.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === name));
  // render-on-show so data is fresh
  if (name === 'today') renderToday();
  if (name === 'calendar') renderCalendar();
  if (name === 'insights') renderInsights();
  if (name === 'settings') renderSettings();
}

$$('.nav-btn').forEach(b => b.addEventListener('click', () => showScreen(b.dataset.screen)));

// ── First-run setup ──────────────────────────────────────────────
function bindSetup() {
  let daysSel = 3;
  $$('#setup-days button').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#setup-days button').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      daysSel = +btn.dataset.n;
    });
  });
  $('#setup-start').addEventListener('click', () => {
    const phase = $('#setup-phase').value;
    storage.setProfile({
      daysPerWeek: daysSel,
      phase,
      startedOn: dt.today(),
      raceDate: null
    });
    generatePlan(storage.getProfile(), 35);
    document.querySelector('.bottom-nav').classList.remove('hidden');
    showScreen('today');
  });
}

// ── Today screen ──────────────────────────────────────────────────
function renderToday() {
  const today = dt.today();
  const plan = planFor(today);
  const session = storage.getSession(today);

  $('#today-date').textContent = dt.prettyDay(today);

  // hero text
  if (!plan) {
    $('#today-day').textContent = 'A day to show up';
    $('#today-prescription').textContent = '—';
    $('#today-prescription-detail').textContent = '';
  } else if (plan.type === 'rest') {
    $('#today-day').textContent = 'Rest day';
    $('#today-prescription').textContent = 'Today is rest. That is the practice.';
    $('#today-prescription-detail').textContent = '';
  } else {
    const label = SESSION_META[plan.type]?.label || plan.type;
    $('#today-day').textContent = `${label}`;
    $('#today-prescription').textContent = plan.prescription || label;
    $('#today-prescription-detail').textContent = '';
  }

  // enso
  let state;
  if (!plan) state = 'empty';
  else if (plan.type === 'rest') state = 'rest';
  else if (session?.completed) state = 'completed';
  else state = 'outline';
  renderEnso($('#today-enso'), { size: 240, state });

  // why card
  if (plan && plan.why) {
    $('#today-why').textContent = plan.why;
    $('.why-card').style.display = '';
  } else {
    $('.why-card').style.display = 'none';
  }

  // show-up button state
  const btn = $('#btn-show-up');
  const moodRow = $('#mood-row');
  const noteRow = $('#note-row');

  if (!plan || plan.type === 'rest') {
    btn.style.display = 'none';
    moodRow.classList.remove('show');
    noteRow.classList.remove('show');
  } else {
    btn.style.display = '';
    if (session?.completed) {
      btn.textContent = '✓ You showed up';
      btn.classList.add('done');
      moodRow.classList.add('show');
      noteRow.classList.add('show');
      // restore selected mood
      $$('.mood-btn').forEach(b => b.classList.toggle('selected', b.dataset.mood === session.mood));
      $('#note-input').value = session.note || '';
    } else {
      btn.textContent = 'I showed up';
      btn.classList.remove('done');
      moodRow.classList.remove('show');
      noteRow.classList.remove('show');
    }
  }

  // strava nudge
  $('#strava-nudge').style.display = strava.isConnected() ? 'none' : '';
}

function bindToday() {
  $('#btn-show-up').addEventListener('click', () => {
    const today = dt.today();
    const plan = planFor(today);
    if (!plan || plan.type === 'rest') return;
    const session = storage.getSession(today);
    if (session?.completed) {
      // toggle off
      storage.upsertSession(today, { completed: false, completedAt: null, mood: null, note: null, source: null });
    } else {
      storage.upsertSession(today, {
        type: plan.type,
        planned: plan.type,
        completed: true,
        completedAt: new Date().toISOString(),
        source: 'manual'
      });
    }
    renderToday();
  });

  $$('.mood-btn').forEach(b => b.addEventListener('click', () => {
    const today = dt.today();
    $$('.mood-btn').forEach(x => x.classList.remove('selected'));
    b.classList.add('selected');
    storage.upsertSession(today, { mood: b.dataset.mood });
  }));

  $('#note-input').addEventListener('blur', () => {
    const today = dt.today();
    storage.upsertSession(today, { note: $('#note-input').value.trim() || null });
  });

  $('#open-strava-settings').addEventListener('click', e => {
    e.preventDefault();
    showScreen('settings');
  });

  // Claude card (Phase 4: opt-in adaptive)
  $('#claude-dismiss').addEventListener('click', () => $('#claude-card').classList.add('hidden'));
  $('#claude-accept').addEventListener('click', () => {
    const sugg = pendingSuggestions;
    if (sugg?.suggestions) {
      const plan = storage.getPlan();
      sugg.suggestions.forEach(s => {
        if (plan[s.date]) {
          plan[s.date] = { ...plan[s.date], prescription: `${plan[s.date].prescription}\n\nClaude's note: ${s.change} — ${s.reason}`, locked: true };
        }
      });
      storage.setPlan(plan);
    }
    $('#claude-card').classList.add('hidden');
    renderToday();
  });
}

let pendingSuggestions = null;
async function maybeOfferClaudeReview() {
  if (!claude.isConfigured()) return;
  const today = dt.today();
  const session = storage.getSession(today);
  if (!session?.completed) return;
  // only offer once per session
  if (session.claudeReviewed) return;

  const card = $('#claude-card');
  const text = $('#claude-text');
  card.classList.remove('hidden');
  text.textContent = 'Reading your last two weeks…';

  try {
    const result = await claude.suggestAdjustments();
    pendingSuggestions = result;
    if (result.keep_as_is) {
      text.textContent = result.summary || 'Your plan looks right where it should be. Keep going.';
      $('#claude-accept').style.display = 'none';
    } else {
      const lines = [result.summary || ''];
      result.suggestions?.forEach(s => {
        lines.push(`• ${s.date}: ${s.change} — ${s.reason}`);
      });
      text.textContent = lines.join('\n');
      $('#claude-accept').style.display = '';
    }
    storage.upsertSession(today, { claudeReviewed: true });
  } catch (e) {
    text.textContent = `Couldn't reach Claude: ${e.message}`;
  }
}

// ── Calendar ───────────────────────────────────────────────────────
function renderCalendar() {
  const root = $('#calendar-root');
  root.innerHTML = '';
  const today = dt.today();
  const weekStart = dt.startOfWeek(today);

  // render: previous 4 weeks + this week + next 2 weeks = 7 weeks
  for (let w = -4; w <= 2; w++) {
    const wkStart = dt.addDays(weekStart, w * 7);
    const wkDiv = document.createElement('div');
    wkDiv.className = 'cal-week';
    const isCurrent = w === 0;
    const lbl = isCurrent ? 'This week' : (w < 0 ? `${Math.abs(w)} week${Math.abs(w) > 1 ? 's' : ''} ago` : `In ${w} week${w > 1 ? 's' : ''}`);
    wkDiv.innerHTML = `<div class="cal-week-label">${lbl} · ${dt.prettyShort(wkStart)}</div>`;
    const grid = document.createElement('div');
    grid.className = 'cal-grid';

    for (let d = 0; d < 7; d++) {
      const iso = dt.addDays(wkStart, d);
      const plan = planFor(iso);
      const session = storage.getSession(iso);
      const dayEl = document.createElement('button');
      dayEl.className = 'cal-day';
      if (iso === today) dayEl.classList.add('today');
      if (iso > today) dayEl.classList.add('future');

      let glyph;
      let typeLabel = '';
      if (!plan) {
        glyph = ensoGlyph('empty');
      } else if (plan.type === 'rest') {
        glyph = restGlyph();
        dayEl.classList.add('rest');
        typeLabel = 'rest';
      } else if (session?.completed) {
        glyph = ensoGlyph('filled');
        dayEl.classList.add('completed');
        typeLabel = shortLabel(plan.type);
      } else if (iso < today) {
        glyph = ensoGlyph('missed');
        typeLabel = shortLabel(plan.type);
      } else {
        glyph = ensoGlyph('outline');
        typeLabel = shortLabel(plan.type);
      }

      dayEl.innerHTML = `
        <span class="dow">${dt.dow(iso).slice(0,1)}</span>
        ${glyph}
        <span class="session-type">${typeLabel}</span>
      `;
      dayEl.addEventListener('click', () => openDayModal(iso));
      grid.appendChild(dayEl);
    }
    wkDiv.appendChild(grid);
    root.appendChild(wkDiv);
  }
}

function shortLabel(type) {
  return {
    easy_run: 'easy',
    long_run: 'long',
    intervals: 'speed',
    lift_full: 'lift',
    lift_lower: 'lift L',
    lift_upper: 'lift U',
    race: 'race'
  }[type] || '';
}

// ── Day detail modal ──────────────────────────────────────────────
let modalDate = null;
function openDayModal(iso) {
  modalDate = iso;
  const plan = planFor(iso);
  const session = storage.getSession(iso);
  $('#modal-date').textContent = dt.prettyDay(iso);
  $('#modal-title').textContent = plan ? (SESSION_META[plan.type]?.label || plan.type) : 'No session';
  $('#modal-prescription').textContent = plan?.prescription || '';
  $('#modal-why').textContent = plan?.why || '';

  if (session?.completed) {
    const parts = [];
    if (session.distance) parts.push(`${(session.distance / 1000).toFixed(2)} km`);
    if (session.durationSec) parts.push(`${Math.round(session.durationSec / 60)} min`);
    if (session.avgHr) parts.push(`avg ${Math.round(session.avgHr)} bpm`);
    if (session.mood) parts.push(`felt ${session.mood}`);
    $('#modal-actual').textContent = parts.length ? `✓ ${parts.join(' · ')}` : '✓ Completed';
  } else {
    $('#modal-actual').textContent = '';
  }

  $('#day-modal').classList.add('show');
}
function closeDayModal() {
  $('#day-modal').classList.remove('show');
  modalDate = null;
}
function bindModal() {
  $('#modal-close').addEventListener('click', closeDayModal);
  $('#day-modal').addEventListener('click', e => { if (e.target.id === 'day-modal') closeDayModal(); });
  $('#modal-mark-done').addEventListener('click', () => {
    if (!modalDate) return;
    const plan = planFor(modalDate);
    if (!plan) return;
    storage.upsertSession(modalDate, {
      type: plan.type,
      planned: plan.type,
      completed: true,
      completedAt: new Date().toISOString(),
      source: 'manual'
    });
    closeDayModal();
    renderCalendar();
  });
  $('#modal-mark-undone').addEventListener('click', () => {
    if (!modalDate) return;
    storage.upsertSession(modalDate, { completed: false, completedAt: null, source: null });
    closeDayModal();
    renderCalendar();
  });
}

// ── File drop (GPX parsing) ───────────────────────────────────────
function bindFileDrop() {
  $('#file-drop').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const status = $('#file-drop-status');
    status.className = 'status-line';
    status.textContent = 'Reading…';
    try {
      const text = await file.text();
      const result = parseGpx(text);
      if (!result) throw new Error('Not a valid GPX (or .fit not yet supported)');
      const iso = result.date.slice(0, 10);
      const plan = planFor(iso);
      storage.upsertSession(iso, {
        type: plan?.type || 'easy_run',
        planned: plan?.type || null,
        completed: true,
        completedAt: new Date().toISOString(),
        source: 'gpx',
        distance: Math.round(result.distance),
        durationSec: result.durationSec,
        title: file.name
      });
      status.className = 'status-line ok';
      status.textContent = `Added: ${(result.distance/1000).toFixed(2)} km on ${iso}`;
      renderCalendar();
    } catch (err) {
      status.className = 'status-line err';
      status.textContent = err.message;
    }
  });
}

function parseGpx(xmlText) {
  // Very small GPX parser. Sums haversine distance across trkpt entries and reads first/last time.
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const pts = Array.from(doc.getElementsByTagName('trkpt'));
  if (!pts.length) return null;
  let dist = 0;
  let prev = null;
  const times = [];
  for (const p of pts) {
    const lat = parseFloat(p.getAttribute('lat'));
    const lon = parseFloat(p.getAttribute('lon'));
    const t = p.getElementsByTagName('time')[0]?.textContent;
    if (t) times.push(new Date(t));
    if (prev) dist += haversine(prev.lat, prev.lon, lat, lon);
    prev = { lat, lon };
  }
  const start = times[0];
  const end = times[times.length - 1];
  return {
    date: start?.toISOString() || new Date().toISOString(),
    distance: dist,
    durationSec: start && end ? Math.round((end - start) / 1000) : null
  };
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Insights ──────────────────────────────────────────────────────
function renderInsights() {
  const sessions = storage.getSessions();
  const today = dt.today();
  const weekStart = dt.startOfWeek(today);
  const monthStart = today.slice(0, 7) + '-01';

  let monthCount = 0;
  let weekMinutes = 0;
  let streak = 0;

  Object.values(sessions).forEach(s => {
    if (!s.completed) return;
    if (s.date >= monthStart) monthCount++;
    if (s.date >= weekStart) weekMinutes += Math.round((s.durationSec || estDurationFromType(s.type)) / 60);
  });

  // "streak" = consecutive non-missed days starting from today walking back
  // (rest days count; only count up to first explicitly-planned-but-missed day)
  for (let i = 0; i < 60; i++) {
    const iso = dt.addDays(today, -i);
    const p = planFor(iso);
    const s = sessions[iso];
    if (!p) break;
    if (p.type === 'rest') { streak++; continue; }
    if (s?.completed) { streak++; continue; }
    if (iso === today) continue;
    break;
  }

  $('#stat-month').textContent = String(monthCount);
  $('#stat-week').textContent = weekMinutes ? `${weekMinutes}m` : '—';
  $('#stat-streak').textContent = String(streak);

  // reflection
  const refl = storage.latestReflection();
  if (refl) {
    $('#reflection-card').classList.remove('empty');
    $('#reflection-meta').textContent = `Week of ${dt.prettyShort(refl.weekStarting)}`;
    $('#reflection-text').textContent = refl.text;
  } else {
    $('#reflection-card').classList.add('empty');
    $('#reflection-meta').textContent = 'Not yet written';
    $('#reflection-text').textContent = claude.isConfigured()
      ? 'After a few sessions this week, tap Reflect for a quiet read on how it went.'
      : 'Connect Claude in Settings to receive weekly reflections written about your practice.';
  }

  // benefit list
  const list = $('#benefit-list');
  list.innerHTML = '';
  Object.entries(SESSION_META).forEach(([k, m]) => {
    if (k === 'rest' || k === 'race') return;
    const li = document.createElement('li');
    li.innerHTML = `<div class="name">${m.label}</div><div class="why">${m.why}</div>`;
    list.appendChild(li);
  });
}

function estDurationFromType(type) {
  return { easy_run: 35*60, long_run: 60*60, intervals: 45*60, lift_full: 35*60, lift_lower: 35*60, lift_upper: 30*60 }[type] || 30*60;
}

function bindInsights() {
  $('#btn-reflect').addEventListener('click', async () => {
    if (!claude.isConfigured()) {
      alert('Add your Anthropic API key in Settings first.');
      return;
    }
    const btn = $('#btn-reflect');
    btn.disabled = true;
    btn.textContent = 'Reflecting…';
    try {
      const text = await claude.weeklyReflection();
      claude.saveReflection(text);
      renderInsights();
    } catch (e) {
      alert(`Couldn't generate reflection: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Reflect on this week';
    }
  });
}

// ── Settings ──────────────────────────────────────────────────────
function renderSettings() {
  const profile = storage.getProfile();
  if (profile) {
    $('#set-days').value = String(profile.daysPerWeek);
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

  const a = storage.getAnthropic();
  if (a?.apiKey) {
    $('#set-anthropic-key').value = '••••••••••' + a.apiKey.slice(-4);
    $('#anthropic-status').className = 'status-line ok';
    $('#anthropic-status').textContent = 'Key saved.';
  } else {
    $('#anthropic-status').className = 'status-line';
    $('#anthropic-status').textContent = '';
  }
}

function bindSettings() {
  $('#btn-save-profile').addEventListener('click', () => {
    const existing = storage.getProfile() || { startedOn: dt.today() };
    const profile = {
      ...existing,
      daysPerWeek: +$('#set-days').value,
      phase: $('#set-phase').value,
      raceDate: $('#set-race').value || null
    };
    storage.setProfile(profile);
    // wipe non-locked future plan entries so the new template applies
    const plan = storage.getPlan();
    const today = dt.today();
    Object.keys(plan).forEach(k => { if (k >= today && !plan[k].locked) delete plan[k]; });
    storage.setPlan(plan);
    generatePlan(profile, 35);
    $('#profile-status').className = 'status-line ok';
    $('#profile-status').textContent = 'Saved. Calendar updated.';
    setTimeout(() => { $('#profile-status').textContent = ''; }, 2500);
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

  $('#btn-save-anthropic').addEventListener('click', () => {
    const val = $('#set-anthropic-key').value.trim();
    if (!val || val.startsWith('•')) {
      $('#anthropic-status').className = 'status-line err';
      $('#anthropic-status').textContent = 'Paste a key starting with sk-ant-…';
      return;
    }
    storage.setAnthropic({ apiKey: val });
    $('#anthropic-status').className = 'status-line ok';
    $('#anthropic-status').textContent = 'Saved.';
    renderSettings();
  });
  $('#btn-clear-anthropic').addEventListener('click', () => {
    storage.clearAnthropic();
    $('#set-anthropic-key').value = '';
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
    if (!confirm('Reset everything? Practice history, plan, and settings will be cleared on this device.')) return;
    storage.resetAll();
    location.reload();
  });
}

// ── Bootstrap ──────────────────────────────────────────────────────
async function boot() {
  bindSetup();
  bindToday();
  bindModal();
  bindFileDrop();
  bindInsights();
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

  // make sure plan covers next ~5 weeks
  generatePlan(storage.getProfile(), 35);
  document.querySelector('.bottom-nav').classList.remove('hidden');
  showScreen('today');

  // background: sync strava if connected, on app open
  if (strava.isConnected()) {
    strava.sync().then(() => renderToday()).catch(() => {});
  }
}

boot();
