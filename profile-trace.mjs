#!/usr/bin/env node
import fs from 'node:fs'

const LOG = process.argv[2] || '/tmp/orch-test10.log'
const OUT = process.argv[3] || '/tmp/profile-trace.log'
const targets = new Map()
const seen = new Set()
let currentEmail = '?'

function out(line) {
  const text = `${new Date().toISOString().slice(11, 19)} ${currentEmail} ${line}`
  fs.appendFileSync(OUT, text + '\n')
  console.log(text)
}

function short(value, max = 220) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? text.slice(0, max) + '…' : text
}

async function listTargets(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

function attach(port, target) {
  const key = `${port}:${target.id}`
  if (seen.has(key)) return
  seen.add(key)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const send = (method, params = {}) => {
    try { ws.send(JSON.stringify({ id: ++id, method, params })) } catch {}
  }
  const call = (method, params = {}) => new Promise((resolve) => {
    const msgId = ++id
    pending.set(msgId, resolve)
    try { ws.send(JSON.stringify({ id: msgId, method, params })) } catch { resolve(null) }
    setTimeout(() => { if (pending.delete(msgId)) resolve(null) }, 5000)
  })
  ws.addEventListener('open', () => {
    out(`ATTACH ${target.type} ${short(target.url)}`)
    send('Page.enable')
    send('Runtime.enable')
    send('Log.enable')
    send('Network.enable')
    if (target.type === 'page') {
      let lastStatus = ''
      setInterval(async () => {
        const r = await call('Runtime.evaluate', {
          expression: "(()=>{const e=document.getElementById('gcp-auto-status');return e?e.textContent:''})()",
          returnByValue: true,
        })
        const value = String(r?.result?.result?.value || '').replace(/\s+/g, ' ').trim()
        if (value && value !== lastStatus) {
          lastStatus = value
          out(`STATUS ${value}`)
        }
      }, 2500)
    }
  })
  ws.addEventListener('message', (event) => {
    let msg
    try { msg = JSON.parse(event.data) } catch { return }
    if (msg.id && pending.has(msg.id)) {
      const resolve = pending.get(msg.id)
      pending.delete(msg.id)
      resolve(msg)
      return
    }
    const method = msg.method
    const p = msg.params || {}
    if (method === 'Page.frameNavigated') {
      const frame = p.frame || {}
      if (!frame.parentId) {
        out(`NAV ${short(frame.url)}`)
        if (/signup\/tos/.test(String(frame.url))) {
          const expr = "(()=>{const inputs=[...document.querySelectorAll('input')].map(i=>({type:i.type,checked:i.checked,disabled:i.disabled,aria:i.getAttribute('aria-checked'),label:i.getAttribute('aria-label'),outer:i.outerHTML.slice(0,200)}));const roles=[...document.querySelectorAll('[role=checkbox],[role=switch]')].map(e=>({role:e.getAttribute('role'),checked:e.getAttribute('aria-checked'),text:(e.innerText||'').slice(0,100),outer:e.outerHTML.slice(0,200)}));const iframes=[...document.querySelectorAll('iframe')].map(f=>f.src);const shadows=[...document.querySelectorAll('*')].filter(e=>e.shadowRoot).map(e=>({tag:e.tagName,id:e.id,html:e.shadowRoot.innerHTML.slice(0,600)}));const buttons=[...document.querySelectorAll('button,[role=button],a')].map(e=>({tag:e.tagName,role:e.getAttribute('role'),text:(e.innerText||'').trim().slice(0,100),disabled:e.disabled,aria:e.getAttribute('aria-disabled')})).filter(x=>x.text);return JSON.stringify({inputs,roles,iframes,shadows,buttons})})()"
          for (const delay of [2500, 8000]) {
            setTimeout(async () => {
              const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true })
              const text = String(r?.result?.result?.value || '').replace(/\s+/g, ' ').trim()
              if (text) out(`TOSDOM2 ${short(text, 3000)}`)
            }, delay)
          }
        }
        if (/signup\/error/.test(String(frame.url))) {
          for (const delay of [80, 500]) {
            setTimeout(async () => {
              const r = await call('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true })
              const text = String(r?.result?.result?.value || '').replace(/\s+/g, ' ').trim()
              if (text) out(`PAGETEXT ${short(text, 1500)}`)
            }, delay)
          }
        }
      }
    } else if (method === 'Page.loadEventFired') {
      out('LOAD')
    } else if (method === 'Runtime.consoleAPICalled') {
      const text = (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
      if (text) out(`CONSOLE ${p.type || ''} ${short(text, 500)}`)
    } else if (method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails || {}
      out(`JSERROR ${short(d.text || d.exception?.description || '')}`)
    } else if (method === 'Log.entryAdded') {
      const e = p.entry || {}
      if (['error', 'warning'].includes(String(e.level))) out(`LOG ${e.level} ${short(e.text || '')}`)
    } else if (method === 'Network.loadingFailed') {
      const url = p.url || ''
      if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(String(p.errorText))) {
        out(`NETFAIL ${short(url)} ${p.errorText || ''}`)
      }
    } else if (method === 'Network.responseReceived') {
      const r = p.response || {}
      const url = r.url || ''
      if (p.type === 'Document' && url) out(`DOC ${r.status} ${short(url)}`)
    }
  })
  ws.addEventListener('close', () => {
    targets.delete(key)
    out(`DETACH ${target.type} ${short(target.url)}`)
  })
  targets.set(key, ws)
}

async function pollPort(port) {
  const list = await listTargets(port)
  for (const target of list) {
    if (target.type === 'page' || target.type === 'iframe' || target.type === 'background_page') {
      if (target.webSocketDebuggerUrl) attach(port, target)
    }
  }
}

async function followLog() {
  let fh = fs.existsSync(LOG) ? fs.openSync(LOG, 'r') : null
  let pos = 0
  let ports = new Set()
  let carry = ''
  while (true) {
    if (!fh) {
      if (fs.existsSync(LOG)) {
        fh = fs.openSync(LOG, 'r')
        pos = 0
      } else {
        await new Promise((r) => setTimeout(r, 500))
        continue
      }
    }
    const buf = Buffer.alloc(64 * 1024)
    const n = fs.readSync(fh, buf, 0, buf.length, pos)
    if (n <= 0) {
      await new Promise((r) => setTimeout(r, 500))
      continue
    }
    pos += n
    carry += buf.toString('utf8', 0, n)
    const lines = carry.split('\n')
    carry = lines.pop() || ''
    for (const line of lines) {
      const m = line.match(/started .*?port=(\d+)\s+email=(\S+)/)
      if (m) {
        const port = Number(m[1])
        currentEmail = m[2]
        if (!ports.has(port)) {
          ports.add(port)
          out(`PROFILE port=${port}`)
        }
      }
      const r = line.match(/IP (\S+) -> (\S+) \(USB tether\)/)
      if (r) out(`ROTATE ${r[1]} -> ${r[2]}`)
    }
    for (const port of ports) await pollPort(port)
    await new Promise((r) => setTimeout(r, 1200))
  }
}

out(`trace start log=${LOG}`)
await followLog()
