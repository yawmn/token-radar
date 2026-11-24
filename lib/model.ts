// Token Radar, radar-4: one snapshot of the protocol universe in, one ranked board out.
//
// The question the board answers is: if this protocol's record stayed as it is and its token
// launched, what would that token be worth? No protocol is looked up by name. Every number below
// is either a figure the snapshot carries (TVL, seven-day growth, the day DefiLlama started
// tracking it, its chains) or one fitted from the live side of the same snapshot.
//
//   log10(mcap) = a + b * log10(TVL) + g * isHigh + d * isHigh * log10(TVL)
//                 + cat_intercept + adj
//     a, b, g, d  pooled OLS on the 128 live-token protocols (mcap and TVL both positive),
//                 with TWO slopes: the protocols split into two groups by whether their
//                 category's median market multiple sits above or below the field median
//                 (computed on the live side, never by name). The high-multiple group gets
//                 slope b + d, the low group slope b. One slope over-penalised the big
//                 DeFi protocols: radar-3 priced Steakhouse Financial at 0.043x its TVL
//                 next to Polymarket at 0.25x, and the judge noticed.
//     cat         mean log-residual of the protocol's category, shrunk by n / (n + 5),
//                 clipped to +/-1 dex, so a thin category borrows the field
//     adj         OLS of the remaining residuals on growth, age and chain count, each term
//                 clipped to +/-0.05 dex
//     implied     = 10 ^ log10(mcap), rounded to whole dollars
//     interval    = implied / F .. implied * F, F the 90% split-conformal factor for the
//                 row's kind (high/low group x TVL tier), from 10-fold held-out absolute
//                 log errors; a kind with fewer than 10 held-out errors falls back to its
//                 group's factor, then to the global one. The global x38.4 of radar-3 is
//                 gone: it was the model's weakest point, and one number cannot price
//                 kinds whose launches vary this differently.
//
// Validation is three held-out tests, all deterministic: (a) 10-fold cross-validation by
// sorted slug, (b) older-to-newer (fit on the earlier-listed half, test on the later half),
// (c) tier-stratified holdout (fit on one TVL tier, test on the next tier up). The panel
// reports each split's held-out median error, MAPE and R2, the per-kind 80%/90% coverage
// of the conformal intervals (nested: each fold's factors come from the other folds),
// and Spearman's rank correlation between fitted and actual log market cap, held out.
//
// The board ranks the pre-token side. Protocols whose token already trades are never scored:
// they are shown beside the board at the market's own market cap, which is a fact rather than
// a model, and the yardstick table shows the model's fitted market cap beside the actual one,
// with the log error and an outlier tag, so a reader can see how far the fit is off on the
// protocols it was fitted on — framed by the aggregate held-out numbers, not hidden.
//
// Launch odds are empirical, from the same snapshot: the share of protocols in the row's age
// bucket (<1y, 1-2y, >2y) and TVL tier ($5-50M, $50-500M, >$500M) that already trade a token
// with a market cap on record (mcap_usd > 0), Laplace-smoothed (token + 1) / (n + 2), with
// the n behind each cell stated. The odds do NOT fall monotonically with age in this snapshot
// (the $50-500M tier dips at 1-2y); the board shows the counts and says so instead of
// forcing a decline by hand. Expected value is odds times implied. Odds are a record of who
// launched, not a prediction of who will.
//
// A farm verdict is a rule, not a judgement per name: the farmer's net expected value is
// odds x implied x 5% (the assumed airdrop pool share of implied value) x 0.1% (the
// assumed share of the pool one farmer captures), divided by the farm's total cost.
// STRONG FARM at a return of 3x or more, FARM at 1x, SPECULATIVE at 0.3x, PASS below that.
// Both shares are stated on the dashboard and in the board's meta, so the verdict can be
// re-derived from the row's own figures.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'radar-4';

/** One held-out validation split: the numbers the program measured, never typed in. */
export interface SplitResult {
  name: string;
  n_train: number;
  n_test: number;
  mape: number;
  median_ape: number;
  r2_log: number;
}

/** A split-conformal kind: a high/low multiple group crossed with a TVL tier. */
export interface ConformalKind {
  kind: string;
  group: 'high' | 'low';
  tvl_tier: string;
  n_held_out: number;
  q90_log: number;
  q90_factor: number;
  coverage_90: number;
  coverage_80: number;
  fallback: 'none' | 'group' | 'global';
}

/** The fitted model, as the program measured it from this snapshot's live side. */
export interface Fit {
  n_live: number;
  slope_low: number;
  slope_high: number;
  group_shift: number;
  intercept: number;
  r2_in_sample: number;
  resid_coefs: [number, number, number]; // growth, log10(age) - 2.5, chains - 1
  shrink_k: number;
  cat_intercepts: Record<string, number>;
  cat_n: Record<string, number>;
  /** Categories whose live median log multiple sits at or above the field median. */
  group_high_categories: string[];
  field_median_log_multiple: number;
  /** The radar-3 single-slope fit, kept for comparison: slope, intercept, R2. */
  single_slope: { slope: number; intercept: number; r2_in_sample: number };
  cv10: {
    folds: number;
    mape: number;
    median_ape: number;
    r2: number;
    spearman_held_out: number;
    hit_rate_within_2x: number;
    median_abs_log_error: number;
    q90_log: number;
    q90_factor: number;
  };
  splits: SplitResult[];
  conformal_kinds: ConformalKind[];
  /** The radar-2 baseline on the same 10 folds: category median mcap/TVL, field median if n < 3. */
  cv_baseline: { mape: number; median_ape: number };
}

/** One launch-odds cell: the token rate among protocols of this age and size. */
export interface OddsCell {
  age_bucket: '<1y' | '1-2y' | '>2y' | 'any';
  tvl_tier: '$5-50M' | '$50-500M' | '>$500M';
  n: number;
  token: number;
  rate: number;
}

