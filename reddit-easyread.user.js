// ==UserScript==
// @name         Reddit Lexend Easy Reader
// @namespace    https://tucm.dev/
// @version      1.0
// @description  Apply Lexend Deca and strip clutter from Reddit for easier reading.
// @author       TUCM
// @match        https://www.reddit.com/*
// @match        https://old.reddit.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const STYLE_ID = 'reddit-lexend-easy-reader-style';

  const cssHiddenSelectors = [
    'header[role="banner"]',
    '#SHORTCUT_FOCUSABLE_DIV > div > header',
    'nav[role="navigation"]',
    '[data-testid="right-rail"]',
    '[data-testid="frontpage-sidebar"]',
    '[data-testid="subreddit-sidebar"]',
    '[data-testid="comment-sidebar"]',
    '[data-testid="content-hub"]',
    '[data-testid="left-sidebar"]',
    '[data-testid="bottom-bar"]',
    '[data-testid="ad-slot"]',
    '[data-testid="ad-root"]',
    '[data-testid="promoted"]',
    'shreddit-ad-post',
    'shreddit-ad-widget',
    'shreddit-async-loader[slot="sidebar"]',
    '#TrendingPostsContainer',
    '.premium-banner',
    '.premium-cta',
    '.premium-subscription',
    '#redesign-beta-optin',
  ];

  const removalSelectors = [
    ...cssHiddenSelectors,
    '[id^="ad-"]',
    '[id*="promo"]',
    '[class*="promoted"]',
    '[data-testid*="ad"]',
    '[href*="/promoted/"]',
    'iframe[src*="ads"]',
  ];

  const globalCss = `
    @import url('https://fonts.googleapis.com/css2?family=Lexend+Deca:wght@300;400;500;600;700&display=swap');

    :root {
      --easy-reader-font: 'Lexend Deca', sans-serif;
      --easy-reader-content-width: min(860px, 95vw);
      --easy-reader-line-height: 1.65;
      --easy-reader-font-size: 17px;
    }

    body {
      font-family: var(--easy-reader-font) !important;
      font-size: var(--easy-reader-font-size) !important;
      line-height: var(--easy-reader-line-height) !important;
      letter-spacing: 0.01em !important;
      background-color: #fafafa !important;
      color: #111 !important;
    }

    body * {
      font-family: var(--easy-reader-font) !important;
      line-height: var(--easy-reader-line-height) !important;
      letter-spacing: 0.01em !important;
    }

    main,
    #SHORTCUT_FOCUSABLE_DIV > div:nth-of-type(3),
    #SHORTCUT_FOCUSABLE_DIV [data-testid="post-container"],
    #SHORTCUT_FOCUSABLE_DIV [data-testid="post-content"],
    #SHORTCUT_FOCUSABLE_DIV [data-testid="comment"] {
      max-width: var(--easy-reader-content-width) !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    ${cssHiddenSelectors.join(',\n    ')} {
      display: none !important;
      visibility: hidden !important;
    }
  `;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = globalCss;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeClutter(root = document) {
    removalSelectors.forEach((selector) => {
      root.querySelectorAll(selector).forEach((node) => {
        if (node instanceof HTMLElement) {
          node.remove();
        } else if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      });
    });
  }

  function init() {
    injectStyle();
    removeClutter();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          removeClutter(node);
        });
      }
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        injectStyle();
        removeClutter();
        observer.observe(document.body, { childList: true, subtree: true });
      }, { once: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();


