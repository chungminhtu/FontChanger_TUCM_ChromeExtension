// FontChanger — X (Twitter) clone-based masonry reader + native thread reader.
// Plain classic content script (isolated world, no ES-module loader) so it runs
// despite X's strict CSP. Harvests X's rendered tweets into our own full-width
// masonry grid (kept permanently) and drives X's virtualized timeline in the
// background to load more as you scroll our grid.
//
// LAYOUT: full width — the left nav AND both sidebars are hidden on /home (CSS,
// gated by html.fc-home). Only mounts on /home.
//
// READER: clicking a card opens it as a centered LIGHTBOX dialog over a dim
// backdrop — a fresh clone of the harvested card (full text + media, uncapped
// height), NOT a page navigation. Self-contained so it can't blank out (the old
// SPA-float of X's own thread left a gray empty modal). The grid overlay stays
// mounted behind the backdrop, so scroll position and harvested cards survive.
// Close via the button, backdrop click, or Escape. (Comments are not shown — the
// reader is the post itself, not the live thread.)
//
// TOGGLES (floating, top-right): layout (masonry <-> aligned rows) and full-height
// (cards grow to fit, capped at 100vh instead of the 600px clip). Both persist in
// chrome.storage.local (xLayout / xFullHeight).
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
  var MEDIA_GRACE = 6000; // ms to wait for a cell's media/cards to load before harvesting anyway

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
  var incomplete = Object.create(null); // status-key -> clone harvested before its media had loaded
  var cards = [];           // ordered card elements
  var columnEls = [];       // current column containers
  var curCols = 0;
  var overlay = null, grid = null, mo = null, loading = false, scheduled = false;
  var lastCount = 0, noProgress = 0;
  var readerOpen = false, backBtn = null, backdrop = null, readerEl = null;
  var layoutMode = 'masonry'; // 'masonry' (staggered columns) | 'rows' (aligned grid). Loaded from storage.
  var layoutBtn = null;
  var fullHeight = false, fullHeightBtn = null; // full-height mode: cards grow to fit (capped 100vh), no inline scroll.

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
      // Keep the wrapper if it has a loadable image: an <img> with an http src, OR
      // a nested element whose background-image points at an http URL (X renders
      // some card/photo media as a background-image div, not an <img>).
      if (wraps[i].querySelector('img[src^="http"]') || hasBgImage(wraps[i])) continue;
      wraps[i].remove();
    }
  }
  function hasBgImage(root) {
    var els = root.querySelectorAll('*');
    for (var i = 0; i < els.length; i++) {
      var bg = els[i].style && els[i].style.backgroundImage;
      if (bg && bg.indexOf('http') !== -1) return true;
    }
    return false;
  }
  // Tag the tweet's flex row + its avatar/content columns so CSS can overlay the
  // avatar in the row's top-left corner and indent ONLY the header line beside it.
  // Floating the avatar column does NOT work here: X's tweet-text wrapper is a
  // flex container (a BFC root), so instead of its line boxes wrapping around the
  // float, the whole box gets pushed 52px right for its full height — the empty
  // strip the user keeps seeing. Absolute avatar + header margin has no such
  // interaction, so text/media get the card's full width.
  function tagAvatarLayout(clone) {
    var av = clone.querySelector('[data-testid="Tweet-User-Avatar"]');
    if (!av) return;
    // Anchor on the tweet body (or name) so we tag the RIGHT columns regardless of
    // DOM variation. The avatar column = highest ancestor of the avatar that does
    // NOT contain the body; its parent is the flex row; the content column is the
    // row child that DOES contain the body. (The old child-count walk mis-tagged a
    // thread-connector line as the content column → body sat beside the float in a
    // tall empty strip instead of wrapping under the avatar.)
    var body = clone.querySelector('[data-testid="tweetText"]') ||
               clone.querySelector('[data-testid="User-Name"]');
    if (!body) return;
    var col = av;
    while (col.parentElement && col.parentElement !== clone && !col.parentElement.contains(body)) {
      col = col.parentElement;
    }
    var row = col.parentElement;
    if (!row || row === clone) return;
    var content = null;
    for (var i = 0; i < row.children.length; i++) {
      if (row.children[i] !== col && row.children[i].contains(body)) { content = row.children[i]; break; }
    }
    if (!content) return;
    row.classList.add('fc-row');
    col.classList.add('fc-avcol');
    content.classList.add('fc-content');
    // Header line = the content child holding the user name; only IT gets the
    // 52px indent so it sits beside the absolutely-positioned avatar. Everything
    // after it (text, media, actions) spans the full card width.
    var name = content.querySelector('[data-testid="User-Name"]');
    var hdr = name;
    while (hdr && hdr.parentElement !== content) hdr = hdr.parentElement;
    if (!hdr) hdr = content.firstElementChild;
    if (hdr) hdr.classList.add('fc-hdr');
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
  // Masonry: append to the shortest column. Rows: append straight to the grid in
  // source order (CSS grid lays them out in aligned rows).
  function place(el) {
    if (layoutMode === 'rows') grid.appendChild(el);
    else shortest().appendChild(el);
  }

  function positionOverlay() {
    if (overlay) overlay.style.left = navWidth() + 'px'; // sit to the right of the left nav
  }
  // Switch the grid container between explicit flex columns (masonry) and a CSS
  // grid whose rows align at the top (table/rows mode).
  function applyGridStyle(n) {
    if (layoutMode === 'rows') {
      grid.classList.add('fc-rows');
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(' + n + ', minmax(0, 1fr))';
      grid.style.alignItems = 'start';
    } else {
      grid.classList.remove('fc-rows');
      grid.style.display = 'flex';
      grid.style.gridTemplateColumns = '';
      grid.style.alignItems = 'flex-start';
    }
  }
  function layout() {
    if (!grid) return;
    positionOverlay();
    var n = colCount();
    applyGridStyle(n);
    // Re-parenting a scrollable card resets its scrollTop, so capture each card's
    // scroll offset before any redistribute and restore it after. Without this,
    // the periodic re-layout snapped a card the user was reading back to the top.
    var scrolls = null;
    if (layoutMode === 'rows') {
      // Cards are direct grid children in source order. Drop any leftover column
      // wrappers from a previous masonry render, then (re)append every card.
      if (columnEls.length || grid.querySelector('.fc-col')) {
        scrolls = saveScrolls();
        grid.textContent = '';
        columnEls = [];
        curCols = 0;
        for (var i = 0; i < cards.length; i++) grid.appendChild(cards[i]);
        restoreScrolls(scrolls);
      }
    } else if (n !== curCols || columnEls.length === 0) {
      scrolls = saveScrolls();
      buildColumns(n);
      for (var j = 0; j < cards.length; j++) place(cards[j]); // redistribute
      restoreScrolls(scrolls);
    }
  }
  function saveScrolls() {
    var s = [];
    for (var i = 0; i < cards.length; i++) s[i] = cards[i].scrollTop;
    return s;
  }
  function restoreScrolls(s) {
    if (!s) return;
    for (var i = 0; i < cards.length; i++) if (s[i]) cards[i].scrollTop = s[i];
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
      if (!k) continue;
      if (seen.has(k)) {
        // Re-fill pass: this cell was already harvested. If its clone went in
        // before X had lazy-loaded the media and the live cell is now fully
        // loaded, replace the clone with a complete fresh copy.
        if (incomplete[k] && mediaReady(cell)) refill(k, cell);
        continue;
      }
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

      var ready = !stillTruncated && mediaReady(cell);
      if (!ready && now - firstSeen[k] < MEDIA_GRACE) continue; // let media/text settle
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
      if (!ready) incomplete[k] = clone; // grace expired with media still missing → re-fill later
      cards.push(clone);
      place(clone);
    }
  }

  // Toggle .fc-clipped on cards whose content overflows the CSS max-height cap.
  // Clipped cards become inline-scrollable (CSS shows the scrollbar on hover) so
  // long posts are read in place — no "Show more". Re-run as images load & grow.
  function markClipped() {
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      c.classList.toggle('fc-clipped', c.scrollHeight > c.clientHeight + 4);
    }
  }

  // Replace an incomplete clone (harvested before its media loaded) with a fresh
  // full clone of the now-loaded live cell, in the same grid position.
  function refill(k, cell) {
    var old = incomplete[k];
    if (!old || !old.parentNode) { delete incomplete[k]; return; }
    if (old.scrollTop > 4) return; // user is scrolling/reading this card — don't swap it out from under them
    var art = cell.querySelector('article');
    var fresh = cell.cloneNode(true);
    fresh.removeAttribute('data-testid');
    fresh.removeAttribute('style');
    fresh.className = 'fc-card';
    fresh.setAttribute('data-fc-status', art ? statusHrefOf(art) : (old.getAttribute('data-fc-status') || ''));
    fresh.setAttribute('data-fc-id', k);
    eagerImgs(fresh);
    stripEmptyMedia(fresh);
    tagAvatarLayout(fresh);
    old.parentNode.replaceChild(fresh, old);
    var idx = cards.indexOf(old);
    if (idx >= 0) cards[idx] = fresh;
    delete incomplete[k];
    markClipped();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () { scheduled = false; harvest(); markClipped(); });
  }

  // ---- Layout mode (masonry <-> aligned rows) -------------------------------
  function updateLayoutBtn() {
    if (layoutBtn) layoutBtn.textContent = layoutMode === 'rows' ? '▦ Rows' : '▤ Masonry';
  }
  function ensureLayoutBtn() {
    if (layoutBtn) return;
    layoutBtn = document.createElement('button');
    layoutBtn.id = 'fc-layout';
    layoutBtn.type = 'button';
    layoutBtn.title = 'Toggle grid layout';
    layoutBtn.addEventListener('click', toggleLayout);
    document.body.appendChild(layoutBtn);
    updateLayoutBtn();
  }
  function toggleLayout() {
    layoutMode = layoutMode === 'rows' ? 'masonry' : 'rows';
    try { chrome.storage.local.set({ xLayout: layoutMode }); } catch (e) { /* no storage */ }
    updateLayoutBtn();
    layout();
    markClipped();
  }
  function loadLayoutMode() {
    try {
      chrome.storage.local.get({ xLayout: 'masonry' }, function (res) {
        var mode = (res && res.xLayout === 'rows') ? 'rows' : 'masonry';
        if (mode === layoutMode) { updateLayoutBtn(); return; }
        layoutMode = mode;
        updateLayoutBtn();
        if (grid) { layout(); markClipped(); }
      });
    } catch (e) { /* no storage */ }
  }

  // ---- Full-height mode (cards grow to fit, capped at 100vh) ----------------
  function updateFullHeightBtn() {
    if (fullHeightBtn) fullHeightBtn.textContent = fullHeight ? '↕ Full height: on' : '↕ Full height: off';
  }
  function ensureFullHeightBtn() {
    if (fullHeightBtn) return;
    fullHeightBtn = document.createElement('button');
    fullHeightBtn.id = 'fc-fullheight';
    fullHeightBtn.type = 'button';
    fullHeightBtn.title = 'Toggle full-height cards';
    fullHeightBtn.addEventListener('click', toggleFullHeight);
    document.body.appendChild(fullHeightBtn);
    updateFullHeightBtn();
  }
  function applyFullHeight() {
    if (overlay) overlay.classList.toggle('fc-full', fullHeight); // CSS caps cards at 100vh, drops the 600px clip
  }
  function toggleFullHeight() {
    fullHeight = !fullHeight;
    try { chrome.storage.local.set({ xFullHeight: fullHeight }); } catch (e) { /* no storage */ }
    updateFullHeightBtn();
    applyFullHeight();
    markClipped();
  }
  function loadFullHeight() {
    try {
      chrome.storage.local.get({ xFullHeight: false }, function (res) {
        fullHeight = !!(res && res.xFullHeight);
        updateFullHeightBtn();
        applyFullHeight();
        if (grid) markClipped();
      });
    } catch (e) { /* no storage */ }
  }

  // ---- Reader (clone lightbox) ---------------------------------------------
  // Open the clicked card as a centered lightbox dialog over a dim backdrop. We
  // show a fresh clone of the harvested card (full text + media, uncapped height)
  // — reliable and self-contained (no dependence on X's router/DOM, which left a
  // blank gray modal). Close via the button, backdrop click, or Escape.
  function ensureBackBtn() {
    if (backBtn) return;
    backBtn = document.createElement('button');
    backBtn.id = 'fc-back';
    backBtn.type = 'button';
    backBtn.textContent = '✕ Close';
    backBtn.addEventListener('click', closeReader);
    document.body.appendChild(backBtn);
  }
  function ensureBackdrop() {
    if (backdrop) return;
    backdrop = document.createElement('div');
    backdrop.id = 'fc-backdrop';
    backdrop.addEventListener('click', closeReader); // click outside the dialog closes it
    document.body.appendChild(backdrop);
  }
  function ensureReader() {
    if (readerEl) return;
    readerEl = document.createElement('div');
    readerEl.id = 'fc-reader';
    document.body.appendChild(readerEl);
  }
  function openReader(card) {
    if (!card || readerOpen) return;
    readerOpen = true;
    ensureBackdrop();
    ensureBackBtn();
    ensureReader();
    var clone = card.cloneNode(true);
    clone.classList.remove('fc-clipped'); // reader is fully expanded, never inline-scrolled
    clone.classList.add('fc-reader-card');
    eagerImgs(clone);
    readerEl.textContent = '';
    readerEl.appendChild(clone);
    readerEl.scrollTop = 0;
    backdrop.style.display = 'block';
    backBtn.style.display = 'block';
    readerEl.style.display = 'block';
    if (layoutBtn) layoutBtn.style.display = 'none';
    if (fullHeightBtn) fullHeightBtn.style.display = 'none';
  }
  function closeReader() {
    if (!readerOpen) return;
    readerOpen = false;
    if (backdrop) backdrop.style.display = 'none';
    if (backBtn) backBtn.style.display = 'none';
    if (readerEl) { readerEl.style.display = 'none'; readerEl.textContent = ''; }
    if (layoutBtn) layoutBtn.style.display = 'block';
    if (fullHeightBtn) fullHeightBtn.style.display = 'block';
  }
  function onCardClick(e) {
    var card = e.target.closest ? e.target.closest('.fc-card') : null;
    if (!card) return;
    e.preventDefault();  // stop the dead clone's own link nav
    e.stopPropagation();
    openReader(card);
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
    document.documentElement.style.setProperty('--fc-bg', bg); // lightbox modal uses it too
    grid = document.createElement('div');
    grid.id = 'fc-grid';
    grid.style.cssText = 'gap:' + GAP + 'px;';
    overlay.appendChild(grid);
    document.body.appendChild(overlay);
    ensureLayoutBtn();
    ensureFullHeightBtn();
    applyFullHeight();
    layout();

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
    if (backdrop) { backdrop.style.display = 'none'; }
    if (readerEl) { readerEl.style.display = 'none'; readerEl.textContent = ''; }
    readerOpen = false;
    seen = new Set(); firstSeen = Object.create(null); expandClicked = new WeakSet();
    incomplete = Object.create(null);
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
        if (area !== 'local') return;
        refreshTypography();
        if (changes.xLayout) loadLayoutMode();
        if (changes.xFullHeight) loadFullHeight();
      });
    }
  } catch (e) { /* no storage access */ }
  refreshTypography();
  loadLayoutMode();
  loadFullHeight();

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
