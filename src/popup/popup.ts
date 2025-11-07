import './style.css'

interface FontSettings {
  fontFamily: string
  fontSize: number
  fontWeight: number
  lineHeight: number
  letterSpacing: number
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

const DEFAULT_SETTINGS: FontSettings = {
  fontFamily: 'Lexend Deca',
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 1.5,
  letterSpacing: 0,
}

async function loadSettings(): Promise<FontSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_SETTINGS, (result) => {
      resolve(result as FontSettings)
    })
  })
}

async function saveSettings(settings: FontSettings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(settings, () => {
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
  format: (val: number) => string,
  onChange: (val: number) => void
): string {
  return `
    <div class="control-group">
      <label>${label}</label>
      <div class="control-row">
        <button type="button" class="btn-decrease" data-control="${label}" data-min="${min}" data-max="${max}" data-step="${step}">-</button>
        <span class="control-value" data-value="${label}">${format(value)}</span>
        <button type="button" class="btn-increase" data-control="${label}" data-min="${min}" data-max="${max}" data-step="${step}">+</button>
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
      <select id="font-select">${options}</select>
    </div>
  `
}

function notifyContentScript(settings: FontSettings): void {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'FONT_SETTINGS_CHANGED', settings }).catch(() => {
        // Ignore errors if content script is not ready
      })
    }
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
    ${createFontSelect(settings.fontFamily)}
    ${createControlRow('Font Size', settings.fontSize, 0, 100, 1, (v) => `${v}px`, (v) => {
      settings.fontSize = v
      saveSettings(settings)
    })}
    ${createControlRow('Font Weight', settings.fontWeight, 100, 900, 100, (v) => `${v}`, (v) => {
      settings.fontWeight = v
      saveSettings(settings)
    })}
    ${createControlRow('Line Height', settings.lineHeight, 1.0, 2.5, 0.1, (v) => v.toFixed(1), (v) => {
      settings.lineHeight = v
      saveSettings(settings)
    })}
    ${createControlRow('Letter Spacing', settings.letterSpacing, -2, 5, 0.5, (v) => `${v}px`, (v) => {
      settings.letterSpacing = v
      saveSettings(settings)
    })}
  `

  document.querySelector('#app')!.innerHTML = html

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

