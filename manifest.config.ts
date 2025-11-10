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
    run_at: 'document_start',
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
