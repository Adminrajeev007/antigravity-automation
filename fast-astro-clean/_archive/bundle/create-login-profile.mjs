#!/usr/bin/env node
/**
 * Create and start a dedicated Octo profile for GCP Antigravity Login.
 * Uploads the bundled login zip, attaches it, enables the HTTP proxy,
 * forces the Sheet URL/token, and starts the live login loop.
 *
 * Run from the antig-orchestrator-mac folder:
 *   ./login-setup.sh
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SHEET = 'https://script.google.com/macros/s/AKfycbzoCHT0aGmxBzTD_j9gEU1JFxBW52_NUj7x-NHW_D_W_PmIZ4YIWWCOWtIcR2fojkfs/exec'
const SHEET_TOKEN = 'change-this-sheet-token'
const ZIP = process.env.LOGIN_ZIP || path.join(process.cwd(), 'gcp-antigravity-login-v2.9.39.zip')

function loadProxyConfig() {
  for (const file of [
    process.env.ORCH_PROXY_CONFIG,
    path.join(process.cwd(), 'proxy.local.json'),
    path.join(path.dirname(new URL(import.meta.url).pathname), 'proxy.local.json'),
  ].filter(Boolean)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (e) {}
  }
  return {}
}

const PROXY_CFG = loadProxyConfig()
const USE_PROXY = process.env.LOGIN_USE_PROXY !== '0'
const PROXY_URL = process.env.LOGIN_PROXY_URL || PROXY_CFG.url
  || 'http://testuser:testpass@192.168.31.250:1080'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function octoPort() {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.Octo Browser', 'local_port'), 'utf8').trim()
    const n = Number(raw)
    if (Number.isInteger(n) && n > 1 && n < 65536) return n
  } catch (e) {}
  return 58888
}

async function api(port, method, target, body) {
  const init = { method, headers: {} }
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`http://127.0.0.1:${port}${target}`, init)
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch (e) { data = { raw: text } }
  if (!res.ok || (data && data.success === false)) {
    const err = data && data.error
    const msg = (err && (err.message || err.code)) || (data && (data.message || data.raw)) || `HTTP ${res.status}`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data
}

function cdpCall(wsUrl, method, params, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let done = false
    const fin = (fn, v) => { if (done) return; done = true; try { ws.close() } catch (e) {} fn(v) }
    const timer = setTimeout(() => fin(reject, new Error('cdp timeout')), timeoutMs)
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method, params })))
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id !== 1) return
      clearTimeout(timer)
      m.error ? fin(reject, new Error(JSON.stringify(m.error))) : fin(resolve, m.result)
    })
    ws.addEventListener('error', () => { clearTimeout(timer); fin(reject, new Error('ws error')) })
  })
}

function cdpEval(wsUrl, expression, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let done = false
    const fin = (fn, v) => { if (done) return; done = true; try { ws.close() } catch (e) {} fn(v) }
    const timer = setTimeout(() => fin(reject, new Error('cdp timeout')), timeoutMs)
    ws.addEventListener('open', () => ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true }
    })))
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id !== 1) return
      clearTimeout(timer)
      if (m.error) return fin(reject, new Error(JSON.stringify(m.error)))
      if (m.result && m.result.exceptionDetails) return fin(reject, new Error(JSON.stringify(m.result.exceptionDetails)))
      fin(resolve, m.result && m.result.result ? m.result.result.value : null)
    })
    ws.addEventListener('error', () => { clearTimeout(timer); fin(reject, new Error('ws error')) })
  })
}

async function main() {
  const port = octoPort()
  if (!fs.existsSync(ZIP)) throw new Error(`login zip not found: ${ZIP}`)

  console.log(`Octo port ${port}`)
  const username = await api(port, 'GET', '/api/username')
  console.log(`Octo account: ${JSON.stringify(username)}`)

  const form = new FormData()
  form.append('file', new Blob([fs.readFileSync(ZIP)], { type: 'application/zip' }), path.basename(ZIP))
  const upRes = await fetch(`http://127.0.0.1:${port}/api/v2/teams/extensions/load_blob?update=true`, {
    method: 'POST',
    body: form
  })
  const up = await upRes.json()
  if (!up.success) throw new Error(`extension upload failed: ${JSON.stringify(up.error || up)}`)
  const item = Array.isArray(up.data) ? up.data[0] : up.data
  console.log(`extension ready: ${item.name} ${item.version} (${item.id})`)

  const isLogin = (title) => /^GCP Antigravity Login/i.test(String(title || ''))
  const activeNow = async () => {
    const rows = await api(port, 'GET', '/api/profiles/active')
    return Array.isArray(rows) ? rows : ((rows && rows.data) || [])
  }
  const freeOldProfile = async () => {
    const list = await api(port, 'POST', '/api/v2/profiles/list', { start: 0, length: 100 })
    const profiles = (list.data && list.data.profiles) || list.profiles || []
    const active = await activeNow()
    const activeSet = new Set(active.map((p) => p.uuid))
    const candidates = profiles
      .filter((p) => p.uuid && !isLogin(p.title || p.name))
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    const pick = candidates.find((p) => !activeSet.has(p.uuid)) || candidates[0]
    if (!pick) return false
    console.log(`profile limit: deleting old non-login profile ${pick.uuid} (${pick.title || pick.name || ''})`)
    try { await api(port, 'POST', '/api/profiles/force_stop', { uuid: pick.uuid }) } catch (e) {}
    await sleep(1000)
    try { await api(port, 'POST', '/api/v2/profiles/delete', { uuids: [pick.uuid] }) } catch (e) { return false }
    return true
  }

  let uuid = ''
  let name = ''
  let detail = null
  const all = await api(port, 'POST', '/api/v2/profiles/list', { start: 0, length: 100 })
  const existingProfiles = (all.data && all.data.profiles) || all.profiles || []
  const existingLogin = existingProfiles.find((p) => p.uuid && isLogin(p.title || p.name))
  if (existingLogin) {
    uuid = existingLogin.uuid
    name = existingLogin.title || existingLogin.name || `GCP Antigravity Login ${Date.now()}`
    console.log(`reusing existing login profile: ${uuid}`)
    detail = (await api(port, 'GET', `/api/v2/profiles/${encodeURIComponent(uuid)}`)).data
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    name = `GCP Antigravity Login ${stamp}`
    let created = null
    for (let attempt = 1; attempt <= 3 && !created; attempt += 1) {
      try {
        created = await api(port, 'POST', '/api/v2/profiles/quick', { alias: name, os: 'mac', os_arch: 'x86' })
      } catch (e) {
        const msg = String(e.message || e)
        if (!/maximum|limit|saved_error|429|too many/i.test(msg)) throw e
        console.log(`login profile create failed (${msg}); freeing a profile and retrying...`)
        if (!(await freeOldProfile())) break
      }
    }
    if (!created) throw new Error('could not create a login profile after freeing old profiles')
    const payload = created && created.data ? created.data : created
    uuid = payload.uuid || (payload.profile && payload.profile.uuid)
    if (!uuid) throw new Error('Octo did not return a profile uuid')
    detail = (await api(port, 'GET', `/api/v2/profiles/${encodeURIComponent(uuid)}`)).data
  }
  const already = (await activeNow()).some((p) => p.uuid === uuid)
  if (already) {
    try { await api(port, 'POST', '/api/profiles/stop', { uuid }) } catch (e) {}
    await sleep(1200)
  }
  const body = {
    name,
    description: detail.description ?? '',
    start_pages: detail.start_pages ?? [],
    bookmarks: detail.bookmarks ?? [],
    launch_args: detail.launch_args ?? [],
    logo: detail.image ?? null,
    tags: detail.tags ?? [],
    folder: detail.folder ?? null,
    pinned_tag: detail.pinned_tag ?? null,
    fp: (detail.fingerprint && detail.fingerprint.data) || detail.fp || {},
    proxy: detail.proxy || { type: 'direct' },
    storage_options: detail.storage_options ?? {},
    local_cache: Boolean(detail.local_cache),
    extensions: [item.id]
  }
  await api(port, 'PATCH', `/api/v2/profiles/${encodeURIComponent(uuid)}`, body)
  await api(port, 'POST', '/api/profiles/start', { uuid, debug_port: true })

  let entry = null
  for (let i = 0; i < 60; i += 1) {
    await sleep(1000)
    const active = await api(port, 'GET', '/api/profiles/active')
    const rows = Array.isArray(active) ? active : (active && active.data) || []
    entry = rows.find((p) => p.uuid === uuid)
    if (entry && entry.debug_port && /STARTED|RUNNING/i.test(String(entry.state || ''))) break
  }
  if (!entry || !entry.debug_port) throw new Error('profile did not become ready')

  const debugPort = Number(entry.debug_port)
  let browserWs = entry.ws_endpoint || null
  if (!browserWs) {
    try {
      const v = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((r) => r.json())
      browserWs = v.webSocketDebuggerUrl || null
    } catch (e) {}
  }

  let targetId = null
  if (browserWs) {
    try {
      const r = await cdpCall(browserWs, 'Target.createTarget', {
        url: `chrome-extension://${item.ext_id}/popup.html`
      })
      targetId = r && r.targetId
    } catch (e) {}
  }

  let pageWs = null
  let swWs = null
  for (let i = 0; i < 40 && !pageWs; i += 1) {
    await sleep(500)
    try {
      const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json())
      const t = (list || []).find((x) => x.type === 'page' && String(x.url || '').includes('/popup.html'))
      if (t) pageWs = t.webSocketDebuggerUrl
      const sw = (list || []).find((x) => x.type === 'service_worker' && String(x.url || '').includes(item.ext_id))
      if (sw) swWs = sw.webSocketDebuggerUrl
      if (pageWs || swWs) break
    } catch (e) {}
  }

  const evalWs = pageWs || swWs
  if (evalWs) {
    // Runs in either the popup page or the service worker. Feature-detects the
    // background globals so the SW context works without runtime.sendMessage.
    // Step 1: apply proxy. Step 2: verify proxy egress IP. Step 3: start.
    const expr = `(async () => {
      const st = await chrome.storage.local.get(null);
      const proxy = Object.assign({}, st.proxy || {}, {
        enabled: ${JSON.stringify(USE_PROXY)},
        customUrl: ${JSON.stringify(PROXY_URL)}
      });
      const config = Object.assign({}, st.config || {}, {
        live: true,
        autoRun: true,
        emailOrder: st.config && st.config.emailOrder === "asc" ? "asc" : "desc"
      });
      await chrome.storage.local.set({
        proxy, config, socks5ProxyMigrated: true,
        sheetWebhookUrl: ${JSON.stringify(SHEET)},
        sheetToken: ${JSON.stringify(SHEET_TOKEN)},
        sheetWebhookMigratedV2: true
      });
      const wantProxy = ${JSON.stringify(USE_PROXY)};
      const hasBg = typeof applyProxy === "function" && typeof ensureLive === "function";
      if (wantProxy) {
        if (hasBg) { await applyProxy(); }
        else { await chrome.runtime.sendMessage({ type: "SET_PROXY" }); }
      } else {
        try { await chrome.proxy.settings.set({ value: { mode: "direct" }, scope: "regular" }); } catch (e) {}
      }
      let proxyIp = "";
      let verified = !wantProxy;
      if (wantProxy) {
        for (let i = 0; i < 15; i++) {
          try {
            let info;
            if (typeof fetchProxyInfo === "function") { info = await fetchProxyInfo(); }
            else { info = await chrome.runtime.sendMessage({ type: "PROXY_INFO" }); }
            if (info && info.ip) { proxyIp = String(info.ip); verified = true; break; }
          } catch (e) {}
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (!verified) {
        return { proxyVerified: false, proxyIp, started: false, via: hasBg ? "sw" : "popup", version: chrome.runtime.getManifest().version, proxyEnabled: wantProxy };
      }
      let r;
      if (hasBg) { r = await ensureLive(true); }
      else { r = await chrome.runtime.sendMessage({ type: "ENSURE_LIVE", start: true }); }
      return { proxyVerified: true, proxyIp, started: !!r, r, via: hasBg ? "sw" : "popup", version: chrome.runtime.getManifest().version, proxyEnabled: wantProxy };
    })()`
    const value = await cdpEval(evalWs, expr, 60000)
    console.log(`extension configured: ${JSON.stringify(value)}`)
    if (!value || value.proxyVerified === false) {
      throw new Error('proxy check failed: no egress IP from the configured proxy; login not started')
    }
    if (targetId && browserWs) cdpCall(browserWs, 'Target.closeTarget', { targetId }).catch(() => {})
  } else {
    console.log('warning: extension popup page and service worker not found; open the extension popup and press Start.')
  }

  console.log(JSON.stringify({
    ok: true,
    profile: { name, uuid, debugPort },
    extension: { name: item.name, version: item.version, id: item.id }
  }, null, 2))
}

main().catch((e) => {
  console.error(`[login-setup] ${e.message}`)
  if (e && e.stack) console.error(e.stack)
  process.exit(1)
})
