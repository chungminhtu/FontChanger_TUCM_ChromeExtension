import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: pkg.name,
  version: pkg.version,
  icons: {
    48: 'public/logo.png',
  },
  action: {
    default_icon: {
      48: 'public/logo.png',
    },
    default_popup: 'src/popup/popup.html',
  },
  background: {
    service_worker: 'src/background.ts',
  },
  content_scripts: [{
    js: ['src/content/main.ts'],
    matches: ['https://*/*', 'http://*/*'],
    // X/Twitter typography is owned by public/x-masonry.js (+ x.css); main.ts is
    // CSP-blocked there and its storage read only logged a benign warning. Skip it.
    exclude_matches: ['https://x.com/*', 'https://twitter.com/*'],
    run_at: 'document_start',
  }, {
    // Static CSS (browser-injected, bypasses X's strict CSP which blocks the JS above).
    css: ['src/content/x.css'],
    matches: ['https://x.com/*', 'https://twitter.com/*'],
    run_at: 'document_start',
  }, {
    // Plain classic JS from public/ (not bundled as a module) so it runs under
    // X's strict CSP: clone-based masonry reader with infinite scroll.
    js: ['public/x-masonry.js'],
    matches: ['https://x.com/*', 'https://twitter.com/*'],
    run_at: 'document_idle',
  }],
  permissions: [
    'storage',
    'tabs',
  ],
  host_permissions: [
    'https://fonts.googleapis.com/*',
    'https://fonts.gstatic.com/*',
  ],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
})
