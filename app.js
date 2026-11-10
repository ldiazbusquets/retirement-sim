/* Retirement Simulator page: reads the form, runs sim.js, draws the results.
   All finance math lives in sim.js; this file only handles the page. */
'use strict';
const S = window.RetirementSim;
const $ = (id) => document.getElementById(id);
/* If a cached copy of an older page loaded this newer script, the page and code don't match:
   reload once to fetch the current page instead of failing silently. */
if (!$('empty') || !$('banner') || !document.querySelector('input[name="timing"]')) {
  let tried = false;
  try { tried = sessionStorage.getItem('retsim-reloaded') === '1'; sessionStorage.setItem('retsim-reloaded', '1'); } catch (e) { tried = true; }
  if (!tried) { const u = new URL(location.href); u.searchParams.set('fresh', Date.now()); location.replace(u); }
  throw new Error('Page and script versions differ; reloading.');
}
try { sessionStorage.removeItem('retsim-reloaded'); } catch (e) { /* storage blocked */ }
const FIELDS = ['currentAge', 'retirementAge', 'contribution', 'startBalance', 'goal', 'simulations', 'timing', 'model', 'seed'];
const MONEY = ['contribution', 'startBalance', 'goal'];
const URL_KEYS = { currentAge: 'age', retirementAge: 'retire', contribution: 'save', startBalance: 'have', goal: 'goal', simulations: 'n', timing: 'timing', model: 'model', seed: 'seed' };
const SVGNS = 'http://www.w3.org/2000/svg';

let current = null;   // { v, result, bands, at }
let pinned = null;    // scenario A: { v, stats }

/* ---------------- formatting ---------------- */
const fmtUSD = (x) => '$' + Math.round(x).toLocaleString('en-US');
function fmtShort(x) {
  const a = Math.abs(x), s = x < 0 ? '−' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e10 ? 1 : 2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `${s}$${Math.round(a / 1e3)}K`;
  return `${s}$${Math.round(a)}`;
}
const fmtPct = (p) => {
  const x = p * 100;
  if (x > 0 && x < 0.1) return '<0.1%';
  if (x < 100 && x > 99.9) return '>99.9%';
  return `${x.toFixed(1)}%`;
};
const fmtAxis = (x) => fmtShort(x).replace(/\.0+(?=[KMB])/, '').replace(/(\.\d*?)0+(?=[KMB])/, '$1');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------- form ---------------- */
function fillSelect() {
  $('simulations').innerHTML = S.SIM_OPTIONS.map((n) => `<option value="${n}">${n.toLocaleString('en-US')}</option>`).join('');
  $('model-help').textContent = `Normal: average ${(S.MEAN * 100).toFixed(2)}% a year, standard deviation ${(S.SD * 100).toFixed(2)}%, the figures from ${S.FIRST_YEAR}–${S.FIRST_YEAR + S.RETURNS.length - 1}. Historical: real years such as 2008 (−38.5%) can repeat, which gives fatter tails.`;
}
function setForm(v) {
  for (const k of FIELDS) {
    const el = $('form').elements[k];
    el.value = MONEY.includes(k) && v[k] !== '' && Number.isFinite(Number(v[k])) ? Number(v[k]).toLocaleString('en-US') : v[k];
  }
}
function readForm() {
  const raw = {};
  for (const k of FIELDS) raw[k] = $('form').elements[k].value;
  return raw;
}
function fromURL() {
  const q = new URLSearchParams(location.search), v = { ...S.DEFAULTS };
  
  for (const [k, p] of Object.entries(URL_KEYS)) if (q.has(p)) v[k] = q.get(p);
  return v;
}
function toURL(v) {
  const q = new URLSearchParams();
  for (const [k, p] of Object.entries(URL_KEYS)) q.set(p, v[k]);
  try { history.replaceState(null, '', `${location.pathname}?${q}${location.hash}`); } catch (e) { /* some browsers block this for local files */ }
}
function showMessages(check) {
  for (const k of FIELDS) {
    const el = $(k), m = $(`${k}-msg`);
    const err = check.errors[k], note = check.notes[k];
    if (el) el.setAttribute('aria-invalid', err ? 'true' : 'false');
    if (m) { m.textContent = err || note || ''; m.classList.toggle('note', !err && !!note); }
  }
  // Errors in hidden settings: open the panel so the message can be seen.
  if (['simulations', 'seed'].some((k) => check.errors[k])) $('advanced').open = true;
}

