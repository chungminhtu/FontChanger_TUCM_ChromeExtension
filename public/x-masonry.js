// FontChanger — X (Twitter) clone-based masonry reader + native thread reader.
// Plain classic content script (isolated world, no ES-module loader) so it runs
// despite X's strict CSP. Harvests X's rendered tweets into our own full-width
// masonry grid (kept permanently) and drives X's virtualized timeline in the
// background to load more as you scroll our grid.
//
// LAYOUT: full width — the left nav AND both sidebars are hidden on /home (CSS,
// gated by html.fc-home). Only mounts on /home.
//
// READER: clicking a card opens the full post + comments WITHOUT a page reload.
// Rather than clone a dead, non-interactive copy, we hide the masonry overlay and
// SPA-navigate X's own router (a synthetic same-origin anchor click — no reload)
// to the thread. X renders it live and full-width (sidebars stay hidden), so
// comments, translation, media and every control still work. A floating "Back"
// button navigates home and restores the grid. The grid overlay is only hidden
// (never torn down), so scroll position and harvested cards survive the round trip.
//
// PERF: masonry uses explicit flex columns (append each card to the shortest
// column) — NOT CSS column-count. Harvest is debounced; clones are stripped of
// data-testid so they are never re-scanned. We do NOT click X's inline "Show
// more" (that reflowed every long tweet — a jank storm); truncated captions are
// read in full in the thread reader instead. The bootstrap loader is capped.
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
  function colCount() {
    var w = window.innerWidth; // full width — no sidebar offset
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
  var readerOpen = false, backBtn = null;

  function keyOf(article) {
    var links = article.querySelectorAll('a[href*="/status/"]');
    for (var i = 0; i < links.length; i++) {
      var m = links[i].getAttribute('href').match(/\/status\/(\d+)/);
      if (m) return m[1];
    }
    return (article.innerText || '').slice(0, 80);
  }
  function statusHrefOf(article) {
    var links = article.querySelectorAll('a[href*="/status/"]');
    for (var i = 0; i < links.length; i++) {
      if (/\/status\/\d+$/.test(links[i].getAttribute('href'))) return links[i].href; // clean permalink
    }
    return links.length ? links[0].href : '';
  }
  // Ready when every <img> decoded AND every media wrapper (photo/link card) has
  // its <img> — otherwise we'd clone an empty bordered box that never fills in.
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
  function eagerImgs(root) {
    var imgs = root.querySelectorAll('img');
    for (var c = 0; c < imgs.length; c++) {
      imgs[c].loading = 'eager';
      imgs[c].setAttribute('decoding', 'sync');
      imgs[c].removeAttribute('fetchpriority');
    }
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
      if (!mediaReady(cell) && now - firstSeen[k] < MEDIA_GRACE) continue; // let media/cards load
      seen.add(k);

      var statusHref = statusHrefOf(art);
      var clone = cell.cloneNode(true);
      clone.removeAttribute('data-testid');
      clone.removeAttribute('style');
      clone.className = 'fc-card';
      clone.setAttribute('data-fc-status', statusHref);
      clone.setAttribute('data-fc-id', k);
      eagerImgs(clone);
      cards.push(clone);
      place(clone);
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () { scheduled = false; harvest(); });
  }

  // ---- Thread reader (native, no reload) -----------------------------------
  // Trigger X's own SPA router via a same-origin anchor click (no page reload).
  function spaNavigate(href) {
    var a = document.createElement('a');
    a.href = href;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    a.remove();
  }
  function ensureBackBtn() {
    if (backBtn) return;
    backBtn = document.createElement('button');
    backBtn.id = 'fc-back';
    backBtn.type = 'button';
    backBtn.textContent = '← Back to grid';
    backBtn.addEventListener('click', closeReader);
    document.body.appendChild(backBtn);
  }
  function openReader(href) {
    if (!href || readerOpen) return;
    readerOpen = true;
    if (overlay) overlay.style.display = 'none'; // reveal X's live thread underneath
    ensureBackBtn();
    backBtn.style.display = 'block';
    spaNavigate(href);
  }
  function closeReader() {
    if (!readerOpen) return;
    readerOpen = false;
    if (backBtn) backBtn.style.display = 'none';
    if (!isHome()) spaNavigate(location.origin + '/home');
    if (overlay) overlay.style.display = ''; // grid (with its cards + scroll) comes right back
  }
  function onCardClick(e) {
    var card = e.target.closest ? e.target.closest('.fc-card') : null;
    if (!card) return;
    e.preventDefault();  // stop the dead clone's own link nav
    e.stopPropagation();
    openReader(card.getAttribute('data-fc-status'));
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && readerOpen) closeReader(); });

  function mount() {
    if (overlay) return;
    document.documentElement.classList.add('fc-home'); // full-width home CSS (hide nav + both sidebars)
    overlay = document.createElement('div');
    overlay.id = ID;
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;overflow-y:auto;' +
      'overflow-x:hidden;z-index:9999;background:' + (getComputedStyle(document.body).backgroundColor || '#fff') + ';padding:8px;';
    grid = document.createElement('div');
    grid.id = 'fc-grid';
    grid.style.cssText = 'display:flex;gap:' + GAP + 'px;align-items:flex-start;';
    overlay.appendChild(grid);
    document.body.appendChild(overlay);
    buildColumns(colCount());

    grid.addEventListener('click', onCardClick, true); // capture: beat X's link handlers → open reader

    overlay.addEventListener('scroll', function () {
      noProgress = 0; // user engaged → allow loading again
      if (loading || readerOpen) return;
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
    if (backBtn) { backBtn.style.display = 'none'; }
    readerOpen = false;
    seen = new Set(); firstSeen = Object.create(null);
    cards = []; columnEls = []; curCols = 0; lastCount = 0; noProgress = 0;
  }

  // ---- Typography ----------------------------------------------------------
  // X's CSP blocks the crxjs module content script (src/content/main.ts), so the
  // popup's font settings never reach X through it. This classic content script
  // is CSP-exempt (isolated world) and reads chrome.storage directly, so it owns
  // typography on X: injects a settings-driven <style>, re-applies on change.
  // Size/weight/line-height/letter-spacing are scoped to tweet text (applying to
  // every element breaks X's icon sizing); font-family is applied broadly.
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
    if (!isHome()) {
      if (readerOpen) return; // reader drove the background page to a thread — keep the grid mounted (hidden)
      unmount();
      return;
    }
    if (readerOpen) return;  // reading a thread that lives at /home? never; guard anyway
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
