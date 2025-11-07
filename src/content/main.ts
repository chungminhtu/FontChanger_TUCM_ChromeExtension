// FontChanger - Apply Lexend Deca font and auto-expand comments on Reddit

let fontInjected = false;
const FONT_CSS_CACHE_KEY = 'fontchanger_lexend_deca_css';

async function injectFont() {
  if (fontInjected || document.getElementById('fontchanger-lexend-deca')) return;
  if (!document.head) return;
  
  try {
    // Check cache first
    let fontCss = localStorage.getItem(FONT_CSS_CACHE_KEY);
    
    if (!fontCss) {
      // Fetch Google Fonts CSS and cache it
      const fontResponse = await fetch('https://fonts.googleapis.com/css2?family=Lexend+Deca:wght@100..900&display=swap');
      if (!fontResponse.ok) throw new Error('Font fetch failed');
      fontCss = await fontResponse.text();
      localStorage.setItem(FONT_CSS_CACHE_KEY, fontCss);
    }
    
    // Inject Google Fonts CSS (custom CSS is loaded via manifest)
    const style = document.createElement('style');
    style.id = 'fontchanger-lexend-deca';
    style.textContent = fontCss;
    document.head.appendChild(style);
    fontInjected = true;
  } catch (error) {
    // Try to use cached version if fetch fails
    const cachedCss = localStorage.getItem(FONT_CSS_CACHE_KEY);
    if (cachedCss) {
      const style = document.createElement('style');
      style.id = 'fontchanger-lexend-deca';
      style.textContent = cachedCss;
      document.head.appendChild(style);
      fontInjected = true;
    }
  }
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
  injectFont();
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
