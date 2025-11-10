// FontChanger - Apply custom fonts and typography settings on Reddit

import type { FeatureKey, FeatureToggles, FontSettings } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/constants'
import { normalizeSettings, isDomainAllowed } from '../shared/utils'

let typographyStyleElement: HTMLStyleElement | null = null;
let fontsPreloaded = false;

const FONT_FALLBACK = 'Lexend Deca';
const REQUEST_TIMEOUT_MS = 10_000;

// Map font names to Google Fonts API names
const FONT_MAP: Record<string, string> = {
  'Lexend Deca': 'Lexend+Deca:wght@100..900',
  'Poppins': 'Poppins:wght@100;200;300;400;500;600;700;800;900',
  'Outfit': 'Outfit:wght@100..900',
  'Urbanist': 'Urbanist:wght@100..900',
  'Figtree': 'Figtree:wght@300..900',
  'Plus Jakarta Sans': 'Plus+Jakarta+Sans:wght@200..800',
  'DM Sans': 'DM+Sans:wght@400;500;600;700',
  'Manrope': 'Manrope:wght@200..800',
  'Rubik': 'Rubik:wght@300..900',
};

const COMMENT_EXPANSION_TEXTS = ['more replies', 'view more comments', 'continue this thread'];
const COMMENT_BUTTON_SELECTOR = 'shreddit-comment, [data-testid*="comment"], .Comment, [class*="comment"]';
const DROPDOWN_SELECTOR = '[role="menu"], [role="listbox"], [data-testid*="menu"], [data-testid*="dropdown"]';
const NAVIGATION_SELECTOR = 'header, nav, [role="navigation"], [data-testid*="search"], [data-testid*="header"], form[action*="search"]';
const AD_SELECTORS = ['[data-testid="ad-slot"]', '[data-testid="promoted"]', '[id*="ad"]', '[id*="promo"]', '[class*="Promoted"]', 'a[href*="/promoted/"]', 'iframe[src*="ads"]'];
const STATIC_REMOVAL_SELECTORS = ['[data-testid="seeker-action-row"]', '[data-testid="action-row"]'];

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function getFontQuery(fontFamily: string): string {
  return FONT_MAP[fontFamily] || FONT_MAP[FONT_FALLBACK];
}

function getFontStyleId(fontFamily: string): string {
  return `fontchanger-font-style-${fontFamily.replace(/\s+/g, '-').toLowerCase()}`;
}

async function waitForFontsReady(): Promise<void> {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  } else {
    await delay(100);
  }
}

