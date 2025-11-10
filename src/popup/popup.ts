import './style.css'
import type { FeatureKey, FeatureToggles, FontSettings } from '../shared/types'
import { DEFAULT_SETTINGS, FONTS } from '../shared/constants'
import { normalizeSettings, parseHostname, sanitizeDomains, isDomainAllowed } from '../shared/utils'

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


async function loadSettings(): Promise<FontSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_SETTINGS, (result) => {
      resolve(normalizeSettings(result as Partial<FontSettings>))
    })
  })
}

async function saveSettings(settings: FontSettings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        ...settings,
        features: { ...settings.features },
        allowedDomains: sanitizeDomains(settings.allowedDomains),
      },
      () => resolve()
    )
  })
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0])
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

async function updateSettings(settings: FontSettings): Promise<void> {
  await saveSettings(settings)
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'FONT_SETTINGS_CHANGED', settings }).catch(() => {
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
  const activeTab = await getActiveTab()

  const currentHost = parseHostname(activeTab?.url) ?? parseHostname(activeTab?.pendingUrl)
  const domainAllowed = currentHost ? isDomainAllowed(currentHost, settings.allowedDomains) : false
  const domainDisplay = currentHost ?? 'No site detected'
  const allowButtonLabel = !currentHost ? 'Unavailable' : domainAllowed ? 'Site allowed' : 'Allow this site'
  const allowButtonDisabled = !currentHost || domainAllowed
  const allowStatusText = !currentHost
    ? 'Switch to a website tab and reopen the popup to allow it.'
    : domainAllowed
      ? 'Typography applies automatically on this site.'
      : 'Add this site so typography loads here.'

  const allowedDomainsHtml = settings.allowedDomains.length > 0 ? `
    <div class="allowed-domains">
      <h3 class="allowed-domains-title">Allowed Sites</h3>
      <div class="allowed-domains-list">
        ${settings.allowedDomains.map(domain => `
          <div class="allowed-domain-item">
            <span class="allowed-domain-name">${domain}</span>
            <button type="button" class="remove-domain-btn" data-remove-domain="${domain}">×</button>
          </div>
        `).join('')}
      </div>
      ${settings.allowedDomains.length > 1 ? '<button type="button" class="clear-domains-btn" data-action="clear-domains">Remove all</button>' : ''}
    </div>` : '';

  const html = `
    <div class="header">
      <div class="extension-info">
        <span class="extension-name">${extensionName}</span>
        <span class="extension-version">v${extensionVersion}</span>
      </div>
      <div class="site-actions">
        <div class="site-actions-meta">
          <span class="site-actions-label">This site</span>
          <span class="current-domain" title="${domainDisplay}">${domainDisplay}</span>
          <span class="site-actions-hint">${allowStatusText}</span>
        </div>
        <button
          type="button"
          id="allow-domain-btn"
          ${allowButtonDisabled ? 'disabled' : ''}
          ${currentHost ? `data-domain="${currentHost}"` : ''}
        >
          ${allowButtonLabel}
        </button>
      </div>
      ${allowedDomainsHtml}
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

  const allowDomainButton = document.getElementById('allow-domain-btn') as HTMLButtonElement | null
  if (allowDomainButton && currentHost && !domainAllowed) {
    allowDomainButton.addEventListener('click', async () => {
      if (!isDomainAllowed(currentHost, settings.allowedDomains)) {
        settings.allowedDomains.push(currentHost)
        await updateSettings(settings)
        location.reload() // Reload popup to show new domain in list
      }
    })
  }

  // Handle removing individual domains
  document.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement

    const removeBtn = target.closest('.remove-domain-btn') as HTMLButtonElement
    if (removeBtn) {
      const domain = removeBtn.getAttribute('data-remove-domain')
      if (!domain) return

      settings.allowedDomains = settings.allowedDomains.filter(d => d !== domain)
      await updateSettings(settings)
      location.reload() // Reload popup to update the list
      return
    }

    const clearBtn = target.closest('.clear-domains-btn') as HTMLButtonElement
    if (clearBtn) {
      settings.allowedDomains = []
      await updateSettings(settings)
      location.reload() // Reload popup to update the list
    }
  })

  document.querySelectorAll('.feature-toggle-input').forEach((input) => {
    input.addEventListener('change', async (e) => {
      const target = e.target as HTMLInputElement
      const feature = target.dataset.feature as FeatureKey | undefined
      if (!feature) return
      settings.features[feature] = target.checked
      await updateSettings(settings)
      if (feature === 'typography') setTypographyControlsEnabled(target.checked)
    })
  })

  const fontSelect = document.getElementById('font-select') as HTMLSelectElement
  fontSelect.addEventListener('change', async () => {
    settings.fontFamily = fontSelect.value
    await updateSettings(settings)
  })

  const CONTROL_CONFIG: Record<string, { prop: keyof FontSettings; format: (v: number) => string }> = {
    'Font Size': { prop: 'fontSize', format: (v) => `${v}px` },
    'Font Weight': { prop: 'fontWeight', format: (v) => `${v}` },
    'Line Height': { prop: 'lineHeight', format: (v) => v.toFixed(1) },
    'Letter Spacing': { prop: 'letterSpacing', format: (v) => `${v}px` },
  }

  document.querySelectorAll('.btn-decrease, .btn-increase').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const control = btn.getAttribute('data-control')!
      const config = CONTROL_CONFIG[control]
      if (!config) return

      const isDecrease = btn.classList.contains('btn-decrease')
      const min = parseFloat(btn.getAttribute('data-min')!)
      const max = parseFloat(btn.getAttribute('data-max')!)
      const step = parseFloat(btn.getAttribute('data-step')!)

      let value = settings[config.prop] as number
      value = isDecrease ? Math.max(min, value - step) : Math.min(max, value + step)
      if (control === 'Line Height') value = Math.round(value * 10) / 10

      settings[config.prop] = value as never
      document.querySelector(`[data-value="${control}"]`)!.textContent = config.format(value)
      await updateSettings(settings)
    })
  })
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup)
} else {
  initPopup()
}

