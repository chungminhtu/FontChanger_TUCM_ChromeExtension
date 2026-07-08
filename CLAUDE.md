# Project rules — fontchanger-tucm

## Ship on finish (ALWAYS — never ask)

When any code change is finished, ALWAYS do this automatically, without asking:

1. Bump the `version` in `package.json` (the crxjs manifest reads it).
2. `npm run build`.
3. `git commit` the changed source (not the unrelated pre-existing
   `package-lock.json` unless asked).
4. `git push`.

The user does not want to be asked each time. "bump build and commit push always."

## X (Twitter) masonry reader

- Behaviour lives in `public/x-masonry.js` (a plain classic content script — CSP
  exempt, isolated world). Layout in `src/content/x.css`. `src/content/main.ts`
  is CSP-blocked on x.com, so X typography is re-implemented inside
  `x-masonry.js`.
- Test it on live x.com over CDP (no Playwright): see `HANDOFF.md` and `test/`.
  Launch Chrome with `--remote-debugging-port=9222`, then
  `node test/live-cdp-inject.js` and READ the screenshots.
- x.com is fully lazy/virtualized: images, media, and avatars only load when a
  cell enters X's viewport. Harvest waits for readiness and scrolls the
  background timeline gently so media loads before cloning.