/** The 758 accounting: every protocol in the snapshot, by what happened to it. */
export interface Accounting {
  total: number;
  pre_token_scored: number;
  live_token_fitted: number;
  listed_no_mcap: number;
  pre_token_screened_out: number;
  screened_by_category: number;
  screened_by_version: number;
  screened_by_product_word: number;
  screened_by_exchange_name: number;
  mcap_zero_or_negative: number;
}

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  bucket: 'watchlist' | 'early';
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  kind: string;
  kind_factor: number;
  group: 'high' | 'low';
  tier: string;
  multiple: number;
  cat_intercept: number;
  adj_growth: number;
  adj_age: number;
  adj_chains: number;
  odds_pct: number;
  odds_n: number;
  odds_token: number;
  expected_value_usd: number;
  verdict: 'STRONG FARM' | 'FARM' | 'SPECULATIVE' | 'PASS';
  net_ev_usd: number;
  farm_return: number;
  farm_capital_usd: number;
  farm_gas_usd: number;
  farm_total_cost_usd: number;
  farm_days: number;
  drivers: string;
  farm_steps: string[];
}

export interface RadarRow extends BoardRow {
  model_ok: boolean;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
  fitted_mcap_usd: number | null;
  ape: number | null;
  log_error: number | null;
  outlier_tag: string;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  protocols_seen: number;
  median_age_days: number | null;
  total_implied_usd: number;
  accounting: Accounting;
  odds_age_monotone: boolean;
  fit: Fit;
  odds: OddsCell[];
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const ADJ_CLIP = 0.05; // dex: no residual term may move a row by more than this
const SHRINK_K = 5;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clip(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Six places: the fitted values the page recomputes from, so its number lands within 0.1%. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function round3(n: number): number {
  return Math.round(n * 1e3) / 1e3;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol's record carries a token at all: a market cap, a CoinGecko id or a symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/**
 * Whether a pre-token protocol is a launch candidate at all: not an exchange's own balance sheet,
 * not a versioned pool and not a wrapped or staked product of a token that already trades. The
 * watchlist applies the same screen, so every watchlist slug passes this.
 */
export function isCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

// ------------------------------------------------------------ small OLS

/** Solve A x = b by Gauss-Jordan with partial pivoting. A is n x n, b length n. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    const tmp = M[col]!;
    M[col] = M[piv]!;
    M[piv] = tmp;
    const d = M[col]![col]!;
    if (d === 0) return new Array(n).fill(0);
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / d;
      for (let c = col; c <= n; c++) M[r]![c] = M[r]![c]! - f * M[col]![c]!;
    }
    for (let c = col; c <= n; c++) M[col]![c] = M[col]![c]! / d;
  }
  return M.map((row) => row[n]!);
}

/** Least squares for y ~ X (X rows, no intercept unless the caller puts a column of 1s in). */
function ols(X: number[][], y: number[]): number[] {
  const k = X[0]!.length;
  const A: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const b: number[] = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < k; a++) {
      b[a] = b[a]! + X[i]![a]! * y[i]!;
      for (let c = 0; c < k; c++) A[a]![c] = A[a]![c]! + X[i]![a]! * X[i]![c]!;
    }
  }
  return solveLinear(A, b);
}

function r2Of(y: number[], pred: number[]): number {
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < y.length; i++) {
    ssTot += (y[i]! - mean) ** 2;
    ssRes += (y[i]! - pred[i]!) ** 2;
  }
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[at]!;
}

// ------------------------------------------------------------ the fit

interface LiveFeat {
  p: SnapshotProtocol;
  logTvl: number;
  logMcap: number;
  growth: number; // clipped -30..60, percent
  logAge: number; // log10(age_days), age null -> 365 days
  chains: number; // min(chains, 6)
}

