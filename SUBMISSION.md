# Submission kit — Base Stocks Maxxing (deadline 5 Dec 2026)

What the rules require (base.org/stocksmaxxing/rules): a **public X post with a video demo that tags
@buildonbase**, and the **submission form** with the post link and the track. Projects that enable
trading for US users are not eligible: bell's terminal is read-only and the hook targets testnets.

Track: **Programmable Stock Markets** (market infrastructure). One-line pitch:
**"bell is the oracle for when the oracle is closed"** — fair value, oracle-jump forecasts and liquidation
risk for tokenized stocks during the ~52 hours every weekend their Chainlink feeds stand still, served to agents over
MCP, CLI and HTTP, plus a Uniswap v4 hook that auctions the reopen. Partners to pitch: an AMM partner
(e.g. Hydrex) for the hook, and an agent platform (e.g. Bankr) for the MCP tools.

Demo add-on (15 s, after the Auctions beat): in Claude or any MCP client ask *"Which tokenized stocks
will their oracle move most at tonight's reopen, and are any of these loans at risk?"* — show it call
`bell_quotes` and `bell_liquidations` and answer from live Base data.

## Checklist
- [x] Ran `contracts/demo.sh sepolia`: hook 0xBA4c45F3e694868791E3560030aC9f54B3C46080 on Base Sepolia, tx links in the README
- [ ] Re-run the pipeline the morning you record, so the numbers are current
- [ ] Record the demo (script below), ≤ 2 min, 1080p, mouse visible
- [ ] Post on X tagging @buildonbase (draft below), then fill the submission form with the post link
- [ ] Optional: add Base Builder Codes to attribute onchain activity

## 90-second demo script
| Time | Screen | Say |
|---|---|---|
| 0:00 | Landing hero, sky drifting | "Tokenized stocks on Base trade all weekend. The prices they track don't. This is bell." |
| 0:08 | Click **Open the terminal** → Overview | "Every Coinbase stock feed on Base goes dark Friday night. The week clock shows it: blue is silence." |
| 0:20 | Hover the KPI **Bells on time** | "We read every feed round since August. 108 of 117 weekly reopens land inside the 20:00 minute, about 35 seconds after the bell. The jump is on a timetable." |
| 0:32 | Dark-variance table | "Right now every feed is frozen while the DEX keeps moving — this column is the drift, in σ." |
| 0:42 | Tokens → NVDAc, drag the crosshair over a reopen marker | "Each dot is a reopen jump. So who absorbs it?" |
| 0:52 | **Ledger** | "Finding two: the weekend DEX price predicts the reopen. 74% lower forecast error than the frozen feed, out of sample, 629 events." |
| 1:05 | **Auctions** | "Finding three: so little is left at the bell — eleven dollars median — and most of it is in the tail. BellHook auctions that tail: it detects the reopen onchain and sells the first rebalance to competing arbitrageurs." |
| 1:20 | Terminal: `forge test` green, keeper dry-run line | "21 tests, a mined-address deploy script, and a keeper that posts the forecast as the auction reserve." |
| 1:30 | Research page | "Scheduled jumps — a paper's worth of findings, all from public Base data. bell." |

## X post draft
> Tokenized stocks on Base trade 24/7. The prices they track jump on a schedule — 108 of 117 weekly
> reopens land inside the 20:00 ET minute.
>
> We built bell: a terminal + research + a Uniswap v4 hook that auctions the reopen to LPs.
>
> Finding: the weekend DEX price predicts the reopen (−74% forecast error). 🧵 @buildonbase

Thread:
1. The week clock: oracle updates by hour — the weekend is a dark ring. [screenshot]
2. 629 reopens, scored out of sample: Aerodrome's pre-bell price vs the frozen feed. [Ledger screenshot]
3. What's left at the bell: $11.6k over 227 bells, median $11. The auction is tail insurance. [Auctions]
4. BellHook: dark fee → onchain bell → priority-taxed auction → dawn. 21 tests. [code]
5. Read-only analytics; hook live on Base Sepolia (https://sepolia.basescan.org/address/0xBA4c45F3e694868791E3560030aC9f54B3C46080). Code + data: [repo link]
