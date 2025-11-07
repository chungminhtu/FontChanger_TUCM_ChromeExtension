// FontChanger - Apply Lexend Deca font and auto-expand comments on Reddit

let fontInjected = false;

const CSS = `
  @font-face {
    font-family: 'Lexend Deca';
    font-style: normal;
    font-weight: 100 900;
    font-display: swap;
    src: url(https://fonts.gstatic.com/s/lexenddeca/v26/K2FifZFYk-dHSE0UPPuwQ7CrD94i-NCKm-U48MxwKln2gEU4.woff2) format('woff2');
    unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
  }
  html { font-size: 120% !important; }
  *, *::before, *::after { font-family: 'Lexend Deca', sans-serif !important; }
  input, textarea, select, button { font-family: 'Lexend Deca', sans-serif !important; }
  .main-container, .main-container.fixed-sidebar, .main-container[class*="fixed-sidebar"] {
    grid-template-columns: 1fr 316px !important;
    border: none !important;
  }
  .main-container.flex-sidebar, .main-container[class*="flex-sidebar"] {
    grid-template-columns: 1fr auto !important;
    border: none !important;
  }
  main#main-content { max-width: none !important; width: 100% !important; margin: 0 !important; padding: 0 !important; }
  main#main-content *[class*="max-w"] { max-width: none !important; }
  #subgrid-container {
    max-width: none !important;
    width: 100% !important;
    margin: 0 !important;
    padding-left: 20px !important;
    padding-right: 0 !important;
    border: none !important;
  }
  [data-testid="ad-slot"], [data-testid="promoted"], [id*="ad"], [id*="promo"],
  [class*="Promoted"], [class*="promoted"], [class*="Ad"], a[href*="/promoted/"],
  iframe[src*="ads"], iframe[src*="doubleclick"] {
    display: none !important;
  }
`;

function injectFont() {
  if (fontInjected || document.getElementById('fontchanger-lexend-deca')) return;
  if (!document.head) return;
  
  const style = document.createElement('style');
  style.id = 'fontchanger-lexend-deca';
  style.textContent = CSS;
  document.head.appendChild(style);
  fontInjected = true;
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
  const comments = document.querySelectorAll('[data-testid="comment"], shreddit-comment');
  comments.forEach(comment => {
    const buttons = comment.querySelectorAll('button.button-small.button-plain');
    buttons.forEach(btn => {
      if (btn instanceof HTMLElement && btn.offsetParent !== null) {
        const isDropdown = btn.closest('[role="menu"], [role="listbox"]');
        if (!isDropdown) btn.click();
      }
    });
  });
  
  document.querySelectorAll('shreddit-comment[collapsed]').forEach(node => {
    const btn = node.querySelector('button.button-small.button-plain') as HTMLElement;
    if (btn && btn.offsetParent !== null) btn.click();
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