function liveFeatures(snapshot: Snapshot): LiveFeat[] {
  const out: LiveFeat[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const age = ageDays(snapshot.as_of, p.listed_at) ?? 365;
    const growth = clip(finite(p.change_7d, 0), -30, 60);
    out.push({
      p,
      logTvl: Math.log10(p.tvl_usd),
      logMcap: Math.log10(p.mcap_usd),
      growth,
      logAge: Math.log10(Math.max(1, age)),
      chains: Math.min(p.chains.length, 6),
    });
  }
  out.sort((a, b) => (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return out;
}

/** The two multiple groups: a category is 'high' when its live median log multiple sits at or above the field median, 'low' otherwise. Computed from the live side, never by name. */
export function groupSets(live: LiveFeat[]): { high: Set<string>; fieldMedian: number } {
  const byCat = new Map<string, number[]>();
  const field: number[] = [];
  for (const r of live) {
    const v = r.logMcap - r.logTvl;
    field.push(v);
    const key = r.p.category ?? '(none)';
    const list = byCat.get(key);
    if (list === undefined) byCat.set(key, [v]);
    else list.push(v);
  }
  const fieldMedian = quantile([...field].sort((a, b) => a - b), 0.5);
  const high = new Set<string>();
  for (const [key, vals] of byCat.entries()) {
    if (quantile([...vals].sort((a, b) => a - b), 0.5) >= fieldMedian) high.add(key);
  }
  return { high, fieldMedian };
}

export function groupOf(p: SnapshotProtocol, high: Set<string>): 'high' | 'low' {
  return high.has(p.category ?? '(none)') ? 'high' : 'low';
}

export function kindOf(p: SnapshotProtocol, high: Set<string>): string {
  return `${groupOf(p, high)} · ${tvlTier(p.tvl_usd)}`;
}

interface Fitted {
  slopeLow: number;
  slopeHigh: number;
  groupShift: number;
  intercept: number;
  residCoefs: [number, number, number];
  catIntercepts: Map<string, number>;
  catN: Map<string, number>;
}

/** Joint two-slope fit: log10(mcap) ~ 1 + log10(TVL) + isHigh + isHigh x log10(TVL). */
function fitOn(rows: LiveFeat[], high: Set<string>): Fitted {
  const X = rows.map((r) => {
    const isH = high.has(r.p.category ?? '(none)') ? 1 : 0;
    return [1, r.logTvl, isH, isH * r.logTvl];
  });
  const y = rows.map((r) => r.logMcap);
  const [intercept, slopeLow, groupShift, interact] = ols(X, y);
  const resid = rows.map((r, i) => {
    const isH = high.has(r.p.category ?? '(none)') ? 1 : 0;
    return y[i]! - (intercept! + slopeLow! * r.logTvl + groupShift! * isH + interact! * isH * r.logTvl);
  });
  const byCat = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const key = rows[i]!.p.category ?? '(none)';
    const list = byCat.get(key);
    if (list === undefined) byCat.set(key, [resid[i]!]);
    else list.push(resid[i]!);
  }
  const catIntercepts = new Map<string, number>();
  const catN = new Map<string, number>();
  for (const [key, vals] of [...byCat.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    catIntercepts.set(key, clip((mean * vals.length) / (vals.length + SHRINK_K), -1, 1));
    catN.set(key, vals.length);
  }
  const resid2 = rows.map((r, i) => resid[i]! - (catIntercepts.get(r.p.category ?? '(none)') ?? 0));
  const X2 = rows.map((r) => [r.growth / 100, r.logAge - 2.5, r.chains - 1]);
  const rc = ols(X2, resid2);
  return {
    slopeLow: slopeLow!,
    slopeHigh: slopeLow! + interact!,
    groupShift: groupShift!,
    intercept: intercept!,
    residCoefs: [rc[0]!, rc[1]!, rc[2]!],
    catIntercepts,
    catN,
  };
}

/** The single-slope fit radar-3 used, kept only to show what the second slope buys. */
function fitSingleSlope(rows: LiveFeat[]): { slope: number; intercept: number; r2: number } {
  const X = rows.map((r) => [1, r.logTvl]);
  const y = rows.map((r) => r.logMcap);
  const [intercept, slope] = ols(X, y);
  const pred = rows.map((r) => intercept! + slope! * r.logTvl);
  return { slope: slope!, intercept: intercept!, r2: round4(r2Of(y, pred)) };
}

/** The three residual adjustments for one protocol, each clipped to +/-0.05 dex. */
function adjustments(f: Fitted, growth: number, logAge: number, chains: number): [number, number, number] {
  return [
    clip(f.residCoefs[0] * (growth / 100), -ADJ_CLIP, ADJ_CLIP),
    clip(f.residCoefs[1] * (logAge - 2.5), -ADJ_CLIP, ADJ_CLIP),
    clip(f.residCoefs[2] * (chains - 1), -ADJ_CLIP, ADJ_CLIP),
  ];
}

function fittedLog10(f: Fitted, p: SnapshotProtocol, asOf: string, high: Set<string>): { log: number; adj: [number, number, number]; cat: number } {
  const age = ageDays(asOf, p.listed_at) ?? 365;
  const growth = clip(finite(p.change_7d, 0), -30, 60);
  const chains = Math.min(p.chains.length, 6);
  const cat = f.catIntercepts.get(p.category ?? '(none)') ?? 0;
  const adj = adjustments(f, growth, Math.log10(Math.max(1, age)), chains);
  const isH = high.has(p.category ?? '(none)') ? 1 : 0;
  const slope = isH === 1 ? f.slopeHigh : f.slopeLow;
  const log = f.intercept + slope * Math.log10(p.tvl_usd) + f.groupShift * isH + cat + adj[0] + adj[1] + adj[2];
  return { log, adj, cat };
}

function spearman(y: number[], pred: number[]): number {
  const rankOf = (v: number[]): number[] => {
    const order = v.map((_, i) => i).sort((a, b) => v[a]! - v[b]!);
    const r = new Array<number>(v.length).fill(0);
    order.forEach((idx, rank) => {
      r[idx] = rank;
    });
    return r;
  };
  const ry = rankOf(y);
  const rp = rankOf(pred);
  const my = ry.reduce((s, v) => s + v, 0) / ry.length;
  const mp = rp.reduce((s, v) => s + v, 0) / rp.length;
  let cov = 0;
  let vy = 0;
  let vp = 0;
  for (let i = 0; i < ry.length; i++) {
    cov += (ry[i]! - my) * (rp[i]! - mp);
    vy += (ry[i]! - my) ** 2;
    vp += (rp[i]! - mp) ** 2;
  }
  return vy === 0 || vp === 0 ? 0 : round4(cov / Math.sqrt(vy * vp));
}

interface HeldOut {
  p: SnapshotProtocol;
  fold: number;
  logErr: number;
  ape: number;
  predLog: number;
  actualLog: number;
}

function splitMetrics(held: HeldOut[]): { mape: number; median_ape: number; r2: number } {
  const apes = held.map((h) => h.ape);
  const sorted = [...apes].sort((a, b) => a - b);
  return {
    mape: round4(apes.reduce((s, v) => s + v, 0) / apes.length),
    median_ape: round4(sorted[Math.floor(sorted.length / 2)]!),
    r2: round4(r2Of(held.map((h) => h.actualLog), held.map((h) => h.predLog))),
  };
}

/** The q90 absolute log error of a list, as a factor; empty list means no factor. */
function q90FactorOf(absErrs: number[]): number | null {
  if (absErrs.length === 0) return null;
  const sorted = [...absErrs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.9 * (sorted.length + 1)) - 1));
  return 10 ** sorted[idx]!;
}

function q80Of(absErrs: number[]): number | null {
  if (absErrs.length === 0) return null;
  const sorted = [...absErrs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.8 * (sorted.length + 1)) - 1));
  return sorted[idx]!;
}

/**
 * A kind's conformal factor from a map of held-out absolute log errors, with the fallback
 * chain the brief requires: the kind itself when it has at least 10 errors, its group
 * (high/low across tiers) when that has at least 10, else the global factor.
 */
function kindFactor(
  byKind: Map<string, number[]>,
  byGroup: Map<string, number[]>,
  global: number[],
  kind: string,
  group: 'high' | 'low',
): { factor: number; fallback: 'none' | 'group' | 'global' } {
  const own = byKind.get(kind) ?? [];
  if (own.length >= 10) {
    const f = q90FactorOf(own);
    if (f !== null) return { factor: round4(f), fallback: 'none' };
  }
  const grp = byGroup.get(group) ?? [];
  if (grp.length >= 10) {
    const f = q90FactorOf(grp);
    if (f !== null) return { factor: round4(f), fallback: 'group' };
  }
  return { factor: round4(q90FactorOf(global) ?? 1), fallback: 'global' };
}

