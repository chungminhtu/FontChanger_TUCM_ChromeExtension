import './style.css'

type FeatureKey =
  | 'typography'
  | 'expandComments'
  | 'expandCollapsedComments'
  | 'removeExpandedComments'
  | 'styleThreadline'
  | 'blockAds'
  | 'removeMinHXL'
  | 'removeStaticRows'

type FeatureToggles = Record<FeatureKey, boolean>

interface FontSettings {
  fontFamily: string
  fontSize: number
  fontWeight: number
  lineHeight: number
  letterSpacing: number
  features: FeatureToggles
}

const FONTS = [
  'Lexend Deca',
  'Poppins',
  'Outfit',
  'Urbanist',
  'Figtree',
  'Plus Jakarta Sans',
  'DM Sans',
  'Manrope',
  'Rubik',
]

const DEFAULT_FEATURES: FeatureToggles = {
  typography: true,
  expandComments: true,
  expandCollapsedComments: true,
  removeExpandedComments: true,
  styleThreadline: true,
  blockAds: true,
  removeMinHXL: true,
  removeStaticRows: true,
}

const DEFAULT_SETTINGS: FontSettings = {
  fontFamily: 'Lexend Deca',
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 1.5,
  letterSpacing: 0,
  features: { ...DEFAULT_FEATURES },
}

const FEATURE_INFO: Array<{ key: FeatureKey; label: string; description?: string }> = [
  { key: 'typography', label: 'Typography override', description: 'Apply custom font, size, weight, line height, and spacing' },
  { key: 'expandComments', label: 'Expand “more replies” buttons' },
  { key: 'expandCollapsedComments', label: 'Uncollapse hidden comments' },
  { key: 'removeExpandedComments', label: 'Remove empty “expanded” rows' },
  { key: 'styleThreadline', label: 'Tighten comment threadlines' },
  { key: 'blockAds', label: 'Hide promoted posts and ads' },
  { key: 'removeMinHXL', label: 'Remove tall spacer rows' },
  { key: 'removeStaticRows', label: 'Remove seeker/action rows' },
]

function normalizeSettings(raw: Partial<FontSettings>): FontSettings {
  const features: FeatureToggles = {
    ...DEFAULT_FEATURES,
    ...(raw.features ?? {}),
  }

  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    features,
  }
}

async function loadSettings(): Promise<FontSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_SETTINGS, (result) => {
      resolve(normalizeSettings(result as Partial<FontSettings>))
    })
  })
}

async function saveSettings(settings: FontSettings): Promise<void> {
  return new Promise((resolve) => {
    const payload: FontSettings = {
      ...settings,
      features: { ...settings.features },
    }

    chrome.storage.local.set(payload, () => {
      resolve()
    })
  })
}

function createControlRow(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  format: (val: number) => string
): string {
  return `
    <div class="control-group">
      <label>${label}</label>
      <div class="control-row">
        <button type="button" class="btn-decrease" data-control="${label}" data-min="${min}" data-max="${max}" data-step="${step}" data-typography-control="true">-</button>
        <span class="control-value" data-value="${label}" data-typography-display="true">${format(value)}</span>
        <button type="button" class="btn-increase" data-control="${label}" data-min="${min}" data-max="${max}" data-step="${step}" data-typography-control="true">+</button>
      </div>
    </div>
  `
}

function createFontSelect(currentFont: string): string {
  const options = FONTS.map(
    (font) => `<option value="${font}" ${font === currentFont ? 'selected' : ''}>${font}</option>`
  ).join('')
  return `
    <div class="control-group">
      <label>Font Family</label>
      <select id="font-select" data-typography-control="true">${options}</select>
    </div>
  `
}

function createFeatureToggleList(features: FeatureToggles): string {
  const items = FEATURE_INFO.map(({ key, label, description }) => {
    const checked = features[key] ? 'checked' : ''
    const desc = description ? `<span class="toggle-description">${description}</span>` : ''
    return `
      <label class="feature-toggle">
        <input type="checkbox" class="feature-toggle-input" data-feature="${key}" ${checked} />
        <span class="feature-toggle-label">
          <span class="feature-toggle-title">${label}</span>
          ${desc}
        </span>
      </label>
    `
  }).join('')

  return `
    <div class="feature-section">
      <h2 class="section-title">Features</h2>
      <div class="feature-list">${items}</div>
    </div>
  `
}

