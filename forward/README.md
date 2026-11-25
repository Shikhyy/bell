# Forward test

Backtests can be tuned after the fact. This folder holds forecasts made **before** each bell, with the scores computed afterwards.

- `predictions/<bell>.json`: written by `cli/src/forward.ts` before the bell. Write-once. It records the frozen oracle, the DEX price, the Laplace scale and the 80/95% bands that `bell quotes` serves, a Base block hash, the commit of the code, and a `contentSha256` of the whole file.
- `results/<bell>.json` and `summary.json`: written by `research/src/bell_research/forward.py` after the bell, from the first Chainlink round at or after it.
- `anchors.md`: transactions on Base Sepolia whose calldata is the prediction's `contentSha256`, so the timestamp does not depend on git alone.

The predictor refuses to run once any feed has printed after the bell, or when the bell is more than 4 hours away.

Scheduled runs: `.github/workflows/forward.yml` predicts before each Sunday reopen and scores after it, committing as a bot so the timestamps are GitHub's, not mine.
