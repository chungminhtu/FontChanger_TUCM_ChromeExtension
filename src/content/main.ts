// FontChanger - Apply custom fonts and typography settings on Reddit

interface FontSettings {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
}

const DEFAULT_SETTINGS: FontSettings = {
  fontFamily: 'Lexend Deca',
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 1.5,
  letterSpacing: 0,
};

let typographyStyleElement: HTMLStyleElement | null = null;
let fontsPreloaded = false;

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

async function getSettings(): Promise<FontSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_SETTINGS, (result) => {
      resolve(result as FontSettings);
    });
  });
}

async function loadFont(fontFamily: string): Promise<void> {
  if (!document.head) return;
  
  const fontApiName = FONT_MAP[fontFamily] || FONT_MAP['Lexend Deca'];
  const fontStyleId = `fontchanger-font-style-${fontFamily.replace(/\s+/g, '-').toLowerCase()}`;
  
  // Check if font is already loaded (from preload)
  const existingStyle = document.getElementById(fontStyleId);
  if (existingStyle) {
    // Font already loaded, just wait a bit for it to be ready
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    } else {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return;
  }
  
  // Fetch CSS via background script (bypasses CSP)
  const fontUrl = `https://fonts.googleapis.com/css2?family=${fontApiName}&display=swap`;
  console.log(`[FontChanger] Loading font "${fontFamily}" from Google Fonts via background script: ${fontUrl}`);
  
  try {
    // Check if background script is available
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      throw new Error('Chrome runtime not available');
    }
    
    const response = await new Promise<{ success: boolean; css?: string; error?: string }>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ success: false, error: 'Timeout waiting for background script response (10s)' });
      }, 10000);
      
      try {
        chrome.runtime.sendMessage(
          { type: 'FETCH_FONT_CSS', fontUrl },
          (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              console.error('[FontChanger] Background script error:', chrome.runtime.lastError);
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else if (response && response.success) {
              resolve(response);
            } else {
              resolve({ success: false, error: response?.error || 'No response from background script' });
            }
          }
        );
      } catch (error) {
        clearTimeout(timeout);
        resolve({ success: false, error: error instanceof Error ? error.message : 'Unknown error sending message' });
      }
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to fetch font CSS');
    }
    
    if (!response.css) {
      throw new Error('Background script returned empty CSS');
    }
    
    // Inject CSS as style tag (bypasses CSP font-src restriction)
    const style = document.createElement('style');
    style.id = fontStyleId;
    style.textContent = response.css;
    document.head.appendChild(style);
    
    console.log(`[FontChanger] Font "${fontFamily}" loaded successfully, CSS length: ${response.css.length}`);
    
    // Wait for fonts to load
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    } else {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } catch (error) {
    console.error(`[FontChanger] Failed to load font "${fontFamily}":`, error);
    // Don't throw - allow page to continue with fallback font
  }
}

async function loadAllFonts(): Promise<void> {
  if (!document.head || fontsPreloaded) return;
  
  fontsPreloaded = true;
  console.log('[FontChanger] Preloading all fonts...');
  
  // Load all fonts upfront so switching is instant (via background script to bypass CSP)
  const loadPromises = Object.keys(FONT_MAP).map(async (fontFamily) => {
    const fontApiName = FONT_MAP[fontFamily];
    const fontStyleId = `fontchanger-font-style-${fontFamily.replace(/\s+/g, '-').toLowerCase()}`;
    
    // Check if already loaded
    const existingStyle = document.getElementById(fontStyleId);
    if (existingStyle) return;
    
    const fontUrl = `https://fonts.googleapis.com/css2?family=${fontApiName}&display=swap`;
    
    try {
      const response = await new Promise<{ success: boolean; css?: string; error?: string }>((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'FETCH_FONT_CSS', fontUrl },
          (response) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(response || { success: false, error: 'No response' });
            }
          }
        );
      });
      
      if (response.success && response.css) {
        const style = document.createElement('style');
        style.id = fontStyleId;
        style.textContent = response.css;
        document.head.appendChild(style);
      }
    } catch (error) {
      console.error(`[FontChanger] Failed to preload font "${fontFamily}":`, error);
    }
  });
  
  await Promise.all(loadPromises);
  console.log('[FontChanger] All fonts preloaded');
}

function applyTypography(settings: FontSettings): void {
  if (!document.head) return;
  
  // Remove existing typography style if it exists
  if (typographyStyleElement) {
    typographyStyleElement.remove();
  }
  
  // Create CSS to apply typography settings
  const css = `
    *,
    *::before,
    *::after {
      font-family: '${settings.fontFamily}', sans-serif !important;
      font-size: ${settings.fontSize}px !important;
      font-weight: ${settings.fontWeight} !important;
      line-height: ${settings.lineHeight} !important;
      letter-spacing: ${settings.letterSpacing}px !important;
    }
    
    input,
    textarea,
    select,
    button {
      font-family: '${settings.fontFamily}', sans-serif !important;
      font-size: ${settings.fontSize}px !important;
      font-weight: ${settings.fontWeight} !important;
      line-height: ${settings.lineHeight} !important;
      letter-spacing: ${settings.letterSpacing}px !important;
    }
  `;
  
  const style = document.createElement('style');
  style.id = 'fontchanger-typography-style';
  style.textContent = css;
  document.head.appendChild(style);
  typographyStyleElement = style;
  
  // Force a reflow to ensure font is applied
  void document.body.offsetHeight;
}

async function injectFontAndTypography(): Promise<void> {
  // Preload all fonts first (like original Lexend Deca)
  await loadAllFonts();
  
  const settings = await getSettings();
  await loadFont(settings.fontFamily);
  applyTypography(settings);
}

