// Weekly-target practice plan. No day lock — train when you feel like it.
// The plan defines what a healthy week looks like; the app tracks progress
// against those targets, not against a Mon/Wed/Fri grid.

import { storage, dt } from './storage.js';

export const SESSION_META = {
  easy_run: {
    label: 'Easy run',
    short: 'Easy',
    isRun: true,
    why: 'Easy runs grow capillary density. Most aerobic adaptation lives here, not in the hard sessions.'
  },
  long_run: {
    label: 'Long run',
    short: 'Long',
    isRun: true,
    why: 'A long, conversational run trains your body to burn fat efficiently and toughens the connective tissue that carries you mile after mile.'
  },
  intervals: {
    label: 'Intervals',
    short: 'Intervals',
    isRun: true,
    why: 'Short bursts at high effort raise your aerobic ceiling and make your easy pace feel easier.'
  },
  lift_full: {
    label: 'Full-body lift',
    short: 'Lift',
    isRun: false,
    why: 'A push, a pull, a squat — the minimum effective dose for resilient tendons and honest posture.'
  },
  lift_lower: {
    label: 'Lower-body lift',
    short: 'Legs',
    isRun: false,
    why: 'Strong glutes and quads protect your knees on long runs and recruit more muscle fibers at the same effort.'
  },
  lift_upper: {
    label: 'Upper-body lift',
    short: 'Upper',
    isRun: false,
    why: 'A strong upper body keeps your form efficient when you tire late in a race.'
  },
  mobility: {
    label: 'Mobility / stretch',
    short: 'Mobility',
    isRun: false,
    why: 'Recovery is the practice. Five minutes of slow movement compounds over a year.'
  }
};

// Phase = where you are right now. Determines weekly targets.
// Targets are floors — do more if you’ve got more. Skip a slot, no guilt.
export const PHASES = {
  foundation: {
    label: 'Foundation',
    description: 'Rebuilding the habit. No soreness, no rush.',
    targets: { easy_run: 2, long_run: 1, intervals: 0, strength: 1 }
  },
  build: {
    label: 'Build',
    description: 'Comfortable with both. Growing capacity.',
    targets: { easy_run: 2, long_run: 1, intervals: 1, strength: 2 }
  },
  maintain: {
    label: 'Maintain',
    description: 'Sharp at current level. Staying there.',
    targets: { easy_run: 2, long_run: 1, intervals: 1, strength: 2 }
  }
};

// Suggestion of what to do today, given this week's progress so far.
// Returns { type, label, reason } or null if nothing is pressing.
export function suggestNext(profile, weekProgress) {
  const phase = PHASES[profile.phase] || PHASES.build;
  const t = phase.targets;
  const done = weekProgress; // { easy_run, long_run, intervals, strength_done }

  // Priority order: long run > intervals > easy > strength
  if (done.long_run < t.long_run) {
    return { type: 'long_run', label: SESSION_META.long_run.label, reason: 'Your long run hasn’t happened yet this week.' };
  }
  if (t.intervals > 0 && done.intervals < t.intervals) {
    return { type: 'intervals', label: SESSION_META.intervals.label, reason: 'One quality session sharpens the week.' };
  }
  if (done.easy_run < t.easy_run) {
    const remain = t.easy_run - done.easy_run;
    return { type: 'easy_run', label: SESSION_META.easy_run.label, reason: `${remain} more easy run${remain === 1 ? '' : 's'} would round out the week.` };
  }
  if (done.strength_done < t.strength) {
    const remain = t.strength - done.strength_done;
    return { type: 'lift_full', label: 'Strength', reason: `${remain} more strength session${remain === 1 ? '' : 's'} to balance the running.` };
  }
  return { type: null, label: 'Rest day', reason: 'All weekly targets met. Rest is the practice now.' };
}

// Computes per-type counts for a given week (Mon-start).
// strengthDone groups lift_full / lift_lower / lift_upper.
export function weekProgress(weekStartIso) {
  const sessions = storage.getSessions();
  const out = { easy_run: 0, long_run: 0, intervals: 0, strength_done: 0, total: 0 };
  for (let i = 0; i < 7; i++) {
    const iso = dt.addDays(weekStartIso, i);
    const s = sessions[iso];
    if (!s?.completed) continue;
    out.total++;
    if (s.type === 'easy_run') out.easy_run++;
    else if (s.type === 'long_run') out.long_run++;
    else if (s.type === 'intervals') out.intervals++;
    else if (s.type?.startsWith('lift_')) out.strength_done++;
  }
  return out;
}

// "Why this matters" lookup for a session type.
export function whyFor(type) {
  return SESSION_META[type]?.why || '';
}

// Classification of a Strava run into our session types based on distance + duration.
// This is a heuristic — user can override in the log flow.
// distanceM = meters, durationSec = seconds.
export function classifyRun(distanceM, durationSec) {
  const miles = distanceM / 1609.34;
  const pacePerMi = durationSec / 60 / miles; // min/mi

  if (miles >= 6) return 'long_run';
  // tighter pace bands look like intervals/tempo
  if (pacePerMi > 0 && pacePerMi < 7.5 && miles < 6) return 'intervals';
  return 'easy_run';
}

// All loggable types in the UI (in display order).
export const LOGGABLE_TYPES = [
  'easy_run', 'long_run', 'intervals',
  'lift_full', 'lift_upper', 'lift_lower',
  'mobility'
];
