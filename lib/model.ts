// Token Radar, radar-3: one snapshot of the protocol universe in, one ranked board out.
//
// The question the board answers is: if this protocol's record stayed as it is and its token
// launched, what would that token be worth? No protocol is looked up by name. Every number below
// is either a figure the snapshot carries (TVL, seven-day growth, the day DefiLlama started
// tracking it, its chains) or one fitted from the live side of the same snapshot: the market
// multiple that protocols in the same category already trade at.
//
//   log10(mcap) = a + b * log10(TVL) + cat_intercept + adj
//     a, b      pooled OLS on the 128 live-token protocols (mcap and TVL both positive)
//     cat       mean log-residual of the protocol's category, shrunk by n / (n + 5),
//               clipped to +/-1 dex, so a thin category borrows the field
//     adj       OLS of the remaining residuals on growth, age and chain count, each term
//               clipped to +/-0.05 dex: the snapshot says these add almost nothing once
//               TVL and category are in, and the fit is not allowed to pretend otherwise
//     implied   = 10 ^ log10(mcap), rounded to whole dollars
//     interval  = implied / F .. implied * F, F = 10 ^ q90, q90 the 90th percentile of the
//               absolute log10 errors of a deterministic 5-fold cross-validation on the
//               live side (folds by sorted slug). A 90% conformal range, held out, not a
//               percentile of the market's own spread. It is wide, because launches vary
//               that much: the dashboard says so rather than hiding it.
//
// The board ranks the pre-token side. Protocols whose token already trades are never scored:
// they are shown beside the board at the market's own market cap, which is a fact rather than
// a model, and the yardstick table shows the model's fitted market cap beside the actual one,
// so a reader can see how far the fit is off on the protocols it was fitted on.
//
// Launch odds are empirical, from the same snapshot: the share of protocols in the row's age
// bucket (<1y, 1-2y, >2y) and TVL tier ($5-50M, $50-500M, >$500M) that already trade a token
// with a market cap on record (mcap_usd > 0), Laplace-smoothed (token + 1) / (n + 2), with
// the n behind each cell stated. 272 protocols carry a gecko_id or symbol with no market cap
// on record; they count as not launched here, because a listing page is not a trading token.
// Expected value is odds times implied. Odds are a record of who launched, not a prediction
// of who will.

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

export const MODEL_VERSION = 'radar-3';

/** The fitted model, as the program measured it from this snapshot's live side. */
export interface Fit {
  n_live: number;
  slope: number;
  intercept: number;
  r2_in_sample: number;
  resid_coefs: [number, number, number]; // growth, log10(age) - 2.5, chains - 1
  shrink_k: number;
  cat_intercepts: Record<string, number>;
  cat_n: Record<string, number>;
  cv: {
    folds: number;
    mape: number;
    median_ape: number;
    r2: number;
    q90_log: number;
    q90_factor: number;
    interval_width_factor: number;
  };
  /** The radar-2 baseline on the same folds: category median mcap/TVL, field median if n < 3. */
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

interface Fitted {
  slope: number;
  intercept: number;
  residCoefs: [number, number, number];
  catIntercepts: Map<string, number>;
  catN: Map<string, number>;
}

function fitOn(rows: LiveFeat[]): Fitted {
  const X = rows.map((r) => [1, r.logTvl]);
  const y = rows.map((r) => r.logMcap);
  const [intercept, slope] = ols(X, y);
  const resid = rows.map((r, i) => y[i]! - (intercept! + slope! * r.logTvl));
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
    slope: slope!,
    intercept: intercept!,
    residCoefs: [rc[0]!, rc[1]!, rc[2]!],
    catIntercepts,
    catN,
  };
}

/** The three residual adjustments for one protocol, each clipped to +/-0.05 dex. */
function adjustments(f: Fitted, growth: number, logAge: number, chains: number): [number, number, number] {
  return [
    clip(f.residCoefs[0] * (growth / 100), -ADJ_CLIP, ADJ_CLIP),
    clip(f.residCoefs[1] * (logAge - 2.5), -ADJ_CLIP, ADJ_CLIP),
    clip(f.residCoefs[2] * (chains - 1), -ADJ_CLIP, ADJ_CLIP),
  ];
}

function fittedLog10(f: Fitted, p: SnapshotProtocol, asOf: string): { log: number; adj: [number, number, number]; cat: number } {
  const age = ageDays(asOf, p.listed_at) ?? 365;
  const growth = clip(finite(p.change_7d, 0), -30, 60);
  const chains = Math.min(p.chains.length, 6);
  const cat = f.catIntercepts.get(p.category ?? '(none)') ?? 0;
  const adj = adjustments(f, growth, Math.log10(Math.max(1, age)), chains);
  const log = f.intercept + f.slope * Math.log10(p.tvl_usd) + cat + adj[0] + adj[1] + adj[2];
  return { log, adj, cat };
}

