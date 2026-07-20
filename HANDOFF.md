# Handoff — X (Twitter) masonry reader: how it was tested & fixed

Scope: the full-width masonry reader + native thread reader that the extension
overlays on `x.com/home`. All of it lives in **`public/x-masonry.js`** (behaviour)
and **`src/content/x.css`** (layout), registered by `manifest.config.ts`.

This doc records the exact test methodology and every root-caused fix, so the
next person can reproduce results instead of guessing.

---

## 1. Architecture facts you must know first

- **`public/x-masonry.js` is a plain classic IIFE content script**, not an ES
  module. It runs in the **isolated world**, so X's strict CSP does not block it.
  crxjs minifies it inline (self-contained — no dynamic `import()`), so it works
  on x.com. Verify with: the built asset in `dist/assets/x-masonry.js-*.js` is the
  whole IIFE, not a loader stub.
- **`src/content/main.ts` does NOT run on x.com.** crxjs wraps it as a module
  loader; X's CSP blocks that. So the popup's font settings never reach X through
  `main.ts`. That is why typography for X is re-implemented inside
  `x-masonry.js` (it reads `chrome.storage.local` directly and injects a
  `<style id="fc-x-type">`, re-applying on `chrome.storage.onChanged`).
- `x-masonry.js` only mounts on `/home` (`isHome()`). It toggles
  `html.fc-home`, which gates all the home-only CSS in `x.css`.
- The grid is an explicit **flex-column masonry** (append each card to the
  shortest column). NOT CSS `column-count` (measured ~9× slower, reflows every
  card per insert).

---

## 2. The test harness (no Playwright/Puppeteer needed)

Three layers, cheapest first. Scripts live in `test/`.

### 2a. jsdom logic test — `test/masonry-jsdom.test.js`
Loads the real `public/x-masonry.js` into a mock `/home` DOM and asserts the
logic paths (mount, harvest, click→reader, Back, typography). Fast, no browser.

```bash
npm i jsdom --no-save          # jsdom is not a project dep
NODE_PATH=./node_modules node test/masonry-jsdom.test.js
```
Notes: the script stubs `chrome.storage`, captures the top-level `setInterval`
so ticks are deterministic, and polyfills `requestAnimationFrame`. It proves the
code executes correctly but NOT real rendering/routing.

