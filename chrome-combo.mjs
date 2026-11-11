import http from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CFT = process.env.CHROME_BIN || '/tmp/cft/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const EXT = process.env.CHROME_EXT || '/tmp/antig-ext-1.0.20'
const PROXY = process.env.CHROME_PROXY || 'http://proxy-admin.astroai.eu.cc:8082'
const COUNT = Math.max(1, Number(process.env.ORCH_BATCH || 3))
const BASE_PORT = Number(process.env.CHROME_PORT_BASE || 9410)
const TIMEOUT_MS = Math.max(0, Number(process.env.ORCH_BATCH_TIMEOUT_MS || 510000))
const CONTROL = Number(process.env.ORCH_PORT || 8791)
const SHEET = process.env.SHEET_WEBAPP_URL || 'https://script.google.com/macros/s/AKfycbzoCHT0aGmxBzTD_j9gEU1JFxBW52_NUj7x-NHW_D_W_PmIZ4YIWWCOWtIcR2fojkfs/exec'
const TOKEN = process.env.SHEET_TOKEN || 'change-this-sheet-token'
const NODE = process.execPath
const RUN_ROOT = process.env.ANTIG_LOG_ROOT || path.join(os.homedir(), 'Desktop', 'antig-logs')
const RUN = process.argv[2] || path.join(RUN_ROOT, 'chrome-' + new Date().toISOString().replace(/[:.]/g, '-'))
fs.mkdirSync(RUN, { recursive: true })
const LOG = path.join(RUN, 'orchestrator.log')
const QUEUE = path.join(RUN, 'sheet-queue.jsonl')
fs.writeFileSync(LOG, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function log(msg) { const line = `${new Date().toTimeString().slice(0, 8)} ${msg}`; fs.appendFileSync(LOG, line + '\n'); console.log(line) }

const profiles = new Map() // uuid -> { i, port, email, proc, done }
let server

async function sheetComplete(email, token) {
  if (!email) return false
  const url = new URL(SHEET)
  url.searchParams.set('token', TOKEN)
  url.searchParams.set('action', 'complete')
  url.searchParams.set('tab', 'QR')
  url.searchParams.set('email', email)
  url.searchParams.set('notes', 'completed')
  if (token) url.searchParams.set('userToken', String(token))
  const deadline = Date.now() + 2500
  let last = ''
  while (Date.now() < deadline) {
    try {
      const left = deadline - Date.now()
      const res = await fetch(url, { signal: AbortSignal.timeout(Math.max(500, Math.min(1200, left))) })
      const text = (await res.text()).replace(/\s+/g, ' ').trim()
      let data = null; try { data = JSON.parse(text) } catch {}
      if (res.ok && (!data || data.ok !== false)) { log(`sheet complete ${email}: ${text.slice(0, 160)}`); return true }
      last = (data && (data.error || data.message)) || `HTTP ${res.status}`
    } catch (e) { last = e.message }
    await sleep(250)
  }
  log(`sheet complete failed for ${email}: ${last || 'timeout'} (queued)`)
  fs.appendFileSync(QUEUE, JSON.stringify({ email, token, at: Date.now() }) + '\n')
  return false
}
async function flushQueue() {
  if (!fs.existsSync(QUEUE)) return
  const lines = fs.readFileSync(QUEUE, 'utf8').split('\n').filter(Boolean)
  const keep = []
  for (const line of lines) {
    let e; try { e = JSON.parse(line) } catch { continue }
    if (!(await sheetComplete(e.email, e.token))) keep.push(line)
  }
  fs.writeFileSync(QUEUE, keep.length ? keep.join('\n') + '\n' : '')
}

function readBody(req) { return new Promise((resolve) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => { try { resolve(JSON.parse(s || '{}')) } catch { resolve({}) } }) }) }
function send(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }

function closeProfileByUuid(uuid, reason) {
  const p = profiles.get(uuid)
  if (!p) return false
  p.done = true
  try { p.proc.kill('SIGKILL') } catch {}
  log(`profile closed (${reason}) ${p.email || uuid} port=${p.port}`)
  return true
}

