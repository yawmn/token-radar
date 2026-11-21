// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The question the board answers is: if this protocol's record stayed as it is and its token
// launched, what would that token be worth? No protocol is looked up by name. Every number below
// is either a figure the snapshot carries (TVL, seven-day growth, the day DefiLlama started
// tracking it, its chains) or one measured from the live side of the same snapshot: the market
// multiple that protocols in the same category already trade at.
//
//   mult        = median(mcap_usd / tvl_usd) over the category's live-token protocols
//                 (fewer than MIN_OBS observations: the whole live field's median)
//   band        = the same ratio's 25th and 75th percentile, so every row carries a range
//   momentum    = 1 + clamp(change_7d, -30, 60) / 100 * MOMENTUM_WEIGHT
//   patience    = PATIENCE_FLOOR + PATIENCE_RANGE * min(age_days, PATIENCE_DAYS) / PATIENCE_DAYS
//   reach       = 1 + REACH_WEIGHT * min(chains, REACH_CHAINS) / REACH_CHAINS
//   implied     = round(tvl_usd * mult * momentum * patience * reach)
//
// `patience` is the time the protocol has run with no token of its own: a protocol that has spent
// four years building a user base before launching is further along its launch than one listed
// last month. It is the snapshot's listed_at, the best record of that age it carries.
//
// The board ranks the pre-token side. Protocols whose token already trades are never scored: they
// are shown beside the board at the market's own market cap, which is a fact rather than a model.
// Their market caps are also what the model's multiples are measured from, which is why the radar
// gets better as the live side of the snapshot gets richer.

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

export const MODEL_VERSION = 'radar-2';

/** How the constants are named on the page: they are the model's stated assumptions. */
export interface ModelConstants {
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
  patience_floor: number;
  patience_range: number;
  patience_days: number;
  reach_weight: number;
  reach_chains: number;
  min_observations: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL: ModelConstants = {
  momentum_weight: 0.6,
  momentum_floor: -30,
  momentum_cap: 60,
  patience_floor: 0.85,
  patience_range: 0.3,
  patience_days: 1460,
  reach_weight: 0.06,
  reach_chains: 12,
  min_observations: 3,
  multiple_floor: 0.02,
  multiple_cap: 4,
};

/** One category's measured multiple: the market's own read, with the sample it was read from. */
export interface Multiple {
  category: string;
  n: number;
  p25: number;
  p50: number;
  p75: number;
  from_field: boolean;
}

/** The live field's ratio, used wherever a category is too thin to read. */
export interface FieldMultiple {
  n: number;
  p25: number;
  p50: number;
  p75: number;
}

export interface Multiples {
  field: FieldMultiple;
  by_category: Multiple[];
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
  momentum_multiplier: number;
  patience_multiplier: number;
  reach_multiplier: number;
  farm_capital_usd: number;
  farm_days: number;
  drivers: string;
  farm_steps: string[];
}

export interface RadarRow extends BoardRow {
  /** The model constants, repeated per row so the page can recompute without the model object. */
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
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  protocols_seen: number;
  median_age_days: number | null;
  total_implied_usd: number;
  multiples: Multiples;
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

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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

/** The nearest-rank percentile of a sorted list, clamped to the model's multiple bounds. */
function percentile(sorted: number[], q: number, model: ModelConstants): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  const raw = sorted[at]!;
  return Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw));
}

/**
 * The market's own multiples, measured from the snapshot's live-token protocols: market cap over
 * TVL, per category. A category with fewer than MIN_OBS observations borrows the live field's own
 * median, so a thin category still gets a number the market supports rather than a guess.
 */