/* ---------------- running ---------------- */
function run() {
  const check = S.validate(readForm());
  showMessages(check);
  if (!check.ok) {
    const first = FIELDS.find((k) => check.errors[k]);
    $(first)?.focus();
    return;
  }
  const v = check.values;
  $('run-btn').disabled = true; $('run-btn').textContent = 'Running…';
  $('results').setAttribute('aria-busy', 'true');
  // Let the button repaint before the (synchronous) simulation runs.
  setTimeout(() => {
    try {
      const t = performance.now();
      const result = S.simulate(v);
      const bands = S.bands(result, [5, 25, 50, 75, 95]);
      current = { v, result, bands, ms: performance.now() - t };
      $('empty').hidden = true; $('out').hidden = false;
      render();
      toURL(v);
      setStale(false);
    } catch (err) {
      console.error(err);
      setBanner('Something went wrong; your inputs were kept. Please try again.', true);
    } finally {
      $('run-btn').disabled = false; $('run-btn').textContent = 'Run simulation';
      $('results').setAttribute('aria-busy', 'false');
    }
  }, 30);
}

function setBanner(text, isError) {
  $('banner').textContent = text || '';
  $('banner').hidden = !text;
  $('banner').classList.toggle('err', !!isError);
}
/* Old results stay visible after an input changes, but are marked out of date until the next run. */
function setStale(on) {
  $('stale').hidden = !on;
  $('results').classList.toggle('is-stale', on);
  setBanner(on ? 'Out of date: your inputs changed. Click Run simulation to update these results.' : '');
}
/* Check fields as the user types; an invalid value shows its message and disables Run. */
function liveCheck(e) {
  const check = S.validate(readForm());
  // Show messages only for fields the user has touched, so one edit doesn't flag the whole form.
  if (e && e.target && e.target.name) touched.add(e.target.name);
  if (e && e.target && e.target.name === 'currentAge') touched.add('retirementAge');
  const shown = { errors: {}, notes: {} };
  for (const k of touched) { if (check.errors[k]) shown.errors[k] = check.errors[k]; if (check.notes[k]) shown.notes[k] = check.notes[k]; }
  showMessages(shown);
  $('run-btn').disabled = !check.ok;
  if (current) setStale(true);
}

/* ---------------- render ---------------- */
function render() {
  const { v, result } = current, st = result.stats;
  $('prob').textContent = fmtPct(st.probability);
  drawGauge(st.probability);
  const years = result.years;
  const tone = st.probability >= 0.75 ? 'likely' : st.probability >= 0.5 ? 'more likely than not' : st.probability >= 0.25 ? 'possible but less likely than not' : 'unlikely';
  $('verdict').innerHTML = `Reaching <strong>${fmtUSD(v.goal)}</strong> by age ${v.retirementAge} is <strong>${tone}</strong>: ${st.hits.toLocaleString('en-US')} of ${v.simulations.toLocaleString('en-US')} simulated futures got there. Half of them ended above <strong>${fmtShort(st.median)}</strong>.`;
  const gap = st.median - v.goal;
  const stats = [
    ['Median outcome', fmtShort(st.median), gap >= 0 ? `${fmtShort(gap)} above goal` : `${fmtShort(-gap)} below goal`],
    ['Average outcome', fmtShort(st.mean), st.mean > st.median * 1.02 ? 'pulled up by the best cases' : 'close to the median'],
    ['Bad case (5th pct.)', fmtShort(st.p5), '1 in 20 ends below this'],
    ['Good case (95th pct.)', fmtShort(st.p95), '1 in 20 ends above this'],
    ['You put in', fmtShort(st.contributed), `over ${years} year${years === 1 ? '' : 's'}`],
  ];
  $('stats').innerHTML = stats.map(([k, val, d]) => `<div class="glass stat"><p class="k">${k}</p><p class="v">${val}</p><p class="d">${d}</p></div>`).join('');
  $('hist-sub').textContent = `Final balance at age ${v.retirementAge} in each of the ${v.simulations.toLocaleString('en-US')} simulations (${v.model === 'normal' ? 'normal model' : 'historical years'}, ${v.timing === 'end' ? 'end-of-year' : 'start-of-year'} contributions, seed ${v.seed}). Ran in ${Math.max(1, Math.round(current.ms))} ms.`;
  drawHistogram(); drawFan(); drawTable();
}