function startControl() {
  server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/combo-step')) {
      const b = await readBody(req)
      const email = String(b.email || '').toLowerCase()
      const step = String(b.step || '')
      if (step) log(`[step] ${email} ${step} ${b.status || ''} attempt=${b.attempt || 1}${b.error ? ' error=' + b.error : ''}`)
      return send(res, 200, { ok: true })
    }
    if (req.method === 'POST' && req.url.startsWith('/combo-complete')) {
      const b = await readBody(req)
      const email = String(b.email || '').toLowerCase()
      const uuid = String(b.uuid || '')
      log(`combo complete for ${email || uuid}`)
      if (email) await sheetComplete(email, b.token)
      closeProfileByUuid(uuid, 'combo-complete')
      if (!uuid) { for (const [u, p] of profiles) if (p.email === email) closeProfileByUuid(u, 'combo-complete') }
      return send(res, 200, { ok: true })
    }
    if (req.method === 'POST' && req.url.startsWith('/billing')) {
      const b = await readBody(req)
      log(`billing reached for ${String(b.email || '').toLowerCase()}`)
      return send(res, 200, { ok: true })
    }
    if (req.method === 'POST' && req.url.startsWith('/delete')) {
      const b = await readBody(req)
      if (b.uuid) closeProfileByUuid(String(b.uuid), 'delete')
      return send(res, 200, { ok: true })
    }
    send(res, 404, { ok: false })
  })
  server.listen(CONTROL, '127.0.0.1', () => log(`control server on http://127.0.0.1:${CONTROL}`))
}

async function cdp(port, timeout = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try { return await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()) } catch { await sleep(300) }
  }
  return null
}
async function cdpList(port) {
  try { return await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()) } catch { return [] }
}
async function evalOn(target, expression, timeout = 15000) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(() => rej(new Error('ws timeout')), 5000) })
  const out = await new Promise((res) => {
    const timer = setTimeout(() => res(null), timeout)
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) { clearTimeout(timer); res(m.result?.result?.value ?? null) } }
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  ws.close()
  return out
}

async function launchProfile(i) {
  const port = BASE_PORT + i
  const userDir = path.join('/tmp/antig-chrome-profiles', `p${i}-${Date.now()}`)
  fs.mkdirSync(userDir, { recursive: true })
  const args = [
    `--user-data-dir=${userDir}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`,
    `--proxy-server=${new URL(PROXY).origin}`,
    '--proxy-bypass-list=localhost;127.0.0.1',
    'about:blank'
  ]
  const proc = spawn(CFT, args, { stdio: 'ignore', detached: false })
  const v = await cdp(port)
  if (!v) { log(`profile ${i} CDP failed`); try { proc.kill('SIGKILL') } catch {}; return null }
  const list = await cdpList(port)
  const sw = list.find((t) => t.type === 'service_worker' && String(t.url).startsWith('chrome-extension://'))
  if (!sw) { log(`profile ${i}: extension not loaded`); try { proc.kill('SIGKILL') } catch {}; return null }
  const extId = new URL(sw.url).host
  const uuid = `chrome-${i}-${port}`
  const entry = { i, port, uuid, email: '', proc, done: false, extId }
  profiles.set(uuid, entry)
  log(`profile ${i} started port=${port} ext=${extId} proxy=${new URL(PROXY).origin}`)
  spawn(NODE, ['--experimental-websocket', path.join(process.cwd(), 'block-fx.mjs'), String(port), '900'], { stdio: 'ignore', detached: true }).unref()
  try {
    await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${extId}/popup.html`).then((r) => r.text()).catch(() => {})
    await sleep(1200)
    const pages = await cdpList(port)
    const popup = pages.find((t) => t.type === 'page' && String(t.url).includes('/popup.html'))
    if (popup) {
      await evalOn(popup, `chrome.storage.local.set({ profileUuid: ${JSON.stringify(uuid)}, config: { autoRun: true, country: 'India', affirmAge: true } }).then(()=>true)`)
      log(`profile ${i} assigned uuid ${uuid}`)
    }
  } catch (e) { log(`profile ${i} assign error: ${e.message}`) }
  return entry
}

async function main() {
  log(`chrome combo: ${COUNT} profiles, proxy ${new URL(PROXY).origin}, cft ${path.basename(CFT)}`)
  startControl()
  const started = []
  for (let i = 0; i < COUNT; i += 1) {
    const p = await launchProfile(i)
    if (p) started.push(p)
    await sleep(800)
  }
  if (!started.length) { log('no profiles started'); process.exit(2) }
  log(`waiting for ${started.length} Chrome profile(s)`)
  const waitAll = Promise.allSettled(started.map((p) => new Promise((res) => {
    const t = setInterval(() => { if (p.done || !fs.existsSync(`/proc/${p.proc.pid}`) && process.platform === 'linux') { clearInterval(t); res() } }, 1000)
    p.proc.on('exit', () => { clearInterval(t); res() })
  })))
  if (TIMEOUT_MS > 0) {
    const timedOut = await Promise.race([waitAll.then(() => false), sleep(TIMEOUT_MS).then(() => true)])
    if (timedOut) {
      log(`batch timeout after ${Math.round(TIMEOUT_MS / 1000)}s — closing ${started.length} profile(s)`)
      for (const p of started) closeProfileByUuid(p.uuid, 'batch-timeout')
    }
  } else await waitAll
  log('batch complete')
  await flushQueue()
  server && server.close()
  setTimeout(() => process.exit(0), 500)
}
main().catch((e) => { log(`fatal: ${e.stack || e.message}`); process.exit(1) })