export function measureMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): Multiples {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0,
  );
  const field_ratios = live.map((p) => (p.mcap_usd as number) / p.tvl_usd).sort((a, b) => a - b);
  const field: FieldMultiple = {
    n: field_ratios.length,
    p25: percentile(field_ratios, 0.25, model),
    p50: percentile(field_ratios, 0.5, model),
    p75: percentile(field_ratios, 0.75, model),
  };
  const by_category: Multiple[] = [];
  const groups = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? '(none)';
    const list = groups.get(key);
    const ratio = (p.mcap_usd as number) / p.tvl_usd;
    if (list === undefined) groups.set(key, [ratio]);
    else list.push(ratio);
  }
  for (const [category, ratios] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    ratios.sort((a, b) => a - b);
    const from_field = ratios.length < model.min_observations;
    by_category.push(
      from_field
        ? { category, n: ratios.length, p25: field.p25, p50: field.p50, p75: field.p75, from_field }
        : {
            category,
            n: ratios.length,
            p25: percentile(ratios, 0.25, model),
            p50: percentile(ratios, 0.5, model),
            p75: percentile(ratios, 0.75, model),
            from_field,
          },
    );
  }
  return { field, by_category };
}

/** The multiple, and the band around it, one protocol's category is scored with. */
export function multipleFor(category: string | null, multiples: Multiples, model: ModelConstants = MODEL): Multiple {
  const key = category ?? '(none)';
  const found = multiples.by_category.find((m) => m.category === key);
  if (found !== undefined) return found;
  return {
    category: key,
    n: 0,
    p25: multiples.field.p25,
    p50: multiples.field.p50,
    p75: multiples.field.p75,
    from_field: true,
  };
}

export interface Scored {
  implied: number;
  low: number;
  high: number;
  multiple: number;
  momentum: number;
  momentumMult: number;
  patienceMult: number;
  reachMult: number;
  age: number | null;
  growthPct: number;
}

/**
 * One protocol's launch-equivalent value under the model. The same function scores every row:
 * nothing here knows any protocol's name.
 */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  multiples: Multiples,
  model: ModelConstants = MODEL,
): Scored {
  const age = ageDays(asOf, p.listed_at);
  const m = multipleFor(p.category, multiples, model);

  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.momentum_cap, Math.max(model.momentum_floor, rawGrowth));
  const momentumMult = 1 + (growthPct / 100) * model.momentum_weight;

  const ageForModel = age ?? Math.round(model.patience_days / 4);
  const patienceMult =
    model.patience_floor +
    (Math.min(Math.max(ageForModel, 0), model.patience_days) / model.patience_days) * model.patience_range;

  const chains = Math.min(p.chains.length, model.reach_chains);
  const reachMult = 1 + (chains / model.reach_chains) * model.reach_weight;

  // The multiple is stated to four places and the arithmetic runs on the stated number, so the
  // page's own recompute from the row reaches the same dollar the board carries.
  const p50 = round4(m.p50);
  const p25 = round4(m.p25);
  const p75 = round4(m.p75);
  const scale = momentumMult * patienceMult * reachMult;
  return {
    implied: Math.max(1, Math.round(p.tvl_usd * p50 * scale)),
    low: Math.max(1, Math.round(p.tvl_usd * p25 * scale)),
    high: Math.max(1, Math.round(p.tvl_usd * p75 * scale)),
    multiple: p50,
    momentum: growthPct,
    momentumMult,
    patienceMult,
    reachMult,
    age,
    growthPct,
  };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The tier a row's implied value falls in: the board's own bands, stated on the page. */
export function tierOf(implied: number): string {
  if (implied >= 250_000_000) return 'A';
  if (implied >= 75_000_000) return 'B';
  if (implied >= 20_000_000) return 'C';
  return 'D';
}

