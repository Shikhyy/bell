"""Infer when the Coinbase tokenized-stock feeds go dark and wake up.

Feeds publish on a 0.5% deviation or a 24h heartbeat, so a quiet hour is not proof
the market is closed. Long gaps (>= MIN_GAP_H) are. For each long gap we record the
last update before it and the first update after it, in New York time, plus the
price move across the gap: that move is the "scheduled jump" the paper is about.

Output: data/boundaries.csv
"""

from __future__ import annotations

import sys
from pathlib import Path

import polars as pl

DATA = Path(__file__).resolve().parents[2] / "data"
MIN_GAP_H = 6.0
TZ = "America/New_York"


def load(tickers: list[str] | None = None) -> pl.DataFrame:
    files = sorted((DATA / "feeds").glob("*.csv"))
    if tickers:
        files = [f for f in files if f.stem in tickers]
    df = pl.concat([pl.read_csv(f) for f in files])
    return (
        df.with_columns(
            price=pl.col("answer") / 1e8,
            ts=pl.from_epoch("updated_at", time_unit="s").dt.replace_time_zone("UTC").dt.convert_time_zone(TZ),
        )
        .sort(["ticker", "updated_at"])
    )


def gaps(df: pl.DataFrame) -> pl.DataFrame:
    g = df.with_columns(
        prev_ts=pl.col("ts").shift(1).over("ticker"),
        prev_price=pl.col("price").shift(1).over("ticker"),
    ).with_columns(
        gap_h=(pl.col("ts") - pl.col("prev_ts")).dt.total_seconds() / 3600,
        jump_pct=(pl.col("price") / pl.col("prev_price") - 1) * 100,
    )
    return (
        g.filter(pl.col("gap_h") >= MIN_GAP_H)
        .select(
            "ticker",
            pl.col("prev_ts").alias("dark_from"),
            pl.col("ts").alias("wake_at"),
            "gap_h",
            "jump_pct",
            pl.col("price").alias("feed_post"),
        )
        .with_columns(
            from_dow=pl.col("dark_from").dt.strftime("%a"),
            from_hm=pl.col("dark_from").dt.strftime("%H:%M"),
            wake_dow=pl.col("wake_at").dt.strftime("%a"),
            wake_hm=pl.col("wake_at").dt.strftime("%H:%M"),
        )
    )


def main(tickers: list[str]) -> None:
    df = load(tickers or None)
    print(f"{df.height} updates · {df['ticker'].n_unique()} feeds · {df['ts'].min()} → {df['ts'].max()}\n")

    hourly = (
        df.with_columns(dow=pl.col("ts").dt.weekday(), hour=pl.col("ts").dt.hour())
        .group_by("dow", "hour").len()
    )
    print("Updates by New York hour (rows Mon..Sun, cols 00..23):")
    for d, name in enumerate(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], start=1):
        row = {r["hour"]: r["len"] for r in hourly.filter(pl.col("dow") == d).iter_rows(named=True)}
        cells = "".join(" ·░▒▓█"[min(5, (row.get(h, 0) + 9) // 10)] if row.get(h, 0) else " " for h in range(24))
        print(f"  {name} |{cells}|")
    print("        0     6     12    18   \n")

    gp = gaps(df)
    gp.write_csv(DATA / "boundaries.csv")
    print(f"{gp.height} dark windows >= {MIN_GAP_H:.0f}h  → data/boundaries.csv\n")
    print("Last update before going dark (day, time):")
    print(gp.group_by("from_dow", "from_hm").len().sort("len", descending=True).head(8))
    print("\nFirst update after waking (day, time):")
    print(gp.group_by("wake_dow", "wake_hm").len().sort("len", descending=True).head(12))
    print("\nJump across the dark window, |%| by wake day:")
    print(
        gp.group_by("wake_dow")
        .agg(n=pl.len(), med_abs=pl.col("jump_pct").abs().median(), p90_abs=pl.col("jump_pct").abs().quantile(0.9),
             med_gap_h=pl.col("gap_h").median())
        .sort("n", descending=True)
    )


if __name__ == "__main__":
    main(sys.argv[1:])
