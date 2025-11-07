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
    default_popup: 'src/popup/index.html',
  },
  content_scripts: [{
    js: ['src/content/main.ts'],
    matches: ['https://www.reddit.com/*'],
    run_at: 'document_start',
  }],
  permissions: [
    'sidePanel',
    'contentSettings',
  ],
  web_accessible_resources: [{
    resources: ['src/content/style.css'],
    matches: ['https://www.reddit.com/*'],
  }],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
})