/** How much capital one position in the protocol needs, from the protocol's own TVL. */
export function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
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
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $20 against it and repay after a week: supply and borrow both count.`;
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain}, in the pair its own volume page ranks first, and swap once a week through it.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) {
    return `Deposit $${capital} of USDC as margin on ${name} and keep one small hedge open; margin balances, not volume, are what its record counts.`;
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return `Move $${capital} of USDC across to ${chain} through ${name} and use the funds in the app it lands in; bridge it back after a week, so both directions count.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of ${chain}'s staking asset through ${name} and keep the receipt token in the farming wallet.`;
  }
  if (c.includes('yield') || c.includes('vault') || c.includes('allocator') || c.includes('curator')) {
    return `Deposit $${capital} of USDC into ${name}'s largest vault on ${chain} and leave the shares in the wallet.`;
  }
  if (c.includes('prediction')) return `Fund $${capital} on ${name} on ${chain} and keep one open position in a market you follow.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it there.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it in the same wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy open.`;
  if (c.includes('chain')) return `Bridge $${capital} onto ${chain} through its own bridge and use one app built on it.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, each derived from the
 * protocol's own record. Nothing here is looked up by name either.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const others = p.chains.length > 1 ? p.chains.slice(0, 2).join(' and ') : chain;
  return [
    {
      text: `Make a fresh wallet for ${p.name} alone, funded from an exchange or a wallet you already control, and keep its seed phrase offline.`,
      cost: 'nothing beyond the funds you will farm',
      time: '10 minutes',
    },
    {
      text: `Get gas onto ${others}: keep about $20 of the chain's own token in the wallet, bought in the same transfer that funds the position.`,
      cost: 'about $20 of gas token and under $1 of fees',
      time: '10 minutes',
    },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${gas} of gas`, time: '20 minutes' },
    {
      text: `Repeat one qualifying action every week for eight weeks, on the same wallet, so the activity lands in more than one snapshot of ${p.name}'s record.`,
      cost: 'about $2 of gas a week',
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
      cost: `about $${gas} of gas to withdraw and bridge back`,
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
export function driversFor(p: SnapshotProtocol, s: Scored): string {
  const parts: string[] = [];
  parts.push(`${fmtMillions(p.tvl_usd)} TVL at ${s.multiple.toFixed(2)}x, the median its category's live tokens trade at`);
  if (p.change_7d === null) parts.push('no seven-day change on record, so flat momentum');
  else parts.push(`${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(2)}% in seven days`);
  parts.push(s.age === null ? 'no listing day on record, so the model assumes one year' : `${Math.round(s.age / 30.44)} months with no token of its own`);
  parts.push(`${p.chains.length} chain${p.chains.length === 1 ? '' : 's'}`);
  return `${parts.join('; ')}.`;
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = measureMultiples(snapshot, model);
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

  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, multiples, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  return scored.map((entry, i) => {
    const { p, s } = entry;
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
      momentum_multiplier: round4(s.momentumMult),
      patience_multiplier: round4(s.patienceMult),
      reach_multiplier: round4(s.reachMult),
      farm_capital_usd: capitalFor(p.tvl_usd),
      farm_days: holdDaysFor(s.age),
      drivers: driversFor(p, s),
      farm_steps: farmPlan(p, s.age).map(stepText),
    };
  });
}

/** The live-token protocols, by market cap, shown beside the board at the market's own valuation. */
export function liveRows(snapshot: Snapshot, model: ModelConstants = MODEL): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number) || b.tvl_usd - a.tvl_usd)
    .slice(0, 40)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      // The ratio as the market set it, not the model's clamped copy of it: this table is the evidence.
      multiple: p.mcap_usd === null ? null : Math.round(((p.mcap_usd as number) / p.tvl_usd) * 100) / 100,
    }));
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const multiples = measureMultiples(snapshot, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot, model);
  const ages = board.map((r) => r.age_days).filter((a): a is number => a !== null).sort((a, b) => a - b);
  const medianAge = ages.length === 0 ? null : ages[Math.floor(ages.length / 2)]!;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => r.bucket === 'early').length,
    live_size: live.length,
    protocols_seen: snapshot.protocols.length,
    median_age_days: medianAge,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    multiples,
    rows: board.map((r) => ({ ...r, model_ok: true })),
    live,
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