function expandComments() {
  const buttons = document.querySelectorAll('button');
  buttons.forEach(btn => {
    const text = (btn.textContent || '').toLowerCase();
    // Only click buttons that are clearly comment expansion buttons, not navigation
    if ((text.includes('more replies') || text.includes('view more comments') || text.includes('continue this thread')) 
        && btn instanceof HTMLElement 
        && btn.offsetParent !== null
        && btn.type !== 'submit'
        && !btn.closest('form')
        && !btn.getAttribute('href')) {
      btn.click();
    }
  });
}

function expandCollapsedComments() {
  // Find all expand buttons with button-small.button-plain.icon classes
  // Only target buttons that are clearly comment-related
  const allExpandButtons = document.querySelectorAll('button.button-small.button-plain.icon, button.button-small.button-plain[class*="icon"]');
  allExpandButtons.forEach(btn => {
    if (btn instanceof HTMLElement && btn.offsetParent !== null) {
      const isDropdown = btn.closest('[role="menu"], [role="listbox"], [data-testid*="menu"], [data-testid*="dropdown"]');
      const hasHref = btn.getAttribute('href');
      
      // Check if button is inside a comment context
      const isInComment = btn.closest('shreddit-comment, [data-testid*="comment"], .Comment, [class*="comment"]');
      
      // Check if button is in navigation/search areas (header, nav, search)
      const isInNav = btn.closest('header, nav, [role="navigation"], [data-testid*="search"], [data-testid*="header"], form[action*="search"]');
      
      // Check aria-label or text for navigation/search keywords
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      const buttonText = (btn.textContent || '').toLowerCase();
      const isSearchOrNav = ariaLabel.includes('search') || ariaLabel.includes('navigate') || 
                           buttonText.includes('search') || buttonText.includes('go to') ||
                           btn.closest('a[href*="search"]');
      
      // Only click if it's in a comment context, not in nav/search, and not a dropdown
      if (!isDropdown && !hasHref && isInComment && !isInNav && !isSearchOrNav) {
        btn.click();
      }
    }
  });
  
  // Also handle collapsed shreddit-comment elements - this is safer as it's scoped to comments
  document.querySelectorAll('shreddit-comment[collapsed], shreddit-comment[collapsed="true"]').forEach(node => {
    const btn = node.querySelector('button.button-small.button-plain') as HTMLElement;
    if (btn && btn.offsetParent !== null) {
      const isDropdown = btn.closest('[role="menu"], [role="listbox"]');
      const hasHref = btn.getAttribute('href');
      // Additional check: ensure it's not a navigation button
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      const isSearchOrNav = ariaLabel.includes('search') || ariaLabel.includes('navigate');
      
      if (!isDropdown && !hasHref && !isSearchOrNav) {
        btn.click();
      }
    }
  });
}

function removeMinHXL() {
  document.querySelectorAll('.min-h-xl').forEach(el => el.remove());
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
  // Handle regular DOM buttons
  const expandedButtons = document.querySelectorAll('button[aria-expanded="true"][aria-controls="comment-children"], button[aria-expanded="true"].button-small.button-plain.icon');
  expandedButtons.forEach(btn => {
    const parent = btn.parentElement;
    const grandparent = parent?.parentElement;
    if (grandparent && grandparent.classList.contains('contents')) {
      grandparent.remove();
    }
  });
  
  // Handle shadow DOM buttons inside shreddit-comment
  document.querySelectorAll('shreddit-comment').forEach(comment => {
    if (comment.shadowRoot) {
      const shadowButtons = comment.shadowRoot.querySelectorAll('button[aria-expanded="true"], button.button-small.button-plain.icon');
      shadowButtons.forEach(btn => {
        const parent = btn.parentElement;
        const grandparent = parent?.parentElement;
        if (grandparent && grandparent.classList.contains('contents')) {
          grandparent.remove();
        }
      });
    }
  });
}

function blockAds() {
  const selectors = ['[data-testid="ad-slot"]', '[data-testid="promoted"]', '[id*="ad"]', '[id*="promo"]', '[class*="Promoted"]', 'a[href*="/promoted/"]', 'iframe[src*="ads"]'];
  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      if (el instanceof HTMLElement) el.style.display = 'none';
    });
  });
}

function removeSeekerActionRow() {
  // Remove seeker action row elements
  document.querySelectorAll('[data-testid="seeker-action-row"]').forEach(el => {
    if (el instanceof HTMLElement) el.remove();
  });
}

function removeActionRow() {
  // Remove action row elements
  document.querySelectorAll('[data-testid="action-row"]').forEach(el => {
    if (el instanceof HTMLElement) el.remove();
  });
}

function removeAsyncLoaders() {
  // Remove shreddit-async-loader elements
  document.querySelectorAll('shreddit-async-loader').forEach(el => {
    if (el instanceof HTMLElement) el.remove();
  });
}

function runAll() {
  injectFontAndTypography();
  expandComments();
  expandCollapsedComments();
  removeExpandedComments();
  styleThreadline();
  blockAds();
  removeMinHXL();
  removeSeekerActionRow();
  removeActionRow();
  removeAsyncLoaders();
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FONT_SETTINGS_CHANGED') {
    const settings = message.settings as FontSettings;
    loadFont(settings.fontFamily).then(() => {
      applyTypography(settings);
    });
    sendResponse({ success: true });
  }
  return true;
});

window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.name === 'AbortError') e.preventDefault();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    runAll();
    setInterval(runAll, 2000);
    if (document.body) {
      new MutationObserver(runAll).observe(document.body, { childList: true, subtree: true });
    }
  });
} else {
  runAll();
  setInterval(runAll, 2000);
  if (document.body) {
    new MutationObserver(runAll).observe(document.body, { childList: true, subtree: true });
  }
}