function notifyContentScript(settings: FontSettings): void {
  const payload = normalizeSettings(settings)
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'FONT_SETTINGS_CHANGED', settings: payload }).catch(() => {
        // Ignore errors if content script is not ready
      })
    }
  })
}

function setTypographyControlsEnabled(enabled: boolean): void {
  document.querySelectorAll('[data-typography-control]').forEach((el) => {
    if ('disabled' in el) {
      ;(el as HTMLInputElement | HTMLButtonElement | HTMLSelectElement).disabled = !enabled
    }
  })

  document.querySelectorAll('[data-typography-section]').forEach((section) => {
    section.classList.toggle('is-disabled', !enabled)
  })

  document.querySelectorAll('[data-typography-display]').forEach((el) => {
    el.classList.toggle('is-disabled', !enabled)
  })
}

async function initPopup() {
  const settings = await loadSettings()
  const manifest = chrome.runtime.getManifest()
  const extensionName = manifest.name || 'Font Changer'
  const extensionVersion = manifest.version || '1.0.0'

  const html = `
    <div class="header">
      <div class="extension-info">
        <span class="extension-name">${extensionName}</span>
        <span class="extension-version">v${extensionVersion}</span>
      </div>
    </div>
    <div class="layout">
      <section class="layout-column features-column">
        ${createFeatureToggleList(settings.features)}
      </section>
      <section class="layout-column typography-section" data-typography-section="true">
        <h2 class="section-title">Typography</h2>
        ${createFontSelect(settings.fontFamily)}
        ${createControlRow('Font Size', settings.fontSize, 0, 100, 1, (v) => `${v}px`)}
        ${createControlRow('Font Weight', settings.fontWeight, 100, 900, 100, (v) => `${v}`)}
        ${createControlRow('Line Height', settings.lineHeight, 1.0, 2.5, 0.1, (v) => v.toFixed(1))}
        ${createControlRow('Letter Spacing', settings.letterSpacing, -2, 5, 0.5, (v) => `${v}px`)}
      </section>
    </div>
  `

  document.querySelector('#app')!.innerHTML = html

  setTypographyControlsEnabled(settings.features.typography)

  // Feature toggle handlers
  document.querySelectorAll('.feature-toggle-input').forEach((input) => {
    input.addEventListener('change', async (e) => {
      const target = e.target as HTMLInputElement
      const feature = target.dataset.feature as FeatureKey | undefined
      if (!feature) return

      settings.features[feature] = target.checked
      await saveSettings(settings)
      notifyContentScript(settings)

      if (feature === 'typography') {
        setTypographyControlsEnabled(target.checked)
      }
    })
  })

  // Font select handler
  const fontSelect = document.getElementById('font-select') as HTMLSelectElement
  fontSelect.addEventListener('change', async (e) => {
    const target = e.target as HTMLSelectElement
    settings.fontFamily = target.value
    await saveSettings(settings)
    notifyContentScript(settings)
  })

  // Button handlers
  document.querySelectorAll('.btn-decrease, .btn-increase').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement
      const control = target.getAttribute('data-control')!
      const isDecrease = target.classList.contains('btn-decrease')
      const valueEl = document.querySelector(`[data-value="${control}"]`) as HTMLElement
      const min = parseFloat(target.getAttribute('data-min')!)
      const max = parseFloat(target.getAttribute('data-max')!)
      const step = parseFloat(target.getAttribute('data-step')!)

      let value: number
      let format: (v: number) => string

      if (control === 'Font Size') {
        value = settings.fontSize
        value = isDecrease ? Math.max(min, value - step) : Math.min(max, value + step)
        format = (v) => `${v}px`
        settings.fontSize = value
      } else if (control === 'Font Weight') {
        value = settings.fontWeight
        value = isDecrease ? Math.max(min, value - step) : Math.min(max, value + step)
        format = (v) => `${v}`
        settings.fontWeight = value
      } else if (control === 'Line Height') {
        value = settings.lineHeight
        value = isDecrease ? Math.max(min, value - step) : Math.min(max, value + step)
        value = Math.round(value * 10) / 10
        format = (v) => v.toFixed(1)
        settings.lineHeight = value
      } else if (control === 'Letter Spacing') {
        value = settings.letterSpacing
        value = isDecrease ? Math.max(min, value - step) : Math.min(max, value + step)
        format = (v) => `${v}px`
        settings.letterSpacing = value
      } else {
        return
      }

      valueEl.textContent = format(value)
      await saveSettings(settings)
      notifyContentScript(settings)
    })
  })
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup)
} else {
  initPopup()
}