async function fetchFontCss(fontUrl: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<string> {
  if (!chrome.runtime?.sendMessage) {
    throw new Error('Chrome runtime not available');
  }

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for background script response (${timeoutMs}ms)`));
    }, timeoutMs);

    chrome.runtime.sendMessage(
      { type: 'FETCH_FONT_CSS', fontUrl },
      (response) => {
        clearTimeout(timeout);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.success || !response.css) {
          reject(new Error(response?.error || 'No CSS received from background script'));
          return;
        }

        resolve(response.css);
      }
    );
  });
}


async function getSettings(): Promise<FontSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_SETTINGS, (result) => {
      resolve(normalizeSettings(result as Partial<FontSettings>));
    });
  });
}

async function loadFont(fontFamily: string): Promise<void> {
  if (!document.head) return;

  const fontStyleId = getFontStyleId(fontFamily);
  const existingStyle = document.getElementById(fontStyleId);
  if (existingStyle) {
    await waitForFontsReady();
    return;
  }

  const fontUrl = `https://fonts.googleapis.com/css2?family=${getFontQuery(fontFamily)}&display=swap`;
  console.log(`[FontChanger] Loading font "${fontFamily}" from Google Fonts via background script: ${fontUrl}`);

  try {
    const css = await fetchFontCss(fontUrl);
    const style = document.createElement('style');
    style.id = fontStyleId;
    style.textContent = css;
    document.head.appendChild(style);

    console.log(`[FontChanger] Font "${fontFamily}" loaded successfully, CSS length: ${css.length}`);
    await waitForFontsReady();
  } catch (error) {
    console.error(`[FontChanger] Failed to load font "${fontFamily}":`, error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function loadAllFonts(): Promise<void> {
  if (!document.head || fontsPreloaded) return;

  fontsPreloaded = true;
  console.log('[FontChanger] Preloading all fonts...');

  await Promise.all(
    Object.keys(FONT_MAP).map(async (fontFamily) => {
      const fontStyleId = getFontStyleId(fontFamily);
      if (document.getElementById(fontStyleId)) return;

      const fontUrl = `https://fonts.googleapis.com/css2?family=${getFontQuery(fontFamily)}&display=swap`;

      try {
        const css = await fetchFontCss(fontUrl);
        const style = document.createElement('style');
        style.id = fontStyleId;
        style.textContent = css;
        document.head?.appendChild(style);
      } catch (error) {
        console.error(`[FontChanger] Failed to preload font "${fontFamily}":`, error);
      }
    })
  );

  console.log('[FontChanger] All fonts preloaded');
}

function clearTypography(): void {
  // Remove the tracked element if it exists
  typographyStyleElement?.remove();
  typographyStyleElement = null;
  
  // Also remove by ID in case the reference was lost (e.g., page reload)
  if (document.head) {
    const existingStyle = document.getElementById('fontchanger-typography-style');
    if (existingStyle) {
      existingStyle.remove();
    }
  }
}

function applyTypography(settings: FontSettings): void {
  if (!document.head) return;

  clearTypography();

  const css = `
    :root {
      --fontchanger-font-family: '${settings.fontFamily}', sans-serif;
      --fontchanger-font-size: ${settings.fontSize}px;
      --fontchanger-font-weight: ${settings.fontWeight};
      --fontchanger-line-height: ${settings.lineHeight};
      --fontchanger-letter-spacing: ${settings.letterSpacing}px;
    }

    body {
      font-family: var(--fontchanger-font-family) !important;
      font-size: var(--fontchanger-font-size) !important;
      font-weight: var(--fontchanger-font-weight) !important;
      line-height: var(--fontchanger-line-height) !important;
      letter-spacing: var(--fontchanger-letter-spacing) !important;
    }

    body *,
    body *::before,
    body *::after {
      font-family: var(--fontchanger-font-family) !important;
      line-height: var(--fontchanger-line-height) !important;
      letter-spacing: var(--fontchanger-letter-spacing) !important;
    }

    body input,
    body textarea,
    body select,
    body button {
      font-size: var(--fontchanger-font-size) !important;
      font-weight: var(--fontchanger-font-weight) !important;
    }
  `;
  
  const style = document.createElement('style');
  style.id = 'fontchanger-typography-style';
  style.textContent = css;
  document.head.appendChild(style);
  typographyStyleElement = style;

  void document.body.offsetHeight;
}

function expandComments() {
  document.querySelectorAll('button').forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    if (btn.offsetParent === null) return;
    if (btn.type === 'submit' || btn.closest('form') || btn.getAttribute('href')) return;

    const text = (btn.textContent || '').toLowerCase().trim();
    if (!COMMENT_EXPANSION_TEXTS.some((needle) => text.includes(needle))) return;

    btn.click();
  });
}

function expandCollapsedComments() {
  const shouldClickButton = (btn: HTMLElement): boolean => {
    if (btn.offsetParent === null) return false;
    if (btn.getAttribute('href')) return false;
    if (!btn.closest(COMMENT_BUTTON_SELECTOR)) return false;
    if (btn.closest(DROPDOWN_SELECTOR)) return false;

    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    const buttonText = (btn.textContent || '').toLowerCase();
    const isSearchOrNav =
      ariaLabel.includes('search') ||
      ariaLabel.includes('navigate') ||
      buttonText.includes('search') ||
      buttonText.includes('go to') ||
      Boolean(btn.closest('a[href*="search"]')) ||
      Boolean(btn.closest(NAVIGATION_SELECTOR));

    return !isSearchOrNav;
  };

  document
    .querySelectorAll('button.button-small.button-plain.icon, button.button-small.button-plain[class*="icon"]')
    .forEach((button) => {
      if (button instanceof HTMLElement && shouldClickButton(button)) {
        button.click();
      }
    });

  document
    .querySelectorAll('shreddit-comment[collapsed], shreddit-comment[collapsed="true"]')
    .forEach((node) => {
      const button = node.querySelector('button.button-small.button-plain');
      if (button instanceof HTMLElement && shouldClickButton(button)) {
        button.click();
      }
    });
}

function removeMinHXL() {
  document.querySelectorAll('.min-h-xl').forEach((el) => {
    if (el instanceof HTMLElement) {
      el.remove();
    }
  });
}

function styleThreadline() {
  document.querySelectorAll('shreddit-comment').forEach(comment => {
    if (comment.shadowRoot) {
      const threadlines = comment.shadowRoot.querySelectorAll('.threadline');
      threadlines.forEach(el => {
        if (el instanceof HTMLElement) {
          el.style.marginLeft = '6px';
        }
      });
    }
  });
}

function removeExpandedComments() {
  const removeContents = (root: ParentNode) => {
    root
      .querySelectorAll('button[aria-expanded="true"][aria-controls="comment-children"], button[aria-expanded="true"].button-small.button-plain.icon')
      .forEach((btn) => {
        const parent = btn.parentElement;
        const grandparent = parent?.parentElement;
        if (grandparent?.classList.contains('contents')) {
          grandparent.remove();
        }
      });
  };

  removeContents(document);

  document.querySelectorAll('shreddit-comment').forEach((comment) => {
    if (comment.shadowRoot) {
      removeContents(comment.shadowRoot);
    }
  });
}

function blockAds() {
  AD_SELECTORS.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      if (el instanceof HTMLElement) {
        el.style.display = 'none';
      }
    });
  });
}

