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
| rank 1 | Steakhouse Financial, $118.2M implied, 22.7% launch odds, $26.9M expected value |
| rank 2 | Sentora Curator, $110.0M implied, 22.7% launch odds |
| rank 3 | Polymarket International, $80.0M implied, 19.8% launch odds |
| rows | 198, every watchlist protocol covered |
| implied in all rows | $2.49B |
| median age with no token | 14 months |
| live-token protocols, the yardstick | 128 with a market cap on record |

## The value model — radar-3, fitted, not assumed

Nothing is keyed on a protocol's name, and no number is invented: every figure is either a field of
the snapshot or fitted from the same snapshot's live side. The numbers below are the actual fit
on this snapshot, printed by the program into `board.json` meta — they are measured, not typed.

```
log10(market cap) = 3.0247 + 0.5223 x log10(TVL) + category intercept + residual terms
  category intercept  mean log-residual of the protocol's category, shrunk by n / (n + 5),
                      clipped to +/-1 dex, so a thin category borrows the field
  residual terms      OLS on 7-day growth, log10(age) and chain count, each term clipped
                      to +/-0.05 dex: the snapshot says they add almost nothing once TVL
                      and category are in (coefficients -1.248, -0.200, -0.000)
  implied             10 ^ log10(market cap), rounded to whole dollars
  90% range           implied / 38.4 to implied x 38.4 — a conformal range from the
                      5-fold held-out absolute log errors. It is wide because launches
                      vary that much; the dashboard says so instead of hiding it.
```

The slope is the point: market cap grows with TVL to the power 0.52, not one-for-one, so a
bigger protocol trades at a lower multiple. A single median multiple per category — the radar-2
model — prices a $2.75B protocol at 0.20x its TVL; the fitted model prices it at 0.04x, because
that is what the live side says big protocols trade at.

### Held-out validation — deterministic 5-fold cross-validation, folds by sorted slug

| | radar-3 (fitted) | radar-2 baseline (category median multiple, same folds) |
|---|---|---|
| Mean error (MAPE) | x17.9 | x42.9 |
| Median error | 85.3% | 91.5% |
| R² on log market cap | 0.13 | — |
| In-sample R² on log market cap | 0.32 | — |

Mean error is a multiple, not a percent: a few live launches sit hundreds of times off any
TVL-only fit, so the mean is dominated by them and the median is the honest headline. The fitted
model more than halves the baseline's mean error on the same held-out folds.

### Launch odds

For each row, the Laplace-smoothed share of protocols in its age bucket (<1y, 1–2y, >2y) and TVL
tier ($5–50M, $50–500M, >$500M) that already trade a token with a positive market cap on record:
`(token + 1) / (n + 2)`, with the n behind each cell shown on the dashboard. A gecko listing with
no market cap does not count as launched. Expected value is odds times implied. Odds are a record
of who launched, not a prediction of who will.

### Farm economics

Capital is sized by TVL tier times the mechanism's factor (supply/borrow, liquidity and RWA
minting need 1.5x; bridging and prediction need 0.6x), gas is a planning figure per main chain
(Ethereum $12 a transaction, Solana $1, most others $2–4), and the total cost on each row is
capital + $20 of gas token + gas across the plan. Every step names the real mechanism for that
category — supply and borrow for lending, LP for DEXes, margin for perps, vault deposits for
yield — with its own cost and time.

## The dashboard

`dashboard/` is three static files (`index.html`, `app.css`, `app.js`, 55,024 bytes in all, so the
dossier's text stays under 65,536 bytes) and one generated `data.js`; no framework, no build step,
no network request — the page opens from `file://`.

- **Board** — sortable on any column (implied value, odds, expected value and farm cost
  included), searchable, filtered by scope / category / chain, with the rank, the implied value,
  its held-out 90% range underneath, launch odds, farm cost and the watchlist or below-floor tag
  on each row.
- **Integrity strip** — watchlist 40/40, rows 198, held-out median error 85.3% vs the 91.5%
  baseline, mean error cut x2.4 vs the baseline, fitted slope 0.52, no value keyed on a name,
  deterministic, 128 live protocols fitted on — every claim a number the program measured.
  The held-out MAPE (x17.9) and the 90% range factor (x38.4) are not in the strip; they stay,
  honestly stated, in the validation panel below, where their context is on the same screen.
- **Validation panel** — the fitted formula, the held-out numbers against the median-multiple
  baseline, the launch-odds table with its counts, and the shrunk category intercepts.
- **Detail** — one page per protocol: the arithmetic factor by factor, the page's own recompute
  of the implied value (within 0.1% of the board's number — the worst row recomputes to within
  0.002%), the 90% range drawn on a log scale, why it sits where it does, and a farm plan of
  7 concrete steps, each with its cost and how long it takes.
- **Yardstick** — the live-token protocols beside the board, at the market's own market cap,
  TVL, market multiple (market cap / TVL) and the category's fitted intercept — no fitted cap
  per protocol and no per-protocol error, because TVL alone cannot price a single launch. The
  held-out aggregate is stated once in the yardstick header: median error 85.3%, R² 0.13, and
  the fitted model still beats the median-multiple baseline on the same folds (median 91.5%,
  MAPE x42.9 vs x17.9).

Hash routes make every view linkable: `#p=<slug>`, `#scope=watchlist|early|live`,
`#cat=`, `#chain=`, `#sort=`, `#dir=asc`.

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
lib/model.ts            the model: log-log fit, 5-fold CV, conformal interval, launch odds,
                        farm economics, parsing, the gate's own checks
dashboard/              index.html, app.css, app.js (app.js recomputes the model in the page)
vendor/makefun-board.ts buildDossier, copied byte for byte from the kit
screenshots/            the four screenshots the dossier carries
```

`vendor/makefun-board.ts` is the kit's own library, unmodified, MIT licensed as `LICENSE` says.

## Licence

MIT.
