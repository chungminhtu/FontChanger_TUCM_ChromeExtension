// FontChanger - Apply Lexend Deca font and auto-expand comments on Reddit

let fontInjected = false;

async function injectFont() {
  if (fontInjected || document.getElementById('fontchanger-lexend-deca')) return;
  if (!document.head) return;
  
  try {
    // Fetch Google Fonts CSS and inject as inline to bypass CSP
    const fontResponse = await fetch('https://fonts.googleapis.com/css2?family=Lexend+Deca:wght@100..900&display=swap');
    const fontCss = await fontResponse.text();
    
    // Fetch custom CSS
    const cssUrl = chrome.runtime.getURL('src/content/style.css');
    const customResponse = await fetch(cssUrl);
    const customCss = await customResponse.text();
    
    const style = document.createElement('style');
    style.id = 'fontchanger-lexend-deca';
    style.textContent = fontCss + '\n' + customCss;
    document.head.appendChild(style);
    fontInjected = true;
  } catch (error) {
    // Fallback: just inject custom CSS
    const cssUrl = chrome.runtime.getURL('src/content/style.css');
    const response = await fetch(cssUrl);
    const cssText = await response.text();
    const style = document.createElement('style');
    style.id = 'fontchanger-lexend-deca';
    style.textContent = cssText;
    document.head.appendChild(style);
    fontInjected = true;
  }
}

function expandComments() {
  const buttons = document.querySelectorAll('button, a');
  buttons.forEach(btn => {
    const text = (btn.textContent || '').toLowerCase();
    if ((text.includes('more replies') || text.includes('view more comments') || text.includes('continue this thread')) && btn instanceof HTMLElement && btn.offsetParent !== null) {
      btn.click();
    }
  });
}

function expandCollapsedComments() {
  // Find all expand buttons with button-small.button-plain.icon classes
  const allExpandButtons = document.querySelectorAll('button.button-small.button-plain.icon, button.button-small.button-plain[class*="icon"]');
  allExpandButtons.forEach(btn => {
    if (btn instanceof HTMLElement && btn.offsetParent !== null) {
      const isDropdown = btn.closest('[role="menu"], [role="listbox"], [data-testid*="menu"], [data-testid*="dropdown"]');
      if (!isDropdown) btn.click();
    }
  });
  
  // Also handle collapsed shreddit-comment elements
  document.querySelectorAll('shreddit-comment[collapsed], shreddit-comment[collapsed="true"]').forEach(node => {
    const btn = node.querySelector('button.button-small.button-plain') as HTMLElement;
    if (btn && btn.offsetParent !== null) {
      const isDropdown = btn.closest('[role="menu"], [role="listbox"]');
      if (!isDropdown) btn.click();
    }
  });
}

function removeMinHXL() {
  document.querySelectorAll('.min-h-xl').forEach(el => el.remove());
}

function blockAds() {
  const selectors = ['[data-testid="ad-slot"]', '[data-testid="promoted"]', '[id*="ad"]', '[id*="promo"]', '[class*="Promoted"]', 'a[href*="/promoted/"]', 'iframe[src*="ads"]'];
  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      if (el instanceof HTMLElement) el.style.display = 'none';
    });
  });
}

function runAll() {
  injectFont();
  expandComments();
  expandCollapsedComments();
  blockAds();
  removeMinHXL();
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
