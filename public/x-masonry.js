// FontChanger — X (Twitter) clone-based masonry reader.
// Plain classic content script (isolated world, no ES-module loader) so it runs
// despite X's strict CSP. Harvests X's rendered tweets into our own masonry grid
// (kept permanently) and drives X's virtualized timeline in the background to
// load more as you scroll our grid.
//
// PERF: masonry uses explicit flex columns (append each card to the shortest
// column) — NOT CSS column-count, which reflows every card on each insert
// (measured ~9x slower and O(n) per insert). Harvest is debounced; clones are
// stripped of data-testid so they are never re-scanned; the bootstrap loader is
// capped so it can't spin forever when the feed has nothing new.
(function () {
  'use strict';
  var ID = 'fc-masonry';
  var NAV_W = 0;   // left nav removed → grid uses the full window
  var GAP = 10;

  function isHome() {
    var h = location.hostname.replace(/^www\./, '');
    if (h !== 'x.com' && !/twitter\.com$/.test(h)) return false;
    return location.pathname === '/home' || location.pathname === '/';
  }
  function colCount() {
    var w = window.innerWidth - NAV_W;
    if (w > 1600) return 4;
    if (w > 1200) return 3;
    if (w > 800) return 2;
    return 1;
  }

  var seen = new Set();
  var firstSeen = Object.create(null);
  var cards = [];           // ordered card elements
  var columnEls = [];       // current column containers
  var curCols = 0;
  var overlay = null, grid = null, mo = null, loading = false, scheduled = false;
  var lastCount = 0, noProgress = 0;

  function keyOf(article) {
    var links = article.querySelectorAll('a[href*="/status/"]');
    for (var i = 0; i < links.length; i++) {
      var m = links[i].getAttribute('href').match(/\/status\/(\d+)/);
      if (m) return m[1];
    }
    return (article.innerText || '').slice(0, 80);
  }
  function mediaReady(cell) {
    var imgs = cell.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      if (!imgs[i].complete || imgs[i].naturalWidth === 0) return false;
    }
    return true;
  }

  function buildColumns(n) {
    grid.textContent = '';
    columnEls = [];
    for (var i = 0; i < n; i++) {
      var col = document.createElement('div');
      col.className = 'fc-col';
      grid.appendChild(col);
      columnEls.push(col);
    }
    curCols = n;
  }
  function shortest() {
    var best = columnEls[0];
    for (var i = 1; i < columnEls.length; i++) {
      if (columnEls[i].offsetHeight < best.offsetHeight) best = columnEls[i];
    }
    return best;
  }
  function place(el) { shortest().appendChild(el); }

  function layout() {
    if (!grid) return;
    var n = colCount();
    if (n !== curCols) {
      buildColumns(n);
      for (var i = 0; i < cards.length; i++) place(cards[i]); // redistribute
    }
  }

  function harvest() {
    if (!grid) return;
    var now = Date.now();
    var cells = document.querySelectorAll('[data-testid="cellInnerDiv"]'); // only X's live cells
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var art = cell.querySelector('article');
      if (!art) continue;
      if (!art.querySelector('time')) continue; // skip promoted/ads (no timestamp)
      var k = keyOf(art);
      if (!k || seen.has(k)) continue;
      if (firstSeen[k] === undefined) firstSeen[k] = now;
      if (!mediaReady(cell) && now - firstSeen[k] < 700) continue; // let media load
      seen.add(k);
      var clone = cell.cloneNode(true);
      clone.removeAttribute('data-testid');
      clone.removeAttribute('style');
      clone.className = 'fc-card';
      cards.push(clone);
      place(clone);
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () { scheduled = false; harvest(); });
  }

  function mount() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = ID;
    overlay.style.cssText = 'position:fixed;top:0;left:' + NAV_W + 'px;right:0;bottom:0;overflow-y:auto;' +
      'overflow-x:hidden;z-index:9999;background:' + (getComputedStyle(document.body).backgroundColor || '#fff') + ';padding:8px;';
    grid = document.createElement('div');
    grid.id = 'fc-grid';
    grid.style.cssText = 'display:flex;gap:' + GAP + 'px;align-items:flex-start;';
    overlay.appendChild(grid);
    document.body.appendChild(overlay);
    buildColumns(colCount());

    overlay.addEventListener('scroll', function () {
      noProgress = 0; // user engaged → allow loading again
      if (loading) return;
      if (overlay.scrollTop + overlay.clientHeight > overlay.scrollHeight - 1500) {
        loading = true;
        window.scrollBy(0, window.innerHeight * 3);
        setTimeout(function () { schedule(); loading = false; }, 600);
      }
    }, { passive: true });

    var container = document.querySelector('[data-testid="cellInnerDiv"]');
    container = container ? container.parentElement : document.body;
    mo = new MutationObserver(schedule);
    mo.observe(container, { childList: true });
    harvest();
  }

  function unmount() {
    if (mo) { mo.disconnect(); mo = null; }
    if (overlay) { overlay.remove(); overlay = null; grid = null; }
    seen = new Set(); firstSeen = Object.create(null);
    cards = []; columnEls = []; curCols = 0; lastCount = 0; noProgress = 0;
  }

  window.addEventListener('resize', layout);
  setInterval(function () {
    if (!isHome()) { unmount(); return; }
    if (!document.querySelector('[data-testid="cellInnerDiv"]')) return;
    mount();
    layout();
    schedule();
    // Bootstrap: fill until the grid is scrollable, but STOP after a few rounds
    // with no new cards so it can't spin forever (the "loop running" bug).
    if (cards.length === lastCount) noProgress++; else { noProgress = 0; lastCount = cards.length; }
    if (!loading && noProgress < 4 && overlay && overlay.scrollHeight <= overlay.clientHeight + 400) {
      loading = true;
      window.scrollBy(0, window.innerHeight * 2);
      setTimeout(function () { schedule(); loading = false; }, 600);
    }
  }, 1200);
})();