function removeStaticRows() {
  STATIC_REMOVAL_SELECTORS.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      if (el instanceof HTMLElement) {
        el.remove();
      }
    });
  });
}

type DomFeatureKey = Exclude<FeatureKey, 'typography'>;

const DOM_TASKS: Record<DomFeatureKey, () => void> = {
  expandComments,
  expandCollapsedComments,
  removeExpandedComments,
  styleThreadline,
  blockAds,
  removeMinHXL,
  removeStaticRows,
};

function runDomTasks(features: FeatureToggles): void {
  (Object.entries(DOM_TASKS) as Array<[DomFeatureKey, () => void]>).forEach(([key, task]) => {
    if (!features[key]) return;

    try {
      task();
    } catch (error) {
      console.error(`[FontChanger] Task ${task.name || key} failed:`, error);
    }
  });
}

function injectRedditCSS(): void {
  // Only inject if not already present
  if (document.getElementById('fontchanger-reddit-css')) return;

  const css = `
    .main-container,
    .main-container.fixed-sidebar,
    .main-container[class*="fixed-sidebar"] {
      grid-template-columns: 1fr 316px !important;
      border: none !important;
    }

    .main-container.flex-sidebar,
    .main-container[class*="flex-sidebar"] {
      grid-template-columns: 1fr auto !important;
      border: none !important;
    }

    main#main-content {
      max-width: none !important;
      width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    main#main-content *[class*="max-w"] {
      max-width: none !important;
    }

    #subgrid-container {
      max-width: none !important;
      width: 100% !important;
      margin: 0 !important;
      padding-left: 20px !important;
      padding-right: 0 !important;
      border: none !important;
    }

    [data-testid="ad-slot"],
    [data-testid="promoted"],
    [id*="ad"],
    [id*="promo"],
    [class*="Promoted"],
    [class*="promoted"],
    [class*="Ad"],
    a[href*="/promoted/"],
    iframe[src*="ads"],
    iframe[src*="doubleclick"] {
      display: none !important;
    }
  `;

  const style = document.createElement('style');
  style.id = 'fontchanger-reddit-css';
  style.textContent = css;
  document.head?.appendChild(style);
}

async function applyEnhancements(): Promise<void> {
  const currentHost = window.location.hostname.toLowerCase()
  const settings = await getSettings()
  const isAllowedDomain = isDomainAllowed(currentHost, settings.allowedDomains)
  const isRedditDomain = /(^|\.)reddit\.com$/i.test(currentHost)

  if (!isAllowedDomain) {
    clearTypography()
    return
  }

  if (settings.features.typography) {
    try {
      await loadAllFonts();
      await loadFont(settings.fontFamily);
      applyTypography(settings);
    } catch (error) {
      console.error('[FontChanger] Failed to apply typography settings:', error);
      clearTypography();
    }
  } else {
    clearTypography();
  }

  if (isRedditDomain) {
    runDomTasks(settings.features);
    // Inject Reddit-specific CSS only on Reddit domains
    injectRedditCSS();
  }
}

let activeRun: Promise<void> | null = null;
let rerunRequested = false;

function queueEnhancements(): void {
  if (activeRun) {
    rerunRequested = true;
    return;
  }

  rerunRequested = false;
  activeRun = applyEnhancements()
    .catch((error) => {
      console.error('[FontChanger] Enhancement pipeline failed:', error);
    })
    .finally(() => {
      activeRun = null;
      if (rerunRequested) {
        queueEnhancements();
      }
    });
}

function onReady(callback: () => void): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback, { once: true });
  } else {
    callback();
  }
}

function startObservers(): void {
  const schedule = () => queueEnhancements();

  setInterval(schedule, 2000);

  if (document.body) {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }
}

// Early check - don't run anything if domain list is empty (first install)
;(async () => {
  const currentHost = window.location.hostname.toLowerCase()
  const settings = await getSettings()
  
  // If domain is not allowed, clear and stop
  if (!isDomainAllowed(currentHost, settings.allowedDomains)) {
    clearTypography()
    return
  }
  
  // Only start if domain is allowed
  onReady(() => {
    clearTypography()
    queueEnhancements()
    startObservers()
  })
})()

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FONT_SETTINGS_CHANGED') {
    const incoming = normalizeSettings(message.settings as Partial<FontSettings>)

    ;(async () => {
      try {
        const currentHost = window.location.hostname.toLowerCase()
        if (!isDomainAllowed(currentHost, incoming.allowedDomains) || !incoming.features.typography) {
          clearTypography()
        }
        queueEnhancements()
        sendResponse({ success: true })
      } catch (error) {
        console.error('[FontChanger] Failed to apply font settings from popup:', error)
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()

    return true
  }
  return false
})

window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.name === 'AbortError') e.preventDefault();
});
