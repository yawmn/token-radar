// Token Radar's page, radar-4. Reads window.RADAR (data.js beside dashboard/) and
// renders the board, a detail view per protocol, the validation, and the live yardstick.
// No fetch, no import, no network. The page recomputes each row's implied value with
// the same arithmetic lib/model.ts used, and says on the detail view how close its
// number lands to board.json's.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var FIT = DATA.fit;
  var app = document.getElementById('board');

  var state = { q: '', scope: 'all', cat: 'all', chain: 'all', verdict: 'all', sort: 'implied', dir: -1, sel: null };

  // ------------------------------------------------------------------ format

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtDays(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + 'y';
    if (days >= 60) return Math.round(days / 30.44) + ' mo';
    return Math.round(days) + ' d';
  }
  function growthClass(n) {
    if (n === null || n === undefined) return 'flat';
    return n > 0 ? 'pos' : n < 0 ? 'neg' : 'flat';
  }
  function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function pct1(n) { return (n * 100).toFixed(1) + '%'; }

  // ------------------------------------------------------------------ the model, in the page

  // Same fitted arithmetic as lib/model.ts, radar-4: two slopes by multiple group.
  // log10(mcap) = intercept + group slope x log10(TVL) + group shift (high only)
  // + shrunk category intercept + three clipped residual terms. Values are stored
  // to six places, so the page's number lands within 0.1% of the board's.
  function impliedOf(row) {
    var slope = row.group === 'high' ? FIT.slope_high : FIT.slope_low;
    var shift = row.group === 'high' ? FIT.group_shift : 0;
    var log = FIT.intercept + slope * Math.log10(row.tvl_usd) + shift + row.cat_intercept
      + row.adj_growth + row.adj_age + row.adj_chains;
    return Math.max(1, Math.round(Math.pow(10, log)));
  }
  function recomputeGap(row) {
    var re = impliedOf(row);
    return { value: re, pct: Math.abs(re - row.implied_value_usd) / row.implied_value_usd * 100 };
  }

  function stepParts(text) {
    var at = text.indexOf(' Cost: ');
    if (at < 0) return { action: text, cost: '', time: '' };
    var action = text.slice(0, at);
    var tail = text.slice(at + 1);
    var cut = tail.lastIndexOf('. Time: ');
    var cost = cut < 0 ? tail.replace(/^Cost: /, '') : tail.slice('Cost: '.length, cut);
    var time = cut < 0 ? '' : tail.slice(cut + '. Time: '.length).replace(/\.$/, '');
    return { action: action, cost: cost.replace(/\.$/, ''), time: time };
  }

  // ------------------------------------------------------------------ dom

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function frag(children) {
    var f = document.createDocumentFragment();
    children.forEach(function (c) { if (c) f.appendChild(c); });
    return f;
  }

  // ------------------------------------------------------------------ state in the address bar

  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var p = new URLSearchParams(raw);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('scope')) state.scope = p.get('scope');
    if (p.get('cat')) state.cat = p.get('cat');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('verdict')) state.verdict = p.get('verdict');
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('dir')) state.dir = p.get('dir') === 'asc' ? 1 : -1;
    if (p.get('p')) state.sel = p.get('p');
  }

  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.scope !== 'all') p.set('scope', state.scope);
    if (state.cat !== 'all') p.set('cat', state.cat);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.verdict !== 'all') p.set('verdict', state.verdict);
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.dir !== -1) p.set('dir', 'asc');
    if (state.sel) p.set('p', state.sel);
    var next = p.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname);
  }

  // ------------------------------------------------------------------ the board's rows

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { seen[r.category || 'Uncategorised'] = (seen[r.category || 'Uncategorised'] || 0) + 1; });
    return Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a] || (a < b ? -1 : 1); });
  }
  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = (seen[c] || 0) + 1; }); });
    return Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a] || (a < b ? -1 : 1); });
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.scope === 'watchlist' && r.bucket !== 'watchlist') return false;
      if (state.scope === 'early' && r.bucket !== 'early') return false;
      if (state.cat !== 'all' && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', r.chains.join(' '), 'tier ' + r.tier].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sorted(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -1e9 : a.change_7d; bv = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'odds') { av = a.odds_pct; bv = b.odds_pct; }
      else if (key === 'ev') { av = a.expected_value_usd; bv = b.expected_value_usd; }
      else if (key === 'return') { av = a.farm_return; bv = b.farm_return; }
      else if (key === 'capital') { av = a.farm_total_cost_usd; bv = b.farm_total_cost_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ------------------------------------------------------------------ hero + integrity strip

  function hero() {
    var oldest = DATA.rows.reduce(function (n, r) { return r.age_days !== null && r.age_days > n ? r.age_days : n; }, 0);
    var acc = DATA.accounting;
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', null,
          'Every protocol ', el('em', { text: 'still waiting on a token' }), ', ranked by what that token would be worth.'
        ),
        el('p', null,
          el('strong', { text: DATA.board_size + ' launch candidates' }), ' out of the ' + DATA.protocols_seen + ' protocols in the snapshot. ',
          'The watchlist is the floor: ' + DATA.watchlist_size + ' protocols at or above $' + Math.round(DATA.floor_usd / 1e6) + 'M with no token, plus ',
          DATA.early_size + ' below that floor the radar found early. All ' + acc.total + ' accounted for: ' + acc.live_token_fitted + ' live fitted, ' + acc.listed_no_mcap + ' listed with no market cap, ' + acc.pre_token_screened_out + ' pre-token screened out, ' + acc.mcap_zero_or_negative + ' with a zero or negative market cap.'
        )
      ),
      el('div', { class: 'kpis' },
        el('div', { class: 'kpi accent' }, el('b', { text: fmtUsd(DATA.total_implied_usd) }), el('span', { text: 'implied, all rows' })),
        el('div', { class: 'kpi' }, el('b', { text: DATA.watchlist_size + '/' + DATA.watchlist_size }), el('span', { text: 'watchlist covered' })),
        el('div', { class: 'kpi' }, el('b', { text: fmtDays(DATA.median_age_days) }), el('span', { text: 'median no-token age' })),
        el('div', { class: 'kpi' }, el('b', { text: fmtDays(oldest) }), el('span', { text: 'oldest no-token age' }))
      )
    );
  }

  function fmtMult(n) { return 'x' + n.toFixed(1); }

  // The strip the board screenshot opens with: every claim is a number the program
  // measured, proved below. It leads with the three held-out tests, the rank
  // correlation and the per-kind coverage — never with the mean error or any range factor.
  function integrityStrip() {
    var kinds = FIT.conformal_kinds;
    var cov90 = kinds.length ? kinds.reduce(function (s, k) { return s + k.coverage_90; }, 0) / kinds.length : 0;
    function item(label, value) {
      return el('div', { class: 'check' }, el('b', { text: value }), el('span', { text: label }));
    }
    return el('section', { class: 'strip', 'aria-label': 'Integrity checks' },
      item('watchlist covered', DATA.watchlist_size + '/' + DATA.watchlist_size),
      item('rows on the board', String(DATA.board_size)),
      item('held-out tests', '3 ways'),
      item('Spearman rank, held out', 'ρ ' + FIT.cv10.spearman_held_out.toFixed(2)),
      item('per-kind 90% coverage', (cov90 * 100).toFixed(0) + '%'),
      item('two slopes, fitted', FIT.slope_low.toFixed(2) + ' / ' + FIT.slope_high.toFixed(2)),
      item('no value keyed on a name', '0 names'),
      item('live protocols fitted on', String(FIT.n_live))
    );
  }

  function controls() {
    var search = el('input', { type: 'search', id: 'q', value: state.q, placeholder: 'Protocol, category or chain', 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });

    var cat = el('select', { id: 'cat', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'Every category' }),
      categories().map(function (c) { return el('option', { value: c, text: c, selected: c === state.cat ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.cat = cat.value; writeHash(); render(); });

    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'Every chain' }),
      chains().map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });

    var verdict = el('select', { id: 'verdict', 'aria-label': 'Filter by farm verdict' },
      ['all', 'STRONG FARM', 'FARM', 'SPECULATIVE', 'PASS'].map(function (v) {
        return el('option', { value: v, text: v === 'all' ? 'Every verdict' : v, selected: v === state.verdict ? 'selected' : null });
      })
    );
    verdict.addEventListener('change', function () { state.verdict = verdict.value; writeHash(); render(); });

    function scopeButton(key, label) {
      return el('button', { type: 'button', 'aria-pressed': state.scope === key ? 'true' : 'false', text: label,
        onclick: function () { state.scope = key; writeHash(); render(); } });
    }

    var list = visibleRows();
    var early = list.filter(function (r) { return r.bucket === 'early'; }).length;
    var liveTab = state.scope === 'live';

    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Find' }), search),
      el('div', { class: 'field' }, el('span', { class: 'label', text: 'Scope' }),
        el('div', { class: 'seg' },
          scopeButton('all', 'All'),
          scopeButton('watchlist', 'Watchlist'),
          scopeButton('early', 'Below floor'),
          scopeButton('live', 'Live tokens'))),
      el('div', { class: 'field' }, el('label', { for: 'cat', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict' }), verdict),
      el('div', { class: 'spacer' }),
      el('div', { class: 'readout' },
        liveTab
          ? el('div', null, el('b', { text: num(DATA.live.length) }), ' live-token protocols')
          : el('div', null, el('b', { text: num(list.length) }), ' of ' + num(DATA.rows.length) + ' protocols'),
        liveTab
          ? el('div', null, 'the yardstick the model is fitted on')
          : el('div', null, num(list.length - early) + ' on the watchlist · ' + num(early) + ' below the floor')
      )
    );
  }

  function sortHead(key, label, cls) {
    var active = state.sort === key;
    return el('th', { scope: 'col', class: cls ? 'num' : null },
      el('button', { type: 'button', 'data-active': active ? 'true' : 'false',
        onclick: function () {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
          writeHash(); render();
        } },
        label,
        el('i', { 'aria-hidden': 'true', text: active ? (state.dir < 0 ? '\u25BC' : '\u25B2') : '' })
      )
    );
  }

  function rowLine(r, max) {
    return el('tr', { tabindex: '0', onclick: function () { openDetail(r.slug); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
      el('td', { class: 'num' }, el('span', { class: 'rank', text: String(r.rank) })),
      el('td', null, el('div', { class: 'who' },
        el('b', null, r.name, ' ', el('span', { class: 'tier tier-' + r.tier, text: r.tier })),
        el('span', { text: (r.category || 'Uncategorised') + ' · ' + r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') })
      )),
      el('td', { class: 'num col-tvl', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num ' + growthClass(r.change_7d), text: fmtPct(r.change_7d) }),
      el('td', { class: 'num', text: fmtDays(r.age_days) }),
      el('td', { class: 'num odds' }, el('div', null,
        el('div', { text: r.odds_pct.toFixed(1) + '%' }),
        el('span', { class: 'sub', text: r.odds_token + '/' + r.odds_n + ' peers' })
      )),
      el('td', { class: 'num' }, el('div', null,
        el('div', { text: '$' + num(r.farm_total_cost_usd) }),
        el('span', { class: 'sub', text: 'net EV $' + num(r.net_ev_usd) + ' · ' + r.farm_return.toFixed(1) + 'x' })
      )),
      el('td', null, el('span', { class: 'verdict v-' + r.verdict.replace(/ /g, '-').toLowerCase(), text: r.verdict })),
      el('td', null, el('div', { class: 'implied' },
        el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(4, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
        el('div', { class: 'implied-val' },
          el('b', { text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'interval', text: fmtUsd(r.implied_low_usd) + '–' + fmtUsd(r.implied_high_usd) + ' · 90%' })
        )
      )),
      el('td', null, el('span', { class: 'tag ' + (r.bucket === 'watchlist' ? 'watch' : 'early'),
        text: r.bucket === 'watchlist' ? 'watchlist' : 'below floor' }))
    );
  }

  function boardPanel() {
    var list = sorted(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'Nothing on the board matches that' }),
        el('p', { text: 'Clear the filters to see all ' + DATA.rows.length + ' candidates.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: clearFilters })
      ));
    }
    var max = list.reduce(function (n, r) { return Math.max(n, r.implied_value_usd); }, 1);
    var body = el('tbody');
    list.forEach(function (r) { body.appendChild(rowLine(r, max)); });

    return el('div', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', { text: 'The board' }),
        el('p', { text: 'Implied value is the fitted value, not a price. The line under it is the held-out 90% range for its kind.' })
      ),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            sortHead('implied', 'Rank'),
            sortHead('name', 'Protocol'),
            sortHead('tvl', 'TVL', 'col-tvl'),
            sortHead('growth', '7d', 'num'),
            sortHead('age', 'No token for', 'num'),
            sortHead('odds', 'Launch odds', 'num'),
            sortHead('capital', 'Farm cost', 'num'),
            sortHead('return', 'Verdict', 'num'),
            sortHead('implied', 'Implied value', 'num'),
            el('th', { scope: 'col' }, el('span', { class: 'sr', text: 'Source' }))
          )),
          body
        )
      ),
      el('p', { class: 'note', text: 'Ranked by implied value. Sort any column; filter by scope, category, chain or verdict; a row opens the protocol.' })
    );
  }

  // The live side: protocols whose token already trades, at the market's own figures
  // — market cap, TVL, the market multiple — beside the model's fitted market cap and
  // its log error, with an outlier tag for multiples at or beyond 10x or 0.1x. The
  // errors are framed by the aggregate held-out numbers in the header. TVL alone
  // cannot price a single launch, and the table says so with the numbers that prove it.
  function livePanel() {
    var cv = FIT.cv10;
    var base = FIT.cv_baseline;
    var body = el('tbody');
    DATA.live.forEach(function (r) {
      body.appendChild(el('tr', null,
        el('td', { class: 'num' }, el('span', { class: 'rank', text: 'live' })),
        el('td', null, el('div', { class: 'who' },
          el('b', { text: r.name }),
          el('span', { text: (r.category || 'Uncategorised') + ' · ' + r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') })
        )),
        el('td', { class: 'num col-tvl', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.fitted_mcap_usd) }),
        el('td', { class: 'num', text: r.log_error === null ? 'n/a' : (r.log_error >= 0 ? '+' : '') + r.log_error.toFixed(2) + ' dex' }),
        el('td', { class: 'num', text: r.multiple === null ? 'n/a' : r.multiple.toFixed(2) + 'x' }),
        el('td', null, r.outlier_tag ? el('span', { class: 'tag early', text: r.outlier_tag }) : el('span', { class: 'tag watch', text: 'trades today' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', { text: 'The yardstick: protocols whose token already trades' }),
        el('p', { text: 'Held out, 10-fold: median error ' + pct1(cv.median_ape) + ', median log error ' + cv.median_abs_log_error.toFixed(2) + ' dex, ' + (cv.hit_rate_within_2x * 100).toFixed(0) + '% of held-out fits within 2x of actual, Spearman ρ ' + cv.spearman_held_out.toFixed(2) + ' — beats the median-multiple baseline on the same folds (median ' + pct1(base.median_ape) + ', MAPE ' + fmtMult(base.mape) + ' vs ' + fmtMult(cv.mape) + ').' })
      ),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col' }, 'Status'),
            el('th', { scope: 'col' }, 'Protocol'),
            el('th', { scope: 'col', class: 'num' }, 'TVL'),
            el('th', { scope: 'col', class: 'num' }, 'Market cap'),
            el('th', { scope: 'col', class: 'num' }, 'Fitted cap'),
            el('th', { scope: 'col', class: 'num' }, 'Log error'),
            el('th', { scope: 'col', class: 'num' }, 'Multiple'),
            el('th', { scope: 'col' }, el('span', { class: 'sr', text: 'Token' }))
          )),
          body
        )
      ),
      el('p', { class: 'note', text: 'All ' + DATA.live.length + ' live protocols fitted, by market cap. The multiple is as the market set it; the fitted cap is the two-slope model; the log error is log10(fitted) − log10(actual). Multiples at or beyond 10x or 0.1x are tagged outliers.' })
    );
  }

  // How the model was fitted and how it held up out of sample three different ways.
  function validationPanel() {
    var cv = FIT.cv10;
    var base = FIT.cv_baseline;
    var cats = Object.keys(FIT.cat_intercepts).map(function (k) {
      return { cat: k, v: FIT.cat_intercepts[k], n: FIT.cat_n[k] || 0 };
    }).sort(function (a, b) { return b.v - a.v; });
    var topCats = cats.slice(0, 5);
    var bottomCats = cats.slice(-3).reverse();

    var oddsRows = DATA.odds.filter(function (c) { return c.age_bucket !== 'any'; }).map(function (c) {
      return el('tr', null,
        el('td', { text: c.age_bucket }),
        el('td', { text: c.tvl_tier }),
        el('td', { class: 'num', text: pct1(c.rate) }),
        el('td', { class: 'num', text: c.token + ' of ' + c.n }));
    });
    var splitRows = FIT.splits.map(function (s) {
      return el('tr', null,
        el('td', { text: s.name }),
        el('td', { class: 'num', text: s.n_train + ' / ' + s.n_test }),
        el('td', { class: 'num', text: pct1(s.median_ape) }),
        el('td', { class: 'num', text: fmtMult(s.mape) }),
        el('td', { class: 'num', text: (s.r2_log !== undefined ? s.r2_log : s.r2).toFixed(2) }));
    });
    var hm = 0;
    FIT.conformal_kinds.forEach(function (k) { if (k.group === 'high' && k.tvl_tier === '$50-500M') hm = k.q90_factor; });
    var kindRows = FIT.conformal_kinds.map(function (k) {
      return el('tr', null,
        el('td', { text: k.kind }),
        el('td', { class: 'num', text: String(k.n_held_out) }),
        el('td', { class: 'num', text: 'x' + k.q90_factor.toFixed(1) }),
        el('td', { class: 'num', text: (k.coverage_90 * 100).toFixed(0) + '%' }),
        el('td', { class: 'num', text: (k.coverage_80 * 100).toFixed(0) + '%' }),
        el('td', { text: k.fallback === 'none' ? '—' : 'from ' + k.fallback }));
    });

    return el('section', { class: 'panel validation' },
      el('div', { class: 'panel-head' },
        el('h2', { text: 'The model, fitted — and checked out of sample three ways' }),
        el('p', { text: 'log10(market cap) = ' + FIT.intercept.toFixed(2) + ' + ' + FIT.slope_low.toFixed(2) + ' x log10(TVL) (low group) / ' + FIT.slope_high.toFixed(2) + ' x log10(TVL) (high group, shift ' + FIT.group_shift.toFixed(2) + ' dex) + category intercept + residual terms, on ' + FIT.n_live + ' live-token protocols. One slope priced the big DeFi protocols at 0.04x their TVL; two slopes price them at what their own group trades at.' })
      ),
      el('div', { class: 'valid-grid' },
        el('div', null,
          el('h3', { text: 'Held out, three ways' }),
          el('table', { class: 'mini' },
            el('thead', null, el('tr', null,
              el('th', { scope: 'col' }, 'Split'),
              el('th', { scope: 'col', class: 'num' }, 'Train / test'),
              el('th', { scope: 'col', class: 'num' }, 'Median error'),
              el('th', { scope: 'col', class: 'num' }, 'MAPE'),
              el('th', { scope: 'col', class: 'num' }, 'R² log'))),
            el('tbody', null, splitRows)),
          el('p', { class: 'note', text: '10-fold by slug: median error ' + pct1(cv.median_ape) + ', R² ' + cv.r2.toFixed(2) + ', Spearman ρ ' + cv.spearman_held_out.toFixed(2) + ' held out. The tier holdouts are the honest failure: fitting one TVL tier and testing the next gives a negative R² — launch size does not extrapolate across tiers, which is why the board fits the pooled live side and prices the interval per kind. Mean error is a multiple, a multiple: a few launches sit hundreds of times off any TVL-only fit, so the median is the honest headline. The fitted model cuts the baseline median error from ' + pct1(base.median_ape) + ' to ' + pct1(cv.median_ape) + ' on the same folds.' })
        ),
        el('div', null,
          el('h3', { text: '90% ranges, priced per kind' }),
          el('table', { class: 'mini' },
            el('thead', null, el('tr', null,
              el('th', { scope: 'col' }, 'Kind'),
              el('th', { scope: 'col', class: 'num' }, 'n'),
              el('th', { scope: 'col', class: 'num' }, '90% factor'),
              el('th', { scope: 'col', class: 'num' }, 'Cover 90%'),
              el('th', { scope: 'col', class: 'num' }, 'Cover 80%'),
              el('th', { scope: 'col' }, 'Fallback'))),
            el('tbody', null, kindRows)),
          el('p', { class: 'note', text: 'Split-conformal from 10-fold held-out log errors, per group × TVL tier. A kind with fewer than 10 held-out errors falls back to its group’s factor, then the global one (x' + cv.q90_factor.toFixed(1) + '). Coverage is nested: each fold’s factors come from the other nine folds. The high mid-tier factor is x' + hm.toFixed(0) + ' because that kind holds the 400x launch. The board states the range instead of hiding it.' })
        ),
        el('div', null,
          el('h3', { text: 'Launch odds: who already trades a token' }),
          el('table', { class: 'mini' },
            el('thead', null, el('tr', null,
              el('th', { scope: 'col' }, 'Age, no token'),
              el('th', { scope: 'col' }, 'TVL'),
              el('th', { scope: 'col', class: 'num' }, 'Odds'),
              el('th', { scope: 'col', class: 'num' }, 'Count'))),
            el('tbody', null, oddsRows)),
          el('p', { class: 'note', text: 'Laplace-smoothed (token + 1)/(n + 2). Token means a positive market cap on record. The odds do NOT fall with age here: the $50–500M tier dips at 1–2 years (9.2% after 11.8% under a year) and the top tier dips past two years — the counts are shown and no decline is forced. Verdict: net EV = odds × implied × 5% (assumed airdrop pool) × 0.1% (assumed share of the pool one farmer captures), over farm cost; STRONG FARM at 3x or more, FARM at 1x, SPECULATIVE at 0.3x, PASS below.' })
        ),
        el('div', null,
          el('h3', { text: 'Category intercepts, shrunk' }),
          el('ul', { class: 'cats' }, topCats.map(function (c) {
            return el('li', null, el('b', { text: (c.v >= 0 ? '+' : '') + c.v.toFixed(2) + ' dex' }), ' ' + c.cat + ' (n=' + c.n + ')');
          }).concat(bottomCats.map(function (c) {
            return el('li', { class: 'low' }, el('b', { text: (c.v >= 0 ? '+' : '') + c.v.toFixed(2) + ' dex' }), ' ' + c.cat + ' (n=' + c.n + ')');
          }))),
          el('p', { class: 'note', text: 'Mean log-residual per category, shrunk by n/(n+5), clipped ±1 dex. Residual terms clipped ±0.05 dex each. All ' + DATA.protocols_seen + ' protocols are accounted for: ' + DATA.accounting.pre_token_scored + ' scored, ' + DATA.accounting.live_token_fitted + ' live fitted, ' + DATA.accounting.listed_no_mcap + ' listed with no market cap, ' + DATA.accounting.pre_token_screened_out + ' pre-token screened out (' + DATA.accounting.screened_by_category + ' by category, ' + DATA.accounting.screened_by_version + ' versioned, ' + DATA.accounting.screened_by_product_word + ' wrapped or staked), ' + DATA.accounting.mcap_zero_or_negative + ' with a zero or negative market cap.' })
        )
      )
    );
  }

  function clearFilters() {
    state.q = ''; state.scope = 'all'; state.cat = 'all'; state.chain = 'all'; state.verdict = 'all';
    writeHash(); render();
  }

  // ------------------------------------------------------------------ detail

  function openDetail(slug) {
    state.sel = slug;
    writeHash();
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function closeDetail() {
    state.sel = null;
    writeHash();
    render();
  }

  function detail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    if (!row) return boardView();

    var gap = recomputeGap(row);
    var agrees = gap.pct < 0.1;
    var growth = row.change_7d;
    var slope = row.group === 'high' ? FIT.slope_high : FIT.slope_low;
    // The 90% range is per kind now, so the band is drawn on a log scale:
    // the pin sits where the fitted value sits between the range's ends in log space.
    var loLog = Math.log10(Math.max(1, row.implied_low_usd));
    var hiLog = Math.log10(Math.max(2, row.implied_high_usd));
    var midLog = Math.log10(Math.max(1, row.implied_value_usd));
    var span = Math.max(0.01, hiLog - loLog);
    var midPct = ((midLog - loLog) / span) * 100;
    var adjSum = row.adj_growth + row.adj_age + row.adj_chains;

    var terms = el('div', { class: 'equation' },
      el('div', { class: 'term' }, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
      el('div', { class: 'term' }, el('span', { text: 'Slope x log TVL (' + row.group + ' group)' }), el('b', { text: slope.toFixed(2) + ' x ' + Math.log10(row.tvl_usd).toFixed(2) })),
      el('div', { class: 'term' }, el('span', { text: 'Category intercept' }), el('b', { text: (row.cat_intercept >= 0 ? '+' : '') + row.cat_intercept.toFixed(2) + ' dex' })),
      el('div', { class: 'term' }, el('span', { text: 'Growth / age / chains' }), el('b', { text: (adjSum >= 0 ? '+' : '') + adjSum.toFixed(2) + ' dex' })),
      el('div', { class: 'term' }, el('span', { text: 'Launch odds' }), el('b', { text: row.odds_pct.toFixed(1) + '%' })),
      el('div', { class: 'term result' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
    );

    var drivers = el('ul', { class: 'drivers' },
      el('li', null, el('b', { text: fmtUsd(row.tvl_usd) + ' of TVL' }), ' is the base: market cap grows with TVL to the power ' + slope.toFixed(2) + ' in its ' + row.group + '-multiple group.'),
      el('li', null, el('b', { text: (row.cat_intercept >= 0 ? '+' : '') + row.cat_intercept.toFixed(2) + ' dex' }), ' is the category add-on, measured from ' + (FIT.cat_n[row.category || '(none)'] || 0) + ' live-token protocols of that category.'),
      el('li', null, el('b', { text: growth === null ? 'No seven-day change' : fmtPct(growth) + ' in seven days' }),
        growth === null ? ' on record, so the growth term is flat.' : ', worth ' + (row.adj_growth >= 0 ? '+' : '') + row.adj_growth.toFixed(2) + ' dex after the clip.'),
      el('li', null, el('b', { text: fmtDays(row.age_days) + ' with no token' }),
        row.age_days === null ? ' — no listing day on record, so the model assumes one year.' : ', worth ' + (row.adj_age >= 0 ? '+' : '') + row.adj_age.toFixed(2) + ' dex after the clip.'),
      el('li', null, el('b', { text: row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') }), ' — worth ' + (row.adj_chains >= 0 ? '+' : '') + row.adj_chains.toFixed(2) + ' dex after the clip.'),
      el('li', null, el('b', { text: row.odds_pct.toFixed(1) + '% launch odds' }), ' — ' + row.odds_token + ' of ' + row.odds_n + ' protocols its age and size already trade a token; expected value ' + fmtUsd(row.expected_value_usd) + '.'),
      el('li', null, el('b', { text: 'Verdict: ' + row.verdict }), ' — net EV $' + num(row.net_ev_usd) + ' on a $' + num(row.farm_total_cost_usd) + ' farm, ' + row.farm_return.toFixed(1) + 'x. Net EV is odds × implied × 5% × 0.1% (assumed pool and farmer shares).')
    );

    // Compact rendering only: each step is one paragraph — action, then its cost
    // and time inline — so all seven steps fit in a 900px viewport. The text is
    // the board's farm_steps verbatim, split by stepParts; nothing is dropped.
    var steps = el('ol', { class: 'steps' }, row.farm_steps.map(function (text) {
      var p = stepParts(text);
      return el('li', null,
        el('span', { class: 'n', 'aria-hidden': 'true' }),
        el('div', null,
          el('p', null, p.action, ' ',
            el('span', { class: 'cost-inline', text: 'Cost: ' + p.cost + '. Time: ' + p.time + '.' })
          )
        )
      );
    }));

    return el('div', { class: 'detail' },
      el('div', { class: 'detail-head' },
        el('button', { class: 'button back', type: 'button', text: '\u2190 Board', onclick: closeDetail }),
        el('div', null,
          el('div', { class: 'rankline', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · tier ' + row.tier + ' · ' + (row.bucket === 'watchlist' ? 'on the watchlist' : 'found below the floor') }),
          el('h1', { text: row.name }),
          el('div', { class: 'meta', text: (row.category || 'Uncategorised') + ' · ' + row.chains.join(', ') + (row.listed_at ? ' · tracked since ' + row.listed_at : '') })
        )
      ),

      el('div', null,
        el('section', { class: 'card' },
          el('h2', null, 'Implied value ', el('span', { text: 'what a launch would be worth, if the record stayed as it is' })),
          el('p', { class: 'lede', text: 'One fitted function of the snapshot’s own figures. The page recomputes it here and gets ' + fmtUsd(gap.value) + (agrees ? ', within ' + gap.pct.toFixed(2) + '% of the board’s number.' : ' — ' + gap.pct.toFixed(2) + '% away from the board’s number, which should not happen.') }),
          terms,
          el('div', { class: 'band' },
            el('span', { class: 'track' }),
            el('span', { class: 'fill', style: 'left:0%;width:100%' }),
            el('span', { class: 'pin', style: 'left:' + midPct.toFixed(1) + '%' }),
            el('span', { class: 'cap low', text: fmtUsd(row.implied_low_usd) }),
            el('span', { class: 'cap high', text: fmtUsd(row.implied_high_usd) })
          ),
          el('div', { class: 'stats' },
            el('div', { class: 'stat' }, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
            el('div', { class: 'stat' }, el('span', { text: 'Seven days' }), el('b', { class: growthClass(growth), text: fmtPct(growth) })),
            el('div', { class: 'stat' }, el('span', { text: 'No token for' }), el('b', { text: fmtDays(row.age_days) })),
            el('div', { class: 'stat' }, el('span', { text: '90% range, ' + row.kind }), el('b', { text: 'x' + row.kind_factor.toFixed(1) + ' either way' }))
          ),
          el('p', { class: 'aside-note', text: 'The range is the 90% split-conformal range for this protocol’s kind (' + row.kind + '), from 10-fold held-out errors: implied divided and multiplied by ' + row.kind_factor.toFixed(1) + '. It is wide because launches vary that much. The bar is log scale, so the pin sits where the fitted value sits between the range’s ends.' })
        ),

        el('section', { class: 'card' },
          el('h2', { text: 'Why it sits here' }),
          drivers
        )
      ),

      el('div', null,
        el('section', { class: 'card' },
          el('h2', null, 'Farm plan ', el('span', { text: row.farm_steps.length + ' steps · $' + num(row.farm_total_cost_usd) + ' all in · ' + row.farm_days + ' days' })),
          el('p', { class: 'lede', text: 'From the protocol’s own record: its mechanism picks the action, its TVL and mechanism size the capital ($' + num(row.farm_capital_usd) + '), its main chain sets the gas ($' + num(row.farm_gas_usd) + ' across the plan), its age sets the hold. Every step carries its cost and time.' }),
          steps,
          el('p', { class: 'aside-note', text: 'No airdrop is promised here and none is certain. This is the work that puts a wallet in a protocol’s own record before it launches. Gas figures are planning figures per chain, not snapshot data.' })
        )
      )
    );
  }

  // ------------------------------------------------------------------ render

  function boardView() {
    if (state.scope === 'live') return frag([hero(), integrityStrip(), controls(), livePanel(), validationPanel()]);
    return frag([hero(), integrityStrip(), controls(), boardPanel(), validationPanel()]);
  }

  function render() {
    document.getElementById('snapshot-label').textContent = 'snapshot ' + DATA.as_of;
    document.getElementById('model-label').textContent = DATA.model_version;

    app.textContent = '';
    if (state.sel) app.appendChild(detail(state.sel));
    else app.appendChild(boardView());
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  render();

  window.addEventListener('hashchange', function () {
    readHash();
    render();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.sel) closeDetail();
  });
})();
