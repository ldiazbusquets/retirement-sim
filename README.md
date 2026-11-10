# Retirement Simulator

An interactive Monte Carlo retirement savings simulator, built for **FIN 414 AI Applications in Finance (Bryant University), Applied Project I**. It turns **Mini Project 2 (Retirement Simulation)** from a Colab notebook into a web app anyone can use.

**Live app:** https://ldiazbusquets.github.io/retirement-sim/

## What it does
Enter your current age, retirement age, yearly contribution, current savings and goal. The app simulates thousands of possible paths for the stock market and reports:
- the chance of reaching the goal (share of simulations that end at or above it)
- the mean, median, and 5th / 25th / 75th / 95th percentile final balances
- a histogram of final balances with the goal marked, and a growth chart by age
- a side-by-side comparison with a saved scenario, and a CSV download of every simulated outcome

Default inputs are the Mini Project 2 case (Emma: age 30, $12,000 a year, $1.5M goal at 65, 10,000 simulations).

## Method
- **Data:** S&P 500 (^GSPC) year-end closes from Yahoo Finance, 1929–2023 (same request as the notebook: 1929-01-01 to 2024-01-01), giving 94 annual price returns for 1930–2023. Stored in `data/sp500_annual_returns.json` and embedded in `sim.js`.
- **Normal model (notebook default):** each year's return is drawn from a normal distribution with the historical mean (7.74%) and sample standard deviation (18.91%), floored at −100%.
- **Historical model:** each year's return is one of the 94 real years, drawn with replacement.
- **Contributions:** end of year, `B = B(1+r) + C` (notebook default), or beginning of year, `B = (B+C)(1+r)`.
- **Reproducible:** seeded random numbers (mulberry32 + Box-Muller); the same inputs and seed always give the same results, and the seed is part of the shareable URL.

Limitations: price returns exclude dividends, amounts are nominal and pre-tax, and the whole balance is in one index. Educational use only, not financial advice.

## Python notebook
[Open in Colab](https://colab.research.google.com/github/ldiazbusquets/retirement-sim/blob/main/notebook/retirement_simulation.ipynb): `notebook/retirement_simulation.ipynb` runs the same simulation in Python, the way Mini Project 2 was done, and matches the website's results for Emma to the dollar. It also shows the hand checks, the what-ifs, and a plain NumPy version for comparison.

## Files
| File | Purpose |
|---|---|
| `sim.js` | Simulation engine (pure functions, runs in the browser and in Node) |
| `app.js`, `index.html`, `styles.css` | The page: form, charts, tables |
| `notebook/retirement_simulation.ipynb` | Colab notebook: the same simulation in Python, matching the app |
| `tests/reference.py` | Independent Python version of the notebook logic |
| `tests/test_engine.py` | Tests: data, JS-vs-Python parity, finance checks, input validation |
| `sw.js`, `manifest.webmanifest` | Installable app and offline use |
| `.github/workflows/deploy.yml` | Runs the tests, then deploys to GitHub Pages |

## Run the tests
```
python3 -m unittest discover -s tests -v    # needs Python 3 and Node 18+
```

## Run locally
```
python3 -m http.server 8000    # then open http://localhost:8000
```
