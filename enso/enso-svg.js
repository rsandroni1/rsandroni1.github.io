// Hand-drawn-looking enso SVG component. Three states: empty, filled, rest.

const STATES = {
  empty:     { stroke: '#a39988', width: 2,   dash: null,    opacity: 1 },
  outline:   { stroke: '#6b6359', width: 3,   dash: null,    opacity: 1 },
  filled:    { stroke: '#1f1c19', width: 6,   dash: null,    opacity: 1 },
  completed: { stroke: '#1f1c19', width: 7,   dash: null,    opacity: 1 },
  rest:      { stroke: '#a39988', width: 1.5, dash: '2 4',   opacity: 0.7 },
  missed:    { stroke: '#b06c4a', width: 2,   dash: '3 5',   opacity: 0.6 }
};

// Build an arc path that goes ALMOST the full circle, leaving a small opening at top-right.
// cx, cy, r — center and radius
function ensoPath(cx, cy, r) {
  // start at top, slightly past 12 o'clock (opening at the top-right)
  const startAng = -Math.PI / 2 + 0.5;   // a bit past 12
  const endAng   = -Math.PI / 2 - 0.05 + 2 * Math.PI;  // sweep almost full
  const sx = cx + r * Math.cos(startAng);
  const sy = cy + r * Math.sin(startAng);
  const ex = cx + r * Math.cos(endAng);
  const ey = cy + r * Math.sin(endAng);
  // single arc, large-arc=1, sweep=1
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 1 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
}

// Render an enso SVG into the target element.
// opts: { size, state, includeBrushNoise }
export function renderEnso(target, opts = {}) {
  const size = opts.size || 240;
  const state = opts.state || 'empty';
  const cfg = STATES[state] || STATES.empty;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;

  const dashAttr = cfg.dash ? `stroke-dasharray="${cfg.dash}"` : '';

  // a second, slightly offset stroke for the "filled" state gives the brush a tapered hand-feel
  let secondary = '';
  if (state === 'filled' || state === 'completed') {
    const p2 = ensoPath(cx + 0.6, cy - 0.4, r - 0.6);
    secondary = `<path d="${p2}" fill="none" stroke="${cfg.stroke}" stroke-width="${cfg.width * 0.55}" stroke-linecap="round" opacity="0.55"/>`;
  }

  const path = ensoPath(cx, cy, r);
  const svg = `
    <svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="${path}"
            fill="none"
            stroke="${cfg.stroke}"
            stroke-width="${cfg.width}"
            stroke-linecap="round"
            opacity="${cfg.opacity}"
            ${dashAttr}/>
      ${secondary}
    </svg>
  `;
  target.innerHTML = svg;
}

// Tiny inline SVG for calendar day glyphs (24x24). Returns an HTML string.
export function ensoGlyph(state) {
  const cfg = STATES[state] || STATES.empty;
  const cx = 12, cy = 12, r = 8.5;
  const path = ensoPath(cx, cy, r);
  const dashAttr = cfg.dash ? `stroke-dasharray="${cfg.dash}"` : '';
  return `
    <svg class="glyph" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="${path}" fill="none" stroke="${cfg.stroke}" stroke-width="${cfg.width * 0.6}" stroke-linecap="round" opacity="${cfg.opacity}" ${dashAttr}/>
    </svg>
  `;
}

// Tiny rest-day dot
export function restGlyph() {
  return `
    <svg class="glyph" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="2" fill="#a39988"/>
    </svg>
  `;
}
