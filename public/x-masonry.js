// FontChanger — X (Twitter) clone-based masonry reader.
// Plain classic content script (isolated world, no ES-module loader) so it runs
// despite X's strict CSP. Harvests X's rendered tweets into our own masonry grid
// (kept permanently) and drives X's virtualized timeline in the background to
// load more as you scroll our grid.
//
// LAYOUT: the left nav (header[role="banner"]) stays visible; the masonry overlay
// starts after it (offset = nav width, measured at runtime) so the grid is
// full-width MINUS the left sidebar. Only mounts on /home; on any other route
// (single post, profile) it unmounts and X's native centered layout shows.
//
// PERF: masonry uses explicit flex columns (append each card to the shortest
// column) — NOT CSS column-count, which reflows every card on each insert
// (measured ~9x slower and O(n) per insert). Harvest is debounced; clones are
// stripped of data-testid so they are never re-scanned; the bootstrap loader is
// capped so it can't spin forever when the feed has nothing new.
(function () {
  'use strict';
  var ID = 'fc-masonry';
  var GAP = 10;
  var MEDIA_GRACE = 2000; // ms to wait for a cell's media/cards to load before harvesting anyway

  function isHome() {
    var h = location.hostname.replace(/^www\./, '');
    if (h !== 'x.com' && !/twitter\.com$/.test(h)) return false;
    return location.pathname === '/home' || location.pathname === '/';
  }
  // Left-nav width so the overlay sits to the right of it (keeps the sidebar).
  function navWidth() {
    var hdr = document.querySelector('header[role="banner"]');
    if (!hdr) return 0;
    var w = Math.round(hdr.getBoundingClientRect().width);
    return w > 0 && w < 400 ? w : 0; // guard against a full-width/mis-measured header
  }
  function colCount() {
    var w = window.innerWidth - navWidth();
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
  // A cell is ready when every <img> has decoded AND every known media wrapper
  // (photo / link card) has actually received its <img> — otherwise we'd clone
  // an empty bordered box that never fills in.
  function mediaReady(cell) {
    var imgs = cell.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      if (!imgs[i].complete || imgs[i].naturalWidth === 0) return false;
    }
    var wraps = cell.querySelectorAll('[data-testid="tweetPhoto"], [data-testid="card.wrapper"]');
    for (var j = 0; j < wraps.length; j++) {
      if (!wraps[j].querySelector('img')) return false;
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

  // Keep the overlay pinned to the right of the (variable-width) left nav.
  function positionOverlay() {
    if (!overlay) return;
    overlay.style.left = navWidth() + 'px';
  }
  function layout() {
    if (!grid) return;
    positionOverlay();
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
      if (!mediaReady(cell) && now - firstSeen[k] < MEDIA_GRACE) continue; // let media/cards load
      seen.add(k);
      var statusLink = art.querySelector('a[href*="/status/"]');
      var statusHref = statusLink ? statusLink.href : '';
      var clone = cell.cloneNode(true);
      clone.removeAttribute('data-testid');
      clone.removeAttribute('style');
      clone.className = 'fc-card';
      // Clone lands in the visible overlay: force any lazy imgs to load now.
      var cimgs = clone.querySelectorAll('img');
      for (var c = 0; c < cimgs.length; c++) {
        cimgs[c].loading = 'eager';
        cimgs[c].setAttribute('decoding', 'sync');
        cimgs[c].removeAttribute('fetchpriority');
      }
      // The clone's React handlers are dead, so X's "Show more" link does nothing.
      // Turn it into a real anchor that opens the full post in a new tab.
      var showMore = clone.querySelector('[data-testid="tweet-text-show-more-link"]');
      if (showMore && statusHref) {
        var a = document.createElement('a');
        a.href = statusHref;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = showMore.textContent || 'Show more';
        a.style.cssText = 'color:#1d9bf0;text-decoration:none;';
        showMore.replaceWith(a);
      }
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
    document.documentElement.classList.add('fc-home'); // enables home-only CSS (hide right sidebar)
    overlay = document.createElement('div');
    overlay.id = ID;
    overlay.style.cssText = 'position:fixed;top:0;left:' + navWidth() + 'px;right:0;bottom:0;overflow-y:auto;' +
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
    document.documentElement.classList.remove('fc-home');
    if (mo) { mo.disconnect(); mo = null; }
    if (overlay) { overlay.remove(); overlay = null; grid = null; }
    seen = new Set(); firstSeen = Object.create(null);
    cards = []; columnEls = []; curCols = 0; lastCount = 0; noProgress = 0;
  }

  // ---- Typography ----------------------------------------------------------
  // X's CSP blocks the crxjs module content script (src/content/main.ts), so the
  // popup's font settings never reach X through it. This classic content script
  // is CSP-exempt (isolated world) and can read chrome.storage directly, so it
  // owns typography on X: it injects a settings-driven <style> and re-applies on
  // every change. Size/weight/line-height/letter-spacing are scoped to tweet text
  // (applying them to every element would break X's icon sizing / layout);
  // font-family is applied broadly.
  var TYPO_DEFAULTS = {
    fontFamily: 'Lexend Deca', fontSize: 16, fontWeight: 400,
    lineHeight: 1.5, letterSpacing: 0,
    features: { typography: true },
  };

  function loadFontLink(family) {
    var id = 'fc-x-font';
    var href = 'https://fonts.googleapis.com/css2?family=' +
      encodeURIComponent(family).replace(/%20/g, '+') + ':wght@100;200;300;400;500;600;700;800;900&display=swap';
    var link = document.getElementById(id);
    if (!link) {
      link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      (document.head || document.documentElement).appendChild(link);
    }
    if (link.href !== href) link.href = href; // may be CSP-blocked on X → silently falls back to the system font
  }

  function applyTypography(s) {
    var on = !s.features || s.features.typography !== false;
    var style = document.getElementById('fc-x-type');
    if (!style) {
      style = document.createElement('style');
      style.id = 'fc-x-type';
      (document.head || document.documentElement).appendChild(style);
    }
    if (!on) { style.textContent = ''; return; }
    loadFontLink(s.fontFamily);
    var fam = "'" + s.fontFamily + "', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    // Text targets: native tweet text AND our cloned cards (clones keep inner data-testid).
    var textSel = '[data-testid="tweetText"], [data-testid="tweetText"] *, ' +
      '#fc-grid .fc-card [data-testid="tweetText"], #fc-grid .fc-card [data-testid="tweetText"] *';
    style.textContent =
      'body, body * { font-family: ' + fam + ' !important; }\n' +
      textSel + ' {\n' +
      '  font-size: ' + s.fontSize + 'px !important;\n' +
      '  font-weight: ' + s.fontWeight + ' !important;\n' +
      '  line-height: ' + s.lineHeight + ' !important;\n' +
      '  letter-spacing: ' + s.letterSpacing + 'px !important;\n' +
      '}';
  }

  function refreshTypography() {
    try {
      chrome.storage.local.get(TYPO_DEFAULTS, function (res) {
        if (chrome.runtime && chrome.runtime.lastError) { applyTypography(TYPO_DEFAULTS); return; }
        applyTypography(res || TYPO_DEFAULTS);
      });
    } catch (e) { applyTypography(TYPO_DEFAULTS); }
  }

  try {
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local') refreshTypography();
      });
    }
  } catch (e) { /* no storage access */ }
  refreshTypography();

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
