"""Python reference for the Retirement Simulator (the Mini Project 2 logic, written the
way the Colab notebook does it), with the same seeded random numbers as sim.js so the
two can be compared number for number."""
import json, math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / "data" / "sp500_annual_returns.json").read_text())


def returns():
    """The annual returns stored with the data (rounded to 6 decimals, same list as sim.js)."""
    return [r["return"] for r in DATA["annual_returns"]]


def returns_from_closes():
    """Recompute the returns from the year-end closes, like close.pct_change() in the notebook."""
    c = [row["close"] for row in DATA["year_end_close"]]
    return [c[i] / c[i - 1] - 1 for i in range(1, len(c))]


def rng(seed):
    a = seed & 0xFFFFFFFF
    def imul(x, y):
        return (x * y) & 0xFFFFFFFF
    def nxt():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return nxt


def simulate(current_age, retirement_age, contribution, start_balance, sims, timing, model, seed, mean=None, sd=None):
    R = returns()
    n = len(R)
    hist_mean = sum(R) / n
    mean = hist_mean if mean is None else mean
    sd = math.sqrt(sum((r - hist_mean) ** 2 for r in R) / (n - 1)) if sd is None else sd
    rand = rng(seed)
    out = []
    for _ in range(sims):
        w = start_balance
        for _ in range(retirement_age - current_age):
            if model == "normal":
                u1, u2 = 1 - rand(), rand()
                r = max(mean + sd * math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2), -1.0)
            else:
                r = R[math.floor(rand() * n)]
            w = (w + contribution) * (1 + r) if timing == "begin" else w * (1 + r) + contribution
        out.append(w)
    return out


def percentile(values, p):
    s = sorted(values)
    pos = (len(s) - 1) * p / 100
    lo, hi = math.floor(pos), math.ceil(pos)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)
