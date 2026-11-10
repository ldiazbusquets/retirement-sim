"""Tests for the Retirement Simulator engine (sim.js), run with:  python3 -m unittest discover tests
sim.js is executed through Node, so these test the exact code the website runs."""
import json, math, subprocess, unittest
from pathlib import Path

from reference import ROOT, percentile, returns, returns_from_closes, simulate

DEFAULTS = dict(currentAge=30, retirementAge=65, contribution=12000, startBalance=0, goal=1500000,
                simulations=10000, timing="end", model="normal", seed=2026)


def js(expr):
    """Evaluate a JavaScript expression with S = sim.js and return it as Python data."""
    code = f"const S=require({json.dumps(str(ROOT / 'sim.js'))});const out=({expr});" \
           "console.log(JSON.stringify(out,(k,v)=>ArrayBuffer.isView(v)?Array.from(v):v));"
    res = subprocess.run(["node", "-e", code], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def run_js(**over):
    v = {**DEFAULTS, **over}
    return js(f"(()=>{{const c=S.validate({json.dumps(v)});if(!c.ok)return c;const r=S.simulate(c.values,{{keepPaths:false}});return {{stats:r.stats,outcomes:r.outcomes}};}})()")


class Data(unittest.TestCase):
    def test_returns_match_closes(self):
        embedded = js("S.RETURNS")
        self.assertEqual(len(embedded), 94)
        self.assertEqual(embedded, returns())
        for a, b in zip(embedded, returns_from_closes()):
            self.assertAlmostEqual(a, b, delta=5e-7)

    def test_known_years(self):
        R = returns()
        self.assertAlmostEqual(R[2008 - 1930], -0.384858, places=6)
        self.assertAlmostEqual(min(R), R[1931 - 1930])

    def test_mean_and_sd(self):
        m, sd = js("[S.MEAN,S.SD]")
        R = returns()
        mean = sum(R) / len(R)
        self.assertAlmostEqual(m, mean, places=12)
        self.assertAlmostEqual(sd, math.sqrt(sum((r - mean) ** 2 for r in R) / (len(R) - 1)), places=12)
        self.assertAlmostEqual(m, 0.0774, places=4)
        self.assertAlmostEqual(sd, 0.1891, places=4)


class Parity(unittest.TestCase):
    """Same inputs and seed give the same outcomes in the website engine and the Python reference."""

    def check(self, **over):
        v = {**DEFAULTS, "simulations": 1000, **over}
        got = run_js(**v)["outcomes"]
        want = simulate(v["currentAge"], v["retirementAge"], v["contribution"], v["startBalance"],
                        v["simulations"], v["timing"], v["model"], v["seed"])
        self.assertEqual(len(got), len(want))
        for a, b in zip(got, want):
            self.assertAlmostEqual(a, b, delta=max(1e-6, abs(b) * 1e-12))

    def test_normal_end(self): self.check()
    def test_normal_begin(self): self.check(timing="begin", seed=7)
    def test_historical_end(self): self.check(model="historical", seed=42)
    def test_historical_begin_with_balance(self): self.check(model="historical", timing="begin", startBalance=50000, currentAge=45)

    def test_percentiles_match_numpy_method(self):
        r = run_js()
        vals = simulate(30, 65, 12000, 0, 10000, "end", "normal", 2026)
        for key, p in [("p5", 5), ("p25", 25), ("median", 50), ("p75", 75), ("p95", 95)]:
            self.assertAlmostEqual(r["stats"][key], percentile(vals, p), delta=1e-6)
        self.assertAlmostEqual(r["stats"]["probability"], sum(w >= 1500000 for w in vals) / len(vals))


class Finance(unittest.TestCase):
    def test_zero_returns_gives_contributions(self):
        # With every return at 0%, wealth is exactly what was put in: 35 x $12,000 = $420,000.
        fixed = lambda r, **o: js(f"S.simulate(S.validate({json.dumps({**DEFAULTS, 'simulations': 1000, **o})}).values,{{fixedReturn:{r}}}).stats")
        s = fixed(0)
        self.assertEqual((s["mean"], s["min"], s["max"]), (420000, 420000, 420000))
        self.assertEqual(s["contributed"], 420000)
        self.assertEqual(s["probability"], 0)
        # At a constant 7%, end-of-year timing is the future value of an ordinary annuity.
        fv = 12000 * ((1.07 ** 35 - 1) / 0.07)
        self.assertAlmostEqual(fixed(0.07)["mean"], fv, delta=1e-4)
        self.assertAlmostEqual(fixed(0.07, timing="begin")["mean"], fv * 1.07, delta=1e-4)
        self.assertAlmostEqual(fixed(0, startBalance=50000, contribution=0)["median"], 50000)

    def test_mean_close_to_formula(self):
        exp_end, exp_begin = js(f"[S.expectedWealth({json.dumps(DEFAULTS)}),S.expectedWealth({json.dumps({**DEFAULTS,'timing':'begin'})})]")
        self.assertAlmostEqual(exp_end, 1953152, delta=5)
        for timing, exp in [("end", exp_end), ("begin", exp_begin)]:
            m = run_js(simulations=50000, timing=timing)["stats"]["mean"]
            self.assertLess(abs(m - exp) / exp, 0.03, f"{timing}: mean {m:,.0f} vs formula {exp:,.0f}")

    def test_beginning_of_year_is_higher(self):
        a, b = run_js()["stats"], run_js(timing="begin")["stats"]
        self.assertGreater(b["mean"], a["mean"])
        self.assertAlmostEqual(b["mean"] / a["mean"], 1 + js("S.MEAN"), delta=0.002)

    def test_directions(self):
        base = run_js()["stats"]["probability"]
        self.assertGreater(run_js(contribution=15000)["stats"]["probability"], base)
        self.assertGreater(run_js(retirementAge=67)["stats"]["probability"], base)
        self.assertLess(run_js(goal=2000000)["stats"]["probability"], base)
        self.assertLess(run_js(currentAge=35)["stats"]["probability"], base)

    def test_same_seed_same_answer_and_new_seed_differs(self):
        self.assertEqual(run_js()["stats"], run_js()["stats"])
        self.assertNotEqual(run_js()["stats"]["mean"], run_js(seed=2027)["stats"]["mean"])

    def test_order_of_percentiles(self):
        s = run_js()["stats"]
        self.assertTrue(s["min"] <= s["p5"] <= s["p25"] <= s["median"] <= s["p75"] <= s["p95"] <= s["max"])
        self.assertGreater(s["mean"], s["median"])  # wealth is right-skewed


class CustomReturns(unittest.TestCase):
    """Optional expected return and volatility for the normal model."""

    def test_historical_figures_as_shown_mean_the_exact_values(self):
        v = js(f"S.validate({json.dumps({**DEFAULTS, 'meanReturn': '7.74', 'volatility': '18.91'})}).values")
        m, sd = js("[S.MEAN,S.SD]")
        self.assertEqual((v["meanReturn"], v["volatility"]), (m, sd))
        self.assertEqual(run_js(meanReturn="7.74", volatility="18.91")["stats"], run_js()["stats"])

    def test_zero_return_zero_volatility_is_hand_calculation(self):
        s = run_js(meanReturn="0", volatility="0", simulations=1000)["stats"]
        self.assertEqual((s["min"], s["max"]), (420000, 420000))

    def test_constant_return_matches_annuity(self):
        s = run_js(meanReturn="7", volatility="0", simulations=1000, timing="begin")["stats"]
        self.assertAlmostEqual(s["mean"], 12000 * ((1.07 ** 35 - 1) / 0.07) * 1.07, delta=1e-4)

    def test_parity_with_python(self):
        v = {**DEFAULTS, "simulations": 1000, "seed": 99, "meanReturn": "5", "volatility": "15"}
        got = run_js(**v)["outcomes"]
        want = simulate(30, 65, 12000, 0, 1000, "end", "normal", 99, mean=0.05, sd=0.15)
        for a, b in zip(got, want):
            self.assertAlmostEqual(a, b, delta=max(1e-6, abs(b) * 1e-12))

    def test_lower_return_lowers_probability(self):
        self.assertLess(run_js(meanReturn="5")["stats"]["probability"], run_js()["stats"]["probability"])

    def test_validation(self):
        err = lambda **o: js(f"S.validate({json.dumps({**DEFAULTS, **o})}).errors")
        self.assertIn("meanReturn", err(meanReturn="31"))
        self.assertIn("meanReturn", err(meanReturn="abc"))
        self.assertIn("volatility", err(volatility="-1"))
        self.assertEqual(err(meanReturn="", volatility=""), {})


class WhatWouldItTake(unittest.TestCase):
    """requiredContribution / requiredRetirementAge give the smallest change that reaches the target."""

    def prob(self, **over):
        return run_js(**over)["stats"]["probability"]

    def test_contribution_is_the_smallest_that_works(self):
        for target in (0.75, 0.9):
            c = js(f"S.requiredContribution(S.validate({json.dumps(DEFAULTS)}).values,{target})")
            self.assertGreaterEqual(self.prob(contribution=c), target)
            self.assertLess(self.prob(contribution=c * 0.999), target)
            self.assertGreaterEqual(self.prob(contribution=math.ceil(c / 100) * 100), target)

    def test_contribution_with_starting_balance_and_end_timing(self):
        base = {**DEFAULTS, "startBalance": 50000, "timing": "end", "simulations": 5000}
        c = js(f"S.requiredContribution(S.validate({json.dumps(base)}).values,0.8)")
        self.assertGreaterEqual(self.prob(**{**base, "contribution": c}), 0.8)
        self.assertLess(self.prob(**{**base, "contribution": c * 0.999}), 0.8)

    def test_retirement_age_is_the_earliest_that_works(self):
        r = js(f"S.requiredRetirementAge(S.validate({json.dumps(DEFAULTS)}).values,0.75)")
        self.assertGreaterEqual(r["probability"], 0.75)
        self.assertAlmostEqual(self.prob(retirementAge=r["age"]), r["probability"])
        self.assertLess(self.prob(retirementAge=r["age"] - 1), 0.75)

    def test_retirement_age_none_when_unreachable(self):
        self.assertIsNone(js(f"S.requiredRetirementAge(S.validate({json.dumps({**DEFAULTS, 'contribution': 1000})}).values,0.9)"))


class Validation(unittest.TestCase):
    def errors(self, **over):
        return js(f"S.validate({json.dumps({**DEFAULTS, **over})}).errors")

    def test_defaults_ok(self): self.assertEqual(self.errors(), {})
    def test_retire_before_age(self): self.assertIn("retirementAge", self.errors(retirementAge=30))
    def test_age_out_of_range(self):
        self.assertIn("currentAge", self.errors(currentAge=17))
        self.assertIn("retirementAge", self.errors(retirementAge=81))
    def test_negative_and_blank(self):
        self.assertIn("contribution", self.errors(contribution=-1))
        self.assertIn("goal", self.errors(goal=""))
        self.assertIn("goal", self.errors(goal=0))
        self.assertIn("startBalance", self.errors(startBalance="abc"))
    def test_money_formatting_accepted(self):
        self.assertEqual(self.errors(contribution="$12,000", goal="1,500,000"), {})
    def test_bad_choices(self):
        self.assertIn("simulations", self.errors(simulations=123))
        self.assertIn("simulations", self.errors(simulations=1000000))
        self.assertIn("seed", self.errors(seed=-1))
        self.assertIn("seed", self.errors(seed=1.5))
    def test_decimal_age_rounded(self):
        c = js(f"S.validate({json.dumps({**DEFAULTS, 'currentAge': 30.6})})")
        self.assertEqual(c["values"]["currentAge"], 31)
        self.assertIn("currentAge", c["notes"])


if __name__ == "__main__":
    unittest.main()
