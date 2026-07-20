// Headless logic test for public/x-masonry.js using jsdom + a mock X /home DOM.
// Verifies the paths the user reported broken: grid mounts, cards harvest,
// clicking a card opens the reader (overlay hidden + Back shown), Back restores
// the grid, and typography settings apply. No X login required.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SCRIPT = fs.readFileSync(
  path.resolve('/Volumes/DATA/TUCM/FontChanger_TUCM_ChromeExtension/public/x-masonry.js'),
  'utf8'
);

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name); }
}

// --- Build a mock X /home document -----------------------------------------
function cellHTML(id, text) {
  return `
    <div data-testid="cellInnerDiv">
      <article>
        <time datetime="2026-07-06"></time>
        <div data-testid="User-Name">User ${id}</div>
        <a href="/user${id}/status/${id}">link</a>
        <div data-testid="tweetText">${text}</div>
        <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/x${id}.jpg"></div>
        <button data-testid="reply"><span>reply</span></button>
      </article>
    </div>`;
}
const html = `<!doctype html><html><head></head><body>
  <div id="timeline">
    ${cellHTML(1001, 'first post text')}
    ${cellHTML(1002, 'second post text')}
    ${cellHTML(1003, 'third post text')}
  </div>
  <header role="banner">left nav</header>
  <main role="main"><div data-testid="primaryColumn"></div><div data-testid="sidebarColumn">right</div></main>
</body></html>`;

const dom = new JSDOM(html, { url: 'https://x.com/home', pretendToBeVisual: true });
const { window } = dom;
const document = window.document;

// jsdom lacks a real layout engine → make every <img> look decoded so mediaReady() passes.
Object.defineProperty(window.HTMLImageElement.prototype, 'complete', { get() { return true; }, configurable: true });
Object.defineProperty(window.HTMLImageElement.prototype, 'naturalWidth', { get() { return 400; }, configurable: true });
// offsetHeight drives shortest-column; give columns a stable height so place() works.
Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { get() { return 100; }, configurable: true });
window.scrollBy = () => {};
window.requestAnimationFrame = (fn) => { fn(); return 0; };

// Capture the script's top-level setInterval so we can tick it deterministically.
let intervalCb = null;
window.setInterval = (fn) => { intervalCb = fn; return 1; };
window.setTimeout = (fn) => 1; // bootstrap timers are no-ops in the test

// chrome.storage stub with a settings row + an onChanged hook.
let onChangedCb = null;
const stored = { fontFamily: 'Poppins', fontSize: 22, fontWeight: 700, lineHeight: 1.8, letterSpacing: 1, features: { typography: true } };
window.chrome = {
  runtime: { lastError: null },
  storage: {
    local: { get: (_defaults, cb) => cb(stored) },
    onChanged: { addListener: (cb) => { onChangedCb = cb; } },
  },
};

// Expose the globals the IIFE reads as bare identifiers.
global.window = window;
global.document = document;
global.location = window.location;
global.chrome = window.chrome;
global.getComputedStyle = window.getComputedStyle.bind(window);
global.MutationObserver = window.MutationObserver;
global.MouseEvent = window.MouseEvent;
global.requestAnimationFrame = window.requestAnimationFrame;
global.setInterval = window.setInterval;
global.setTimeout = window.setTimeout;
global.Set = Set; global.WeakSet = WeakSet;

// --- Load the script (runs the IIFE once, in this scope) -------------------
try { eval(SCRIPT); } catch (e) { console.log('SCRIPT THREW:', e.message); }

console.log('\n[1] Initial typography applied on load');
const typeStyle = document.getElementById('fc-x-type');
ok('injects <style id=fc-x-type>', !!typeStyle);
ok('applies fontSize 22px from storage', !!typeStyle && typeStyle.textContent.includes('font-size: 22px'));
ok('applies fontWeight 700', !!typeStyle && typeStyle.textContent.includes('font-weight: 700'));
ok('applies lineHeight 1.8', !!typeStyle && typeStyle.textContent.includes('line-height: 1.8'));
ok('applies family Poppins', !!typeStyle && typeStyle.textContent.includes("'Poppins'"));

console.log('\n[2] Tick interval → mount + harvest');
ok('interval registered', typeof intervalCb === 'function');
if (intervalCb) intervalCb();
const overlay = document.getElementById('fc-masonry');
const gridEl = document.getElementById('fc-grid');
ok('overlay #fc-masonry mounted', !!overlay);
ok('grid #fc-grid mounted', !!gridEl);
ok('html.fc-home class added (full-width CSS)', document.documentElement.classList.contains('fc-home'));
const columns = document.querySelectorAll('#fc-grid .fc-col');
ok('flex columns built', columns.length >= 1);
const cardEls = document.querySelectorAll('#fc-grid .fc-card');
ok('harvested 3 cards', cardEls.length === 3);
const firstCard = cardEls[0];
ok('card carries data-fc-status permalink', firstCard && /\/status\/1001$/.test(firstCard.getAttribute('data-fc-status') || ''));
ok('card carries data-fc-id', firstCard && firstCard.getAttribute('data-fc-id') === '1001');
ok('cloned card has no live data-testid on root', firstCard && !firstCard.getAttribute('data-testid'));

console.log('\n[3] Only the reply icon opens the reader; body clicks stay inert');
// Spy on the SPA-nav anchor: record clicks dispatched on anchors with a status href.
let navigatedTo = null;
document.addEventListener('click', (e) => {
  const a = e.target && e.target.closest && e.target.closest('a[href]');
  if (a && /\/status\//.test(a.getAttribute('href'))) navigatedTo = a.getAttribute('href');
}, true);
// Clicking the card body (tweet text) must NOT open the reader (text stays copyable).
firstCard.querySelector('[data-testid="tweetText"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
ok('body click leaves overlay visible', overlay.style.display !== 'none');
// Clicking an anchor must NOT navigate the page — it opens a new tab instead.
let openedTab = null;
window.open = (href) => { openedTab = href; };
firstCard.querySelector('a[href]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
ok('anchor click opens new tab, overlay stays', /\/status\/1001$/.test(openedTab || '') && overlay.style.display !== 'none');
// Clicking the reply (chat) icon opens the reader.
firstCard.querySelector('[data-testid="reply"] span').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
ok('overlay hidden on open', overlay.style.display === 'none');
const back = document.getElementById('fc-back');
ok('#fc-back button created', !!back);
ok('#fc-back visible', !!back && back.style.display === 'block');
ok('SPA-navigated to the thread permalink', !!navigatedTo && /\/status\/1001/.test(navigatedTo));

console.log('\n[4] Back → grid restored');
back.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
ok('overlay shown again', overlay.style.display === '');
ok('#fc-back hidden', back.style.display === 'none');

console.log('\n[5] Storage change → typography re-applies live');
stored.fontSize = 30;
ok('onChanged listener registered', typeof onChangedCb === 'function');
if (onChangedCb) onChangedCb({}, 'local');
ok('re-applied new fontSize 30px', document.getElementById('fc-x-type').textContent.includes('font-size: 30px'));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
