const port = process.argv[2]
const maxSec = Number(process.argv[3] || 600)
const endAt = Date.now() + maxSec * 1000
const seen = new Set()
let failCount = 0, dead = 0
const css = `*,*::before,*::after{animation:none!important;animation-duration:0s!important;transition:none!important;scroll-behavior:auto!important}img,video,picture,source,canvas,[style*="background-image"]{visibility:hidden!important;opacity:0!important}`
const inject = `(function(){try{if(document.getElementById('__antig_nofx'))return;var s=document.createElement('style');s.id='__antig_nofx';s.textContent=${JSON.stringify(css)};(document.head||document.documentElement).appendChild(s)}catch(e){}})()`
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function attach(t){
  let ws; try { ws = new WebSocket(t.webSocketDebuggerUrl) } catch { return }
  let id = 0
  const send = (method, params={}) => { try { ws.send(JSON.stringify({ id: ++id, method, params })) } catch {} }
  ws.onopen = () => {
    send('Page.enable'); send('Runtime.enable'); send('Network.enable')
    send('Page.addScriptToEvaluateOnNewDocument', { source: inject })
    send('Runtime.evaluate', { expression: inject })
    send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Image', requestStage: 'Request' }] })
    send('Network.setBlockedURLs', { urls: ['*google-analytics.com*','*googletagmanager.com*','*doubleclick.net*','*googleadservices.com*','*googlesyndication.com*','*analytics.google.com*'] })
    console.log('ATTACH', String(t.url||'').slice(0,100))
  }
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data) } catch { return }
    if (m.method === 'Fetch.requestPaused') {
      failCount++
      try { ws.send(JSON.stringify({ id: ++id, method: 'Fetch.failRequest', params: { requestId: m.params.requestId, errorReason: 'Aborted' } })) } catch {}
    }
  }
  ws.onerror = () => {}
}
console.log('BLOCKER start port', port, 'max', maxSec+'s')
while (Date.now() < endAt) {
  let list = null
  try { list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json()); dead = 0 } catch { dead++ }
  if (dead > 20) { console.log('BLOCKER port gone; exit'); break }
  for (const t of (list || [])) {
    if (t.type !== 'page' || !t.webSocketDebuggerUrl || seen.has(t.id)) continue
    seen.add(t.id)
    attach(t)
  }
  if (failCount && failCount % 25 === 0) console.log('images blocked so far:', failCount)
  await sleep(800)
}
console.log('BLOCKER end; total image requests blocked:', failCount)
