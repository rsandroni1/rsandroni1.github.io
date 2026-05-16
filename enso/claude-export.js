// Builds a copy-paste training summary for discussion in the Claude app/web.
// User generates → copies → pastes into Claude → discusses → pastes the
// recommendation back into the Strategies section to remember it.

import { storage } from './storage.js';
import { PHASES } from './plan.js';
import { getWeeklySummaries, formatPace, formatMiles, getSuggestions } from './suggestions.js';

export function buildTrainingSummary({ weeks = 6 } = {}) {
  const profile = storage.getProfile() || {};
  const phase = PHASES[profile.phase] || PHASES.build;
  const summaries = getWeeklySummaries(weeks);
  const suggestions = getSuggestions();
  const recentJournal = storage.getJournal().slice(0, 5);

  const lines = [];
  lines.push('# My training context');
  lines.push('');
  lines.push(`I’m using a hybrid running + strength practice app. I train when I feel like it, not on a fixed schedule. Here’s where I am.`);
  lines.push('');

  lines.push('## Profile');
  lines.push(`- Phase: **${phase.label}** — ${phase.description}`);
  lines.push(`- Weekly targets: ${phase.targets.easy_run} easy runs, ${phase.targets.long_run} long run, ${phase.targets.intervals} intervals, ${phase.targets.strength} strength sessions`);
  if (profile.raceDate) lines.push(`- Race date: ${profile.raceDate}`);
  lines.push('');

  lines.push(`## Weekly miles (last ${weeks} weeks, newest first)`);
  for (const w of summaries) {
    const longest = w.longestMi > 0 ? `, longest ${formatMiles(w.longestMi)} mi` : '';
    lines.push(`- **${w.start}**: ${formatMiles(w.miles)} mi over ${w.runs.length} runs${longest}, ${w.strength} strength`);
  }
  lines.push('');

  // Per-run detail for the most recent 2 weeks
  const recentRuns = summaries.slice(0, 2).flatMap(w => w.runs).sort((a, b) => a.iso < b.iso ? 1 : -1);
  if (recentRuns.length > 0) {
    lines.push('## Recent runs (most recent first)');
    for (const r of recentRuns) {
      const elev = r.elevM > 0 ? `, +${Math.round(r.elevM * 3.28084)} ft` : '';
      lines.push(`- ${r.iso} (${r.type.replace('_', ' ')}): ${formatMiles(r.miles)} mi @ ${formatPace(r.pace)}${elev}`);
    }
    lines.push('');
  }

  if (suggestions.length > 0) {
    lines.push('## What my app is flagging');
    for (const s of suggestions.slice(0, 4)) {
      lines.push(`- **${s.headline}** — ${s.detail}`);
    }
    lines.push('');
  }

  if (recentJournal.length > 0) {
    lines.push('## Recent journal notes');
    for (const j of recentJournal) {
      const tag = j.sessionType ? ` (${j.sessionType.replace('_', ' ')})` : '';
      lines.push(`- ${j.date}${tag}: ${j.thoughts}`);
    }
    lines.push('');
  }

  lines.push('## What I’d like your read on');
  lines.push('- Where should I focus the next 2-4 weeks?');
  lines.push('- Anything in the data that worries you?');
  lines.push('- One concrete change that would move the needle most.');
  lines.push('');
  lines.push('Keep it short and direct. I’ll save your recommendation back into the app.');

  return lines.join('\n');
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback for browsers without async clipboard
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
    return ok;
  }
}
