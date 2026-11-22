"""Backtest: does the closed-market DEX price forecast the reopen?

For each scheduled boundary in data/jumps.csv we forecast the first post-bell feed value
(the reference market's reopen print) with two Gaussian predictive distributions in log space:

  no_change   centre = last feed value before the market went dark
  dex         centre = the Aerodrome pool price 30s before the bell

Each model's width sigma is the RMS of its own *past* log errors (expanding window, events
strictly earlier in time, pooled across tokens), so every score is out of sample. We score
with CRPS (a proper scoring rule; Gneiting & Raftery 2007), 80% band coverage and PIT,
instead of information-share tests, which have no power on oracle marks (Seo et al. 2026).

Outputs
  data/ledger.csv           one row per (event, model)
  data/ledger_summary.json  aggregate scores overall and by boundary kind
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import polars as pl

DATA = Path(__file__).resolve().parents[2] / "data"
WARMUP = 15  # events needed before a model's sigma is trusted
Z80 = 1.2815515655446004
SQRT_PI = math.sqrt(math.pi)


def phi(z: float) -> float:
    return math.exp(-0.5 * z * z) / math.sqrt(2 * math.pi)


def Phi(z: float) -> float:
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def crps_gauss(mu: float, sigma: float, y: float) -> float:
    z = (y - mu) / sigma
    return sigma * (z * (2 * Phi(z) - 1) + 2 * phi(z) - 1 / SQRT_PI)


# Reopen errors are heavy-tailed (most within ~10 bp, a few beyond 150 bp), so a Gaussian sized
# by RMS error is far too wide for the typical event. Laplace(0, b) with b = mean |past error|
# matches that shape and keeps closed forms for CRPS, CDF and central bands.
LN5 = math.log(5)  # P(|X| <= b ln 5) = 0.8 under Laplace(0, b)


def crps_laplace(b: float, e: float) -> float:
    a = abs(e)
    return a + b * math.exp(-a / b) - 0.75 * b


def cdf_laplace(b: float, e: float) -> float:
    return 0.5 * math.exp(e / b) if e < 0 else 1 - 0.5 * math.exp(-e / b)


def kind_of(dow: str, hhmm: str) -> str:
    if dow == "Sun" and "20:00" <= hhmm <= "20:29":
        return "sun_reopen"
    if "09:30" <= hhmm <= "09:59":
        return "open_0930"
    if "04:00" <= hhmm <= "04:29":
        return "pre_0400"
    if "20:00" <= hhmm <= "20:29":
        return "overnight_2000"
    return "other"


def load_events() -> pl.DataFrame:
    d = pl.read_csv(DATA / "jumps.csv", infer_schema_length=None, null_values=["nan", "inf", "-inf"])
    d = d.unique(subset=["ticker", "wake_ts"]).drop_nulls(["feed_pre", "feed_post", "pool_pre"]).sort("wake_ts")
    return d.with_columns(
        kind=pl.struct("wake_dow", "wake_ny").map_elements(
            lambda r: kind_of(r["wake_dow"], r["wake_ny"][11:16]), return_dtype=pl.String
        )
    )


def run() -> dict:
    ev = load_events()
    models = {"no_change": "feed_pre", "dex": "pool_pre"}
    past_abs: dict[str, list[float]] = {m: [] for m in models}
    past_kind: dict[tuple[str, str], list[float]] = {}
    rows = []
    for r in ev.iter_rows(named=True):
        y = math.log(r["feed_post"])
        for m, col in models.items():
            mu = math.log(r[col])
            err = y - mu
            # Scale from this boundary type's own history once it has enough, else pooled history.
            own = past_kind.setdefault((m, r["kind"]), [])
            hist = own if len(own) >= WARMUP else past_abs[m]
            if len(past_abs[m]) >= WARMUP:
                # Robust Laplace scale: median |X| = b ln 2, so b = median(|past errors|) / ln 2.
                # (The mean is dragged up by a few >150 bp events and over-widens every band.)
                srt = sorted(hist)
                b = max(srt[len(srt) // 2] / math.log(2), 1e-6)
                pit = cdf_laplace(b, err)
                rows.append({
                    "ticker": r["ticker"], "wake_ts": r["wake_ts"], "wake_ny": r["wake_ny"], "kind": r["kind"], "model": m,
                    "center": r[col], "feed_post": r["feed_post"], "scale_bp": b * 1e4, "band80_bp": b * LN5 * 1e4,
                    "err_bp": err * 1e4, "pit": pit, "crps_bp": crps_laplace(b, err) * 1e4, "in80": abs(err) <= b * LN5,
                })
            past_abs[m].append(abs(err))  # update only after scoring: strictly out of sample
            own.append(abs(err))

    led = pl.DataFrame(rows)
    led.write_csv(DATA / "ledger.csv")

    def summarise(df: pl.DataFrame) -> dict:
        out: dict = {"n": int(df.filter(pl.col("model") == "dex").height)}
        for m in models:
            s = df.filter(pl.col("model") == m)
            if s.height == 0:
                continue
            pits = s["pit"].to_list()
            out[m] = {
                "crps_bp": round(float(s["crps_bp"].mean()), 3),
                "mae_bp": round(float(s["err_bp"].abs().mean()), 3),
                "coverage80": round(float(s["in80"].mean()), 4),
                "pit_hist": [sum(1 for p in pits if k / 10 <= p < (k + 1) / 10 or (k == 9 and p == 1.0)) for k in range(10)],
                "reliability": [
                    {"nominal": q, "realised": round(sum(1 for p in pits if abs(p - 0.5) <= q / 2) / len(pits), 4)}
                    for q in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95)
                ],
            }
        if "dex" in out and "no_change" in out and out["no_change"]["crps_bp"] > 0:
            out["skill_dex_vs_no_change"] = round(1 - out["dex"]["crps_bp"] / out["no_change"]["crps_bp"], 4)
        return out

    summary = {
        "method": "Laplace log-space forecasts; scale = expanding median |past error| / ln 2 per boundary type (pooled until 15 events), out of sample, pooled across tokens",
        "warmup_events": WARMUP,
        "first": led["wake_ny"].min() if led.height else None,
        "last": led["wake_ny"].max() if led.height else None,
        "overall": summarise(led),
        "by_kind": {k: summarise(led.filter(pl.col("kind") == k)) for k in sorted(set(led["kind"].to_list()))} if led.height else {},
    }
    (DATA / "ledger_summary.json").write_text(json.dumps(summary, indent=1))
    return summary


if __name__ == "__main__":
    s = run()
    o = s["overall"]
    print(f"{o['n']} events scored ({s['first']} → {s['last']}), warm-up {s['warmup_events']}")
    for m in ("no_change", "dex"):
        if m in o:
            print(f"  {m:10} CRPS {o[m]['crps_bp']:7.2f} bp   MAE {o[m]['mae_bp']:7.2f} bp   80% coverage {o[m]['coverage80']:.1%}")
    if "skill_dex_vs_no_change" in o:
        print(f"  skill of the weekend DEX price over no-change: {o['skill_dex_vs_no_change']:+.1%}")
    for k, v in s["by_kind"].items():
        if "skill_dex_vs_no_change" in v:
            print(f"  {k:15} n={v['n']:4}  DEX CRPS {v['dex']['crps_bp']:6.2f} bp vs {v['no_change']['crps_bp']:6.2f}  skill {v['skill_dex_vs_no_change']:+.1%}  cov80 {v['dex']['coverage80']:.0%}")