function drawGauge(p) {
  const r = 52, c = 2 * Math.PI * r, color = p >= 0.5 ? 'var(--hit)' : p >= 0.25 ? 'var(--mid)' : 'var(--bad)';
  $('gauge').innerHTML = `<svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="${r}" fill="none" stroke="var(--s3)" stroke-width="12"/>
    <circle cx="66" cy="66" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 66 66)"/></svg>`;
}

/* Rounded axis steps (1, 2, 2.5, 5 x 10^k). */
function niceStep(range, ticks) {
  const raw = range / ticks, mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
}

function svgEl(w, h, label) {
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">`;
}

function attachHover(container, w, onMove) {
  const svg = container.querySelector('svg');
  let tip = container.querySelector('.tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; container.appendChild(tip); }
  const move = (e) => {
    const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * (w / r.width);
    const out = onMove(x);
    if (!out) { tip.hidden = true; return; }
    tip.hidden = false; tip.innerHTML = out.html;
    tip.style.left = `${Math.min(Math.max(out.x * r.width / w, 70), r.width - 70)}px`;
    tip.style.top = `${out.y * r.height / svg.viewBox.baseVal.height}px`;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', () => { tip.hidden = true; onMove(null); });
}

function drawHistogram() {
  const { v, result } = current, st = result.stats, out = result.outcomes;
  const W = $('hist').clientWidth < 560 ? 420 : 760, H = W < 600 ? 260 : 300, L = 54, R = 14, T = 26, B = 34;
  // Show up to the 98th percentile (or a bit past the goal), with the rest in the last bar.
  const sorted = Float64Array.from(out).sort();
  const top = Math.max(S.percentile(sorted, 98), v.goal * 1.25);
  const BINS = W < 600 ? 28 : 40, step = niceStep(top, BINS), hi = step * Math.ceil(top / step), nb = Math.round(hi / step);
  const hit = new Array(nb).fill(0), miss = new Array(nb).fill(0);
  for (const w of out) {
    const i = Math.min(nb - 1, Math.max(0, Math.floor(w / step)));
    if (w >= v.goal) hit[i]++; else miss[i]++;
  }
  const maxC = Math.max(...hit.map((h, i) => h + miss[i]));
  const xs = (x) => L + (x / hi) * (W - L - R), ys = (c) => H - B - (c / maxC) * (H - T - B);
  const bw = (W - L - R) / nb;
  let s = svgEl(W, H, `Histogram of final balances. ${fmtPct(st.probability)} of simulations reach the goal of ${fmtUSD(v.goal)}.`);
  const yStep = niceStep(maxC, 4);
  for (let c = 0; c <= maxC; c += yStep) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${ys(c)}" y2="${ys(c)}"/><text x="${L - 8}" y="${ys(c) + 4}" text-anchor="end">${c.toLocaleString('en-US')}</text>`;
  const xStep = niceStep(hi, W < 600 ? 4 : 6);
  for (let x = 0; x <= hi + 1e-9; x += xStep) s += `<text x="${xs(x)}" y="${H - B + 18}" text-anchor="middle">${fmtAxis(x)}${x >= hi - 1e-9 ? '+' : ''}</text>`;
  for (let i = 0; i < nb; i++) {
    const x = L + i * bw + 0.8, wdt = Math.max(bw - 1.6, 1);
    if (miss[i]) s += `<rect class="bar-miss" data-i="${i}" x="${x}" y="${ys(miss[i])}" width="${wdt}" height="${ys(0) - ys(miss[i])}" rx="1.5"/>`;
    if (hit[i]) s += `<rect class="bar-hit" data-i="${i}" x="${x}" y="${ys(miss[i] + hit[i])}" width="${wdt}" height="${ys(miss[i]) - ys(miss[i] + hit[i])}" rx="1.5"/>`;
  }
  s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  const gx = xs(Math.min(v.goal, hi));
  s += `<line class="goal-line" x1="${gx}" x2="${gx}" y1="${T - 8}" y2="${H - B}"/><text class="goal-lbl" x="${gx + (gx > W - 130 ? -6 : 6)}" y="${T - 10}" text-anchor="${gx > W - 130 ? 'end' : 'start'}">Goal ${fmtShort(v.goal)}</text>`;
  s += '</svg>';
  const box = $('hist'); box.innerHTML = s;
  const rects = box.querySelectorAll('rect');
  attachHover(box, W, (x) => {
    rects.forEach((r) => r.classList.remove('hot'));
    if (x === null) return null;
    const i = Math.floor((x - L) / bw);
    if (i < 0 || i >= nb) return null;
    box.querySelectorAll(`rect[data-i="${i}"]`).forEach((r) => r.classList.add('hot'));
    const n = hit[i] + miss[i];
    const range = i === nb - 1 ? `${fmtShort(i * step)} or more` : `${fmtShort(i * step)} – ${fmtShort((i + 1) * step)}`;
    return { x: L + (i + 0.5) * bw, y: ys(n), html: `<b>${range}</b><br>${n.toLocaleString('en-US')} simulations (${fmtPct(n / out.length)})` };
  });
}

function drawFan() {
  const { v, result, bands } = current, years = result.years;
  const W = $('fan').clientWidth < 560 ? 420 : 760, H = W < 600 ? 260 : 300, L = 58, R = 14, T = 16, B = 34;
  const ymax = Math.max(bands[years][4], v.goal) * 1.06;
  const yStep = niceStep(ymax, 5), top = yStep * Math.ceil(ymax / yStep);
  const xs = (y) => L + (y / Math.max(years, 1)) * (W - L - R), ys = (m) => H - B - (Math.min(m, top) / top) * (H - T - B);
  const area = (lo, hi) => {
    let d = `M${xs(0)},${ys(bands[0][hi])}`;
    for (let y = 1; y <= years; y++) d += `L${xs(y)},${ys(bands[y][hi])}`;
    for (let y = years; y >= 0; y--) d += `L${xs(y)},${ys(bands[y][lo])}`;
    return d + 'Z';
  };
  const line = (f) => bands.map((_, y) => `${y ? 'L' : 'M'}${xs(y).toFixed(1)},${ys(f(y)).toFixed(1)}`).join('');
  let s = svgEl(W, H, `Savings growth from age ${v.currentAge} to ${v.retirementAge}. Median at retirement ${fmtShort(bands[years][2])}; middle 90% from ${fmtShort(bands[years][0])} to ${fmtShort(bands[years][4])}.`);
  for (let m = 0; m <= top + 1; m += yStep) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${ys(m)}" y2="${ys(m)}"/><text x="${L - 8}" y="${ys(m) + 4}" text-anchor="end">${fmtAxis(m)}</text>`;
  const ageStep = W < 600 && years > 12 ? (years <= 30 ? 10 : 10) : years <= 12 ? 1 : years <= 30 ? 5 : 10;
  for (let y = 0; y <= years; y++) {
    const age = v.currentAge + y;
    if (age % ageStep === 0 || y === 0 || y === years) {
      if (y !== 0 && y !== years && Math.abs(y - years) < ageStep / 2) continue;
      s += `<text x="${xs(y)}" y="${H - B + 18}" text-anchor="middle">${age}</text>`;
    }
  }
  s += `<path class="band" d="${area(0, 4)}"/><path class="band2" d="${area(1, 3)}"/>`;
  s += `<path class="paid" d="${line((y) => v.startBalance + v.contribution * y)}"/>`;
  s += `<path class="med" d="${line((y) => bands[y][2])}"/>`;
  s += `<line class="goal-line" x1="${L}" x2="${W - R}" y1="${ys(v.goal)}" y2="${ys(v.goal)}"/><text class="goal-lbl" x="${L + 6}" y="${ys(v.goal) - 6}">Goal ${fmtShort(v.goal)}</text>`;
  s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/><line class="hover-line" id="fan-hover" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>`;
  s += '</svg>';
  const box = $('fan'); box.innerHTML = s;
  const hl = box.querySelector('#fan-hover');
  attachHover(box, W, (x) => {
    if (x === null) { hl.setAttribute('visibility', 'hidden'); return null; }
    const y = Math.round(((x - L) / (W - L - R)) * years);
    if (y < 0 || y > years) { hl.setAttribute('visibility', 'hidden'); return null; }
    hl.setAttribute('x1', xs(y)); hl.setAttribute('x2', xs(y)); hl.setAttribute('visibility', 'visible');
    const b = bands[y];
    return { x: xs(y), y: ys(b[4]) + 4, html: `<b>Age ${v.currentAge + y}</b><br>Median ${fmtShort(b[2])}<br>Middle 90%: ${fmtShort(b[0])} – ${fmtShort(b[4])}<br>Put in: ${fmtShort(v.startBalance + v.contribution * y)}` };
  });
}

const ROWS = [
  ['Chance of reaching goal', 'probability', 'pct'],
  ['Average (mean)', 'mean'], ['5th percentile', 'p5'], ['25th percentile', 'p25'],
  ['Median (50th)', 'median'], ['75th percentile', 'p75'], ['95th percentile', 'p95'],
  ['Total put in', 'contributed'],
];
function drawTable() {
  const st = current.result.stats, A = pinned?.stats;
  const cell = (val, kind) => kind === 'pct' ? fmtPct(val) : fmtUSD(val);
  const diff = (a, b, kind) => {
    const d = a - b;
    if (Math.abs(d) < (kind === 'pct' ? 5e-4 : 0.5)) return '<td>–</td>';
    const txt = kind === 'pct' ? `${d > 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)} pts` : `${d > 0 ? '+' : '−'}${fmtUSD(Math.abs(d))}`;
    return `<td class="${d > 0 ? 'up' : 'dn'}">${txt}</td>`;
  };
  let h = `<thead><tr><th scope="col">Measure</th><th scope="col">${A ? 'Current' : 'Value'}</th>${A ? '<th scope="col">Scenario A</th><th scope="col">Change vs A</th>' : ''}</tr></thead><tbody>`;
  for (const [label, key, kind] of ROWS) {
    h += `<tr${key === 'probability' ? ' class="goal-row"' : ''}><td>${label}</td><td>${cell(st[key], kind)}</td>${A ? `<td>${cell(A[key], kind)}</td>${diff(st[key], A[key], kind)}` : ''}</tr>`;
  }
  $('ptable').innerHTML = h + '</tbody>';
  $('pin-note').textContent = A ? `Scenario A: ${describe(pinned.v)}.` : 'Save these results as scenario A, change an input and run again to compare side by side. A copied link opens these exact results for anyone.';
  $('pin-btn').textContent = A ? 'Replace scenario A' : 'Save as scenario A';
}
function describe(v) {
  return `age ${v.currentAge} to ${v.retirementAge}, ${fmtUSD(v.contribution)}/yr, starting ${fmtUSD(v.startBalance)}, goal ${fmtUSD(v.goal)}, ${v.model === 'normal' ? 'normal model' : 'historical years'}, ${v.timing === 'end' ? 'end' : 'start'}-of-year, ${v.simulations.toLocaleString('en-US')} sims, seed ${v.seed}`;
}

function downloadCSV() {
  if (!current) return;
  const { v, result } = current, st = result.stats;
  const lines = [
    '# Retirement Simulator results (FIN 414 Applied Project I)',
    `# Inputs: ${describe(v)}`,
    `# Returns: S&P 500 (^GSPC) annual price returns ${S.FIRST_YEAR}-${S.FIRST_YEAR + S.RETURNS.length - 1}; mean ${S.MEAN.toFixed(6)}; sd ${S.SD.toFixed(6)}`,
    ...ROWS.map(([label, key]) => `# ${label}: ${key === 'probability' ? st[key].toFixed(4) : st[key].toFixed(2)}`),
    'simulation,final_balance',
    ...Array.from(result.outcomes, (w, i) => `${i + 1},${w.toFixed(2)}`),
  ];
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `retirement-sim_seed${v.seed}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------------- theme, glass, hero ---------------- */
function syncThemeButton() {
  const lt = document.documentElement.classList.contains('lt');
  $('theme-toggle').setAttribute('aria-label', lt ? 'Switch to dark theme' : 'Switch to light theme');
  document.querySelector('meta[name="theme-color"]').setAttribute('content', lt ? '#eceff3' : '#080c13');
}
$('theme-toggle').addEventListener('click', () => {
  const lt = document.documentElement.classList.toggle('lt');
  try { localStorage.setItem('retsim-theme', lt ? 'light' : 'dark'); } catch (e) { /* storage blocked */ }
  syncThemeButton(); tiles.redraw();
});
document.addEventListener('pointermove', (e) => {
  const g = e.target.closest?.('.glass');
  if (!g) return;
  const r = g.getBoundingClientRect();
  g.style.setProperty('--mx', `${e.clientX - r.left}px`);
  g.style.setProperty('--my', `${e.clientY - r.top}px`);
}, { passive: true });

/* Hero animation: a live fan chart of Emma's simulated savings (age 30 to 65), from the
   app's own engine. The shaded bands are the middle 50% and 90% of 400 simulations and
   the solid line is the median; individual simulated paths draw across it one after
   another and fade out. Paths ending above the goal (dashed line) are drawn darker.
   Paused off screen, in hidden tabs and for reduced motion. */
const tiles = (() => {
  const cv = $('hero-tiles'), ctx = cv.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const POOL = 400, DRAW_MS = 3400, HOLD_MS = 1800, FADE_MS = 2600, EVERY_MS = 900, INTRO_MS = 1600;
  const sim = S.simulate({ ...S.DEFAULTS, simulations: POOL, seed: 414 });
  const years = sim.years, goal = S.DEFAULTS.goal, age0 = S.DEFAULTS.currentAge;
  const band = S.bands(sim, [5, 25, 50, 75, 95]);
  const top = band[years][4] * 1.04;
  const yv = (w) => Math.sqrt(Math.max(w, 0) / top);   // square root keeps early years and late spread both visible
  const paths = Array.from({ length: POOL }, (_, s) => {
    const pts = [];
    for (let y = 0; y <= years; y++) pts.push(yv(sim.paths[s * (years + 1) + y]));
    return { pts, hit: sim.outcomes[s] >= goal };
  }).filter((p) => p.pts[years] < 1.02);            // skip the extreme top paths that would leave the frame
  let narrow = false, W = 0, H = 0, x0 = 0, x1 = 0, yTop = 0, yBot = 0, run = false, vis = true, last = 0, lastSpawn = -1e9, next = 0, t0 = 0;
  const live = [];
  function size() {
    const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    narrow = W < 1000;
    // line the chart up with the page's content column (max 1240px), right half
    const inner = document.querySelector('.hero-inner').getBoundingClientRect(), pad = parseFloat(getComputedStyle(document.querySelector('.hero-inner')).paddingRight) || 0;
    const cl = inner.left - r.left + pad, cr = inner.right - r.left - pad;
    x0 = narrow ? W * 0.06 : Math.max(cl + (cr - cl) * 0.55, 700); x1 = narrow ? W - 20 : cr - 84;
    yTop = H * 0.16; yBot = H - (narrow ? 26 : 44);
    draw(performance.now());
  }
  const px = (i) => x0 + (x1 - x0) * (i / years);
  const py = (v) => yBot - (yBot - yTop) * Math.min(v, 1.04);
  const ease = (t) => 1 - (1 - t) ** 3;
  function line(vals, upto) {
    const n = Math.floor(upto);
    ctx.moveTo(px(0), py(vals(0)));
    for (let i = 1; i <= n; i++) ctx.lineTo(px(i), py(vals(i)));
    if (n < years && upto > n) ctx.lineTo(px(upto), py(vals(n) + (vals(n + 1) - vals(n)) * (upto - n)));
  }
  function area(lo, hi, upto) {
    ctx.beginPath(); line((i) => yv(band[i][hi]), upto);
    const n = Math.min(years, Math.ceil(upto));
    for (let i = n; i >= 0; i--) ctx.lineTo(px(Math.min(i, upto)), py(yv(band[Math.min(i, years)][lo])));
    ctx.closePath(); ctx.fill();
  }
  function draw(now) {
    const lt = document.documentElement.classList.contains('lt');
    const acc = lt ? '31,91,151' : '116,169,221', ink = lt ? '16,40,72' : '232,240,248', muted = lt ? '93,106,124' : '127,140,157';
    const intro = still ? 1 : ease(Math.min(Math.max((now - t0) / INTRO_MS, 0), 1)), upto = intro * years;
    ctx.clearRect(0, 0, W, H);
    // axis: baseline and age ticks
    ctx.font = '500 10.5px "Geist Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.strokeStyle = `rgba(${muted},0.35)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, yBot + 0.5); ctx.lineTo(x1, yBot + 0.5); ctx.stroke();
    ctx.fillStyle = `rgba(${muted},0.9)`;
    for (const age of [30, 40, 50, 60, 65]) {
      const x = px(age - age0);
      ctx.beginPath(); ctx.moveTo(x, yBot); ctx.lineTo(x, yBot + 4); ctx.stroke();
      ctx.fillText(age === 30 ? 'AGE 30' : String(age), x, yBot + 8);
    }
    // bands and median
    ctx.fillStyle = `rgba(${acc},${lt ? 0.07 : 0.07})`; area(0, 4, upto);
    ctx.fillStyle = `rgba(${acc},${lt ? 0.11 : 0.12})`; area(1, 3, upto);
    // goal line + label
    const gy = py(yv(goal));
    ctx.setLineDash([3, 5]); ctx.strokeStyle = `rgba(${ink},${lt ? 0.35 : 0.4})`;
    ctx.beginPath(); ctx.moveTo(x0, gy + 0.5); ctx.lineTo(x1, gy + 0.5); ctx.stroke(); ctx.setLineDash([]);
    const my = py(yv(band[years][2]));
    // end labels sit in the right gutter; nudged apart when the median ends near the goal
    let gl = gy, ml = my;
    if (Math.abs(gl - ml) < 15) { const mid = (gl + ml) / 2, up = gl <= ml; gl = mid + (up ? -8 : 8); ml = mid + (up ? 8 : -8); }
    ctx.textBaseline = 'middle';
    if (!narrow) { ctx.textAlign = 'left'; ctx.fillStyle = `rgba(${ink},${lt ? 0.6 : 0.7})`; ctx.fillText('GOAL $1.5M', x1 + 12, gl); }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // individual simulated paths
    for (const L of live) {
      const age = now - L.t0;
      const prog = ease(Math.min(Math.max(age / DRAW_MS, 0), 1));
      const fade = age < DRAW_MS + HOLD_MS ? 1 : Math.max(0, 1 - (age - DRAW_MS - HOLD_MS) / FADE_MS);
      if (fade <= 0) continue;
      const end = prog * years;
      ctx.strokeStyle = L.p.hit ? `rgba(${ink},${(lt ? 0.55 : 0.6) * fade})` : `rgba(${acc},${(lt ? 0.45 : 0.5) * fade})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath(); line((i) => L.p.pts[i], end); ctx.stroke();
      if (prog < 1) {
        const n = Math.floor(end), v = L.p.pts[n] + ((L.p.pts[Math.min(n + 1, years)] - L.p.pts[n]) * (end - n));
        ctx.fillStyle = `rgba(${ink},${0.9 * fade})`;
        ctx.beginPath(); ctx.arc(px(end), py(v), 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    // median on top
    ctx.strokeStyle = `rgba(${acc},${lt ? 0.95 : 1})`; ctx.lineWidth = 2;
    ctx.beginPath(); line((i) => yv(band[i][2]), upto); ctx.stroke();
    if (intro >= 1) {
      ctx.fillStyle = `rgba(${acc},1)`; ctx.beginPath(); ctx.arc(x1, my, 3, 0, Math.PI * 2); ctx.fill();
      if (!narrow) { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('MEDIAN', x1 + 12, ml); }
    }
  }
  function loop(now) {
    if (!run) return;
    if (now - t0 > INTRO_MS * 0.6 && now - lastSpawn > EVERY_MS) {
      live.push({ p: paths[next], t0: now }); next = (next + 1) % paths.length; lastSpawn = now;
    }
    while (live.length && now - live[0].t0 > DRAW_MS + HOLD_MS + FADE_MS) live.shift();
    if (now - last > 33) { last = now; draw(now); }
    requestAnimationFrame(loop);
  }
  function go() {
    const want = vis && !document.hidden && !still;
    if (want && !run) { run = true; requestAnimationFrame(loop); } else if (!want) run = false;
  }
  function start() {
    t0 = performance.now();
    size();
    let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(size, 150); });
    document.addEventListener('visibilitychange', go);
    new IntersectionObserver((e) => { vis = e[0].isIntersecting; go(); }).observe(cv);
    if (document.fonts) document.fonts.ready.then(() => draw(performance.now()));
    go();
  }
  return { start, redraw: () => draw(performance.now()) };
})();

/* ---------------- install (PWA) ---------------- */
let deferredPrompt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
addEventListener('appinstalled', () => { deferredPrompt = null; $('install-btn').hidden = true; });
$('install-btn').addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null;
    return;
  }
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
  let steps;
  if (ios) steps = 'In Safari, tap the Share button, then “Add to Home Screen”.';
  else if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) steps = 'In Safari on a Mac, choose File › Add to Dock.';
  else if (/Firefox/.test(ua)) steps = 'Firefox does not install web apps on desktop. Open this page in Chrome or Edge and use the install icon in the address bar.';
  else if (/Edg/.test(ua)) steps = 'In Edge, open the … menu, then Apps › Install this site as an app. If it is already installed, choose “Open in app” in the address bar.';
  else steps = 'In Chrome, click the install icon at the right of the address bar, or open the ⋮ menu › Cast, save and share › Install page as app. If it is already installed, use “Open in app” in the address bar.';
  $('install-steps').textContent = steps;
  $('install-dlg').showModal();
});
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ }));
}

/* ---------------- wire up ---------------- */
fillSelect();
setForm(fromURL());
const R = S.RETURNS, worst = R.indexOf(Math.min(...R)), best = R.indexOf(Math.max(...R));
$('data-facts').textContent = `Average ${(S.MEAN * 100).toFixed(2)}% a year · standard deviation ${(S.SD * 100).toFixed(2)}% · worst ${S.FIRST_YEAR + worst} (${(R[worst] * 100).toFixed(1)}%) · best ${S.FIRST_YEAR + best} (+${(R[best] * 100).toFixed(1)}%) · ${R.filter((r) => r < 0).length} down years of ${R.length}.`;

$('form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
const touched = new Set();
$('form').addEventListener('input', liveCheck);
$('form').addEventListener('change', liveCheck);
for (const k of MONEY) $(k).addEventListener('blur', () => {
  const x = Number($(k).value.replace(/[$,\s]/g, ''));
  if ($(k).value.trim() !== '' && Number.isFinite(x)) $(k).value = x.toLocaleString('en-US');
});
$('reset-btn').addEventListener('click', () => { setForm(S.DEFAULTS); touched.clear(); liveCheck(); });
$('new-seed').addEventListener('click', () => { $('seed').value = Math.floor(Math.random() * 1e6); liveCheck(); });
$('pin-btn').addEventListener('click', () => { if (current) { pinned = { v: current.v, stats: current.result.stats }; drawTable(); } });
$('csv-btn').addEventListener('click', downloadCSV);
/* Copy a link that reproduces these exact results (inputs and seed are in the URL). */
if (location.protocol === 'file:') $('share-btn').hidden = true;   // offline copy has no shareable address
$('share-btn').addEventListener('click', async () => {
  const btn = $('share-btn'), url = location.href.split('#')[0];
  let ok = false;
  try { await navigator.clipboard.writeText(url); ok = true; } catch (e) {
    const t = document.createElement('textarea'); t.value = url; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    t.remove();
  }
  btn.textContent = ok ? 'Link copied' : 'Copy failed: use the address bar';
  setTimeout(() => { btn.textContent = 'Copy link to these results'; }, 2200);
});
syncThemeButton();
let lastNarrow = null, rzc;
addEventListener('resize', () => { clearTimeout(rzc); rzc = setTimeout(() => {
  const narrow = $('hist').clientWidth < 560;
  if (current && narrow !== lastNarrow) { drawHistogram(); drawFan(); }
  lastNarrow = narrow;
}, 150); });
tiles.start();
// Run once on open with the form's values (Emma's case, or the inputs in a shared link).
liveCheck();
if (!$('run-btn').disabled) run();