### 2b. Offline real-Chrome fixture — `test/x-fixture.html` + `test/fixture-server.js`
A realistic X-shaped DOM (`cellInnerDiv`/`article`/`tweetText`/`tweetPhoto`) with
a **mock SPA router** and the real `x.css`, served for any path so `/home` and
`/status/ID` both load it. Drive it with headless Chrome over CDP (see 2c
pattern) to screenshot the grid and reader without an X login. Good for layout,
bad for X-specific routing (the mock router differs from X's).

### 2c. Live x.com over CDP — `test/live-cdp-inject.js`, `test/live-nav-probe.js`
**This is the one that matters.** It drives the user's logged-in Chrome. The
whole CDP client is ~20 lines using Node 23's global `WebSocket` + `fetch` — no
deps.

Launch Chrome once (visible, so the user can log in), with the built extension
and remote debugging:
```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DIST=./dist
"$CHROME" --remote-debugging-port=9222 \
  --user-data-dir=/tmp/x-debug-profile \
  --load-extension="$DIST" \
  --disable-features=DisableLoadExtensionCommandLineSwitch \
  "https://x.com/home"
# → user logs into X in that window
```
Then drive it:
```bash
node test/live-cdp-inject.js     # screenshots grid + reader, prints DOM diagnostics
```
CDP essentials the drivers use:
- `GET http://localhost:9222/json` → find the `page` target whose `url` matches x.com; connect its `webSocketDebuggerUrl`.
- `Runtime.evaluate {expression, returnByValue:true}` → read/poke the page.
- `Page.captureScreenshot {format:'png'}` → base64 PNG (write to file, then read it back to actually LOOK).
- `Emulation.setDeviceMetricsOverride {width,height}` → force a viewport (used 1680×1000).

> **Chrome 149 caveat:** `--load-extension` no longer registers the declared
> content scripts in a throwaway CLI profile, so the *extension* didn't inject in
> the debug window. To test the exact code anyway, the driver **injects
> `public/x-masonry.js` + `x.css` straight into the live page** via
> `Runtime.evaluate` (main world; `chrome.storage` is absent there so typography
> falls back to defaults through the script's try/catch). Same source that ships.

**Always screenshot AND read the PNG.** DOM diagnostics can say "cards:8" while
the layout is visually broken. Every fix below was confirmed by eyeballing the
screenshot, not just the JSON.

---

## 3. Bugs found & fixed (root cause → fix → how verified)

Ordered by when found. Each was verified on **live x.com** unless noted.

| # | Symptom | Root cause (measured) | Fix | Ver |
|---|---------|----------------------|-----|-----|
| 1 | tsc build error | `FontSettings` has no index signature; `chrome.storage.local.get(DEFAULT_SETTINGS,…)` fails TS2345 | double-cast `as unknown as Record<string,unknown>` | 1.2.5 |
| 2 | Single post pinned left, empty right | `x.css` hid nav+sidebars globally | gate home-only CSS behind `html.fc-home` | 1.2.7 |
| 3 | Font size/weight/line-height dead on X | `main.ts` CSP-blocked on X, and it only ever applied `font-family` | typography engine inside `x-masonry.js` (reads storage, injects `<style>`, re-applies on change) | 1.2.7 |
| 4 | Media blank on some cards | X lazy-assigns `<img>` `src` via IntersectionObserver on the *live* cell; a clone's IO never fires → empty `src` forever | `stripEmptyMedia()`: drop any `tweetPhoto`/`card.wrapper` with no `img[src^="http"]`; grace 2s→3.5s | 1.2.10 |
| 5 | Click card "did not open" | shipped a lightbox with **zero CSS** (invisible div) | replaced with native thread reader | 1.2.8 |
| 6 | Perf jank | harvest clicked X's inline "Show more" on **every** pass → reflowed every long tweet | removed the per-pass click | 1.2.8 |
| 7 | **Reader reloaded the page** | a synthetic anchor click is **not** intercepted by X's React Router → full navigation (verified: injected script wiped, `overlay` gone). `pushState` alone also does nothing (`threadCells` stayed home). | `history.pushState(url)` **+ `dispatchEvent(new PopStateEvent('popstate'))`** → SPA render, no reload (verified `probe` survived, `threadCells` grew) | 1.2.9 |
| 8 | Empty gutter left of nav | X centers its layout; the visible rail is a `position:fixed` `header>div>div` at left **208**, width **275**, inside a **483**-wide header box | pin the rail `left:0`; offset grid by the **rail** width (275), not the header box (483). `navWidth()` measures `header>div>div` | 1.2.11 |
| 9 | Avatars all blank | compact-card CSS set the avatar's wrapper `div:has(> Tweet-User-Avatar)` to `width:0`, collapsing the profile `<img>` (which actually has a valid `src`) | delete the compact hack; render avatars natively | 1.2.11 |
| 10 | "Hiển thị thêm" won't expand | clones are dead React; full text isn't in the clone | click X's inline "Show more" (a `<button role=button>`, no href) once per cell **before** cloning — verified it expands **in place with no navigation** (path stayed `/home`, text 279→398 chars) | 1.2.11 |
| 11 | Blank cards: gray avatar circle + big empty bordered box | X mounts the cell **shell** (text/buttons) before media/avatar even exist in the DOM; `mediaReady` saw zero `<img>`s → "ready" → instant blank clone, `incomplete[k]` never set so refill never fired. The empty box is a bare `/photo/N` anchor + aspect-ratio div (no `tweetPhoto` testid yet) | `mediaReady`: unready if `Tweet-User-Avatar` has no img, or any `a[href*="/photo/"]` has no img/bg. `stripEmptyMedia`: remove empty photo-anchor region (climb while parent holds nothing real) | 1.2.25 |
| 12 | Loaded photo still invisible in clone | X fades imgs in: inline `opacity:0`, React sets 1 on load — clone's React is dead (verified live: `complete=true, naturalWidth>0`, computed opacity 0); only the bg-image sibling div saved most photos | `eagerImgs` forces `img.style.opacity='1'` on every cloned img | 1.2.25 |
| 13 | Grid stops loading at the bottom; blind scroll left permanent blanks | (a) scroll events can't fire once `scrollTop` is pinned at max → scroll-handler-only loader starves; (b) blind one-viewport steps rushed past cells before X hydrated them | `advanceTimeline()`: park X's viewport on the first cell still missing media (skip after 2×grace) instead of blind `scrollBy`; interval also feeds while user sits near the grid bottom (`noProgress` cap 8 ticks ≈ 9.6s outlasts one grace dwell) | 1.2.25 |
| 14 | Whole card was a click target — text/media couldn't be selected/copied | `onCardClick` preventDefault'ed every click and opened the reader | only the reply (chat) icon opens the reader; anchors open in a new tab (a clone's real href would otherwise full-navigate and kill the grid); everything else is inert — text selects, images right-click save. CSS: card `cursor:auto` + `user-select:text` | 1.2.26 |
| 15 | Action buttons dead on cards (no like/repost/share menu); video unplayable | clones are dead React | forward a full synthetic pointer sequence (pointerdown→click) to the live cell's matching button (testid match, else index in `[role="group"]`), `scrollIntoView` the target first (X anchors menus to document coords — off-screen otherwise, measured top:-1513), re-clone the card 1.5s later so like state shows. Menus paint above the grid because the overlay mounts INSIDE `#layers` as an earlier sibling (a body-level z9999 overlay always beat #layers' z-0 ancestor stacking context). Loader pauses while a menu/dialog is open (background scroll drags the anchored menu off-screen). Video click → thread reader (clone `<video>` can't stream). Live cell gone → fallback reader. Verified: like toggled+reverted on live account, share menu visible+items real, video→reader→Back | 1.2.27 |
| 16 | **"Every click still jumps to detail"** (user report; 1.2.27 tests had passed) | tests used fresh cards whose live cells still existed; in real use X has **evicted** most cells (virtualized), and the button path's live-cell-missing fallback was `openReader` → every action button opened the reader | `restoreLiveCell()`: record each cell's document offset at clone time (`data-fc-y`); on action with no live cell, freeze the loader, `scrollTo` that offset and poll ≤3.2s (probe ±1 viewport for drift) — X re-renders the evicted cell, then forward the click. Reader fallback only on failed restore. `refreshCard` retries until `mediaReady` so a half-hydrated restored cell can't eat the card's images. Also `data-fc-version` on the overlay to catch stale extension loads | 1.2.28 |

| 17 | Menus opened mid-screen (anchored to live cell), not at the mouse; video click opened the reader instead of playing | X anchors `#layers [role=menu]` (inline `top/right`) to the LIVE button we forwarded to; a clone's `<video>` can never stream and the old handler just opened the thread | `moveMenuNear()`: poll ≤1s for the menu to mount, then pin it `position:fixed` at the click point, clamped on-screen (item clicks verified to survive the move — copy-link toast fired). In-card video: background service worker fetches `cdn.syndication.twimg.com/tweet-result` (page CSP/CORS block it from content-script AND page worlds — measured; host permission added), pick highest-bitrate mp4 variant (host `video.twimg.com` = allowed by X's own `media-src`), swap into the player box as `<video controls autoplay>`; muted-retry if user activation expired; `data-fc-playing` guards refill/refresh from clobbering the player; reader only as error fallback. Verified with trusted CDP input on the real packed extension: video played unmuted in-card (t 0.1→4.1s, path stayed `/home`), caret/share menus rendered at the exact click coords | 1.2.29 |

| 18 | Hover-to-play | — (feature) | dwell 250ms over a card's video → muted inline preview via the same syndication-mp4 path (muted = allowed without user activation); mouseleave pauses, re-hover resumes, click un-marks the preview so it keeps playing and native controls take over. Tweet JSON cached per id so hovering doesn't refetch. Verified with trusted CDP mouse moves: hover t2.8→5.8 muted, leave paused, click kept playing (t→10), path stayed `/home` | 1.2.30 |

> **Testing note (Chrome 150):** `--load-extension` still doesn't register content
> scripts, but launching with `--enable-unsafe-extension-debugging` and calling the
> CDP `Extensions.loadUnpacked {path: dist}` **does** — 1.2.28 was verified with the
> real packed content script (no source injection), confirmed via the overlay's
> `data-fc-version`. Login for the debug profile: inject saved cookies over CDP
> (`Storage.setCookies`, with `expires` set or they die with the browser process).

### Key measurements captured (for the next person)
- Left nav geometry @1680px: `header[role="banner"]` = 0→483; visible rail (`header>div>div`, `position:fixed`) = left 208, width 275; `primaryColumn.left` = 608.
- Avatar: `Tweet-User-Avatar img` has real `src=https://pbs.twimg.com/profile_images/…`, `complete=true` — so blanks were CSS, not lazy-loading.
- Nav method probe: `pushState+popstate` → SPA (no reload); `pushState` only → no render; synthetic `<a>` click → full reload.
- Show-more: `tweet-text-show-more-link` is `<button role=button>` (no href); click → inline expand, no nav.

---

## 4. Known limitations (not yet solved)

- **Full external link text**: X shortens the display URL (e.g.
  `github.com/cullenwebber/t…`) in the text node itself and the `href` is a
  `t.co` short link — the full URL is genuinely **not** in the page. Clicking
  still resolves correctly. To show the full URL you'd have to `fetch()` the
  `t.co` and read `response.url` (redirect), async, per link. Not done.
- **Font-family on X** depends on X's CSP allowing the Google Fonts `<link>`. If
  blocked, it silently falls back to the system font. Size/weight/line-height are
  pure CSS and always work.
- **Chrome 149 `--load-extension`** doesn't register content scripts in a CLI
  debug profile — test via injection (§2c) or a normally-installed extension.
- Column count scales with viewport minus nav (~275px): 2 cols @1680, 3–4 on
  wider screens.

---

## 5. How to verify a change end-to-end (checklist)

1. `node --check public/x-masonry.js` (it's copied un-typechecked by vite — a JS
   syntax error would otherwise ship silently).
2. `node test/masonry-jsdom.test.js` (logic).
3. Launch debug Chrome (§2c), `node test/live-cdp-inject.js`, then **read**
   `*-01-grid.png` / `*-02-reader.png` / `*-03-back.png`.
4. `npm run build`; confirm the fix is in `dist/assets/x-masonry.js-*.js`.
5. Bump `package.json` version (manifest reads it), commit, push.
6. Reload the extension in real Chrome (`chrome://extensions` → ⟳).
