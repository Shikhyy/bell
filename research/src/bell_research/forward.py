"""Score the pre-registered forward test.

forward/predictions/<bell>.json is written by cli/src/forward.ts before a bell. After the bell, run

    uv run python -m bell_research.feeds --update
    uv run python -m bell_research.forward

For each stock the target is the first Chainlink round whose updated_at is at or after the bell. We score
the DEX-centred forecast stored in the prediction file against the no-change baseline (the frozen oracle),
with the same Laplace CRPS and 80% coverage used in the backtest (forecast.py). Results are written to
forward/results/<bell>.json and forward/summary.json.
"""

from __future__ import annotations

import csv
import json
import math
import time
from pathlib import Path

from bell_research.forecast import LN5, crps_laplace

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "research" / "data"
FWD = ROOT / "forward"
GIVE_UP_S = 3600  # a stock with no print an hour after the bell counts as "no print"


def first_print(ticker: str, bell_ts: int):
    with open(DATA / "feeds" / f"{ticker}.csv") as f:
        for r in csv.DictReader(f):
            u = int(r["updated_at"])
            if u >= bell_ts:
                return int(r["answer"]) / 1e8, u
    return None


def baseline_scales() -> dict[str, float]:
    """Latest no-change scale (bp) per boundary kind from the backtest ledger (ends before the forward test)."""
    out: dict[str, float] = {}
    with open(DATA / "ledger.csv") as f:
        for r in csv.DictReader(f):
            if r["model"] == "no_change":
                out[r["kind"]] = float(r["scale_bp"])
    return out


def score_one(path: Path, now: float) -> dict:
    p = json.loads(path.read_text())
    bell_ts = p["bell"]["unix"]
    scales = baseline_scales()
    nc_scale_bp = scales.get(p["bell"]["kind"]) or max(scales.values())
    rows = []
    for fc in p["forecasts"]:
        ticker = fc["symbol"].removesuffix("c")
        hit = first_print(ticker, bell_ts)
        row = {"symbol": fc["symbol"], "dexPrice": fc["dexPrice"], "frozenPrice": fc["frozenOracle"]["price"], "scaleBp": fc["scaleBp"]}
        if hit is None:
            row["status"] = "no_print" if now - bell_ts > GIVE_UP_S else "pending"
            rows.append(row)
            continue
        post, upd = hit
        b = fc["scaleBp"] / 1e4
        bn = nc_scale_bp / 1e4
        e_dex = math.log(post / fc["dexPrice"])
        e_nc = math.log(post / fc["frozenOracle"]["price"])
        row.update({
            "status": "scored", "firstPrint": post, "printedAt": upd, "secondsAfterBell": upd - bell_ts,
            "insideBellMinute": 0 <= upd - bell_ts < 60,
            "errDexBp": round(e_dex * 1e4, 2), "errFrozenBp": round(e_nc * 1e4, 2),
            "crpsDexBp": round(crps_laplace(b, e_dex) * 1e4, 3), "crpsFrozenBp": round(crps_laplace(bn, e_nc) * 1e4, 3),
            "inBand80": abs(e_dex) <= b * LN5,
        })
        rows.append(row)
    s = [r for r in rows if r["status"] == "scored"]
    res = {"bell": p["bell"], "predictionSha256": p["contentSha256"], "madeAt": p["madeAt"], "scoredAt": int(now), "n": len(s), "stocks": rows}
    if s:
        res["crpsDexBp"] = round(sum(r["crpsDexBp"] for r in s) / len(s), 3)
        res["crpsFrozenBp"] = round(sum(r["crpsFrozenBp"] for r in s) / len(s), 3)
        res["maeDexBp"] = round(sum(abs(r["errDexBp"]) for r in s) / len(s), 2)
        res["maeFrozenBp"] = round(sum(abs(r["errFrozenBp"]) for r in s) / len(s), 2)
        res["coverage80"] = round(sum(r["inBand80"] for r in s) / len(s), 3)
        res["insideBellMinute"] = sum(r["insideBellMinute"] for r in s)
    return res


def main() -> None:
    now = time.time()
    (FWD / "results").mkdir(parents=True, exist_ok=True)
    allres = []
    for path in sorted((FWD / "predictions").glob("*.json")):
        res = score_one(path, now)
        (FWD / "results" / path.name).write_text(json.dumps(res, indent=1) + "\n")
        allres.append(res)
        print(f"{path.stem}: {res['n']}/{len(res['stocks'])} scored", end="")
        if res["n"]:
            print(f"  CRPS dex {res['crpsDexBp']} vs frozen {res['crpsFrozenBp']} bp  MAE {res['maeDexBp']} vs {res['maeFrozenBp']}  cov80 {res['coverage80']:.0%}  in-minute {res['insideBellMinute']}/{res['n']}")
        else:
            print()
    done = [r for r in allres if r["n"]]
    if done:
        n = sum(r["n"] for r in done)
        w = lambda k: sum(r[k] * r["n"] for r in done) / n
        summary = {"bells": len(done), "stocksScored": n, "crpsDexBp": round(w("crpsDexBp"), 3), "crpsFrozenBp": round(w("crpsFrozenBp"), 3),
                   "skill": round(1 - w("crpsDexBp") / w("crpsFrozenBp"), 4), "coverage80": round(w("coverage80"), 3)}
        (FWD / "summary.json").write_text(json.dumps(summary, indent=1) + "\n")
        print("forward summary:", summary)


if __name__ == "__main__":
    main()
