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

// Map font names to Google Fonts API names
const FONT_MAP: Record<string, string> = {
  'Lexend Deca': 'Lexend+Deca',
  'Poppins': 'Poppins',
  'Outfit': 'Outfit',
  'Urbanist': 'Urbanist',
  'Figtree': 'Figtree',
  'Plus Jakarta Sans': 'Plus+Jakarta+Sans',
  'DM Sans': 'DM+Sans',
  'Manrope': 'Manrope',
  'Rubik': 'Rubik',
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
  const cacheKey = `fontchanger_${fontFamily.replace(/\s+/g, '_').toLowerCase()}_css`;
  
  // Check if font style already exists
  const existingStyle = document.getElementById('fontchanger-font-style');
  if (existingStyle) {
    existingStyle.remove();
  }
  
  try {
    // Check cache in chrome.storage
    const cached = await new Promise<string | null>((resolve) => {
      chrome.storage.local.get([cacheKey], (result) => {
        resolve(result[cacheKey] || null);
      });
    });
    
    let fontCss = cached;
    
    if (!fontCss) {
      // Fetch Google Fonts CSS
      const fontUrl = `https://fonts.googleapis.com/css2?family=${fontApiName}:wght@100..900&display=swap`;
      const fontResponse = await fetch(fontUrl);
      if (!fontResponse.ok) throw new Error('Font fetch failed');
      fontCss = await fontResponse.text();
      
      // Cache it
      chrome.storage.local.set({ [cacheKey]: fontCss });
    }
    
    // Inject Google Fonts CSS
    const style = document.createElement('style');
    style.id = 'fontchanger-font-style';
    style.textContent = fontCss;
    document.head.appendChild(style);
    
    // Wait for fonts to load
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    } else {
      // Fallback: wait a bit for fonts to load
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch (error) {
    console.error('Failed to load font:', error);
    // Try to use cached version if fetch fails
    const cached = await new Promise<string | null>((resolve) => {
      chrome.storage.local.get([cacheKey], (result) => {
        resolve(result[cacheKey] || null);
      });
    });
    
    if (cached) {
      const style = document.createElement('style');
      style.id = 'fontchanger-font-style';
      style.textContent = cached;
      document.head.appendChild(style);
      
      // Wait for fonts to load
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      } else {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
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