/** Deterministic 5-fold CV on the live side: folds by sorted slug, so the same run repeats. */
function crossValidate(live: LiveFeat[], asOf: string): Fit['cv'] {
  const folds: LiveFeat[][] = [[], [], [], [], []];
  live.forEach((r, i) => folds[i % 5]!.push(r));
  const logErrs: number[] = [];
  const apes: number[] = [];
  const yHeld: number[] = [];
  const predHeld: number[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const test = folds[fold]!;
    const train = folds.flatMap((f, i) => (i === fold ? [] : f));
    const f = fitOn(train);
    for (const r of test) {
      const pred = fittedLog10(f, r.p, asOf).log;
      const actual = 10 ** r.logMcap;
      const fitted = 10 ** pred;
      logErrs.push(pred - r.logMcap);
      apes.push(Math.abs(fitted - actual) / actual);
      yHeld.push(r.logMcap);
      predHeld.push(pred);
    }
  }
  const absErrs = logErrs.map((e) => Math.abs(e)).sort((a, b) => a - b);
  // Conformal 90%: the ceil(0.9 * (n + 1))-th smallest absolute held-out log error.
  const idx = Math.min(absErrs.length - 1, Math.max(0, Math.ceil(0.9 * (absErrs.length + 1)) - 1));
  const q90 = absErrs[idx]!;
  const mape = apes.reduce((s, v) => s + v, 0) / apes.length;
  const sortedApe = [...apes].sort((a, b) => a - b);
  const medianApe = sortedApe[Math.floor(sortedApe.length / 2)]!;
  return {
    folds: 5,
    mape: round4(mape),
    median_ape: round4(medianApe),
    r2: round4(r2Of(yHeld, predHeld)),
    q90_log: round4(q90),
    q90_factor: round4(10 ** q90),
    interval_width_factor: round4(10 ** (2 * q90)),
  };
}

export function fitModel(snapshot: Snapshot): { fit: Fit; live: LiveFeat[] } {
  const live = liveFeatures(snapshot);
  const f = fitOn(live);
  const y = live.map((r) => r.logMcap);
  const pred = live.map((r) => fittedLog10(f, r.p, snapshot.as_of).log);
  const cv = crossValidate(live, snapshot.as_of);
  const fit: Fit = {
    n_live: live.length,
    slope: round6(f.slope),
    intercept: round6(f.intercept),
    r2_in_sample: round4(r2Of(y, pred)),
    resid_coefs: [round6(f.residCoefs[0]), round6(f.residCoefs[1]), round6(f.residCoefs[2])],
    shrink_k: SHRINK_K,
    cat_intercepts: Object.fromEntries([...f.catIntercepts.entries()].map(([k, v]) => [k, round6(v)])),
    cat_n: Object.fromEntries(f.catN.entries()),
    cv,
    cv_baseline: baselineCv(live),
  };
  return { fit, live };
}

/**
 * The radar-2 baseline, scored on the same 5 folds by sorted slug: each fold's training
 * categories give a median mcap/TVL (fewer than 3 observations: the field median), and the
 * held-out protocols are priced at TVL times that median. The comparison is the point:
 * the fitted model must earn its keep against the simplest honest model, on held-out data.
 */
function baselineCv(live: LiveFeat[]): { mape: number; median_ape: number } {
  const folds: LiveFeat[][] = [[], [], [], [], []];
  live.forEach((r, i) => folds[i % 5]!.push(r));
  const apes: number[] = [];
  for (let fold = 0; fold < 5; fold++) {
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
}

export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  f: Fitted,
  q90Factor: number,
): Scored {
  const age = ageDays(asOf, p.listed_at);
  const { log, adj, cat } = fittedLog10(f, p, asOf);
  const implied = Math.max(1, Math.round(10 ** log));
  return {
    implied,
    low: Math.max(1, Math.round(implied / q90Factor)),
    high: Math.round(implied * q90Factor),
    multiple: round4(implied / p.tvl_usd),
    cat: round6(cat),
    adj: [round6(adj[0]), round6(adj[1]), round6(adj[2])],
    age,
    growthPct: clip(finite(p.change_7d, 0), -30, 60),
  };
}

/** The tier a row's implied value falls in: the board's own bands, stated on the page. */
export function tierOf(implied: number): string {
  if (implied >= 250_000_000) return 'A';
  if (implied >= 75_000_000) return 'B';
  if (implied >= 20_000_000) return 'C';
  return 'D';
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

export function buildBoard(snapshot: Snapshot, fitted: Fitted, fit: Fit, odds: OddsCell[]): BoardRow[] {
  const q90Factor = fit.cv.q90_factor;
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
    const s = scoreProtocol(p, snapshot.as_of, fitted, q90Factor);
    const cell = oddsFor(p, snapshot.as_of, odds);
    return { p, s, cell };
  });
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  return scored.map((entry, i) => {
    const { p, s, cell } = entry;
    const capital = capitalFor(p);
    const gas = gasFor(chainOf(p)) * 6;
    const oddsPct = cell.rate * 100;
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
      farm_capital_usd: capital,
      farm_gas_usd: gas,
      farm_total_cost_usd: capital + 20 + gas,
      farm_days: holdDaysFor(s.age),
      drivers: driversFor(p, s, oddsPct, fit.slope),
      farm_steps: farmPlan(p, s.age).map(stepText),
    };
  });
}

/** The live-token protocols, by market cap, shown beside the board at the market's own valuation. */
export function liveRows(snapshot: Snapshot, fitted: Fitted): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number) || b.tvl_usd - a.tvl_usd)
    .slice(0, 40)
    .map((p) => {
      const fittedMcap = Math.round(10 ** fittedLog10(fitted, p, snapshot.as_of).log);
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        change_7d: p.change_7d,
        // The ratio as the market set it, not the model's fitted copy of it: this table is the evidence.
        multiple: p.mcap_usd === null ? null : Math.round(((p.mcap_usd as number) / p.tvl_usd) * 100) / 100,
        fitted_mcap_usd: fittedMcap,
        ape: p.mcap_usd === null ? null : round4(Math.abs(fittedMcap - p.mcap_usd) / p.mcap_usd),
      };
    });
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { fit } = fitModel(snapshot);
  const live = liveFeatures(snapshot);
  const fitted = fitOn(live);
  const odds = buildOdds(snapshot);
  const board = buildBoard(snapshot, fitted, fit, odds);
  const liveRowsOut = liveRows(snapshot, fitted);
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
