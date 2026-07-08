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
  var MEDIA_GRACE = 3500; // ms to wait for a cell's media/cards to load before harvesting anyway

  function isHome() {
    var h = location.hostname.replace(/^www\./, '');
    if (h !== 'x.com' && !/twitter\.com$/.test(h)) return false;
    return location.pathname === '/home' || location.pathname === '/';
  }
  // Keep X's left nav visible; the grid fills the width to the RIGHT of it. The
  // right sidebar is hidden via CSS. Nav width is measured at runtime (it's
  // responsive: a wide labelled rail or a narrow icon rail).
  function navWidth() {
    var hdr = document.querySelector('header[role="banner"]');
    if (!hdr) return 0;
    // The visible nav rail is the fixed inner column (header > div > div, ~275px);
    // the header box itself is wider (X reserves centered gutter). CSS pins that
    // rail to the left edge; we offset the grid by the rail's width, not the box.
    var rail = hdr.querySelector(':scope > div > div') || hdr;
    var w = Math.round(rail.getBoundingClientRect().width);
    return (w > 0 && w < window.innerWidth * 0.5) ? w : 0;
  }
  function colCount() {
    var w = window.innerWidth - navWidth(); // full width MINUS the left nav
    if (w > 1600) return 4;
    if (w > 1200) return 3;
    if (w > 800) return 2;
    return 1;
  }

  var seen = new Set();
  var firstSeen = Object.create(null);
  var expandClicked = new WeakSet(); // live cells whose inline "Show more" we already clicked
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
    // Avatar first — x.com is fully lazy, and a blank avatar is the most visible
    // miss. Don't harvest until the profile image has decoded.
    var avi = cell.querySelector('[data-testid="Tweet-User-Avatar"] img');
    if (avi && (!avi.complete || avi.naturalWidth === 0)) return false;
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
  // X lazy-assigns media <img> src only when the REAL cell intersects the
  // viewport; a clone's IntersectionObserver never fires, so an unfilled photo /
  // link-card leaves a blank bordered box forever. Drop any media wrapper that
  // has no real (http) image — the card keeps its text and any loadable media
  // (a wrapper whose img already has an http src still loads in the overlay).
  function stripEmptyMedia(clone) {
    var wraps = clone.querySelectorAll('[data-testid="tweetPhoto"], [data-testid="card.wrapper"]');
    for (var i = 0; i < wraps.length; i++) {
      if (!wraps[i].querySelector('img[src^="http"]')) wraps[i].remove();
    }
  }
  // Tag the tweet's flex row + its avatar/content columns so CSS can float the
  // avatar (content then wraps beside it and reclaims full width below), instead
  // of X's fixed avatar column reserving an empty strip / our old overlap.
  function tagAvatarLayout(clone) {
    var av = clone.querySelector('[data-testid="Tweet-User-Avatar"]');
    if (!av) return;
    var col = av;
    while (col.parentElement && col.parentElement !== clone && col.parentElement.children.length < 2) {
      col = col.parentElement;
    }
    var row = col.parentElement;
    if (row && row !== clone && row.children.length >= 2) {
      row.classList.add('fc-row');
      col.classList.add('fc-avcol');
      if (col.nextElementSibling) col.nextElementSibling.classList.add('fc-content');
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

  function positionOverlay() {
    if (overlay) overlay.style.left = navWidth() + 'px'; // sit to the right of the left nav
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

      // Auto-expand long posts: X's inline "Show more" is a <button role=button>
      // (no href) that reveals the rest of the text IN PLACE with no navigation
      // (verified on live x.com: click → path unchanged, text grew). Click it
      // once per cell, then wait for the expansion before cloning so the card
      // captures the full text and no dead "Show more" remains. Anchor-type
      // show-more (has href → would navigate) is never clicked.
      var sm = cell.querySelector('[data-testid="tweet-text-show-more-link"]');
      var inlineExpand = sm && !(sm.tagName === 'A' && sm.getAttribute('href'));
      if (inlineExpand && !expandClicked.has(cell)) {
        expandClicked.add(cell);
        try { sm.click(); } catch (e) { /* ignore */ }
      }
      var stillTruncated = inlineExpand && cell.querySelector('[data-testid="tweet-text-show-more-link"]');

      if ((!mediaReady(cell) || stillTruncated) && now - firstSeen[k] < MEDIA_GRACE) continue; // let media/text settle
      seen.add(k);

      var statusHref = statusHrefOf(art);
      var clone = cell.cloneNode(true);
      clone.removeAttribute('data-testid');
      clone.removeAttribute('style');
      clone.className = 'fc-card';
      clone.setAttribute('data-fc-status', statusHref);
      clone.setAttribute('data-fc-id', k);
      eagerImgs(clone);
      stripEmptyMedia(clone);
      tagAvatarLayout(clone);
      cards.push(clone);
      place(clone);
    }
  }

  // Toggle .fc-clipped on cards whose content overflows the CSS max-height cap
  // (so the bottom fade only shows where there's actually more to read). Re-run
  // as images finish loading and grow the cards.
  function markClipped() {
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var clipped = c.scrollHeight > c.clientHeight + 4;
      c.classList.toggle('fc-clipped', clipped);
      var more = c.querySelector('.fc-more');
      if (clipped && !more) {
        more = document.createElement('div');
        more.className = 'fc-more';
        more.textContent = 'Show more →';
        c.appendChild(more);
      } else if (!clipped && more) {
        more.remove();
      }
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () { scheduled = false; harvest(); markClipped(); });
  }

  // ---- Thread reader (native, no reload) -----------------------------------
  // Trigger X's own SPA router WITHOUT a page reload. A synthetic anchor click is
  // NOT intercepted by X's React Router (verified on live x.com — it falls through
  // to a full navigation). pushState + a popstate event IS what X's history
  // listener reacts to, so it renders the route in place. pushState alone does
  // nothing (verified) — the popstate dispatch is the trigger.
  function spaNavigate(href) {
    try {
      history.pushState({}, '', href);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (e) {
      location.href = href; // last-resort fallback (full nav) if pushState is blocked
    }
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
    document.documentElement.classList.add('fc-home'); // home CSS: keep left nav, hide right sidebar
    overlay = document.createElement('div');
    overlay.id = ID;
    var bg = getComputedStyle(document.body).backgroundColor || '#fff';
    overlay.style.cssText = 'position:fixed;top:0;left:' + navWidth() + 'px;right:0;bottom:0;overflow-y:auto;' +
      'overflow-x:hidden;z-index:9999;background:' + bg + ';padding:8px;';
    overlay.style.setProperty('--fc-bg', bg); // the clipped-card fade fades to the real bg
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
        // Gentle step + dwell: x.com only loads a cell's media/avatar once it sits
        // in the viewport, so scrolling too far too fast leaves blanks.
        window.scrollBy(0, window.innerHeight * 1.5);
        setTimeout(function () { schedule(); loading = false; }, 900);
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
    seen = new Set(); firstSeen = Object.create(null); expandClicked = new WeakSet();
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
      window.scrollBy(0, window.innerHeight * 1.2);
      setTimeout(function () { schedule(); loading = false; }, 900);
    }
  }, 1200);
})();
