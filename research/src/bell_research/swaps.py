"""Fetch Aerodrome Slipstream swaps in event windows around session boundaries.

Pulling every swap for months is millions of logs; the paper only needs the hours
around each boundary plus control windows. Base makes a block every 2 seconds, so a
timestamp maps to a block number arithmetically from one anchor block.

Windows (New York time):
  sun_reopen   Sunday 20:00  [-3h, +3h]   weekly reopen of the overnight session
  ctrl_sat     Saturday 14:00 [-3h, +3h]  closed-market control

Output: data/swaps/<SYMBOL>.csv
  block, ts, tx, log_index, amount0, amount1, sqrt_price_x96, liquidity, tick,
  price (USDC per token), window, t_rel_s (seconds from the boundary)
"""

from __future__ import annotations

import csv
import json
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

import os

def _keychain_rpc() -> str | None:
    """macOS Keychain item `bell-base-rpc`, if the user stored one there."""
    import subprocess

    try:
        out = subprocess.run(
            ["security", "find-generic-password", "-s", "bell-base-rpc", "-w"],
            capture_output=True, text=True, timeout=10,
        )
        return (out.stdout.strip() or None) if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


RPC = (
    os.environ.get("BASE_ARCHIVE_RPC_URL")
    or _keychain_rpc()
    or os.environ.get("BASE_RPC_URL", "https://mainnet.base.org")
)

DATA = Path(__file__).resolve().parents[2] / "data"
NY = ZoneInfo("America/New_York")
SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
CHUNK = int(os.environ.get("LOG_CHUNK", "2000"))
HALF_H = 3
START = datetime(2026, 8, 16, tzinfo=NY)  # first Sunday after the first mints (12 Aug)

_c = httpx.Client(timeout=60, headers={"User-Agent": "bell-research/0.1"})


def rpc(method: str, params: list):
    for attempt in range(7):
        try:
            r = _c.post(RPC, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).raise_for_status().json()
            if "error" in r:
                raise RuntimeError(r["error"])
            return r["result"]
        except Exception as e:
            time.sleep(1.5 * 2 ** attempt)
            last = e
    raise RuntimeError(f"{method} failed: {last}")


def anchor() -> tuple[int, int]:
    b = rpc("eth_getBlockByNumber", ["latest", False])
    return int(b["number"], 16), int(b["timestamp"], 16)


_ts_cache: dict[int, int] = {}


def block_ts(n: int) -> int:
    if n not in _ts_cache:
        _ts_cache[n] = int(rpc("eth_getBlockByNumber", [hex(n), False])["timestamp"], 16)
    return _ts_cache[n]


def block_at(ts: int, a: tuple[int, int]) -> int:
    """First block with timestamp >= ts. Binary search: Base block time has changed
    over its life (2s earlier, 200ms now), so arithmetic from one anchor is wrong."""
    lo, hi = 0, a[0]
    while lo < hi:
        mid = (lo + hi) // 2
        if block_ts(mid) < ts:
            lo = mid + 1
        else:
            hi = mid
    return lo


def windows(now: datetime) -> list[tuple[str, int]]:
    out = []
    d = START
    while d < now:
        sun = d.replace(hour=20, minute=0, second=0)
        sat = (d - timedelta(days=1)).replace(hour=14, minute=0, second=0)
        if sun + timedelta(hours=HALF_H) < now:
            out.append(("sun_reopen", int(sun.timestamp())))
            out.append(("ctrl_sat", int(sat.timestamp())))
        d += timedelta(days=7)
    return out


def s256(h: str) -> int:
    v = int(h, 16)
    return v - (1 << 256) if v >= 1 << 255 else v


def decode(log: dict, dec1: int) -> tuple:
    d = log["data"][2:]
    w = [d[i * 64:(i + 1) * 64] for i in range(5)]
    a0, a1 = s256(w[0]), s256(w[1])
    sqrtp, liq = int(w[2], 16), int(w[3], 16)
    tick = s256(w[4])
    p_raw = (sqrtp / 2**96) ** 2  # token1 raw per token0 raw
    price = (1 / p_raw) * 10 ** (dec1 - 6) if p_raw else 0.0  # USDC per token
    return a0, a1, sqrtp, liq, tick, price


def fetch(symbol: str, pool: str, dec1: int = 8) -> int:
    a = anchor()
    now = datetime.now(NY)
    rows = []
    wins = windows(now)
    for name, t0 in wins:
        lo, hi = block_at(t0 - HALF_H * 3600, a), block_at(t0 + HALF_H * 3600, a)
        n = 0
        for b in range(lo, hi + 1, CHUNK):
            logs = rpc("eth_getLogs", [{"address": pool, "topics": [SWAP_TOPIC], "fromBlock": hex(b), "toBlock": hex(min(hi, b + CHUNK - 1))}])
            for lg in logs:
                blk = int(lg["blockNumber"], 16)
                ts = int(lg["blockTimestamp"], 16) if lg.get("blockTimestamp") else block_ts(blk)
                rows.append((blk, ts, lg["transactionHash"], int(lg["logIndex"], 16), *decode(lg, dec1), name, ts - t0))
                n += 1
        print(f"  {symbol} {name} {datetime.fromtimestamp(t0, NY):%Y-%m-%d %H:%M} → {n} swaps")
    out = DATA / "swaps"
    out.mkdir(parents=True, exist_ok=True)
    with open(out / f"{symbol}.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["block", "ts", "tx", "log_index", "amount0", "amount1", "sqrt_price_x96", "liquidity", "tick", "price", "window", "t_rel_s"])
        w.writerows(rows)
    return len(rows)


def main(symbols: list[str]) -> None:
    pools = json.load(open(DATA / "pools" / "pools.json"))["pools"]
    main_pool = {}
    for p in pools:  # biggest-liquidity USDC pool on Aerodrome Slipstream ("aero") per symbol
        if p["dex"] == "aero" and p["quote"] == "USDC":
            if p["symbol"] not in main_pool or (p["liq_usd"] or 0) > (main_pool[p["symbol"]]["liq_usd"] or 0):
                main_pool[p["symbol"]] = p
    for s in symbols or sorted(main_pool):
        print(f"{s} pool {main_pool[s]['pair']}")
        n = fetch(s, main_pool[s]["pair"])
        print(f"  wrote {n} swaps")


if __name__ == "__main__":
    main(sys.argv[1:])
