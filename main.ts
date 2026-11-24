// Token Radar — main.ts (Node 22+, standard library only).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), scores every pre-token
// protocol with the model in lib/model.ts, and writes what the grader collects:
//
//   /output/board.json     the ranked board: 100 to 4000 rows, the whole watchlist covered
//   /output/data.js        window.RADAR, the dashboard's whole dataset, beside the page
//   /output/dashboard/     the static page (index.html, app.css, app.js), no network calls
//   /output/screenshots/   the three screenshots the repository carries
//   /output/dossier.json   what buildDossier writes from the two, byte for byte
//
// Run it outside the grader with MAKEFUN_OUTPUT_DIR standing in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// Nothing here reads the clock, the network or anything but the snapshot, so two runs write the
// same bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the dossier's bytes, the rest only refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const meta = {
  model_version: radar.model_version,
  as_of: radar.as_of,
  source: radar.source,
  floor_usd: radar.floor_usd,
  watchlist_size: radar.watchlist_size,
  pre_token_protocols_scored: radar.board_size,
  early_below_floor: radar.early_size,
  live_token_protocols: radar.live_size,
  protocols_in_snapshot: radar.protocols_seen,
  // radar-4: two fitted slopes (high/low multiple groups), per-kind conformal intervals,
  // three held-out validation splits, verdict rule, and the 758 accounting — all measured.
  fitted_model: {
    n_live: radar.fit.n_live,
    slope_low_log10_mcap_on_log10_tvl: radar.fit.slope_low,
    slope_high_log10_mcap_on_log10_tvl: radar.fit.slope_high,
    group_shift_high_dex: radar.fit.group_shift,
    intercept: radar.fit.intercept,
    r2_in_sample_log: radar.fit.r2_in_sample,
    resid_coefs_growth_logage_chains: radar.fit.resid_coefs,
    category_intercept_shrink_k: radar.fit.shrink_k,
    group_high_categories: radar.fit.group_high_categories,
    field_median_log_multiple: radar.fit.field_median_log_multiple,
    single_slope_radar3: radar.fit.single_slope,
  },
  held_out_validation: {
    cv10_by_slug: {
      mape: radar.fit.cv10.mape,
      median_ape: radar.fit.cv10.median_ape,
      r2_log: radar.fit.cv10.r2,
      spearman_held_out: radar.fit.cv10.spearman_held_out,
      hit_rate_within_2x: radar.fit.cv10.hit_rate_within_2x,
      median_abs_log_error: radar.fit.cv10.median_abs_log_error,
      global_q90_factor: radar.fit.cv10.q90_factor,
    },
    splits: radar.fit.splits,
    baseline_median_multiple_cv10: radar.fit.cv_baseline,
  },
  conformal_kinds: radar.fit.conformal_kinds,
  interval_method: '90% split-conformal per kind (high/low multiple group x TVL tier) from 10-fold held-out absolute log errors; a kind with fewer than 10 held-out errors falls back to its group factor, then the global one',
  odds_method: 'Laplace-smoothed token rate by age bucket x TVL tier, (token + 1) / (n + 2); see odds in data.js. Odds do NOT fall monotonically with age in this snapshot (odds_age_monotone=false); the counts are shown and no decline is forced',
  odds_age_monotone: radar.odds_age_monotone,
  verdict_rule: 'net EV = odds x implied x 0.05 (assumed airdrop pool share of implied) x 0.001 (assumed share of the pool one farmer captures); return = net EV / farm total cost; STRONG FARM >= 3x, FARM >= 1x, SPECULATIVE >= 0.3x, else PASS',
  verdict_counts: Object.fromEntries(
    ['STRONG FARM', 'FARM', 'SPECULATIVE', 'PASS'].map((v) => [v, board.filter((r) => r.verdict === v).length]),
  ),
  accounting_758: radar.accounting,
  multiple_basis: 'fitted log10(mcap) on log10(TVL) with two slopes by multiple group and a shrunk per-category intercept, not a median ratio',
};
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board, meta }, null, 0)}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > SCREENSHOT_CAPS.max) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3 or 4, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
  const size = statSync(join(out, 'screenshots', name)).size;
  if (size > SCREENSHOT_CAPS.max_bytes) {
    process.stderr.write(`token radar: screenshots/${name} is ${size} bytes, over the ${SCREENSHOT_CAPS.max_bytes} the gate takes\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

const top = board[0]!;
const fit = radar.fit;
const acc = radar.accounting;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols read, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} pre-token rows scored (${radar.early_size} below the floor, ${radar.live_size} live-token protocols set aside)\n` +
    `token radar: accounting: ${acc.pre_token_scored} scored + ${acc.live_token_fitted} live fitted + ${acc.listed_no_mcap} listed with no market cap + ${acc.pre_token_screened_out} pre-token screened out + ${acc.mcap_zero_or_negative} market cap zero or negative = ${acc.total}\n` +
    `token radar: radar-4 fit on ${fit.n_live} live protocols: log10(mcap) = ${fit.intercept} + ${fit.slope_low} x log10(TVL) (low group) / ${fit.slope_high} x log10(TVL) (high group, shift ${fit.group_shift} dex), R2 ${fit.r2_in_sample}\n` +
    `token radar: held-out 10-fold: MAPE x${fit.cv10.mape}, median error ${(fit.cv10.median_ape * 100).toFixed(1)}%, R2 ${fit.cv10.r2}, Spearman ${fit.cv10.spearman_held_out}\n` +
    `token radar: rank 1 is ${top.name} at $${top.implied_value_usd.toLocaleString('en-US')} implied, ${top.multiple}x its TVL, ${top.odds_pct}% launch odds, verdict ${top.verdict}\n` +
    `token radar: verdicts: ${['STRONG FARM', 'FARM', 'SPECULATIVE', 'PASS'].map((v) => `${v} ${board.filter((r) => r.verdict === v).length}`).join(', ')}\n` +
    `token radar: wrote board.json, data.js, dashboard/ (3 files), screenshots/ (${shots.length} images) and dossier.json to ${out}\n`,
);
