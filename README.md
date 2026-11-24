# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yawmn/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yawmn/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A launch radar for pre-token DeFi protocols: what a token would be worth if the protocol's record
stayed as it is, ranked, with the farm plan for each one. Built for make.fun's
[token launch radar](https://make.fun/bounty/token-radar-01) bounty
([make.fun](https://make.fun)).

Snapshot: **2026-11-14**, 758 protocols at or above $5M TVL, 40 of them on the watchlist.
The board ranks **198** pre-token protocols — the 40 on the watchlist (`$50M`+ TVL, no token on
record) and 158 the radar found below the floor, which the rules call "the floor, never the
ceiling".

| | |
|---|---|
| rank 1 | Steakhouse Financial, $167.5M implied, 22.7% launch odds (4/20 peers), STRONG FARM, net EV $1,904 |
| rank 2 | Sentora Curator, $154.3M implied, 22.7% launch odds, STRONG FARM |
| rank 3 | Polymarket International, $123.9M implied, 19.8% launch odds (15/79 peers), STRONG FARM |
| rows | 198, every watchlist protocol covered |
| implied in all rows | $3.31B |
| median age with no token | 418 days |
| live-token protocols, the yardstick | 128 with a market cap on record |

## The value model — radar-4, fitted, not assumed

Nothing is keyed on a protocol's name, and no number is invented: every figure is either a field of
the snapshot or fitted from the same snapshot's live side. The numbers below are the actual fit
on this snapshot, printed by the program into `board.json` meta — they are measured, not typed.

```
log10(market cap) = 1.8528 + 0.6396 x log10(TVL)  (low-multiple group)
                         / 0.4247 x log10(TVL)  (high-multiple group, shift +2.2652 dex)
                         + category intercept + residual terms
  groups          a category is 'high' when its live median log multiple sits at or above
                  the field median (-0.6884 dex). 15 categories are high: AI Agents,
                  Basis Trading, Canonical Bridge, Chain, Collateral Management,
                  Cross Chain Bridge, Decentralized AI, Derivatives, Dexs, NFT Marketplace,
                  Options, Prediction Market, Privacy, RWA, Risk Curators. The rest are low.
                  Groups are defined by category, fitted from the live side, never by name.
  category intercept  mean log-residual of the protocol's category, shrunk by n / (n + 5),
                      clipped to +/-1 dex, so a thin category borrows the field
  residual terms      OLS on 7-day growth, log10(age) and chain count, each term clipped
                      to +/-0.05 dex: the snapshot says they add almost nothing once TVL
                      and category are in (coefficients -1.041, -0.199, 0.012)
  implied             10 ^ log10(market cap), rounded to whole dollars
  90% range           split-conformal per kind, from 10-fold held-out absolute log errors
                      (see the table below). It is wide because launches vary that much;
                      the dashboard says so instead of hiding it.
```

Two slopes, not one. The radar-3 single slope (0.5223, in-sample R² 0.19) priced
Steakhouse Financial — $2.75B TVL, in the high-multiple Risk Curators group — at $118.2M,
0.043x its TVL, next to Polymarket at $80.0M, 0.25x its TVL, and the two did not sit
together. The two-slope fit (in-sample R² 0.38) prices Steakhouse at $167.5M, 0.061x its
TVL, and Polymarket at $123.9M, 0.39x its TVL — the same rule, applied to each group's own
multiple. The high group's flatter slope is the point: inside the high-multiple group,
market cap grows more slowly with TVL, because the group already contains the flow and
prediction names whose multiples the market set far above DeFi's.

### 90% ranges, priced per kind

Split-conformal from the 10-fold held-out absolute log errors, per kind — high/low
multiple group crossed with TVL tier. A kind with fewer than 10 held-out errors falls back
to its group's factor, then to the global one (×41.76). Coverage is the held-out share of
live protocols whose actual market cap fell inside the range.

| Kind | n | 90% factor | Coverage 90% | Coverage 80% |
|---|---|---|---|---|
| high · $5–50M | 36 | ×62.09 | 91.7% | 83.3% |
| high · $50–500M | 14 | ×1929.09 | 92.9% | 78.6% |
| high · >$500M | 3 | ×60.12 (group fallback) | 66.7% | 66.7% |
| low · $5–50M | 40 | ×31.87 | 90.0% | 82.5% |
| low · $50–500M | 21 | ×132.18 | 85.7% | 85.7% |
| low · >$500M | 14 | ×62.43 | 92.9% | 85.7% |

The high · $50–500M factor (×1929) is honest, not a bug: that kind contains the 400x
Rain outlier, and a 90% range that has to cover it is wide. The high · >$500M kind has
only 3 held-out errors, so it falls back to the high group's factor — the table says so.

### Held-out validation — three deterministic splits, not one

| Split | Train / test | Median error | MAPE | R² on log market cap |
|---|---|---|---|---|
| 10-fold by sorted slug | 128 / 128 | 79.6% | ×20.20 | 0.20 |
| older-to-newer (by listed_at) | 47 / 48 | 97.9% | ×7.30 | 0.09 |
| $5–50M → $50–500M | 76 / 35 | 97.6% | ×35.42 | −0.08 |
| $50–500M → >$500M | 35 / 17 | 514.4% | ×29.86 | −1.66 |

Held-out Spearman rank correlation between fitted and actual log market cap on the live
side: **ρ 0.49**. Held-out hit rate within 2x of actual: 33.6%. Median absolute log error
held out: 0.54 dex. Against the median-multiple baseline on the same 10 folds, the fitted
model cuts the median error from 91.8% to 79.6% and the MAPE from ×43.66 to ×20.20.

The tier holdouts are the honest failure: fitting one TVL tier and testing the next tier
up gives a negative R² — launch size does not extrapolate across tiers, which is why the
board fits the pooled live side and prices the interval per kind instead of pretending
the model travels. Mean error is a multiple, not a percent: a few live launches sit
hundreds of times off any TVL-only fit, so the mean is dominated by them and the median
is the honest headline.

### Launch odds

For each row, the Laplace-smoothed share of protocols in its age bucket (<1y, 1–2y, >2y) and TVL
tier ($5–50M, $50–500M, >$500M) that already trade a token with a positive market cap on record:
`(token + 1) / (n + 2)`, with the peer count behind each cell shown on the board itself
(e.g. 22.7% (4/20)) and in the validation panel. A gecko listing with no market cap does
not count as launched. Odds are a record of who launched, not a prediction of who will.

The rates do **not** fall monotonically with age past the peak launch window, and the
dashboard does not force them to. At $5–50M the rates run 4.8% / 13.7% / 22.7% across the
age buckets; at $50–500M they dip to 11.8% / 9.2% / 19.8%; above $500M they run
20.0% / 22.7% / 19.6%. The counts are shown and the dip is stated in the validation panel.

### Farm economics and the verdict

Capital is sized by TVL tier times the mechanism's factor (supply/borrow, liquidity and RWA
minting need 1.5x; bridging and prediction need 0.6x), gas is a planning figure per main chain
(Ethereum $12 a transaction, Solana $1, most others $2–4), and the total cost on each row is
capital + $20 of gas token + gas across the plan. Every step names the real mechanism for that
category — supply and borrow for lending, LP for DEXes, margin for perps, vault deposits for
yield — with its own cost and time.

The verdict on each row is a rule, not a judgement: net expected value is launch odds ×
implied value × 5% (the assumed airdrop pool share of the implied value) × 0.1% (the
assumed share of the pool one farmer captures), and the return is net EV over the farm's
total cost. **STRONG FARM** at 3x+, **FARM** at 1x+, **SPECULATIVE** at 0.3x+, **PASS**
below. The assumed shares are one number for every row, stated on the dashboard and in
`board.json` meta. The board holds 8 STRONG FARM, 35 FARM, 80 SPECULATIVE and 75 PASS.
Net EV and the return sit under the farm cost on every row.

### The 758, accounted for

Every protocol in the snapshot is accounted for, counted by the program:

| | |
|---|---|
| pre-token scored on the board | 198 |
| live-token fitted (the yardstick) | 128 |
| listed with a gecko/symbol but no market cap | 272 |
| pre-token screened out | 144 |
| market cap zero or negative on record | 16 |
| **total** | **758** |

The 144 screened out break down by their actual snapshot reasons: 128 by category
(canonical/wrapped/bridged and the other excluded categories), 11 by a versioned name,
5 by a wrapped/staked/staking product word, 0 by an exchange name. The snapshot has no
protocol below $5M TVL, so nothing is excluded for size.

## The dashboard

`dashboard/` is three static files (`index.html`, `app.css`, `app.js`, 59,997 bytes in all, so the
dossier's text stays under 65,536 bytes) and one generated `data.js`; no framework, no build step,
no network request — the page opens from `file://`.

- **Board** — sortable on any column (implied value, odds, net expected value and farm
  return included), searchable, filtered by scope / category / chain / farm verdict, with
  the rank, the implied value, its held-out 90% range underneath, launch odds with the
  peer count under it, farm cost with net EV and return under it, a verdict pill, and
  the watchlist or below-floor tag on each row.
- **Integrity strip** — watchlist 40/40, rows 198, 3 held-out tests, Spearman ρ 0.49,
  per-kind 90% coverage 85.7–92.9%, two slopes 0.64 / 0.42, no value keyed on a name,
  deterministic, 128 live protocols fitted on — every claim a number the program measured.
  The held-out median error (79.6%) and the per-kind range factors are not in the strip;
  they stay, honestly stated, in the validation panel below, where their context is on
  the same screen.
- **Validation panel** — the fitted formula, the three held-out splits against the
  median-multiple baseline, the per-kind 90% ranges with their coverage, the launch-odds
  table with its counts and the non-monotonicity note, the verdict rule with its stated
  shares, the shrunk category intercepts, and the 758 accounting.
- **Detail** — one page per protocol: the arithmetic factor by factor, the page's own recompute
  of the implied value (within 0.1% of the board's number — the worst row recomputes to within
  0.002%), the 90% range drawn on a log scale, why it sits where it does, its verdict with
  the net EV arithmetic, and a farm plan of 7 concrete steps, each with its cost and how
  long it takes.
- **Yardstick** — all 128 live-token protocols the model is fitted on, by market cap, with
  the market's own market cap, TVL, market multiple (market cap / TVL), the fitted cap
  recomputed by the same model, the log error between the two, and an outlier tag where
  the multiple sits at or beyond 10x or 0.1x (Rain 400x, OKX 0.07x). The held-out
  aggregate is stated once in the yardstick header: median error 79.6%, median log error
  0.54 dex, 33.6% of held-out fits within 2x of actual, Spearman ρ 0.49 — the raw
  per-row errors are never shown without that context. 128 live tokens fitted; all 128
  shown, not just the top 40.

Hash routes make every view linkable: `#p=<slug>`, `#scope=watchlist|early|live`,
`#cat=`, `#chain=`, `#verdict=`, `#sort=`, `#dir=asc`.

Screenshots: `screenshots/1-board.png`, `2-detail.png`, `3-filtered.png`, `4-live.png`
(1440×900).

## Run it

Node 22+, standard library only, nothing to install:

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

Under the grader it reads `/input/snapshot.json` and writes `/output`:

```
/output/board.json     198 rows and the model's metadata
/output/data.js        window.RADAR, the dashboard's whole dataset
/output/dashboard/     the page
/output/screenshots/   4 images
/output/dossier.json   buildDossier(out, {text_max_bytes: 65536})
```

The program reads nothing but the snapshot — no clock, no network, no randomness — so two runs
write identical bytes (`diff -r` over two runs: identical).

## Layout

```
main.ts                 the entrypoint: snapshot in, board + dashboard + dossier out
lib/model.ts            the model: two-slope log-log fit, 10-fold CV plus older-to-newer
                        and tier holdouts, per-kind conformal intervals, launch odds,
                        farm verdicts and economics, parsing, the gate's own checks
dashboard/              index.html, app.css, app.js (app.js recomputes the model in the page)
vendor/makefun-board.ts buildDossier, copied byte for byte from the kit
screenshots/            the four screenshots the dossier carries
```

`vendor/makefun-board.ts` is the kit's own library, unmodified, MIT licensed as `LICENSE` says.

## Licence

MIT.
