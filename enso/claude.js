// Claude (Anthropic API) integration. Browser-direct calls using
// `anthropic-dangerous-direct-browser-access: true`. Acceptable for a
// single-user personal app where the user pastes their own key.

import { storage, dt } from './storage.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL_FAST = 'claude-haiku-4-5-20251001';
const MODEL_DEEP = 'claude-sonnet-4-6';

function getKey() {
  return storage.getAnthropic()?.apiKey || null;
}

export function isConfigured() {
  return !!getKey();
}

async function callClaude({ system, user, model = MODEL_FAST, maxTokens = 600 }) {
  const key = getKey();
  if (!key) throw new Error('No Anthropic API key set');

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Claude error ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.content?.[0]?.text || '';
}

// ── Snapshot of recent practice for Claude prompts ────────────────
function buildSnapshot(days = 14) {
  const profile = storage.getProfile();
  const today = dt.today();
  const start = dt.addDays(today, -days);

  const sessions = [];
  for (let i = 0; i <= days; i++) {
    const iso = dt.addDays(start, i);
    const planned = storage.getPlanFor(iso);
    const actual = storage.getSession(iso);
    if (!planned && !actual) continue;
    sessions.push({
      date: iso,
      dow: dt.dow(iso),
      planned: planned?.type || null,
      planned_prescription: planned?.prescription || null,
      actual: actual?.completed
        ? {
            type: actual.type,
            mood: actual.mood || null,
            note: actual.note || null,
            distance_km: actual.distance ? +(actual.distance / 1000).toFixed(2) : null,
            duration_min: actual.durationSec ? Math.round(actual.durationSec / 60) : null,
            avg_hr: actual.avgHr || null,
            source: actual.source || 'manual'
          }
        : null,
      missed: !actual?.completed && planned && planned.type !== 'rest' && iso < today
    });
  }

  // upcoming 7 days
  const upcoming = [];
  for (let i = 1; i <= 7; i++) {
    const iso = dt.addDays(today, i);
    const p = storage.getPlanFor(iso);
    if (p) upcoming.push({ date: iso, dow: dt.dow(iso), type: p.type, prescription: p.prescription });
  }

  return { profile, today, recent: sessions, upcoming };
}

// ── A. Adaptive adjustment ────────────────────────────────────────
// Returns: { summary, suggestions: [{ date, change, reason }], keep_as_is: bool }
export async function suggestAdjustments() {
  const snap = buildSnapshot(14);

  const system = `You are a gentle, experienced hybrid-athlete coach with a Zen sensibility. The user is training casually — running + strength — to feel good and grow capacity, not to chase numbers. Your job: read the data and either confirm the plan or propose small, specific adjustments to the NEXT 7 DAYS to honor where they actually are. Keep tone calm and brief. Never gamify, never shame. Prefer fewer, more confident suggestions over many small ones. If everything looks fine, say so and recommend keeping the plan as is.

Return JSON only, matching this shape:
{
  "summary": "one short calm sentence",
  "keep_as_is": boolean,
  "suggestions": [
    { "date": "YYYY-MM-DD", "change": "short imperative, e.g. 'Shorten to 25 min easy'", "reason": "one sentence" }
  ]
}`;

  const user = `Recent practice and upcoming plan:\n${JSON.stringify(snap, null, 2)}\n\nReview. Suggest 0–3 small adjustments to the upcoming week if warranted. Otherwise keep_as_is=true.`;

  const raw = await callClaude({ system, user, model: MODEL_FAST, maxTokens: 700 });

  try {
    // strip code fences if present
    const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return { summary: raw.trim().slice(0, 200), keep_as_is: true, suggestions: [] };
  }
}

// ── B. Sunday weekly reflection ───────────────────────────────────
export async function weeklyReflection() {
  const snap = buildSnapshot(7);
  const previous = storage.latestReflection();

  const system = `You are writing a quiet weekly reflection for a hybrid athlete. Voice: calm, observant, plain prose — like a journal entry written by a thoughtful coach who knows them. 4–6 short sentences. No bullet points. No fitness jargon. Notice what showed up, what to honor, what to gently watch next week. Avoid "you should." Prefer "you might."`;

  const user = `Past 7 days:\n${JSON.stringify(snap, null, 2)}\n${previous ? `\nLast week's reflection (for continuity, do not repeat it):\n"${previous.text}"` : ''}\n\nWrite this week's reflection now.`;

  const text = await callClaude({ system, user, model: MODEL_DEEP, maxTokens: 500 });
  return text.trim();
}

// Save a reflection
export function saveReflection(text) {
  const weekStarting = dt.startOfWeek(dt.today());
  storage.addReflection({
    weekStarting,
    text,
    generatedAt: new Date().toISOString()
  });
}
