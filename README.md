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
| rank 1 | Steakhouse Financial, $564.9M implied (0.20x its $2.75B TVL) |
| rows | 198, every watchlist protocol covered |
| implied in all rows | $4.33B |
| median age with no token | 14 months |
| live-token protocols, the yardstick | 128 with a market cap on record |

## The value model

Nothing is keyed on a protocol's name, and no number is invented: every figure is either a field of
the snapshot or measured from the same snapshot's live side.

```
mult      = median(mcap_usd / tvl_usd) over the category's live-token protocols
            (fewer than 3 observations: the whole live field's median)
band      = that ratio's p25 and p75, so each row carries a range, not a point promise
momentum  = 1 + clamp(change_7d, -30, 60) / 100 * 0.6
patience  = 0.85 + 0.3 * min(age_days, 1460) / 1460      age_days = as_of - listed_at
reach     = 1 + 0.06 * min(chains, 12) / 12
implied   = round(tvl_usd * mult * momentum * patience * reach)
```

The multiple a category trades at is a fact about that category, so it is read from the protocols
whose token already trades; the model only borrows it. A single multiple is clamped to 0.02x–4x so
one outlier cannot set a category's number, and the dashboard's yardstick table shows the
unclamped market ratio, because that table is the evidence rather than the estimate.

Aggregation is measured too: `median` and the percentiles come from the snapshot's own 128
live-token observations, so a category with a richer live side gives a tighter number.

## The dashboard

`dashboard/` is three static files (`index.html`, `app.css`, `app.js`) and one generated
`data.js`; no framework, no build step, no network request — the page opens from `file://`.

- **Board** — sortable on any column, searchable, filtered by scope / category / chain, with the
  rank, the implied value, its bar and the watchlist or below-floor tag on each row.
- **Detail** — one page per protocol: the arithmetic factor by factor, why it sits where it does,
  the category's p25–p75 band, and a farm plan of 7 concrete steps, each with its cost and how long
  it takes.
- **Yardstick** — the live-token protocols beside the board, at the market's own market cap and
  multiple, with the note that the model reads its multiples from them.

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
/output/data.js        window.RADAR, the dashboard's dataset
/output/dashboard/     the page
/output/screenshots/   4 images
/output/dossier.json   buildDossier(out, {text_max_bytes: 65536})
```

The program reads nothing but the snapshot — no clock, no network, no randomness — so two runs
write identical bytes.

## Layout

```
main.ts                 the entrypoint: snapshot in, board + dashboard + dossier out
lib/model.ts            the model: parsing, multiples, scoring, the gate's own checks
dashboard/              index.html, app.css, app.js (app.js recomputes the model in the page)
vendor/makefun-board.ts buildDossier, copied byte for byte from the kit
screenshots/            the four screenshots the dossier carries
```

`vendor/makefun-board.ts` is the kit's own library, unmodified, MIT licensed as `LICENSE` says.

## Licence

MIT.
