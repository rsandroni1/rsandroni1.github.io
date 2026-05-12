// Rule-based training advice. No AI — just patterns from your data.
// Each rule reads the recent history and returns a Suggestion or null.
// The Insights screen surfaces whichever rules fire, sorted by priority.

import { storage, dt } from './storage.js';

const M_PER_MI = 1609.34;

// ── helpers ───────────────────────────────────────────────────────────────

function metersToMiles(m) { return m / M_PER_MI; }
function secsToMinutes(s) { return s / 60; }
function pacePerMile(distM, durSec) {
  if (!distM || !durSec) return null;
  return secsToMinutes(durSec) / metersToMiles(distM);
}

// Build a per-week summary for the last `n` ISO weeks (Mon-start), newest first.
function weeklySummaries(n = 8) {
  const all = storage.getSessions();
  const today = dt.today();
  const thisStart = dt.startOfWeek(today);

  const weeks = [];
  for (let w = 0; w < n; w++) {
    const wkStart = dt.addDays(thisStart, -7 * w);
    const sum = {
      start: wkStart,
      runs: [], strength: 0, total: 0,
      miles: 0, durationMin: 0, elevFt: 0, longestMi: 0
    };
    for (let i = 0; i < 7; i++) {
      const iso = dt.addDays(wkStart, i);
      const s = all[iso];
      if (!s?.completed) continue;
      sum.total++;
      if (['easy_run', 'long_run', 'intervals'].includes(s.type)) {
        const mi = metersToMiles(s.distance || 0);
        sum.runs.push({ iso, type: s.type, miles: mi, durSec: s.durationSec || 0, pace: pacePerMile(s.distance, s.durationSec), elevM: s.elevGain || 0 });
        sum.miles += mi;
        sum.durationMin += secsToMinutes(s.durationSec || 0);
        sum.elevFt += (s.elevGain || 0) * 3.28084;
        if (mi > sum.longestMi) sum.longestMi = mi;
      } else if (s.type?.startsWith('lift_')) {
        sum.strength++;
      }
    }
    weeks.push(sum);
  }
  return weeks; // weeks[0] = current, weeks[1] = last, ...
}

// Days since the last run (any type). null if no runs ever logged.
function daysSinceLastRun() {
  const all = storage.getSessions();
  const isos = Object.keys(all).sort().reverse();
  for (const iso of isos) {
    const s = all[iso];
    if (s?.completed && ['easy_run', 'long_run', 'intervals'].includes(s.type)) {
      return Math.floor((Date.now() - dt.parse(iso).getTime()) / 86400000);
    }
  }
  return null;
}

// ── rules ─────────────────────────────────────────────────────────────────
// Each rule: (ctx) => Suggestion | null
// Suggestion = { id, priority, icon, headline, detail, action }

