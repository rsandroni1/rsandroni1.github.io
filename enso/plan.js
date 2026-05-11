// Curated hybrid base plan. Scales with daysPerWeek (2/3/4) and phase.
// Each session is { type, prescription, why, duration }.

import { storage, dt } from './storage.js';

export const SESSION_META = {
  easy_run: {
    label: 'Easy run',
    why: 'Easy runs grow capillary density — your engine quietly gets bigger. Most aerobic adaptation lives here, not in the hard sessions.'
  },
  long_run: {
    label: 'Long run',
    why: 'A long, conversational run trains your body to burn fat efficiently and strengthens the connective tissue that carries you mile after mile.'
  },
  intervals: {
    label: 'Intervals',
    why: 'Short bursts at high effort raise your aerobic ceiling and make your easy pace feel easier. One hard session a week is plenty.'
  },
  lift_full: {
    label: 'Full-body lift',
    why: 'A push, a pull, a squat — the minimum effective dose for keeping your tendons resilient and your posture honest.'
  },
  lift_lower: {
    label: 'Lower-body lift',
    why: 'Strong glutes and quads protect your knees on long runs and recruit more muscle fibers at the same effort.'
  },
  lift_upper: {
    label: 'Upper-body lift',
    why: 'A strong upper body keeps your form efficient when you tire late in a race — and balances out the all-leg endurance work.'
  },
  rest: {
    label: 'Rest',
    why: 'Adaptation happens between sessions, not during them. Resting is the practice.'
  },
  race: {
    label: 'Race day',
    why: 'A celebration of the work. Run by feel, not by clock.'
  }
};

// ── Weekly templates ─────────────────────────────────────────────
// Each entry: array of 7 session types, Mon→Sun.

const TEMPLATES = {
  foundation: {
    2: ['easy_run', 'rest', 'rest', 'lift_full', 'rest', 'rest', 'rest'],
    3: ['easy_run', 'rest', 'lift_full', 'rest', 'easy_run', 'rest', 'rest'],
    4: ['easy_run', 'rest', 'lift_full', 'easy_run', 'rest', 'lift_full', 'rest']
  },
  build: {
    2: ['easy_run', 'rest', 'rest', 'lift_full', 'rest', 'long_run', 'rest'],
    3: ['easy_run', 'rest', 'lift_full', 'rest', 'easy_run', 'long_run', 'rest'],
    4: ['easy_run', 'rest', 'lift_lower', 'intervals', 'rest', 'long_run', 'lift_upper']
  },
  maintain: {
    2: ['easy_run', 'rest', 'rest', 'lift_full', 'rest', 'long_run', 'rest'],
    3: ['easy_run', 'lift_full', 'rest', 'easy_run', 'rest', 'long_run', 'rest'],
    4: ['easy_run', 'lift_lower', 'rest', 'intervals', 'rest', 'long_run', 'lift_upper']
  }
};

// ── Prescription text per phase + session type ────────────────────

function prescribe(type, phase, weekIndex) {
  // weekIndex: how many weeks since starting the plan (0+). Used to gently progress duration.
  const wk = Math.max(0, weekIndex);

  if (type === 'rest') return '';

  if (type === 'easy_run') {
    if (phase === 'foundation') {
      const min = Math.min(30 + Math.floor(wk / 2) * 5, 45);
      return `${min} min easy. Should be conversational — if you can't speak in full sentences, slow down.`;
    }
    if (phase === 'build') {
      const min = Math.min(35 + Math.floor(wk / 3) * 5, 55);
      return `${min} min easy. Nose-breathing pace. Save the hard work for tomorrow.`;
    }
    return `35–45 min easy. Heart rate stays low. This is the base.`;
  }

  if (type === 'long_run') {
    if (phase === 'foundation') {
      const min = Math.min(40 + wk * 5, 60);
      return `${min} min long, easy. Walk if you need to — the time on feet matters more than the pace.`;
    }
    if (phase === 'build') {
      const min = Math.min(50 + wk * 5, 90);
      return `${min} min long. First 80% easy. Last 10–15 min: pick it up slightly if you feel good. Optional.`;
    }
    return `60–75 min long. Conversational throughout. Maybe a faster finish.`;
  }

  if (type === 'intervals') {
    if (phase === 'build') {
      // simple progression
      const variants = [
        '4 x 3 min @ comfortably hard, 2 min easy jog between.',
        '5 x 3 min @ 5K effort, 2 min easy jog.',
        '6 x 2 min @ hard, 2 min easy jog.',
        '4 x 4 min @ threshold (you could talk in 2-word phrases), 3 min easy.'
      ];
      return variants[wk % variants.length];
    }
    return '6 x 90 sec strides at hard, with full recovery. Keep it sharp, not deep.';
  }

  if (type === 'lift_full') {
    if (phase === 'foundation') {
      return 'Squat · Push · Pull · Core. 3 sets of 6–10. Leave 3 reps in reserve. Move well, not heavy.';
    }
    return 'Squat or deadlift · Press · Row · Carry · Core. 3 sets of 5–8. Leave 2 reps in reserve.';
  }
  if (type === 'lift_lower') {
    return 'Squat (or deadlift, alternate weeks) · Lunge or split squat · Hip hinge · Calf raise. 3 x 6–10.';
  }
  if (type === 'lift_upper') {
    return 'Press · Pull-up or row · Push-up variation · Anti-rotation core. 3 x 6–10.';
  }
  if (type === 'race') {
    return 'Race day. Warm up gently. Trust the work. Run by feel.';
  }
  return '';
}

// ── Plan generation ───────────────────────────────────────────────
// Generates plan entries for [startIso, startIso + days). Doesn't overwrite existing manually-edited entries.

export function generatePlan(profile, days = 28) {
  const startedOn = profile.startedOn || dt.today();
  const today = dt.today();
  const weekStart = dt.startOfWeek(today);
  const planStart = weekStart; // always align to current week's Monday

  const template = TEMPLATES[profile.phase]?.[String(profile.daysPerWeek)] || TEMPLATES.build[3];
  const existing = storage.getPlan();

  for (let i = 0; i < days; i++) {
    const iso = dt.addDays(planStart, i);
    if (existing[iso]?.locked) continue; // never overwrite a locked (user-modified or AI-accepted) entry

    const dow = (i % 7); // 0 = Monday
    const type = template[dow];
    const weekIndex = dt.weeksBetween(startedOn, iso);

    // race day override
    if (profile.raceDate && iso === profile.raceDate) {
      existing[iso] = {
        date: iso,
        type: 'race',
        prescription: prescribe('race', profile.phase, weekIndex),
        why: SESSION_META.race.why,
        label: SESSION_META.race.label
      };
      continue;
    }

    existing[iso] = {
      date: iso,
      type,
      prescription: prescribe(type, profile.phase, weekIndex),
      why: SESSION_META[type]?.why || '',
      label: SESSION_META[type]?.label || type
    };
  }

  storage.setPlan(existing);
  return existing;
}

export function planFor(iso) {
  return storage.getPlanFor(iso);
}

// Whether the session is one that involves running (used for Strava matching)
export function isRunSession(type) {
  return type === 'easy_run' || type === 'long_run' || type === 'intervals' || type === 'race';
}
