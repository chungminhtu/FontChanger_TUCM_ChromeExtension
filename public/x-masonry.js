// FontChanger — X (Twitter) clone-based masonry reader.
// Plain classic content script (isolated world, no ES-module loader) so it runs
// despite X's strict CSP. Harvests X's rendered tweets into our own masonry grid
// (kept permanently), and drives X's virtualized timeline in the background to
// load more as you scroll our grid.
(function () {
  'use strict';
  var ID = 'fc-masonry';
  var NAV_W = 76; // matches the slim icon nav pinned by x.css

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
  var overlay = null, grid = null, mo = null, loading = false, scheduled = false;

  function keyOf(article) {
    var links = article.querySelectorAll('a[href*="/status/"]');
    for (var i = 0; i < links.length; i++) {
      var m = links[i].getAttribute('href').match(/\/status\/(\d+)/);
      if (m) return m[1];
    }
    return (article.innerText || '').slice(0, 80);
  }

  function mediaReady(cell) {
    // Give lazy-loaded images a moment so clones aren't blank; clone anyway
    // after a short dwell so a never-loading image can't block a tweet.
    var imgs = cell.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      if (!imgs[i].complete || imgs[i].naturalWidth === 0) return false;
    }
    return true;
  }

  function harvest() {
    if (!grid) return;
    var now = Date.now();
    // Only X's live cells carry data-testid=cellInnerDiv; our clones don't
    // (we strip it), so this stays cheap regardless of how many cards exist.
    var cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var art = cell.querySelector('article');
      if (!art) continue;
      if (!art.querySelector('time')) continue; // skip promoted/ads (no timestamp)
      var k = keyOf(art);
      if (!k || seen.has(k)) continue;
      if (firstSeen[k] === undefined) firstSeen[k] = now;
      // wait up to 700ms for media to load, then clone regardless
      if (!mediaReady(cell) && now - firstSeen[k] < 700) continue;
      seen.add(k);
      var clone = cell.cloneNode(true);
      clone.removeAttribute('data-testid');
      clone.removeAttribute('style');
      clone.className = 'fc-card';
      grid.appendChild(clone);
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () { scheduled = false; harvest(); });
  }

  function layout() {
    if (!overlay || !grid) return;
    overlay.style.left = NAV_W + 'px';
    grid.style.columnCount = colCount();
  }

  function mount() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = ID;
    overlay.style.cssText = 'position:fixed;top:0;left:' + NAV_W + 'px;right:0;bottom:0;overflow-y:auto;' +
      'overflow-x:hidden;z-index:9999;background:' + (getComputedStyle(document.body).backgroundColor || '#fff') + ';padding:8px;';
    grid = document.createElement('div');
    grid.id = 'fc-grid';
    overlay.appendChild(grid);
    document.body.appendChild(overlay);
    layout();

    overlay.addEventListener('scroll', function () {
      if (loading) return;
      if (overlay.scrollTop + overlay.clientHeight > overlay.scrollHeight - 1500) {
        loading = true;
        window.scrollBy(0, window.innerHeight * 3);
        setTimeout(function () { schedule(); loading = false; }, 600);
      }
    }, { passive: true });

    // Observe only the timeline's cell container (childList), not the whole body.
    var container = document.querySelector('[data-testid="cellInnerDiv"]');
    container = container ? container.parentElement : document.body;
    mo = new MutationObserver(schedule);
    mo.observe(container, { childList: true });
    harvest();
  }

  function unmount() {
    if (mo) { mo.disconnect(); mo = null; }
    if (overlay) { overlay.remove(); overlay = null; grid = null; }
    seen = new Set();
    firstSeen = Object.create(null);
  }

  window.addEventListener('resize', layout);
  setInterval(function () {
    if (isHome()) {
      if (!document.querySelector('[data-testid="cellInnerDiv"]')) return;
      mount();
      schedule();
      // Bootstrap: if the grid doesn't fill the viewport yet it isn't scrollable,
      // so the user can't trigger load-more — nudge X to keep loading.
      if (overlay && !loading && overlay.scrollHeight <= overlay.clientHeight + 400) {
        loading = true;
        window.scrollBy(0, window.innerHeight * 2);
        setTimeout(function () { schedule(); loading = false; }, 600);
      }
    } else {
      unmount();
    }
  }, 1200);
})();
