// Inject the REAL x-masonry.js source into the live logged-in x.com page (main
// world) to test the harvest/reader logic against real X DOM, independent of the
// extension's content-script registration. Also injects x.css so cards style.
const fs = require('fs');
const DIR = '/private/tmp/claude-501/-Volumes-DATA-TUCM-FontChanger-TUCM-ChromeExtension/2469f2b4-7a4a-4336-bfc1-25bb70ea0877/scratchpad';
const CDP = 'http://localhost:9222';
const SCRIPT = fs.readFileSync('/Volumes/DATA/TUCM/FontChanger_TUCM_ChromeExtension/public/x-masonry.js', 'utf8');
const CSS = fs.readFileSync('/Volumes/DATA/TUCM/FontChanger_TUCM_ChromeExtension/src/content/x.css', 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl); const pending = new Map(); let id = 0;
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const ready = new Promise((res) => ws.addEventListener('open', res));
  const send = (method, params) => { const mid = ++id; return new Promise((res) => { pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); }); };
  return { ws, send, ready };
}

async function main() {
  const tabs = await fetch(`${CDP}/json`).then((r) => r.json());
  const tab = tabs.find((t) => t.type === 'page' && /x\.com/.test(t.url));
  if (!tab) { console.error('no x.com tab'); process.exit(1); }
  const c = connect(tab.webSocketDebuggerUrl); await c.ready;
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false });
  const evalJS = async (expr) => { const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) return 'EXC: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300); return r.result && r.result.result ? r.result.result.value : undefined; };
  const shot = async (name) => { const r = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${DIR}/${name}.png`, Buffer.from(r.result.data, 'base64')); console.log('  saved', name); };

  // Ensure a fresh home, wait for X timeline to populate.
  await c.send('Page.navigate', { url: 'https://x.com/home' });
  console.log('waiting for X timeline…');
  for (let i = 0; i < 15; i++) { await sleep(1500); const n = await evalJS(`document.querySelectorAll('[data-testid="cellInnerDiv"]').length`); console.log('  cells:', n); if (n >= 3) break; }

  // Inject CSS then the script (main world; chrome.storage absent → typography uses defaults via try/catch).
  await evalJS(`(function(){var s=document.getElementById('fc-inj-css');if(!s){s=document.createElement('style');s.id='fc-inj-css';document.head.appendChild(s);}s.textContent=${JSON.stringify(CSS)};})()`);
  const injRes = await evalJS(`try{ (0,eval)(${JSON.stringify(SCRIPT)}); 'injected'; }catch(e){ 'THROW: '+e.message }`);
  console.log('inject result:', injRes);

  console.log('\n[A] Grid after inject');
  for (let i = 0; i < 8; i++) {
    await sleep(1500);
    const g = await evalJS(`JSON.stringify({overlay:!!document.getElementById('fc-masonry'),cards:document.querySelectorAll('#fc-grid .fc-card').length,cols:document.querySelectorAll('#fc-grid .fc-col').length,fcHome:document.documentElement.classList.contains('fc-home'),type:!!document.getElementById('fc-x-type')})`);
    console.log('  ', g);
    if (JSON.parse(g).cards >= 3) break;
  }
  await shot('inj-01-grid');

  console.log('\n[B] Click first card → reader');
  console.log('  click:', await evalJS(`(function(){var e=document.querySelector('#fc-grid .fc-card');if(!e)return 'no-card';e.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));return 'clicked '+e.getAttribute('data-fc-status');})()`));
  await sleep(5000);
  console.log('  ', await evalJS(`JSON.stringify({overlayDisplay:document.getElementById('fc-masonry')?document.getElementById('fc-masonry').style.display:'gone',back:(document.getElementById('fc-back')||{}).style?document.getElementById('fc-back').style.display:null,path:location.pathname,threadCells:document.querySelectorAll('[data-testid="cellInnerDiv"]').length,translateCTA:!!Array.from(document.querySelectorAll('button,span,div')).find(function(n){return /Translate post|Show original|Hi.n b.n g.c/i.test(n.textContent||'')&&(n.textContent||'').length<40;})})`));
  await shot('inj-02-reader');

  console.log('\n[C] Back → grid');
  await evalJS(`(function(){var b=document.getElementById('fc-back');if(b)b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));})()`);
  await sleep(4000);
  console.log('  ', await evalJS(`JSON.stringify({overlayDisplay:document.getElementById('fc-masonry')?document.getElementById('fc-masonry').style.display:'gone',path:location.pathname,cards:document.querySelectorAll('#fc-grid .fc-card').length})`));
  await shot('inj-03-back');

  c.ws.close(); console.log('\nDONE'); process.exit(0);
}
main().catch((e) => { console.error('ERR', e); process.exit(1); });
