# The scheduled jump: forecasting the reopen of tokenized-stock oracles on Base

*bell research note. Data and code: this repository. All numbers are reproducible from `research/`.*

## Abstract

Coinbase tokenized stocks on Base trade around the clock, but the Chainlink feeds that price them do not: they stand still for about 52 hours every weekend and for hours on weekday nights. We read every round of ten feeds from August to November 2026 and find three things. (1) The feeds wake on a timetable: in 108 of 117 weekly reopens the first new round lands inside the 20:00 ET minute, a median 35 s after the bell. (2) The closed-market DEX price forecasts that first print out of sample: over 629 scheduled boundaries the Aerodrome price 30 s before the bell cuts CRPS from 58.0 bp (the frozen oracle) to 15.0 bp, a 74.2% skill gain, although it does not help at the weekday 20:00 overnight session. (3) Little is left for arbitrageurs to take at the bell itself: liquidity providers lost \$11.6k over 227 scheduled bells (median \$11), with 67% of it in the worst tenth. We turn (1) and (2) into an agent-facing oracle and (3) into a Uniswap v4 hook that auctions the residual jump to liquidity providers.

## 1. Problem

A price feed for a stock is only as informative as the market behind it. While US equity markets are closed, the on-chain feed holds its last value; the token keeps trading. When the feed resumes, the whole gap lands in one update. For lending protocols this is a stale collateral price; for liquidity providers it is a scheduled adverse-selection event, in the sense of loss-versus-rebalancing (Milionis et al., 2022), concentrated at a time everyone can predict. Here the jump has a known date and, as we show, a forecastable size, which makes it a different problem from an unscheduled shock.

## 2. Data and definitions

- **Feeds.** The ten Chainlink proxies for Coinbase tokenized stocks on Base, every round from the first to the 22 November reopen.
- **Boundary.** A gap of at least 6 hours between consecutive rounds. The *scheduled jump* is the log change in the feed across the gap. Boundaries are typed by the clock time they end: Sunday reopen, 09:30 open, 04:00 pre-market, 20:00 overnight session.
- **Pool state.** For each boundary we read the Aerodrome pool's price at t-30 s, t+2 s, t+60 s and t+600 s around the first new round, from Base archive state.
- **Loss.** LVR at the bell, from the pre-bell active liquidity and the price move to the post-bell oracle value.

## 3. Findings

### 3.1 The bell is on a timetable

108 of 117 weekly reopens (92%) produce the first new round inside the 20:00 ET minute, 19 to 57 s after the bell, median 35 s. The other nine arrive 1 to 24 minutes later, all in thinly traded names. Dark windows are long: median 52.3 h before the Sunday reopen (10th to 90th percentile 49.0 to 57.2 h).

### 3.2 The weekend price forecasts the reopen

For each boundary we forecast the first post-bell feed value with two predictive distributions, Laplace in log price. The *no-change* model is centred on the last feed value before the gap; the *DEX* model on the pool price 30 s before the bell. The Laplace scale is the expanding median of past absolute errors divided by ln 2, per boundary type once it has 15 events and pooled before that, so every score is out of sample. We score with CRPS (Gneiting and Raftery, 2007), 80% interval coverage and PIT calibration.

| | n | CRPS DEX | CRPS frozen oracle | skill | 80% coverage (DEX) |
|---|---|---|---|---|---|
| All boundaries | 629 | 15.0 bp | 58.0 bp | **74.2%** | 90.5% |
| Sunday reopen | 81 | 14.8 bp | 65.4 bp | 77.3% | 86.4% |
| 09:30 open | 94 | 14.9 bp | 70.5 bp | 78.8% | 90.4% |
| 04:00 pre-market | 50 | 32.9 bp | 49.7 bp | 33.8% | 94.0% |
| 20:00 overnight session | 12 | 60.9 bp | 61.1 bp | 0.4% | 58.3% |
| Other (mid-day gaps) | 392 | 11.3 bp | 54.5 bp | 79.2% | 91.8% |

Mean absolute error is 18.2 bp against 80.3 bp. The DEX price helps wherever it carries information about the reopen, and does not at the weekday overnight session, which has only 12 events and a market that is not closed in the same way. Realised coverage of the nominal 80% band is 90.5%, so the bands are conservative; we report that rather than tune it away.

### 3.3 What is left at the bell

Using pre-bell active liquidity and the move to the post-bell value, LPs lost \$11.6k over 227 scheduled bells (median \$11). The top decile accounts for 67% of it. By the time the feed wakes, the pool price has already moved toward the new value, which is the same fact as 3.2 seen from the pool's side. The loss that remains is a tail event, not a steady drain, so the right instrument is insurance for the tail rather than a fee for every swap.

## 4. Mechanisms

**Oracle for the closed market.** `bell quotes` returns, for each stock, the frozen oracle, the DEX price, fair value with 80% and 95% bands from the scale in 3.2, the expected move at the next bell and the model's track record. The same core is served as an MCP server, a CLI and an HTTP API. It is read-only and descriptive.

**BellHook.** A Uniswap v4 hook with three phases. While the feed is fresh it charges the live fee; after a silence of `minDarkGap` it charges a low dark fee; when the feed's `updatedAt` advances after a dark gap it opens an auction window of `auctionBlocks` blocks in which the fee is `max(reserve, priorityFee × rate)`, capped. Arbitrageurs competing to be first bid up the priority fee and the gap is paid to LPs as swap fees (the MEV tax of Robinson and White, 2024). The reserve is set by a keeper from the forecast band in 3.2. The hook detects the bell on chain from the feed and cannot be poked past it. A mock-feed run on Base Sepolia (README) exercises LIVE, DARK, the bell, two escalating auction bids and the return to LIVE.

## 5. Forward test

A backtest can be tuned after the fact. Starting 25 November 2026 the repository records forecasts before each bell (`forward/predictions/`), made by the same code that serves `bell quotes`, with a content hash anchored in a Base Sepolia transaction, and scores them afterwards against the first Chainlink round at or after the bell (`forward/results/`). A scheduled workflow does this for each Sunday reopen and commits as the GitHub Actions bot. Results so far are in `forward/summary.json`; with a handful of bells they are anecdotes, and we do not treat them as a second backtest.

## 6. Limits

- Feeds update on a 0.5% move or a 24 h heartbeat, so the first round after a bell can trail the true open.
- The loss measure ignores the pool fee and uses pre-bell active liquidity; it overstates small events slightly.
- Three months of history, one regime. Weekday 20:00 overnight opens have 12 events and no skill.
- The auction's revenue depends on how competitive bidding is; we have shown the mechanism works on a testnet with a mock feed, not measured revenue on real flow.
- The hook has not been audited and the terminal is read-only.

## References

- Milionis, Moallemi, Roughgarden, Zhang. *Automated Market Making and Loss-Versus-Rebalancing.* 2022.
- Robinson, White. *Priority Is All You Need.* Paradigm, 2024.
- Gneiting, Raftery. *Strictly Proper Scoring Rules, Prediction, and Estimation.* JASA, 2007.
- Bundi. *Optimal Block Time for AMM Liquidity Providers under Jump-Diffusion Prices.* arXiv:2608.30321.
- Seo et al. arXiv:2608.09188. Cha et al. (NEST), arXiv:2610.21491. Amini, Feinstein. arXiv:2609.33799.
