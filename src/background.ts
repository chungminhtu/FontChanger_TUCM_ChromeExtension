// Background service worker - fetches Google Fonts CSS and converts font URLs to data URIs to bypass CSP

async function convertFontUrlsToDataUris(css: string): Promise<string> {
  try {
    // Find all font file URLs in the CSS (woff2 files)
    const fontUrlRegex = /url\(([^)]+\.woff2[^)]*)\)/g;
    const fontUrls: string[] = [];
    let match;

    while ((match = fontUrlRegex.exec(css)) !== null) {
      const url = match[1].replace(/['"]/g, '');
      if (!fontUrls.includes(url)) {
        fontUrls.push(url);
      }
    }

    console.log(`[FontChanger Background] Found ${fontUrls.length} font URLs to convert`);

    if (fontUrls.length === 0) {
      console.warn('[FontChanger Background] No font URLs found in CSS');
      return css;
    }

    // Fetch each font file and convert to data URI (limit to first 5 to avoid timeout)
    const replacements: Array<{ original: string; dataUri: string }> = [];
    const urlsToProcess = fontUrls.slice(0, 5); // Limit to avoid timeout

    for (const fontUrl of urlsToProcess) {
      try {
        console.log(`[FontChanger Background] Converting font URL: ${fontUrl.substring(0, 50)}...`);
        const response = await fetch(fontUrl);
        if (!response.ok) {
          console.warn(`[FontChanger Background] Font fetch failed: ${response.status}`);
          continue;
        }

        const blob = await response.blob();
        const reader = new FileReader();

        const dataUri = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('FileReader timeout')), 5000);
          reader.onloadend = () => {
            clearTimeout(timeout);
            resolve(reader.result as string);
          };
          reader.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('FileReader error'));
          };
          reader.readAsDataURL(blob);
        });

        replacements.push({ original: fontUrl, dataUri });
        console.log(`[FontChanger Background] Successfully converted font URL to data URI`);
      } catch (error) {
        console.error(`[FontChanger Background] Failed to convert font URL to data URI: ${fontUrl.substring(0, 50)}...`, error);
      }
    }

    // Replace URLs in CSS with data URIs
    let modifiedCss = css;
    replacements.forEach(({ original, dataUri }) => {
      // Escape special regex characters in URL
      const escapedUrl = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      modifiedCss = modifiedCss.replace(new RegExp(escapedUrl, 'g'), dataUri);
    });

    console.log(`[FontChanger Background] Converted ${replacements.length} font URLs to data URIs`);
    return modifiedCss;
  } catch (error) {
    console.error('[FontChanger Background] Error in convertFontUrlsToDataUris:', error);
    return css; // Return original CSS if conversion fails
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FC_TWEET_JSON') {
    // x-masonry.js in-card video playback: page CSP/CORS block the syndication
    // API from content-script and page worlds, so the fetch happens here (host
    // permission granted in the manifest). Returns X's public tweet JSON with
    // mediaDetails[].video_info.variants (direct video.twimg.com mp4 URLs).
    const id: string = String(message.id || '');
    if (!/^\d+$/.test(id)) {
      sendResponse({ success: false, error: 'bad id' });
      return false;
    }
    const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
    (async () => {
      try {
        const response = await fetch(
          `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`
        );
        if (!response.ok) throw new Error(`syndication fetch failed: ${response.status}`);
        const tweet = await response.json();
        sendResponse({ success: true, tweet });
      } catch (error) {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    })();
    return true; // keep channel open for async response
  }

  if (message.type === 'FETCH_FONT_CSS') {
    const fontUrl = message.fontUrl;

    // Use async function to properly handle the promise
    (async () => {
      try {
        console.log('[FontChanger Background] Fetching font CSS from:', fontUrl);
        const response = await fetch(fontUrl);

        if (!response.ok) {
          throw new Error(`Font fetch failed: ${response.status} ${response.statusText}`);
        }

        let css = await response.text();
        console.log('[FontChanger Background] Successfully fetched font CSS, length:', css.length);

        // Convert font file URLs to data URIs to bypass CSP
        console.log('[FontChanger Background] Converting font URLs to data URIs...');
        css = await convertFontUrlsToDataUris(css);
        console.log('[FontChanger Background] Font CSS converted, length:', css.length);

        sendResponse({ success: true, css });
      } catch (error) {
        console.error('[FontChanger Background] Failed to fetch font:', error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    })();

    return true; // Keep channel open for async response
  }

  return false;
});