const RULES = [
  function recoveryAfterJump(ctx) {
    const [now, prev] = ctx.weeks;
    if (!now || !prev) return null;
    if (prev.miles < 4) return null; // need a real baseline
    const jump = (now.miles - prev.miles) / prev.miles;
    if (jump > 0.25) {
      return {
        id: 'recovery_after_jump',
        priority: 9,
        icon: '◐',
        headline: 'Earn this week’s jump',
        detail: `You ran ${now.miles.toFixed(1)} mi this week vs ${prev.miles.toFixed(1)} last week (+${Math.round(jump * 100)}%). Your tendons and connective tissue need a beat to catch up.`,
        action: 'Make the next session easy or take a rest day. The fitness adapts during rest, not during the work.'
      };
    }
    return null;
  },

  function quietWeek(ctx) {
    const last = ctx.daysSinceRun;
    if (last == null) return null;
    if (last >= 4) {
      return {
        id: 'quiet_week',
        priority: 8,
        icon: '○',
        headline: `${last} days since your last run`,
        detail: 'Rhythm matters more than mileage. Even 20 minutes today keeps the habit warm.',
        action: 'Tonight or tomorrow: an easy 20–30 min, nothing more.'
      };
    }
    return null;
  },

  function staleLongRun(ctx) {
    const longests = ctx.weeks.slice(0, 4).map(w => w.longestMi).filter(x => x > 0);
    if (longests.length < 3) return null;
    const top = Math.max(...longests);
    const recent = ctx.weeks[0]?.longestMi || 0;
    // If your longest hasn't grown in 3+ weeks AND you've done at least one decent long run
    if (top >= 4 && longests.every(x => Math.abs(x - top) < 0.5)) {
      return {
        id: 'stale_long_run',
        priority: 6,
        icon: '↗',
        headline: 'Stretch the long run',
        detail: `Your longest run has held at ~${top.toFixed(1)} mi for 3+ weeks. Time to extend by half a mile or a kilometer.`,
        action: `Aim for ${(top + 0.5).toFixed(1)} mi on your next long run. Same easy pace — distance grows, intensity stays.`
      };
    }
    return null;
  },

  function easyPaceDrift(ctx) {
    // Easy runs should be ~60-90 sec/mi slower than tempo/intervals pace.
    const recentRuns = ctx.weeks.slice(0, 2).flatMap(w => w.runs);
    const easies = recentRuns.filter(r => r.type === 'easy_run' && r.pace);
    const quality = recentRuns.filter(r => r.type === 'intervals' && r.pace);
    if (easies.length < 2 || quality.length < 1) return null;
    const avgEasy = easies.reduce((s, r) => s + r.pace, 0) / easies.length;
    const avgQual = quality.reduce((s, r) => s + r.pace, 0) / quality.length;
    const gap = avgEasy - avgQual;
    if (gap < 0.75) {
      return {
        id: 'easy_pace_drift',
        priority: 7,
        icon: '⤳',
        headline: 'Your easy isn’t easy enough',
        detail: `Your easy runs are averaging ${formatPace(avgEasy)} while your quality work is ${formatPace(avgQual)}. That’s a ~${gap.toFixed(1)} min/mi gap — should be closer to a full minute slower.`,
        action: 'Next easy run: hold conversational pace, even if it feels too slow. The point is recovery.'
      };
    }
    return null;
  },

  function strengthLag(ctx) {
    const recent = ctx.weeks.slice(0, 3);
    if (recent.length < 2) return null;
    const totalRuns = recent.reduce((s, w) => s + w.runs.length, 0);
    const totalLift = recent.reduce((s, w) => s + w.strength, 0);
    if (totalRuns >= 6 && totalLift === 0) {
      return {
        id: 'strength_lag',
        priority: 5,
        icon: '⊥',
        headline: 'All running, no lifting',
        detail: `Last 3 weeks: ${totalRuns} runs, 0 lifts. Strength is what protects you from injury when you're tired.`,
        action: 'This week: one 20-min session. Squat, push, pull. That’s the whole thing.'
      };
    }
    return null;
  },

  function consistencyWin(ctx) {
    const counts = ctx.weeks.slice(0, 4).map(w => w.total);
    if (counts.length < 4) return null;
    if (counts.every(c => c >= 3)) {
      return {
        id: 'consistency_win',
        priority: 3,
        icon: '◉',
        headline: '4 weeks of consistent practice',
        detail: 'Four straight weeks of 3+ sessions. The habit is the win — most adaptations live here.',
        action: 'Hold the line. No need to push harder — just keep the rhythm.'
      };
    }
    return null;
  },

  function lightWeek(ctx) {
    const [now, prev] = ctx.weeks;
    if (!now || !prev || prev.miles < 4) return null;
    if (now.miles < prev.miles * 0.5 && now.total < 2 && now.runs.length < 2) {
      const dow = new Date().getDay();
      if (dow >= 4) { // Thu or later — week is mostly over
        return {
          id: 'light_week',
          priority: 4,
          icon: '◯',
          headline: 'Quiet week — push a quality session',
          detail: `Only ${now.miles.toFixed(1)} mi so far this week. Lighter than your usual.`,
          action: 'A short quality run before the week closes — 4×3 min hard, 2 min easy between.'
        };
      }
    }
    return null;
  },

  function elevationStreak(ctx) {
    const recent = ctx.weeks.slice(0, 3);
    const totalFt = recent.reduce((s, w) => s + w.elevFt, 0);
    if (totalFt > 3000) {
      return {
        id: 'elev_streak',
        priority: 2,
        icon: '△',
        headline: 'Lot of climbing lately',
        detail: `${Math.round(totalFt)} ft of gain over the last 3 weeks. Big hidden stimulus.`,
        action: 'Flatten the next easy run if your calves are barking — vertical fatigue accumulates quietly.'
      };
    }
    return null;
  }
];

export function getSuggestions() {
  const ctx = {
    weeks: weeklySummaries(8),
    daysSinceRun: daysSinceLastRun()
  };
  return RULES.map(r => {
    try { return r(ctx); } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.priority - a.priority);
}

export function getWeeklySummaries(n = 8) {
  return weeklySummaries(n);
}

export function formatPace(minutesPerMile) {
  if (!minutesPerMile || !isFinite(minutesPerMile)) return '—';
  const m = Math.floor(minutesPerMile);
  const s = Math.round((minutesPerMile - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}/mi`;
}

export function formatMiles(miles) {
  return miles.toFixed(1);
}

// Public helper: total miles across the last N weeks
export function totalMiles(n = 4) {
  return weeklySummaries(n).reduce((s, w) => s + w.miles, 0);
}
