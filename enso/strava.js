// Strava OAuth + activity sync. Personal-app pattern: user creates their own
// Strava API app and stores client_id/secret in localStorage. The "secret"
// only sits on the user's own device — security-acceptable for a single-user PWA.

import { storage, dt } from './storage.js';
import { classifyRun } from './plan.js';

const AUTH_URL  = 'https://www.strava.com/oauth/authorize';
const TOKEN_URL = 'https://www.strava.com/api/v3/oauth/token';
const ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities';

const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);

export function redirectUri() {
  return location.origin + location.pathname;
}

export function isConnected() {
  const s = storage.getStrava();
  return !!(s && s.refreshToken);
}

export function beginAuth(clientId, clientSecret) {
  if (!clientId || !clientSecret) throw new Error('Need client ID and secret first');
  // store credentials before redirecting away
  const existing = storage.getStrava() || {};
  storage.setStrava({ ...existing, clientId, clientSecret });

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    approval_prompt: 'auto',
    scope: 'read,activity:read_all'
  });
  location.href = `${AUTH_URL}?${params}`;
}

// Detect ?code=... on page load and exchange for tokens
export async function handleAuthCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return false;

  const s = storage.getStrava() || {};
  if (!s.clientId || !s.clientSecret) {
    cleanUrl();
    throw new Error('Missing Strava client credentials');
  }

  const body = new URLSearchParams({
    client_id: s.clientId,
    client_secret: s.clientSecret,
    code,
    grant_type: 'authorization_code'
  });

  const resp = await fetch(TOKEN_URL, { method: 'POST', body });
  if (!resp.ok) {
    cleanUrl();
    throw new Error(`Token exchange failed: ${resp.status}`);
  }
  const data = await resp.json();
  storage.setStrava({
    ...s,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
    athleteId: data.athlete?.id
  });
  cleanUrl();
  return true;
}

function cleanUrl() {
  history.replaceState({}, '', location.pathname);
}

async function ensureFreshToken() {
  const s = storage.getStrava();
  if (!s?.refreshToken) throw new Error('Not connected');
  const now = Math.floor(Date.now() / 1000);
  if (s.accessToken && s.expiresAt && s.expiresAt - now > 60) return s.accessToken;

  const body = new URLSearchParams({
    client_id: s.clientId,
    client_secret: s.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: s.refreshToken
  });
  const resp = await fetch(TOKEN_URL, { method: 'POST', body });
  if (!resp.ok) throw new Error(`Refresh failed: ${resp.status}`);
  const data = await resp.json();
  storage.setStrava({
    ...s,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at
  });
  return data.access_token;
}

// Sync new activities. Returns { matched, total, errors }.
export async function sync(opts = {}) {
  const token = await ensureFreshToken();
  const lastSync = storage.getLastSync();
  // pull a generous window so first-time sync gets the last 30 days
  const after = opts.afterEpoch ?? (lastSync.strava || Math.floor((Date.now() - 30 * 86400 * 1000) / 1000));

  const url = `${ACTIVITIES_URL}?after=${after}&per_page=30`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Activities fetch failed: ${resp.status}`);
  const activities = await resp.json();

  let matched = 0;
  for (const act of activities) {
    if (!RUN_TYPES.has(act.type)) continue;
    const startIso = act.start_date_local.slice(0, 10);
    const existing = storage.getSession(startIso);
    // skip if already manually logged for this day from a non-Strava source
    if (existing?.completed && existing?.source !== 'strava') continue;

    const inferredType = classifyRun(act.distance, act.moving_time);
    storage.upsertSession(startIso, {
      type: inferredType,
      completed: true,
      completedAt: new Date().toISOString(),
      source: 'strava',
      stravaActivityId: act.id,
      distance: Math.round(act.distance), // meters
      durationSec: act.moving_time,
      avgHr: act.average_heartrate || null,
      maxHr: act.max_heartrate || null,
      elevGain: act.total_elevation_gain || null,
      avgCadence: act.average_cadence || null,
      title: act.name
    });
    matched++;
  }

  storage.setLastSync({ ...lastSync, strava: Math.floor(Date.now() / 1000) });
  return { matched, total: activities.length };
}

export function disconnect() {
  storage.clearStrava();
}
