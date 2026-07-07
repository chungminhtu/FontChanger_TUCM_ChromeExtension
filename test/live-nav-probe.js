// Empirically find a way to open a thread WITHOUT a full reload on live X.
// Sets window.__probe before each attempt; if it survives, it was a SPA nav.
const CDP = 'http://localhost:9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function connect(wsUrl){const ws=new WebSocket(wsUrl);const p=new Map();let id=0;ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}});const ready=new Promise(res=>ws.addEventListener('open',res));const send=(method,params)=>{const mid=++id;return new Promise(res=>{p.set(mid,res);ws.send(JSON.stringify({id:mid,method,params:params||{}}));});};return{ws,send,ready};}

async function main(){
  const tabs=await fetch(`${CDP}/json`).then(r=>r.json());
  const tab=tabs.find(t=>t.type==='page'&&/x\.com/.test(t.url));
  const c=connect(tab.webSocketDebuggerUrl);await c.ready;await c.send('Runtime.enable');
  const ev=async expr=>{const r=await c.send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});if(r.result&&r.result.exceptionDetails)return 'EXC:'+JSON.stringify(r.result.exceptionDetails).slice(0,200);return r.result&&r.result.result?r.result.result.value:undefined;};

  await c.send('Page.navigate',{url:'https://x.com/home'});
  for(let i=0;i<12;i++){await sleep(1500);const n=await ev(`document.querySelectorAll('[data-testid="cellInnerDiv"]').length`);if(n>=3)break;}

  // Grab a real status permalink present in X's live tree.
  const target=await ev(`(function(){var a=document.querySelector('article a[href*="/status/"]');return a?a.getAttribute('href'):null;})()`);
  console.log('target href:', target);

  async function probe(label, code){
    await ev(`window.__probe='alive_'+Date.now(); window.__p0=location.pathname;`);
    const before=await ev(`window.__probe`);
    await ev(code);
    await sleep(3500);
    const after=await ev(`JSON.stringify({probe:window.__probe,alive:window.__probe===${JSON.stringify(before)},path:location.pathname,changed:location.pathname!==window.__p0,threadCells:document.querySelectorAll('[data-testid="cellInnerDiv"]').length})`);
    console.log(`\n[${label}]`, after);
    // reset to home for next probe
    await c.send('Page.navigate',{url:'https://x.com/home'});
    for(let i=0;i<10;i++){await sleep(1200);const n=await ev(`document.querySelectorAll('[data-testid="cellInnerDiv"]').length`);if(n>=3)break;}
  }

  // Method B: pushState + popstate
  await probe('B pushState+popstate', `history.pushState({},'', ${JSON.stringify(target)}); window.dispatchEvent(new PopStateEvent('popstate'));`);

  // Method C: click X's OWN live permalink anchor (React-wired)
  await probe('C click live X anchor', `(function(){var a=document.querySelector('article a[href*="/status/"]');if(a)a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));})()`);

  // Method D: click X's own anchor via a trusted-ish path — focus + Enter not feasible; try setting location via history then popstate with state
  await probe('D history.pushState only', `history.pushState({},'', ${JSON.stringify(target)});`);

  c.ws.close();process.exit(0);
}
main().catch(e=>{console.error('ERR',e);process.exit(1);});
