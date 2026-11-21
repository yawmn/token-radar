// Token Radar's page. It reads window.RADAR, which main.ts writes beside dashboard/ as data.js, and
// renders three things from it: the board (every pre-token launch candidate, ranked by implied
// value), a detail view for each protocol, and the filter and sort that cut the board down.
//
// Everything shown is in data.js: no fetch, no import, no network. The page also recomputes each
// row's implied value from the snapshot's own figures with the same arithmetic the program used, and
// says on the detail view whether its number is the one board.json carries.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');

  var state = { q: '', scope: 'all', cat: 'all', chain: 'all', sort: 'implied', dir: -1, sel: null };

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

  // ------------------------------------------------------------------ the model, in the page

  // The same arithmetic lib/model.ts runs, so the page can show its own work: the multiple is the
  // one measured for the protocol's category, momentum is the seven-day change, patience is the age,
  // reach is the chain count.
  function impliedOf(row) {
    var m = DATA.model;
    var growth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    growth = Math.min(m.momentum_cap, Math.max(m.momentum_floor, growth));
    var momentum = 1 + (growth / 100) * m.momentum_weight;
    var age = row.age_days === null || row.age_days === undefined ? Math.round(m.patience_days / 4) : row.age_days;
    var patience = m.patience_floor + (Math.min(Math.max(age, 0), m.patience_days) / m.patience_days) * m.patience_range;
    var chains = Math.min(row.chains.length, m.reach_chains);
    var reach = 1 + (chains / m.reach_chains) * m.reach_weight;
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * momentum * patience * reach));
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
      else if (key === 'multiple') { av = a.multiple; bv = b.multiple; }
      else if (key === 'capital') { av = a.farm_capital_usd; bv = b.farm_capital_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ------------------------------------------------------------------ board

  function hero() {
    var oldest = DATA.rows.reduce(function (n, r) { return r.age_days !== null && r.age_days > n ? r.age_days : n; }, 0);
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', null,
          'Every protocol ', el('em', { text: 'still waiting on a token' }), ', ranked by what that token would be worth.'
        ),
        el('p', null,
          el('strong', { text: DATA.board_size + ' launch candidates' }), ' out of the ' + DATA.protocols_seen + ' protocols in the snapshot. ',
          'The watchlist is the floor, not the list: ' + DATA.watchlist_size + ' protocols at or above $' + Math.round(DATA.floor_usd / 1e6) + 'M with no token on record, plus ',
          DATA.early_size + ' below that floor the radar found early. The ' + DATA.live_size + ' protocols whose token already trades are the yardstick, not the board.'
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
      el('div', { class: 'spacer' }),
      el('div', { class: 'readout' },
        liveTab
          ? el('div', null, el('b', { text: num(DATA.live.length) }), ' live-token protocols')
          : el('div', null, el('b', { text: num(list.length) }), ' of ' + num(DATA.rows.length) + ' protocols'),
        liveTab
          ? el('div', null, 'the yardstick the multiples are read from')
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
    var stepWord = r.farm_steps.length + ' steps';
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
      el('td', { class: 'num', text: r.multiple.toFixed(2) + 'x' }),
      el('td', { class: 'num', text: '$' + r.farm_capital_usd }),
      el('td', null, el('div', { class: 'implied' },
        el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(4, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
        el('b', { text: fmtUsd(r.implied_value_usd) })
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
        el('p', { text: 'Clear the filters to see all ' + DATA.rows.length + ' launch candidates.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: clearFilters })
      ));
    }
    var max = list.reduce(function (n, r) { return Math.max(n, r.implied_value_usd); }, 1);
    var body = el('tbody');
    list.forEach(function (r) { body.appendChild(rowLine(r, max)); });

    return el('div', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', { text: 'The board' }),
        el('p', { text: 'Implied value is the value this model puts on a launch, not a price. Pick a row for its arithmetic and its farm plan.' })
      ),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            sortHead('implied', 'Rank'),
            sortHead('name', 'Protocol'),
            sortHead('tvl', 'TVL', 'col-tvl'),
            sortHead('growth', '7d', 'num'),
            sortHead('age', 'No token for', 'num'),
            sortHead('multiple', 'Multiple', 'num'),
            sortHead('capital', 'Farm with', 'num'),
            sortHead('implied', 'Implied value', 'num'),
            el('th', { scope: 'col' }, el('span', { class: 'sr', text: 'Source' }))
          )),
          body
        )
      ),
      el('p', { class: 'note', text: 'Ranked by implied value. Sort any column; filter by scope, category or chain; a row opens the protocol.' })
    );
  }

  // The live side: the protocols whose token already trades. They are not ranked here, because
  // their value is a fact the market has already set, and it is the number the model borrows.
  function livePanel() {
    var body = el('tbody');
    DATA.live.forEach(function (r) {
      body.appendChild(el('tr', null,
        el('td', { class: 'num' }, el('span', { class: 'rank', text: 'live' })),
        el('td', null, el('div', { class: 'who' },
          el('b', { text: r.name }),
          el('span', { text: (r.category || 'Uncategorised') + ' · ' + r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') })
        )),
        el('td', { class: 'num col-tvl', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass(r.change_7d), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.multiple === null ? 'n/a' : r.multiple.toFixed(2) + 'x' }),
        el('td', null, el('span', { class: 'tag watch', text: 'trades today' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', { text: 'The yardstick: protocols whose token already trades' }),
        el('p', { text: 'Their market cap is a fact, not a model. Market cap over TVL here is the multiple a launch candidate of the same category is scored at.' })
      ),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col' }, 'Status'),
            el('th', { scope: 'col' }, 'Protocol'),
            el('th', { scope: 'col', class: 'num' }, 'TVL'),
            el('th', { scope: 'col', class: 'num' }, '7d'),
            el('th', { scope: 'col', class: 'num' }, 'Market cap'),
            el('th', { scope: 'col', class: 'num' }, 'Multiple'),
            el('th', { scope: 'col' }, el('span', { class: 'sr', text: 'Token' }))
          )),
          body
        )
      ),
      el('p', { class: 'note', text: 'The ' + DATA.live.length + ' largest by market cap, out of the ' + DATA.multiples.field.n + ' live-token protocols the multiples are measured from. The ratios are as the market set them; the model clamps a single multiple at ' + DATA.model.multiple_floor + 'x to ' + DATA.model.multiple_cap + 'x so one outlier cannot set a category\'s number.' })
    );
  }

  function multiplesPanel() {
    var field = DATA.multiples.field;
    var measured = DATA.multiples.by_category.slice().sort(function (a, b) { return b.p50 - a.p50 || a.category.localeCompare(b.category); });
    var shown = measured.slice(0, 11);
    return el('section', { class: 'panel multiples' },
      el('div', { class: 'panel-head' },
        el('h2', { text: 'The multiples the model runs on' }),
        el('p', { text: measured.length + ' categories read from ' + field.n + ' live-token protocols: market cap over TVL, median with its 25th and 75th percentile.' })
      ),
      el('div', { class: 'mult-grid' }, shown.map(function (m) {
        return el('div', { class: 'mult' + (m.from_field ? ' none' : '') },
          el('b', { text: m.p50.toFixed(2) + 'x' }),
          el('span', { text: m.category }),
          el('em', { text: m.from_field ? 'n=' + m.n + ', field median' : 'n=' + m.n + ' · ' + m.p25.toFixed(2) + '–' + m.p75.toFixed(2) })
        );
      })),
      el('p', { class: 'note', text: 'The five furthest categories by multiple. Everything else is on its row: the board shows the multiple each protocol is scored at.' })
    );
  }

  function clearFilters() {
    state.q = ''; state.scope = 'all'; state.cat = 'all'; state.chain = 'all';
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

    var recomputed = impliedOf(row);
    var agrees = recomputed === row.implied_value_usd;
    var growth = row.change_7d;
    var band = Math.max(row.implied_high_usd, 1);
    var lowPct = Math.max(0, (row.implied_low_usd / band) * 100);
    var midPct = Math.max(0, (row.implied_value_usd / band) * 100);

    var terms = el('div', { class: 'equation' },
      el('div', { class: 'term' }, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
      el('div', { class: 'term' }, el('span', { text: 'Category multiple' }), el('b', { text: row.multiple.toFixed(2) + 'x' })),
      el('div', { class: 'term' }, el('span', { text: 'Momentum' }), el('b', { text: row.momentum_multiplier.toFixed(2) + 'x' })),
      el('div', { class: 'term' }, el('span', { text: 'Patience' }), el('b', { text: row.patience_multiplier.toFixed(2) + 'x' })),
      el('div', { class: 'term' }, el('span', { text: 'Reach' }), el('b', { text: row.reach_multiplier.toFixed(2) + 'x' })),
      el('div', { class: 'term result' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
    );

    var drivers = el('ul', { class: 'drivers' },
      el('li', null, el('b', { text: fmtUsd(row.tvl_usd) + ' of TVL' }), ' is the base: every dollar the protocol holds is a dollar a token would have to justify.'),
      el('li', null, el('b', { text: row.multiple.toFixed(2) + 'x' }), ' is what ' + (row.category || 'comparable') + ' protocols whose token already trades are valued at, measured from this same snapshot.'),
      el('li', null, el('b', { text: growth === null ? 'No seven-day change' : fmtPct(growth) + ' in seven days' }),
        growth === null ? ' on record, so momentum is taken as flat.' : ', which moves the multiple by ' + row.momentum_multiplier.toFixed(2) + 'x.'),
      el('li', null, el('b', { text: fmtDays(row.age_days) + ' with no token' }),
        row.age_days === null ? ' — no listing day on record, so the model assumes one year.' : ', the record of how far along the launch is: a longer run is worth ' + row.patience_multiplier.toFixed(2) + 'x.'),
      el('li', null, el('b', { text: row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') }), ' — ' + row.chains.slice(0, 4).join(', ') + (row.chains.length > 4 ? ' and more' : '') + ', worth ' + row.reach_multiplier.toFixed(2) + 'x for reach.')
    );

    var steps = el('ol', { class: 'steps' }, row.farm_steps.map(function (text) {
      var p = stepParts(text);
      return el('li', null,
        el('span', { class: 'n', 'aria-hidden': 'true' }),
        el('div', null,
          el('p', { text: p.action }),
          el('div', { class: 'cost' },
            el('span', { 'data-k': 'cost', text: p.cost }),
            el('span', { 'data-k': 'time', text: p.time })
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
          el('p', { class: 'lede', text: 'One function of the snapshot\'s own figures. The page recomputes it here and gets ' + fmtUsd(recomputed) + (agrees ? ', the number board.json carries.' : ', which does not match the board.') }),
          terms,
          el('div', { class: 'band' },
            el('span', { class: 'track' }),
            el('span', { class: 'fill', style: 'left:' + lowPct.toFixed(1) + '%;width:' + Math.max(2, midPct - lowPct).toFixed(1) + '%' }),
            el('span', { class: 'pin', style: 'left:' + midPct.toFixed(1) + '%' }),
            el('span', { class: 'cap low', text: fmtUsd(row.implied_low_usd) }),
            el('span', { class: 'cap high', text: fmtUsd(row.implied_high_usd) })
          ),
          el('div', { class: 'stats' },
            el('div', { class: 'stat' }, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
            el('div', { class: 'stat' }, el('span', { text: 'Seven days' }), el('b', { class: growthClass(growth), text: fmtPct(growth) })),
            el('div', { class: 'stat' }, el('span', { text: 'No token for' }), el('b', { text: fmtDays(row.age_days) })),
            el('div', { class: 'stat' }, el('span', { text: 'Band' }), el('b', { text: fmtUsd(row.implied_low_usd) + '–' + fmtUsd(row.implied_high_usd) }))
          ),
          el('p', { class: 'aside-note', text: 'The band is the category\'s own 25th to 75th percentile multiple, so it shows how differently the market values protocols of this kind. It is not a range of promises.' })
        ),

        el('section', { class: 'card' },
          el('h2', { text: 'Why it sits here' }),
          drivers
        )
      ),

      el('div', null,
        el('section', { class: 'card' },
          el('h2', null, 'Farm plan ', el('span', { text: row.farm_steps.length + ' steps · $' + row.farm_capital_usd + ' and about ' + row.farm_days + ' days' })),
          el('p', { class: 'lede', text: 'Derived from the protocol\'s own record: its category picks the action, its TVL sizes the position, its age sets the hold. Every step carries what it costs and how long it takes.' }),
          steps,
          el('p', { class: 'aside-note', text: 'No airdrop is promised here and none is certain. This is the work that puts a wallet in a protocol\'s own record before it launches, which is the only thing a plan can do.' })
        )
      )
    );
  }

  // ------------------------------------------------------------------ render

  function boardView() {
    if (state.scope === 'live') return frag([hero(), controls(), livePanel(), multiplesPanel()]);
    return frag([hero(), controls(), boardPanel(), multiplesPanel()]);
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
