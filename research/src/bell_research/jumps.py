"""Measure what each scheduled reopen costs Aerodrome LPs, from pool state snapshots.

Free-tier RPCs cap eth_getLogs at a few blocks, and Base makes a block every 0.2s, so
pulling every swap is impractical. We don't need every swap: for a jump from the pool's
pre-bell price P0 to the market's post-bell price P1, the value an arbitrageur extracts
from concentrated liquidity L (Milionis et al. 2022, discrete-jump form) is

    LVR = L * (sqrt(P1) - sqrt(P0))**2 / sqrt(P0)      (token1 raw units)

where P is Uniswap's raw price (token1 per token0). We read slot0 and liquidity at
t-30s, t+2s, t+60s and t+600s around each feed wake-up t (the bell), which also shows
how fast the pool converges to the market.

Approximations, stated in the paper: L is the active liquidity at t-30s (moves that cross
initialized ticks see different L), and the pool fee (3-4 bp) is ignored, which slightly
overstates the loss for jumps close to the fee.

Output: data/jumps.csv
  ticker, pool, wake_ts, wake_ny, wake_dow, gap_h, feed_pre, feed_post, jump_pct,
  pool_pre, pool_2s, pool_60s, pool_600s, weekend_share, gap_left_2s_bp,
  gap_left_60s_bp, liq_pre, lvr_usd
"""

from __future__ import annotations

import bisect
import csv
import json
import math
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

from .boundaries import gaps, load

DATA = Path(__file__).resolve().parents[2] / "data"
NY = ZoneInfo("America/New_York")
RPC = os.environ.get("BASE_ARCHIVE_RPC_URL", "")
SLOT0 = "0x3850c7bd"
LIQUIDITY = "0x1a686502"
DECIMALS = "0x313ce567"
OFFSETS = {"pre": -30, "2s": 2, "60s": 60, "600s": 600}

_c = httpx.Client(timeout=60, headers={"User-Agent": "bell-research/0.1"})


def rpc(calls: list[dict]) -> list[dict]:
    for attempt in range(7):
        try:
            r = _c.post(RPC, json=calls).raise_for_status().json()
            if isinstance(r, dict):
                raise RuntimeError(r.get("error"))
            r = sorted(r, key=lambda x: x["id"])
            if any("error" in x and "rate" in str(x["error"]).lower() for x in r):
                raise RuntimeError("rate limited")
            return r
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.0 * 2 ** attempt)
    raise RuntimeError(f"rpc failed: {last}")


def one(method: str, params: list):
    r = rpc([{"jsonrpc": "2.0", "id": 0, "method": method, "params": params}])[0]
    if "error" in r:
        raise RuntimeError(r["error"])
    return r["result"]


# ── block lookup: interpolation search over cached (block, timestamp) anchors ──

_blocks: list[int] = []
_ts: dict[int, int] = {}


def _ts_of(n: int) -> int:
    if n not in _ts:
        _ts[n] = int(one("eth_getBlockByNumber", [hex(n), False])["timestamp"], 16)
        bisect.insort(_blocks, n)
    return _ts[n]


def block_at(t: int) -> int:
    """First block with timestamp >= t."""
    if not _blocks:
        _ts_of(1)
        _ts_of(int(one("eth_blockNumber", []), 16))
    i = bisect.bisect_left([_ts[b] for b in _blocks], t)
    lo = _blocks[max(0, i - 1)]
    hi = _blocks[min(len(_blocks) - 1, i)]
    if _ts[lo] >= t:
        return lo
    step = 0
    while hi - lo > 1:
        if step % 2 == 0 and _ts[hi] > _ts[lo]:
            g = lo + int((t - _ts[lo]) * (hi - lo) / (_ts[hi] - _ts[lo]))
        else:
            g = (lo + hi) // 2
        g = min(max(g, lo + 1), hi - 1)
        if _ts_of(g) < t:
            lo = g
        else:
            hi = g
        step += 1
    return hi


# ── pool reads ──

def pool_state(pool: str, blocks: list[int]) -> list[tuple[int, int]]:
    calls = []
    for k, b in enumerate(blocks):
        calls.append({"jsonrpc": "2.0", "id": 2 * k, "method": "eth_call", "params": [{"to": pool, "data": SLOT0}, hex(b)]})
        calls.append({"jsonrpc": "2.0", "id": 2 * k + 1, "method": "eth_call", "params": [{"to": pool, "data": LIQUIDITY}, hex(b)]})
    res = rpc(calls)
    out = []
    for k in range(len(blocks)):
        s, l = res[2 * k].get("result", "0x"), res[2 * k + 1].get("result", "0x")
        out.append((int(s[2:66], 16) if len(s) >= 66 else 0, int(l, 16) if len(l) > 2 else 0))
    return out


def usd_price(sqrtp: int, dec1: int) -> float:
    p_raw = (sqrtp / 2**96) ** 2
    return (1 / p_raw) * 10 ** (dec1 - 6) if p_raw else float("nan")


