// Site-wide instant product search. One implementation powering the homepage
// hero input, the header search overlay on every other page, and the ?q=
// filter handoff to listing pages.
//
// Index: /search-index.json (emitted by scripts/generate-product-pages.js —
// regenerate after catalog changes). Fetched once on first focus of any
// search input, cached in memory for the session.
//
// Matching: tokenize on whitespace; every token must appear in the product's
// normalized searchable string (AND). Normalization strips punctuation and
// lowercases both sides, so "g.skill", "g skill" and "gskill" all match.
// Ranking: exact brand match > name-start match > earlier token positions >
// shorter names. Display cap: 8.
window.memradarSearch = (function () {
  var VER = document.currentScript && /v=(\d+)/.exec(document.currentScript.src);
  var INDEX_URL = '/search-index.json' + (VER ? '?v=' + VER[1] : '');
  var MAX_RESULTS = 8;
  var DEBOUNCE_MS = 120;
  var GA_PAUSE_MS = 1000;

  var index = null;
  var indexLoading = false;
  var indexWaiters = [];
  var lastGaQuery = null;

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '');
  }
  function tokenize(q) {
    return normalize(q).split(/\s+/).filter(Boolean);
  }
  // Public text matcher (used by product-listing.js for ?q= filtering).
  function textMatches(query, haystack) {
    var tokens = tokenize(query);
    if (!tokens.length) return false;
    var h = normalize(haystack).replace(/\s+/g, '');
    var hSpaced = normalize(haystack);
    return tokens.every(function (t) { return hSpaced.indexOf(t) >= 0 || h.indexOf(t) >= 0; });
  }

  function loadIndex(cb) {
    if (index) { cb(index); return; }
    indexWaiters.push(cb);
    if (indexLoading) return;
    indexLoading = true;
    fetch(INDEX_URL)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        data.forEach(function (p) {
          p._n = normalize(p.search);          // normalized, spaced
          p._nc = p._n.replace(/\s+/g, '');    // compact — catches "gskill"
          p._brand = normalize(p.brand || '');
          p._name = normalize(p.name);
        });
        index = data;
        indexWaiters.forEach(function (w) { w(index); });
        indexWaiters = [];
      })
      .catch(function (err) {
        console.error('Search index failed to load:', err.message);
        indexLoading = false; // allow retry on next focus
        indexWaiters = [];
      });
  }

  function findMatches(query) {
    var tokens = tokenize(query);
    if (!tokens.length || !index) return [];
    var out = [];
    for (var i = 0; i < index.length; i++) {
      var p = index[i];
      var ok = true;
      var posSum = 0;
      for (var t = 0; t < tokens.length; t++) {
        var idx = p._n.indexOf(tokens[t]);
        if (idx < 0) idx = p._nc.indexOf(tokens[t]);
        if (idx < 0) { ok = false; break; }
        posSum += idx;
      }
      if (!ok) continue;
      var score = 0;
      for (var b = 0; b < tokens.length; b++) {
        if (p._brand && tokens[b] === p._brand) { score += 1000; break; }
      }
      if (p._name.indexOf(tokens.join(' ')) === 0) score += 500;
      else if (p._name.indexOf(tokens[0]) === 0) score += 300;
      score -= posSum;
      out.push({ p: p, score: score });
    }
    out.sort(function (a, b) {
      return b.score - a.score || a.p.name.length - b.p.name.length;
    });
    return out.map(function (r) { return r.p; });
  }

  function majorityCategoryUrl(results, query) {
    var ram = 0, ssd = 0;
    results.forEach(function (p) { p.category === 'ram' ? ram++ : ssd++; });
    var cat = ssd > ram ? 'ssd' : 'ram';
    return '/' + cat + '/?q=' + encodeURIComponent(query);
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtPrice(v) {
    return v == null ? '' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  // Bold each query token's first occurrence in the raw name (case-insensitive,
  // punctuation-stripped token). Tokens that only match via normalization
  // simply aren't bolded — display stays correct.
  function highlightName(name, query) {
    var ranges = [];
    tokenize(query).forEach(function (tok) {
      var i = name.toLowerCase().indexOf(tok);
      if (i >= 0) ranges.push([i, i + tok.length]);
    });
    if (!ranges.length) return escHtml(name);
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [ranges[0]];
    for (var i = 1; i < ranges.length; i++) {
      var last = merged[merged.length - 1];
      if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]);
      else merged.push(ranges[i]);
    }
    var html = '', pos = 0;
    merged.forEach(function (r) {
      html += escHtml(name.slice(pos, r[0])) + '<strong>' + escHtml(name.slice(r[0], r[1])) + '</strong>';
      pos = r[1];
    });
    return html + escHtml(name.slice(pos));
  }

  function fireGa(query, count) {
    if (typeof gtag !== 'function') return;
    var key = query + '|' + count;
    if (key === lastGaQuery) return;
    lastGaQuery = key;
    gtag('event', 'search', { search_term: query, result_count: count });
  }

  var uid = 0;

  // Wire an input into a full typeahead. The dropdown is created inside
  // `container` (must be position:relative) directly after the input.
  function attach(input, opts) {
    opts = opts || {};
    var container = opts.container || input.parentElement;
    var id = 'searchListbox' + (++uid);

    var dropdown = document.createElement('div');
    dropdown.className = 'search-dropdown';
    dropdown.id = id;
    dropdown.setAttribute('role', 'listbox');
    dropdown.hidden = true;
    container.appendChild(dropdown);

    var live = document.createElement('div');
    live.className = 'visually-hidden';
    live.setAttribute('aria-live', 'polite');
    container.appendChild(live);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', id);
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('autocomplete', 'off');

    var state = { results: [], highlighted: -1, open: false, query: '' };
    var debounceTimer = null;
    var gaTimer = null;

    function setOpen(open) {
      state.open = open;
      dropdown.hidden = !open;
      input.setAttribute('aria-expanded', String(open));
      if (!open) { state.highlighted = -1; }
    }

    function rowsHtml() {
      var q = state.query;
      var html = state.results.slice(0, MAX_RESULTS).map(function (p, i) {
        var thumb = p.image_url
          ? '<img src="' + escHtml(p.image_url) + '" alt="" loading="lazy" class="search-row-thumb-img" onerror="this.style.display=\'none\'">'
          : '';
        return '<a href="/' + p.category + '/' + escHtml(p.slug) + '/" class="search-row" role="option" id="' + id + '-opt' + i + '" aria-selected="' + (i === state.highlighted) + '" data-i="' + i + '">' +
          '<span class="search-row-thumb">' + thumb + '</span>' +
          '<span class="search-row-main">' +
            '<span class="search-row-name">' + highlightName(p.name, q) + '</span>' +
            '<span class="search-row-meta">' + escHtml([p.brand, p.category === 'ram' ? 'RAM' : 'SSD'].filter(Boolean).join(' · ')) + '</span>' +
          '</span>' +
          '<span class="search-row-price">' + fmtPrice(p.current_price) + '</span>' +
        '</a>';
      }).join('');
      if (state.results.length > MAX_RESULTS) {
        html += '<a href="' + majorityCategoryUrl(state.results, q) + '" class="search-row search-row--all" role="option" id="' + id + '-opt' + MAX_RESULTS + '" aria-selected="' + (state.highlighted === MAX_RESULTS) + '" data-i="' + MAX_RESULTS + '">' +
          'View all ' + state.results.length + ' results for &ldquo;' + escHtml(q) + '&rdquo; →</a>';
      }
      return html;
    }

    function render() {
      var q = state.query;
      if (!q) { setOpen(false); return; }
      if (!index) {
        dropdown.innerHTML = '<div class="search-row search-row--note">Loading products…</div>';
        setOpen(true);
        return;
      }
      state.results = findMatches(q);
      if (state.results.length === 0) {
        dropdown.innerHTML = '<div class="search-row search-row--note">No products match &ldquo;' + escHtml(q) + '&rdquo;' +
          '<span class="search-row-sub">Try browsing <a href="/ram/">RAM</a> or <a href="/ssd/">SSDs</a></span></div>';
        live.textContent = 'No results';
      } else {
        dropdown.innerHTML = rowsHtml();
        live.textContent = state.results.length + ' result' + (state.results.length === 1 ? '' : 's');
        dropdown.querySelectorAll('.search-row[data-i]').forEach(function (row) {
          row.addEventListener('mouseenter', function () { setHighlight(+row.dataset.i); });
        });
      }
      setOpen(true);
      clearTimeout(gaTimer);
      gaTimer = setTimeout(function () {
        if (state.query === q) fireGa(q, state.results.length);
      }, GA_PAUSE_MS);
    }

    function visibleCount() {
      return Math.min(state.results.length, MAX_RESULTS) + (state.results.length > MAX_RESULTS ? 1 : 0);
    }

    function setHighlight(i) {
      state.highlighted = i;
      dropdown.querySelectorAll('.search-row[data-i]').forEach(function (row) {
        var on = +row.dataset.i === i;
        row.classList.toggle('active', on);
        row.setAttribute('aria-selected', String(on));
      });
      var el = dropdown.querySelector('.search-row[data-i="' + i + '"]');
      if (el) {
        input.setAttribute('aria-activedescendant', el.id);
        if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function navigateHighlighted() {
      var el = dropdown.querySelector('.search-row[data-i="' + state.highlighted + '"]');
      if (el && el.href) { window.location.href = el.href; return true; }
      return false;
    }

    // Submit behavior (Enter with no highlight / the Search button): top
    // result if the ranking has a clear winner, else listing with the query.
    function submitQuery() {
      var q = input.value.trim();
      if (!q) return;
      var results = index ? findMatches(q) : [];
      if (results.length > 0) {
        window.location.href = '/' + results[0].category + '/' + results[0].slug + '/';
      } else {
        window.location.href = majorityCategoryUrl(results, q) ;
      }
    }

    input.addEventListener('focus', function () {
      loadIndex(function () { if (state.query) render(); });
    });

    input.addEventListener('input', function () {
      state.query = input.value.trim();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        loadIndex(function () { render(); });
        if (!index) render(); // show loading row immediately
      }, DEBOUNCE_MS);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' && state.open) {
        e.preventDefault();
        setHighlight(Math.min(state.highlighted + 1, visibleCount() - 1));
      } else if (e.key === 'ArrowUp' && state.open) {
        e.preventDefault();
        setHighlight(Math.max(state.highlighted - 1, -1));
      } else if (e.key === 'Enter') {
        if (state.open && state.highlighted >= 0) {
          e.preventDefault();
          navigateHighlighted();
        } else if (!opts.formHandlesEnter) {
          e.preventDefault();
          submitQuery();
        }
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    });

    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) setOpen(false);
    });

    return { submitQuery: submitQuery, render: render, input: input };
  }

  // ---- Header search overlay (present on every page except the homepage) ----
  function initHeaderSearch() {
    var toggle = document.getElementById('headerSearchToggle');
    var panel = document.getElementById('headerSearchPanel');
    if (!toggle || !panel) return;
    var input = panel.querySelector('input');
    var api = attach(input, { container: panel });

    function setPanel(open) {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) { loadIndex(function () {}); input.focus(); }
    }
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      setPanel(panel.hidden);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden && document.activeElement !== input) setPanel(false);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && input.value === '') setPanel(false);
    });
    document.addEventListener('click', function (e) {
      if (!panel.hidden && !panel.contains(e.target) && !toggle.contains(e.target)) setPanel(false);
    });
  }
  initHeaderSearch();

  return { attach: attach, textMatches: textMatches, normalize: normalize, loadIndex: loadIndex };
})();