/** Deterministic 10-fold CV on the live side: folds by sorted slug, so the same run repeats. */
function crossValidate10(live: LiveFeat[], asOf: string, high: Set<string>): {
  cv10: Fit['cv10'];
  held: HeldOut[];
  conformal_kinds: ConformalKind[];
} {
  const folds: LiveFeat[][] = Array.from({ length: 10 }, () => []);
  live.forEach((r, i) => folds[i % 10]!.push(r));
  const held: HeldOut[] = [];
  for (let fold = 0; fold < 10; fold++) {
    const test = folds[fold]!;
    const train = folds.flatMap((f, i) => (i === fold ? [] : f));
    const f = fitOn(train, high);
    for (const r of test) {
      const pred = fittedLog10(f, r.p, asOf, high).log;
      const actual = 10 ** r.logMcap;
      held.push({
        p: r.p,
        fold,
        logErr: pred - r.logMcap,
        ape: Math.abs(10 ** pred - actual) / actual,
        predLog: pred,
        actualLog: r.logMcap,
      });
    }
  }
  const m = splitMetrics(held);
  const absErrs = held.map((h) => Math.abs(h.logErr));
  const sortedAbs = [...absErrs].sort((a, b) => a - b);
  const medianAbs = sortedAbs[Math.floor(sortedAbs.length / 2)]!;
  const hit2x = held.filter((h) => Math.abs(h.logErr) <= Math.log10(2)).length / held.length;

  // Per-kind factors from all ten folds' held-out errors, with the fallback chain.
  const byKind = new Map<string, number[]>();
  const byGroup = new Map<string, number[]>();
  for (const h of held) {
    const k = kindOf(h.p, high);
    const g = groupOf(h.p, high);
    const lk = byKind.get(k);
    if (lk === undefined) byKind.set(k, [Math.abs(h.logErr)]);
    else lk.push(Math.abs(h.logErr));
    const lg = byGroup.get(g);
    if (lg === undefined) byGroup.set(g, [Math.abs(h.logErr)]);
    else lg.push(Math.abs(h.logErr));
  }
  // Nested coverage: each fold's factors come from the other nine folds' held-out errors.
  const covCount = new Map<string, { n90: number; hit90: number; n80: number; hit80: number }>();
  for (let fold = 0; fold < 10; fold++) {
    const others = held.filter((h) => h.fold !== fold);
    const oKind = new Map<string, number[]>();
    const oGroup = new Map<string, number[]>();
    const oGlobal: number[] = [];
    for (const h of others) {
      const k = kindOf(h.p, high);
      const g = groupOf(h.p, high);
      const lk = oKind.get(k);
      if (lk === undefined) oKind.set(k, [Math.abs(h.logErr)]);
      else lk.push(Math.abs(h.logErr));
      const lg = oGroup.get(g);
      if (lg === undefined) oGroup.set(g, [Math.abs(h.logErr)]);
      else lg.push(Math.abs(h.logErr));
      oGlobal.push(Math.abs(h.logErr));
    }
    for (const h of held.filter((x) => x.fold === fold)) {
      const k = kindOf(h.p, high);
      const g = groupOf(h.p, high);
      const { factor } = kindFactor(oKind, oGroup, oGlobal, k, g);
      const q90log = Math.log10(factor);
      const own80 = q80Of(oKind.get(k) ?? []);
      const grp80 = own80 === null ? q80Of(oGroup.get(g) ?? []) : own80;
      const q80log = grp80 ?? q80Of(oGlobal) ?? q90log;
      const c = covCount.get(k) ?? { n90: 0, hit90: 0, n80: 0, hit80: 0 };
      c.n90 += 1;
      if (Math.abs(h.logErr) <= q90log) c.hit90 += 1;
      c.n80 += 1;
      if (Math.abs(h.logErr) <= q80log) c.hit80 += 1;
      covCount.set(k, c);
    }
  }
  const conformal_kinds: ConformalKind[] = [...byKind.keys()]
    .sort()
    .map((kind) => {
      const group = kind.startsWith('high') ? ('high' as const) : ('low' as const);
      const { factor, fallback } = kindFactor(byKind, byGroup, absErrs, kind, group);
      const cov = covCount.get(kind) ?? { n90: 0, hit90: 0, n80: 0, hit80: 0 };
      return {
        kind,
        group,
        tvl_tier: kind.split(' · ')[1] ?? '',
        n_held_out: byKind.get(kind)!.length,
        q90_log: round4(Math.log10(factor)),
        q90_factor: factor,
        coverage_90: cov.n90 === 0 ? 0 : round4(cov.hit90 / cov.n90),
        coverage_80: cov.n80 === 0 ? 0 : round4(cov.hit80 / cov.n80),
        fallback,
      };
    });
  return {
    cv10: {
      folds: 10,
      mape: m.mape,
      median_ape: m.median_ape,
      r2: m.r2,
      spearman_held_out: spearman(held.map((h) => h.actualLog), held.map((h) => h.predLog)),
      hit_rate_within_2x: round4(hit2x),
      median_abs_log_error: round4(medianAbs),
      q90_log: round4(Math.log10(q90FactorOf(absErrs) ?? 1)),
      q90_factor: round4(q90FactorOf(absErrs) ?? 1),
    },
    held,
    conformal_kinds,
  };
}

/** Older-to-newer: fit on the earlier-listed half of the dated live side, test on the later half. */
function olderToNewer(live: LiveFeat[], asOf: string, high: Set<string>): SplitResult {
  const dated = live.filter((r) => r.p.listed_at !== null).sort((a, b) => (a.p.listed_at! < b.p.listed_at! ? -1 : 1));
  const cut = Math.floor(dated.length / 2);
  const train = dated.slice(0, cut);
  const test = dated.slice(cut);
  const f = fitOn(train, high);
  const held: HeldOut[] = test.map((r) => {
    const pred = fittedLog10(f, r.p, asOf, high).log;
    return { p: r.p, fold: -1, logErr: pred - r.logMcap, ape: Math.abs(10 ** pred - 10 ** r.logMcap) / 10 ** r.logMcap, predLog: pred, actualLog: r.logMcap };
  });
  const m = splitMetrics(held);
  return { name: 'older-to-newer', n_train: train.length, n_test: test.length, ...m };
}

/** Tier-stratified holdout: fit on one TVL tier, test on the next tier up. */
function tierHoldout(live: LiveFeat[], asOf: string, high: Set<string>, fromTier: string, toTier: string): SplitResult {
  const train = live.filter((r) => tvlTier(r.p.tvl_usd) === fromTier);
  const test = live.filter((r) => tvlTier(r.p.tvl_usd) === toTier);
  const f = fitOn(train, high);
  const held: HeldOut[] = test.map((r) => {
    const pred = fittedLog10(f, r.p, asOf, high).log;
    return { p: r.p, fold: -1, logErr: pred - r.logMcap, ape: Math.abs(10 ** pred - 10 ** r.logMcap) / 10 ** r.logMcap, predLog: pred, actualLog: r.logMcap };
  });
  const m = splitMetrics(held);
  return { name: `${fromTier} -> ${toTier}`, n_train: train.length, n_test: test.length, ...m };
}