def main(args: list[str]) -> None:
    if not RPC.startswith("https://"):
        sys.exit("BASE_ARCHIVE_RPC_URL is not set. Run with: uv run --env-file .env python -m bell_research.jumps")
    sunday_only = "--sunday" in args
    tickers = [a for a in args if not a.startswith("--")]

    # Candidate venues: every Aerodrome-family USDC pool with a plain address (v4 pools are ids).
    # Liquidity migrated between venues over time, so the active one is chosen per event.
    pools = json.load(open(DATA / "pools" / "pools.json"))
    cands: dict[str, list[str]] = {}
    for p in pools["pools"]:
        if p["dex"] in ("aero", "aerodrome") and p["quote"] == "USDC" and len(p["pair"]) == 42:
            cands.setdefault(p["symbol"], []).append(p["pair"])
    # keep only pools that answer the concentrated-liquidity ABI
    for sym in list(cands):
        ok = []
        for a in cands[sym]:
            r = rpc([{"jsonrpc": "2.0", "id": 0, "method": "eth_call", "params": [{"to": a, "data": SLOT0}, "latest"]},
                     {"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": a, "data": LIQUIDITY}, "latest"]}])
            if all(len(x.get("result", "0x")) >= 66 for x in r):
                ok.append(a)
        cands[sym] = ok
        print(f"  {sym}: {len(ok)} concentrated-liquidity USDC pools")
    token_of = {p["symbol"]: p["token"] for p in pools["pools"]}
    dec = {sym: int(one("eth_call", [{"to": token_of[sym], "data": DECIMALS}, "latest"]), 16) for sym in cands}

    ev = gaps(load(tickers or None))
    if sunday_only:
        ev = ev.filter(ev["wake_dow"] == "Sun")
    out_path = DATA / "jumps.csv"
    done = set()
    if out_path.exists():
        with open(out_path) as f:
            done = {(r["ticker"], r["wake_ts"]) for r in csv.DictReader(f)}
    new_file = not out_path.exists()
    f = open(out_path, "a", newline="")
    w = csv.writer(f)
    if new_file:
        w.writerow(["ticker", "pool", "wake_ts", "wake_ny", "wake_dow", "gap_h", "feed_pre", "feed_post", "jump_pct",
                    "pool_pre", "pool_2s", "pool_60s", "pool_600s", "weekend_share", "gap_left_2s_bp",
                    "gap_left_60s_bp", "liq_pre", "lvr_usd"])

    min_ts = int(datetime(2026, 8, 12, tzinfo=NY).timestamp())  # first mints
    n = skipped = 0
    for r in ev.sort("wake_at").iter_rows(named=True):
        sym = r["ticker"] + "c"
        if not cands.get(sym):
            continue
        t = int(r["wake_at"].timestamp())
        if t < min_ts or (r["ticker"], str(t)) in done:
            continue
        d1 = dec[sym]
        jump = r["jump_pct"] / 100
        feed_pre_ref = r["feed_post"] / (1 + jump)
        blocks = [block_at(t + o) for o in OFFSETS.values()]
        # choose the venue that was actually live: in-range liquidity and a price near the feed
        best, best_st = None, None
        for a in cands[sym]:
            st_a = pool_state(a, blocks)
            sq, liq = st_a[0]
            if sq == 0 or liq == 0:
                continue
            if abs(usd_price(sq, d1) / feed_pre_ref - 1) > 0.20:
                continue
            if best_st is None or liq > best_st[0][1]:
                best, best_st = a, st_a
        if best is None:
            skipped += 1
            continue
        st = best_st
        px = [usd_price(s, d1) for s, _ in st]
        feed_post_px = r["feed_post"]
        feed_pre_px = feed_post_px / (1 + jump)
        # LVR from the pre-bell pool state to the post-bell market price
        sqrt_p0 = st[0][0] / 2**96
        p1_raw = 10 ** (d1 - 6) / feed_post_px
        sqrt_p1 = math.sqrt(p1_raw)
        lvr_raw = st[0][1] * (sqrt_p1 - sqrt_p0) ** 2 / sqrt_p0
        lvr_usd = lvr_raw / 10**d1 * feed_post_px
        move = feed_post_px - feed_pre_px
        weekend_share = (px[0] - feed_pre_px) / move if abs(move) > 1e-9 else float("nan")
        w.writerow([
            r["ticker"], best, t, r["wake_at"].strftime("%Y-%m-%d %H:%M:%S"), r["wake_dow"],
            round(r["gap_h"], 3), round(feed_pre_px, 6), round(feed_post_px, 6), round(r["jump_pct"], 4),
            round(px[0], 6), round(px[1], 6), round(px[2], 6), round(px[3], 6), round(weekend_share, 4),
            round((px[1] / feed_post_px - 1) * 1e4, 2), round((px[2] / feed_post_px - 1) * 1e4, 2),
            st[0][1], round(lvr_usd, 2),
        ])
        f.flush()
        n += 1
        if n % 10 == 0:
            print(f"  {n} events · last {r['ticker']} {r['wake_at']:%a %d %b %H:%M} jump {r['jump_pct']:+.2f}% lvr ${lvr_usd:,.0f}")
    f.close()
    print(f"wrote {n} new events ({skipped} skipped: no live pool near the feed price) → {out_path}")


if __name__ == "__main__":
    main(sys.argv[1:])
