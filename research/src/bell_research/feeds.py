"""Pull the full round history of the Coinbase tokenized-stock Chainlink feeds on Base.

Each feed is a standard Chainlink proxy. Round ids are (phaseId << 64) | aggregatorRound,
so we walk every phase from round 1 until the proxy stops returning data.

Output: data/feeds/<TICKER>.csv with columns
    ticker, phase, round, answer, started_at, updated_at
`answer` is the raw 8-decimal integer; timestamps are unix seconds (UTC).
"""

from __future__ import annotations

import csv
import os
import sys
import time
from pathlib import Path

import httpx

RPC = os.environ.get("BASE_RPC_URL", "https://mainnet.base.org")
OUT = Path(__file__).resolve().parents[2] / "data" / "feeds"

# Proxy addresses from docs.base.org "List Tokenized Stocks" (Chainlink data feeds on Base).
FEEDS = {
    "AAPL": "0x787f13dEa48Db0897CbCDD985de77809D837F988",
    "AMZN": "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295",
    "GOOGL": "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2",
    "META": "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D",
    "MSFT": "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c",
    "MSTR": "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a",
    "NVDA": "0x04689a41629776563E6822F76f2e57D148d28513",
    "SNDK": "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA",
    "SPCX": "0x6A634B235903C4ad6376892180d6fF8612e3Fa68",
    "TSLA": "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4",
}

LATEST_ROUND_DATA = "0xfeaf968c"
GET_ROUND_DATA = "0x9a6fc8f5"
# The public Base RPC allows 25 requests/s and counts every call in a batch, so stay under it by default.
BATCH = int(os.environ.get("BELL_RPC_BATCH", "20"))
BATCH_PAUSE_S = float(os.environ.get("BELL_RPC_PAUSE", "1.0"))


_client = httpx.Client(timeout=30, headers={"User-Agent": "bell-research/0.1"})
_TRANSIENT = ("rate", "limit", "capacity", "exceed", "too many", "timeout", "busy", "429", "unavailable")


def rpc_batch(calls: list[dict]) -> list[dict]:
    for attempt in range(6):
        try:
            res = _client.post(RPC, json=calls).raise_for_status().json()
            if isinstance(res, dict):  # whole-batch error
                raise RuntimeError(res.get("error"))
            res = sorted(res, key=lambda x: x["id"])
            # A rate-limited call comes back as a per-item error. Treating it as "no data" would silently
            # drop rounds (and end a phase early), so retry the whole batch. Reverts, which mark rounds
            # that were never populated, are expected and pass through.
            limited = [x for x in res if "error" in x and any(w in str(x["error"]).lower() for w in _TRANSIENT)]
            if limited:
                raise RuntimeError(f"rate limited: {limited[0]['error']}")
            return res
        except Exception as e:  # rate limits, timeouts
            wait = 1.5 * (2 ** attempt)
            print(f"  rpc retry in {wait:.1f}s: {e}", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError("RPC failed after retries")


def eth_call(to: str, data: str, i: int) -> dict:
    return {"jsonrpc": "2.0", "id": i, "method": "eth_call", "params": [{"to": to, "data": data}, "latest"]}


def decode_round(hexdata: str):
    h = hexdata[2:]
    if len(h) < 64 * 5:
        return None
    w = [int(h[i * 64:(i + 1) * 64], 16) for i in range(5)]
    rid, answer, started, updated, _ = w
    if answer >= 2**255:
        answer -= 2**256
    if updated == 0:
        return None
    return rid, answer, started, updated


def round_call(addr: str, rid: int, i: int) -> dict:
    return eth_call(addr, GET_ROUND_DATA + f"{rid:064x}", i)


def fetch_feed(ticker: str, addr: str, resume: tuple[int, int] | None = None) -> list[tuple]:
    """All rounds of a feed, or only those after `resume` = (phase, round) already stored."""
    latest = rpc_batch([eth_call(addr, LATEST_ROUND_DATA, 0)])[0]
    if "result" not in latest:
        raise RuntimeError(f"{ticker}: latestRoundData failed: {latest.get('error')}")
    rid, *_ = decode_round(latest["result"])
    last_phase, last_round = rid >> 64, rid & ((1 << 64) - 1)
    rows: list[tuple] = []
    first_phase, first_round = resume if resume else (1, 0)
    for phase in range(first_phase, last_phase + 1):
        r, done = (first_round + 1 if phase == first_phase else 1), False
        while not done:
            hi = last_round if phase == last_phase else r + BATCH - 1
            ids = list(range(r, min(r + BATCH, hi + 1)))
            if not ids:
                break
            res = rpc_batch([round_call(addr, (phase << 64) | n, k) for k, n in enumerate(ids)])
            time.sleep(BATCH_PAUSE_S)
            got = 0
            for n, item in zip(ids, res):
                dec = decode_round(item.get("result", "0x")) if "result" in item else None
                if dec is None:
                    if phase != last_phase:
                        done = True
                    continue
                _, answer, started, updated = dec
                rows.append((ticker, phase, n, answer, started, updated))
                got += 1
            r = ids[-1] + 1
            if phase == last_phase and r > last_round:
                done = True
            if got == 0 and phase != last_phase:
                done = True
        print(f"  {ticker} phase {phase}: {sum(1 for x in rows if x[1] == phase)} rounds")
    return rows


def last_stored(path: Path) -> tuple[int, int] | None:
    if not path.exists():
        return None
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    return (int(rows[-1]["phase"]), int(rows[-1]["round"])) if rows else None


def main(args: list[str]) -> None:
    """feeds [--update] [TICKER ...]   --update appends only rounds newer than what is stored."""
    update = "--update" in args
    tickers = [a for a in args if not a.startswith("--")]
    OUT.mkdir(parents=True, exist_ok=True)
    for t in tickers or FEEDS:
        print(f"{t} ← {FEEDS[t]}")
        path = OUT / f"{t}.csv"
        resume = last_stored(path) if update else None
        rows = fetch_feed(t, FEEDS[t], resume)
        if resume:  # append: existing history is never rewritten
            with open(path, "a", newline="") as f:
                csv.writer(f).writerows(rows)
            print(f"  appended {len(rows)} rows after phase {resume[0]} round {resume[1]} → {path}")
        else:
            with open(path, "w", newline="") as f:
                w = csv.writer(f)
                w.writerow(["ticker", "phase", "round", "answer", "started_at", "updated_at"])
                w.writerows(rows)
            print(f"  wrote {len(rows)} rows → {path}")


if __name__ == "__main__":
    main(sys.argv[1:])