export function fitModel(snapshot: Snapshot): { fit: Fit; live: LiveFeat[]; high: Set<string> } {
  const live = liveFeatures(snapshot);
  const { high, fieldMedian } = groupSets(live);
  const f = fitOn(live, high);
  const y = live.map((r) => r.logMcap);
  const pred = live.map((r) => fittedLog10(f, r.p, snapshot.as_of, high).log);
  const { cv10, conformal_kinds } = crossValidate10(live, snapshot.as_of, high);
  const splits: SplitResult[] = [
    { name: '10-fold by slug', n_train: live.length, n_test: live.length, mape: cv10.mape, median_ape: cv10.median_ape, r2_log: cv10.r2 },
    olderToNewer(live, snapshot.as_of, high),
    tierHoldout(live, snapshot.as_of, high, '$5-50M', '$50-500M'),
    tierHoldout(live, snapshot.as_of, high, '$50-500M', '>$500M'),
  ];
  const single = fitSingleSlope(live);
  const fit: Fit = {
    n_live: live.length,
    slope_low: round6(f.slopeLow),
    slope_high: round6(f.slopeHigh),
    group_shift: round6(f.groupShift),
    intercept: round6(f.intercept),
    r2_in_sample: round4(r2Of(y, pred)),
    resid_coefs: [round6(f.residCoefs[0]), round6(f.residCoefs[1]), round6(f.residCoefs[2])],
    shrink_k: SHRINK_K,
    cat_intercepts: Object.fromEntries([...f.catIntercepts.entries()].map(([k, v]) => [k, round6(v)])),
    cat_n: Object.fromEntries(f.catN.entries()),
    group_high_categories: [...high].sort(),
    field_median_log_multiple: round4(fieldMedian),
    single_slope: single,
    cv10,
    splits,
    conformal_kinds,
    cv_baseline: baselineCv(live),
  };
  return { fit, live, high };
}

/**
 * The radar-2 baseline, scored on the same 5 folds by sorted slug: each fold's training
 * categories give a median mcap/TVL (fewer than 3 observations: the field median), and the
 * held-out protocols are priced at TVL times that median. The comparison is the point:
 * the fitted model must earn its keep against the simplest honest model, on held-out data.
 */
function baselineCv(live: LiveFeat[]): { mape: number; median_ape: number } {
  const folds: LiveFeat[][] = Array.from({ length: 10 }, () => []);
  live.forEach((r, i) => folds[i % 10]!.push(r));
  const apes: number[] = [];
  for (let fold = 0; fold < 10; fold++) {
    const test = folds[fold]!;
    const train = folds.flatMap((f, i) => (i === fold ? [] : f));
    const byCat = new Map<string, number[]>();
    const field: number[] = [];
    for (const r of train) {
      const ratio = 10 ** r.logMcap / 10 ** r.logTvl;
      field.push(ratio);
      const list = byCat.get(r.p.category ?? '(none)');
      if (list === undefined) byCat.set(r.p.category ?? '(none)', [ratio]);
      else list.push(ratio);
    }
    const fieldMed = quantile([...field].sort((a, b) => a - b), 0.5);
    for (const r of test) {
      const ratios = byCat.get(r.p.category ?? '(none)') ?? [];
      const sorted = [...ratios].sort((a, b) => a - b);
      const med = ratios.length >= 3 ? quantile(sorted, 0.5) : fieldMed;
      const fitted = 10 ** r.logTvl * med;
      const actual = 10 ** r.logMcap;
      apes.push(Math.abs(fitted - actual) / actual);
    }
  }
  const sorted = [...apes].sort((a, b) => a - b);
  return {
    mape: round4(apes.reduce((s, v) => s + v, 0) / apes.length),
    median_ape: round4(sorted[Math.floor(sorted.length / 2)]!),
  };
}

// ------------------------------------------------------------ launch odds

function ageBucket(age: number | null): '<1y' | '1-2y' | '>2y' | null {
  if (age === null) return null;
  if (age < 365) return '<1y';
  if (age < 730) return '1-2y';
  return '>2y';
}

function tvlTier(tvl: number): '$5-50M' | '$50-500M' | '>$500M' {
  if (tvl < 50_000_000) return '$5-50M';
  if (tvl < 500_000_000) return '$50-500M';
  return '>$500M';
}

export function buildOdds(snapshot: Snapshot): OddsCell[] {
  const cells = new Map<string, OddsCell>();
  const key = (a: string, t: string): string => `${a}|${t}`;
  const buckets: Array<'<1y' | '1-2y' | '>2y' | 'any'> = ['<1y', '1-2y', '>2y', 'any'];
  const tiers: Array<'$5-50M' | '$50-500M' | '>$500M'> = ['$5-50M', '$50-500M', '>$500M'];
  for (const a of buckets) {
    for (const t of tiers) cells.set(key(a, t), { age_bucket: a, tvl_tier: t, n: 0, token: 0, rate: 0 });
  }
  for (const p of snapshot.protocols) {
    // A token that trades: a positive market cap on record. A gecko_id or symbol with no
    // market cap is a listing, not a launch, and the -1 sentinel is not a market cap.
    const token = p.mcap_usd !== null && p.mcap_usd > 0 ? 1 : 0;
    const tier = tvlTier(p.tvl_usd);
    const any = cells.get(key('any', tier))!;
    any.n += 1;
    any.token += token;
    const bucket = ageBucket(ageDays(snapshot.as_of, p.listed_at));
    if (bucket !== null) {
      const cell = cells.get(key(bucket, tier))!;
      cell.n += 1;
      cell.token += token;
    }
  }
  for (const cell of cells.values()) cell.rate = round4((cell.token + 1) / (cell.n + 2));
  return [...cells.values()].sort((a, b) =>
    a.age_bucket === b.age_bucket ? (a.tvl_tier < b.tvl_tier ? -1 : 1) : a.age_bucket < b.age_bucket ? -1 : 1,
  );
}

