/* Retirement Simulator engine (FIN 414 Applied Project I, built from Mini Project 2).
   Pure functions, no page code, so the same file runs in the browser and in the tests
   (tests/test_engine.py runs it through Node and compares it with a Python reference). */
(function (root) {
  'use strict';

  /* S&P 500 (^GSPC) annual price returns, 1930-2023: year-end closes from Yahoo Finance,
     1929-2023, the same request as the Mini Project 2 notebook. Dividends not included.
     Full table with closes: data/sp500_annual_returns.json */
  const FIRST_YEAR = 1930;
  const RETURNS = [-0.284848, -0.470665, -0.147783, 0.440751, -0.047141, 0.413684, 0.279226, -0.385914, 0.245498, -0.05175, -0.150883, -0.178639, 0.124281, 0.194473, 0.137961, 0.307229, -0.118664, 0.0, -0.006536, 0.104605, 0.216796, 0.163485, 0.117796, -0.06624, 0.450222, 0.264036, 0.026165, -0.143133, 0.380595, 0.084767, -0.029721, 0.231285, -0.118099, 0.188906, 0.129699, 0.090619, -0.13091, 0.200921, 0.076604, -0.113614, 0.000978, 0.107868, 0.156333, -0.173655, -0.297181, 0.31549, 0.191485, -0.11502, 0.01062, 0.123088, 0.257736, -0.097304, 0.147613, 0.17271, 0.014006, 0.263334, 0.146204, 0.020275, 0.124008, 0.272505, -0.065591, 0.263067, 0.044643, 0.070552, -0.015393, 0.341107, 0.202637, 0.310082, 0.266686, 0.19526, -0.101392, -0.130427, -0.23366, 0.263804, 0.089935, 0.03001, 0.136194, 0.035296, -0.384858, 0.234542, 0.127827, -3.2e-05, 0.134057, 0.296013, 0.113906, -0.007266, 0.09535, 0.1942, -0.062373, 0.288781, 0.162589, 0.268927, -0.194428, 0.242305];

  const n = RETURNS.length;
  const MEAN = RETURNS.reduce((s, r) => s + r, 0) / n;
  // Sample standard deviation (n - 1), the pandas .std() default used in the notebooks.
  const SD = Math.sqrt(RETURNS.reduce((s, r) => s + (r - MEAN) ** 2, 0) / (n - 1));

  const LIMITS = {
    currentAge: [18, 79], retirementAge: [19, 80], contribution: [0, 1e6],
    startBalance: [0, 1e8], goal: [1, 1e9],
  };
  const SIM_OPTIONS = [1000, 5000, 10000, 25000, 50000];
  const DEFAULTS = {
    currentAge: 30, retirementAge: 65, contribution: 12000, startBalance: 0, goal: 1500000,
    simulations: 10000, timing: 'begin', model: 'normal', seed: 2026,  // start of year, as in our Mini Project 2
  };

  /** Seeded random numbers (mulberry32): the same seed always gives the same sequence. */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Check inputs. Returns { values, errors, notes }; errors is keyed by field. */
  function validate(raw) {
    const errors = {}, notes = {}, v = {};
    const asNumber = (key, label) => {
      const s = String(raw[key] ?? '').replace(/[$,\s]/g, '');
      if (s === '') { errors[key] = `Enter ${label}.`; return null; }
      const x = Number(s);
      if (!Number.isFinite(x)) { errors[key] = 'Enter a number.'; return null; }
      return x;
    };
    const ageField = (key, label) => {
      let x = asNumber(key, label);
      if (x === null) return null;
      if (!Number.isInteger(x)) { notes[key] = `Rounded to ${Math.round(x)}: the simulation moves one year at a time.`; x = Math.round(x); }
      return x;
    };
    v.currentAge = ageField('currentAge', 'your current age');
    v.retirementAge = ageField('retirementAge', 'a retirement age');
    v.contribution = asNumber('contribution', 'an annual contribution');
    v.startBalance = asNumber('startBalance', 'a starting balance');
    v.goal = asNumber('goal', 'a goal');

    const [aMin, aMax] = LIMITS.currentAge, [rMin, rMax] = LIMITS.retirementAge;
    if (v.currentAge !== null && (v.currentAge < aMin || v.currentAge > aMax)) errors.currentAge = `Age must be between ${aMin} and ${aMax}.`;
    if (v.retirementAge !== null && (v.retirementAge < rMin || v.retirementAge > rMax)) errors.retirementAge = `Retirement age must be between ${rMin} and ${rMax}.`;
    if (v.currentAge !== null && v.retirementAge !== null && !errors.currentAge && !errors.retirementAge && v.retirementAge <= v.currentAge) {
      errors.retirementAge = 'Retirement age must be after your current age.';
    }
    for (const [key, label] of [['contribution', 'Contribution'], ['startBalance', 'Starting balance'], ['goal', 'Goal']]) {
      if (v[key] === null || errors[key]) continue;
      const [lo, hi] = LIMITS[key];
      if (v[key] < 0) errors[key] = `${label} must be 0 or more.`;
      else if (v[key] < lo) errors[key] = `${label} must be at least $${lo.toLocaleString('en-US')}.`;
      else if (v[key] > hi) errors[key] = `${label} can be at most $${hi.toLocaleString('en-US')}.`;
    }
    v.simulations = Number(raw.simulations);
    if (!SIM_OPTIONS.includes(v.simulations)) errors.simulations = 'Choose a number of simulations from the list.';
    v.timing = raw.timing === 'begin' ? 'begin' : raw.timing === 'end' ? 'end' : null;
    if (!v.timing) errors.timing = 'Choose when contributions are made.';
    v.model = raw.model === 'historical' ? 'historical' : raw.model === 'normal' ? 'normal' : null;
    if (!v.model) errors.model = 'Choose a return model.';
    const seed = Number(String(raw.seed ?? '').trim());
    if (String(raw.seed ?? '').trim() === '' || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) errors.seed = 'Seed must be a whole number from 0 to 4,294,967,295.';
    v.seed = seed;
    if (!Object.keys(errors).length && v.contribution === 0 && v.startBalance === 0) {
      notes.contribution = 'With no contribution and no starting balance, wealth stays at $0.';
    }
    return { values: v, errors, notes, ok: Object.keys(errors).length === 0 };
  }

  /** Linear-interpolation percentile, the same method as numpy.percentile's default. */
  function percentile(sorted, p) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * (p / 100), lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /**
   * Run the Monte Carlo simulation (Mini Project 2 logic).
   * Each simulation: for every year until retirement, draw one annual return, then
   *   end-of-year timing:       balance = balance * (1 + r) + contribution
   *   beginning-of-year timing: balance = (balance + contribution) * (1 + r)
   * Normal model: r ~ Normal(MEAN, SD) by Box-Muller, floored at -100%.
   * Historical model: r = one of the 94 historical years, drawn with replacement.
   */
  function simulate(v, opts) {
    const keepPaths = !opts || opts.keepPaths !== false;
    // opts.fixedReturn (tests only): every year earns this return, to check the arithmetic by hand.
    const fixed = opts && typeof opts.fixedReturn === 'number' ? opts.fixedReturn : null;
    const years = v.retirementAge - v.currentAge;
    const sims = v.simulations, rand = rng(v.seed);
    const outcomes = new Float64Array(sims);
    const paths = keepPaths ? new Float64Array(sims * (years + 1)) : null;
    let floored = 0;
    for (let s = 0; s < sims; s++) {
      let balance = v.startBalance;
      if (paths) paths[s * (years + 1)] = balance;
      for (let y = 1; y <= years; y++) {
        let r;
        if (fixed !== null) {
          r = fixed;
        } else if (v.model === 'normal') {
          const u1 = 1 - rand(), u2 = rand();
          r = MEAN + SD * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
          if (r < -1) { r = -1; floored++; }
        } else {
          r = RETURNS[Math.floor(rand() * n)];
        }
        balance = v.timing === 'begin' ? (balance + v.contribution) * (1 + r) : balance * (1 + r) + v.contribution;
        if (paths) paths[s * (years + 1) + y] = balance;
      }
      outcomes[s] = balance;
    }
    return { years, outcomes, paths, floored, stats: summarize(outcomes, v, years) };
  }

  function summarize(outcomes, v, years) {
    const sorted = Float64Array.from(outcomes).sort();
    let sum = 0, hit = 0;
    for (const w of outcomes) { sum += w; if (w >= v.goal) hit++; }
    return {
      mean: sum / outcomes.length,
      median: percentile(sorted, 50),
      p5: percentile(sorted, 5), p25: percentile(sorted, 25), p75: percentile(sorted, 75), p95: percentile(sorted, 95),
      min: sorted[0], max: sorted[sorted.length - 1],
      probability: hit / outcomes.length, hits: hit,
      contributed: v.startBalance + v.contribution * years,
    };
  }

  /** Percentile bands of wealth for every year (for the growth chart). */
  function bands(result, ps) {
    const { paths, years, outcomes } = result, sims = outcomes.length, out = [];
    const col = new Float64Array(sims);
    for (let y = 0; y <= years; y++) {
      for (let s = 0; s < sims; s++) col[s] = paths[s * (years + 1) + y];
      col.sort();
      out.push(ps.map((p) => percentile(col, p)));
    }
    return out;
  }

  /** Histogram counts over [lo, hi]; values beyond hi go in the last bin. */
  function histogram(outcomes, bins, hi) {
    const lo = 0, width = (hi - lo) / bins, counts = new Array(bins).fill(0);
    for (const w of outcomes) counts[Math.min(bins - 1, Math.max(0, Math.floor((w - lo) / width)))]++;
    return { lo, hi, width, counts };
  }

  /** Expected (average) final wealth implied by the formula, for the normal model. */
  function expectedWealth(v) {
    const g = 1 + MEAN, T = v.retirementAge - v.currentAge;
    const annuity = MEAN === 0 ? T : (g ** T - 1) / MEAN;
    const contrib = v.timing === 'begin' ? v.contribution * annuity * g : v.contribution * annuity;
    return v.startBalance * g ** T + contrib;
  }

  const api = { RETURNS, FIRST_YEAR, MEAN, SD, LIMITS, SIM_OPTIONS, DEFAULTS, rng, validate, simulate, summarize, percentile, bands, histogram, expectedWealth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RetirementSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