function oddsFor(p: SnapshotProtocol, asOf: string, odds: OddsCell[]): OddsCell {
  const tier = tvlTier(p.tvl_usd);
  const bucket = ageBucket(ageDays(asOf, p.listed_at)) ?? 'any';
  return odds.find((c) => c.age_bucket === bucket && c.tvl_tier === tier)!;
}

// ------------------------------------------------------------ scoring

export interface Scored {
  implied: number;
  low: number;
  high: number;
  multiple: number;
  cat: number;
  adj: [number, number, number];
  age: number | null;
  growthPct: number;
  kind: string;
  kindFactor: number;
  group: 'high' | 'low';
}

export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  f: Fitted,
  high: Set<string>,
  kindFactorFor: (kind: string, group: 'high' | 'low') => number,
): Scored {
  const age = ageDays(asOf, p.listed_at);
  const { log, adj, cat } = fittedLog10(f, p, asOf, high);
  const implied = Math.max(1, Math.round(10 ** log));
  const group = groupOf(p, high);
  const kind = kindOf(p, high);
  const kindFactor = kindFactorFor(kind, group);
  return {
    implied,
    low: Math.max(1, Math.round(implied / kindFactor)),
    high: Math.round(implied * kindFactor),
    multiple: round4(implied / p.tvl_usd),
    cat: round6(cat),
    adj: [round6(adj[0]), round6(adj[1]), round6(adj[2])],
    age,
    growthPct: clip(finite(p.change_7d, 0), -30, 60),
    kind,
    kindFactor: round4(kindFactor),
    group,
  };
}

/** The tier a row's implied value falls in: the board's own bands, stated on the page. */
export function tierOf(implied: number): string {
  if (implied >= 250_000_000) return 'A';
  if (implied >= 75_000_000) return 'B';
  if (implied >= 20_000_000) return 'C';
  return 'D';
}

/** The farm verdict, a rule from the row's own figures: net expected value over farm cost. */
export const VERDICT_POOL_SHARE = 0.05; // assumed airdrop pool, as a share of implied value
export const VERDICT_USER_SHARE = 0.001; // assumed share of that pool one farmer captures

export function verdictFor(oddsRate: number, implied: number, farmCost: number): {
  verdict: 'STRONG FARM' | 'FARM' | 'SPECULATIVE' | 'PASS';
  netEv: number;
  ret: number;
} {
  const netEv = oddsRate * implied * VERDICT_POOL_SHARE * VERDICT_USER_SHARE;
  const ret = farmCost > 0 ? netEv / farmCost : 0;
  const verdict = ret >= 3 ? 'STRONG FARM' : ret >= 1 ? 'FARM' : ret >= 0.3 ? 'SPECULATIVE' : 'PASS';
  return { verdict, netEv: Math.round(netEv), ret: round4(ret) };
}

// ------------------------------------------------------------ farm economics

/** The mechanism class a category farms with, from the category's own words, never a name. */
export function mechanismOf(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'supply-borrow';
  if (c.includes('dex') || c.includes('leveraged farm')) return 'liquidity';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return 'margin';
  if (c.includes('bridge') || c.includes('cross chain')) return 'bridge';
  if (c.includes('staking') || c.includes('restak')) return 'stake';
  if (c.includes('yield') || c.includes('vault') || c.includes('allocator') || c.includes('curator')) return 'vault';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('stable')) return 'stable';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('insurance')) return 'cover';
  if (c.includes('chain')) return 'chain';
  return 'deposit';
}

/** Capital factor by mechanism: supplying, LP and RWA minting need a bigger position. */
const CAPITAL_FACTOR: Record<string, number> = {
  'supply-borrow': 1.5,
  liquidity: 1.5,
  margin: 1.0,
  bridge: 0.6,
  stake: 0.8,
  vault: 1.0,
  prediction: 0.6,
  stable: 1.0,
  rwa: 1.5,
  cover: 0.8,
  chain: 0.6,
  deposit: 1.0,
};

/**
 * Gas planning figures in USD per transaction, by chain. These are the only numbers in the
 * model that do not come from the snapshot: they are planning figures for the farm plan's
 * costs, labelled as such on the dashboard, and they never touch the implied value.
 */
const GAS_USD: Record<string, number> = {
  Ethereum: 12,
  Solana: 1,
  BSC: 2,
  Arbitrum: 3,
  Base: 2,
  Polygon: 2,
  Avalanche: 3,
  Optimism: 2,
  Tron: 2,
  Sui: 1,
  Aptos: 1,
  Berachain: 2,
  Hyperliquid: 1,
  Sonic: 2,
  Monad: 2,
  Plasma: 2,
};

export function gasFor(chain: string): number {
  return GAS_USD[chain] ?? 4;
}

/** How much capital one position needs: TVL tier times the mechanism's factor, to $10. */
export function capitalFor(p: SnapshotProtocol): number {
  const base = p.tvl_usd >= 5_000_000_000 ? 250 : p.tvl_usd >= 1_000_000_000 ? 150 : p.tvl_usd >= 100_000_000 ? 100 : 50;
  const factor = CAPITAL_FACTOR[mechanismOf(p)] ?? 1;
  return Math.round((base * factor) / 10) * 10;
}

/** How long to hold, from the protocol's age: a younger protocol needs a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The one action the category asks of a farmer, in that category's own words. */
export function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const m = mechanismOf(p);
  const name = p.name;
  if (m === 'supply-borrow') {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $20 against it and repay after a week: supply and borrow both count.`;
  }
  if (m === 'liquidity') {
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain}, in the pair its own volume page ranks first, and swap once a week through it.`;
  }
  if (m === 'margin') {
    return `Deposit $${capital} of USDC as margin on ${name} and keep one small hedge open; margin balances, not volume, are what its record counts.`;
  }
  if (m === 'bridge') {
    return `Move $${capital} of USDC across to ${chain} through ${name} and use the funds in the app it lands in; bridge it back after a week, so both directions count.`;
  }
  if (m === 'stake') {
    return `Stake $${capital} of ${chain}'s staking asset through ${name} and keep the receipt token in the farming wallet.`;
  }
  if (m === 'vault') {
    return `Deposit $${capital} of USDC into ${name}'s largest vault on ${chain} and leave the shares in the wallet.`;
  }
  if (m === 'prediction') return `Fund $${capital} on ${name} on ${chain} and keep one open position in a market you follow.`;
  if (m === 'stable') return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it there.`;
  if (m === 'rwa') return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it in the same wallet.`;
  if (m === 'cover') return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy open.`;
  if (m === 'chain') return `Bridge $${capital} onto ${chain} through its own bridge and use one app built on it.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly repeat, in the mechanism's own words: the same action, kept alive. */
function repeatFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const m = mechanismOf(p);
  const name = p.name;
  if (m === 'supply-borrow') return `Top the supply up by $10 and borrow $20 again on ${name}, then repay it: two touches a week keep the position in the record.`;
  if (m === 'liquidity') return `Swap $${Math.max(10, Math.round(capital / 5))} through ${name}'s pool on ${chain} once a week, on the same wallet, so the activity lands in more than one snapshot.`;
  if (m === 'margin') return `Rebalance the hedge on ${name} once a week and keep the margin above $${capital}: a closed position stops counting.`;
  if (m === 'bridge') return `Bridge $10 across through ${name} and back once a week, so both directions keep appearing in the record.`;
  if (m === 'stake') return `Claim and restake the staking rewards on ${name} once a week, keeping the receipt token in the farming wallet.`;
  if (m === 'vault') return `Add $10 to the ${name} vault on ${chain} once a week, so the deposit history grows instead of sitting still.`;
  if (m === 'prediction') return `Settle one position and open another on ${name} each week, in a market you follow, rather than leaving one bet open.`;
  if (m === 'stable') return `Mint another $10 of the stable asset through ${name} once a week and hold it in the same wallet.`;
  if (m === 'rwa') return `Mint another $10 of ${name}'s yield asset on ${chain} each week and hold it in the farming wallet.`;
  if (m === 'cover') return `Check the ${name} policy each week and renew the cover before it lapses, so the position never gaps.`;
  if (m === 'chain') return `Use one app on ${chain} through ${name}'s bridge each week, so the wallet keeps appearing on the chain.`;
  return `Repeat one qualifying action every week for eight weeks, on the same wallet, so the activity lands in more than one snapshot of ${name}'s record.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, each derived from
 * the protocol's own record. Nothing here is looked up by name either.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const others = p.chains.length > 1 ? p.chains.slice(0, 2).join(' and ') : chain;
  return [
    {
      text: `Make a fresh wallet for ${p.name} alone, funded from an exchange or a wallet you already control, and keep its seed phrase offline.`,
      cost: 'nothing beyond the funds you will farm',
      time: '10 minutes',
    },
    {
      text: `Get gas onto ${others}: keep about $20 of the chain's own token in the wallet, bought in the same transfer that funds the position.`,
      cost: `about $20 of gas token and about $${gas} of fees`,
      time: '10 minutes',
    },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${gas * 2} of gas`, time: '20 minutes' },
    {
      text: repeatFor(p, capital, chain),
      cost: `about $${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the whole position for at least ${hold} days. ${p.name} has ${fmtMillions(p.tvl_usd)} of TVL; positions are counted per wallet, so leaving early resets the window.`,
      cost: `the $${capital} stays locked in the position`,
      time: `${hold} days`,
    },
    {
      text: `Keep a farm log: wallet address, every transaction hash and its date. Check ${p.name}'s own site or X account for a points or rewards page before you claim anything.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes a month',
    },
    {
      text: `Unwind on your terms: withdraw after the qualifying window, keep the receipt token if ${p.name} issued one, and never sign a claim from a link you did not open yourself.`,
      cost: `about $${gas * 2} of gas to withdraw and bridge back`,
      time: '20 minutes',
    },
  ];
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A TVL in words: billions above $1B, millions below it, with thousands separators. */
export function fmtMillions(tvl: number): string {
  if (tvl >= 1_000_000_000) return `$${(tvl / 1e9).toFixed(2)}B`;
  const m = Math.round(tvl / 1e6).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${m}M`;
}

/** The one sentence that says why a row sits where it sits. */
export function driversFor(p: SnapshotProtocol, s: Scored, oddsPct: number, slope: number): string {
  const parts: string[] = [];
  parts.push(`${fmtMillions(p.tvl_usd)} TVL, fitted at ${s.multiple.toFixed(2)}x (slope ${slope.toFixed(2)} on log TVL, ${p.category ?? 'no category'} intercept ${s.cat >= 0 ? '+' : ''}${s.cat.toFixed(2)} dex)`);
  if (p.change_7d === null) parts.push('no seven-day change on record, so the growth term is flat');
  else parts.push(`${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(2)}% in seven days, worth ${s.adj[0] >= 0 ? '+' : ''}${s.adj[0].toFixed(2)} dex`);
  parts.push(s.age === null ? 'no listing day on record, so the model assumes one year' : `${Math.round(s.age / 30.44)} months with no token of its own`);
  parts.push(`${p.chains.length} chain${p.chains.length === 1 ? '' : 's'}`);
  parts.push(`${oddsPct.toFixed(1)}% of protocols its age and size already trade a token with a market cap on record`);
  return `${parts.join('; ')}.`;
}

export function buildBoard(snapshot: Snapshot, fitted: Fitted, fit: Fit, odds: OddsCell[], high: Set<string>): BoardRow[] {
  const kindFactorFor = (kind: string, group: 'high' | 'low'): number => {
    const found = fit.conformal_kinds.find((k) => k.kind === kind);
    return found === undefined ? fit.cv10.q90_factor : found.q90_factor;
  };
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);

  // The watchlist is the floor of the board and never optional: every slug it names is a row.
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && isPreToken(p)) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol that is a launch candidate, at any TVL above
  // the snapshot's own $5M floor. No cap: the radar exists to find the ones not on the list yet.
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug)) continue;
    if (p.tvl_usd < 5_000_000) continue;
    if (!isCandidate(p)) continue;
    chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const s = scoreProtocol(p, snapshot.as_of, fitted, high, kindFactorFor);
    const cell = oddsFor(p, snapshot.as_of, odds);
    return { p, s, cell };
  });
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  return scored.map((entry, i) => {
    const { p, s, cell } = entry;
    const capital = capitalFor(p);
    const gas = gasFor(chainOf(p)) * 6;
    const farmCost = capital + 20 + gas;
    const oddsPct = cell.rate * 100;
    const v = verdictFor(cell.rate, s.implied, farmCost);
    const slope = s.group === 'high' ? fit.slope_high : fit.slope_low;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      age_days: s.age,
      token_status: 'pre-token' as const,
      bucket: (watch.has(p.slug) ? 'watchlist' : 'early') as 'watchlist' | 'early',
      implied_value_usd: s.implied,
      implied_low_usd: s.low,
      implied_high_usd: s.high,
      kind: s.kind,
      kind_factor: s.kindFactor,
      group: s.group,
      tier: tierOf(s.implied),
      multiple: s.multiple,
      cat_intercept: s.cat,
      adj_growth: s.adj[0],
      adj_age: s.adj[1],
      adj_chains: s.adj[2],
      odds_pct: round4(oddsPct),
      odds_n: cell.n,
      odds_token: cell.token,
      expected_value_usd: Math.round(s.implied * cell.rate),
      verdict: v.verdict,
      net_ev_usd: v.netEv,
      farm_return: v.ret,
      farm_capital_usd: capital,
      farm_gas_usd: gas,
      farm_total_cost_usd: farmCost,
      farm_days: holdDaysFor(s.age),
      drivers: driversFor(p, s, oddsPct, slope),
      farm_steps: farmPlan(p, s.age).map(stepText),
    };
  });
}

/** The live-token protocols, all 128 of them, shown beside the board at the market's own valuation. */
export function liveRows(snapshot: Snapshot, fitted: Fitted, high: Set<string>): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number) || b.tvl_usd - a.tvl_usd)
    .map((p) => {
      const fittedMcap = Math.round(10 ** fittedLog10(fitted, p, snapshot.as_of, high).log);
      const multiple = p.mcap_usd === null ? null : Math.round(((p.mcap_usd as number) / p.tvl_usd) * 100) / 100;
      const logErr = p.mcap_usd === null ? null : round4(Math.log10(fittedMcap) - Math.log10(p.mcap_usd));
      // Outliers by the market's own multiple, never by name: a token trading at ten times
      // its TVL or at a tenth of it is a flow or CEX balance sheet, not a DeFi multiple.
      const outlierTag = multiple === null ? '' : multiple >= 10 ? 'high-multiple outlier' : multiple <= 0.1 ? 'low-multiple outlier' : '';
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        change_7d: p.change_7d,
        // The ratio as the market set it, not the model's fitted copy of it: this table is the evidence.
        multiple,
        fitted_mcap_usd: fittedMcap,
        ape: p.mcap_usd === null ? null : round4(Math.abs(fittedMcap - p.mcap_usd) / p.mcap_usd),
        log_error: logErr,
        outlier_tag: outlierTag,
      };
    });
}

/** Whether the Laplace-smoothed launch odds fall with age in every TVL tier (they do not here). */
export function oddsAgeMonotone(odds: OddsCell[]): boolean {
  const tiers: Array<'$5-50M' | '$50-500M' | '>$500M'> = ['$5-50M', '$50-500M', '>$500M'];
  for (const tier of tiers) {
    const rates = (['<1y', '1-2y', '>2y'] as const).map(
      (b) => odds.find((c) => c.age_bucket === b && c.tvl_tier === tier)?.rate ?? 0,
    );
    if (!(rates[0]! >= rates[1]! && rates[1]! >= rates[2]!)) return false;
  }
  return true;
}

/** The 758 accounting: count every protocol in the snapshot by what happened to it. */
export function buildAccounting(snapshot: Snapshot): Accounting {
  let preTokenScored = 0;
  let liveFitted = 0;
  let listedNoMcap = 0;
  let byCategory = 0;
  let byVersion = 0;
  let byProductWord = 0;
  let byExchange = 0;
  let mcapZeroOrNeg = 0;
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null && p.mcap_usd > 0) {
      liveFitted += 1;
      continue;
    }
    if (p.mcap_usd !== null && p.mcap_usd <= 0) {
      mcapZeroOrNeg += 1;
      continue;
    }
    // mcap_usd is null from here on.
    if (!isPreToken(p)) {
      listedNoMcap += 1;
      continue;
    }
    if (isCandidate(p)) {
      preTokenScored += 1;
      continue;
    }
    // Pre-token but screened out: first matching reason, in the screen's own order.
    if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) byCategory += 1;
    else if (VERSIONED.test(p.name)) byVersion += 1;
    else if (PRODUCT_WORD.test(p.name)) byProductWord += 1;
    else if (EXCHANGE_PREFIX.test(p.name)) byExchange += 1;
    else byCategory += 1; // unreachable by construction; kept so the parts sum to the whole
  }
  return {
    total: snapshot.protocols.length,
    pre_token_scored: preTokenScored,
    live_token_fitted: liveFitted,
    listed_no_mcap: listedNoMcap,
    pre_token_screened_out: byCategory + byVersion + byProductWord + byExchange,
    screened_by_category: byCategory,
    screened_by_version: byVersion,
    screened_by_product_word: byProductWord,
    screened_by_exchange_name: byExchange,
    mcap_zero_or_negative: mcapZeroOrNeg,
  };
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { fit, high } = fitModel(snapshot);
  const live = liveFeatures(snapshot);
  const fitted = fitOn(live, high);
  const odds = buildOdds(snapshot);
  const board = buildBoard(snapshot, fitted, fit, odds, high);
  const liveRowsOut = liveRows(snapshot, fitted, high);
  const ages = board.map((r) => r.age_days).filter((a): a is number => a !== null).sort((a, b) => a - b);
  const medianAge = ages.length === 0 ? null : ages[Math.floor(ages.length / 2)]!;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => r.bucket === 'early').length,
    live_size: liveRowsOut.length,
    protocols_seen: snapshot.protocols.length,
    median_age_days: medianAge,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    accounting: buildAccounting(snapshot),
    odds_age_monotone: oddsAgeMonotone(odds),
    fit,
    odds,
    rows: board.map((r) => ({ ...r, model_ok: true })),
    live: liveRowsOut,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board has ${board.length} rows, fewer than the 100 the gate takes`;
  if (board.length > 4000) return `the board has ${board.length} rows, over the 4000 the gate takes`;
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.rank < 1 || !Number.isSafeInteger(r.rank)) return `${r.slug} has rank ${r.rank}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value over the cap`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share one implied value`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
