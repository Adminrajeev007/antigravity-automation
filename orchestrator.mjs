#!/usr/bin/env node
/**
 * GCP/Octo orchestrator
 *
 * Loop:
 *   1. verify the Android device + USB tether internet
 *   2. toggle flight mode and wait for a new egress IP via USB tether
 *   3. create a fresh Octo profile with the extension attached and launch it
 *   4. generate an email and open the signup flow
 *   5. wait until the extension saves the QR email to the Sheet or fails
 *   6. stop + delete that profile, then repeat
 *
 * The extension calls this process at POST /delete (QR saved) and POST /failed.
 * It also serves /health.
 *
 * Env:
 *   ORCH_MAX_RUNS=1            stop after N runs (0 = infinite)
 *   ORCH_SESSION_TIMEOUT_MS    per-profile timeout (default 15m)
 *   ORCH_AIRPLANE_SECONDS      flight-mode cycle length (default 6)
 *   ORCH_EXT_ID                override extension base id
 *   EXT_ZIP                    extension zip path
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { loadConfig } from './src/octo/config.mjs'
import { AndroidService } from './src/android/service.mjs'
import { hostNetwork } from './src/android/host.mjs'

const require = createRequire(import.meta.url)
globalThis.self = globalThis
require('./gcp-auto-intern-portal/email-gen.js')

function generateBatchEmails(count) {
  const used = new Set()
  const out = []
  for (let i = 0; i < count; i += 1) {
    const email = globalThis.gcpRandomEmail(used)
    if (!email) break
    out.push(email)
    used.add(String(email).toLowerCase())
  }
  return out
}

const PORT = Number(process.env.ORCH_PORT || 8791)
const OCTO_HOME = path.join(os.homedir(), '.Octo Browser')
const SIGNUP_URL = 'https://console.cloud.google.com/freetrial'
const PROFILE_PREFIX = 'GCP Intern Auto'
const SESSION_TIMEOUT_MS = Number(process.env.ORCH_SESSION_TIMEOUT_MS || 15 * 60 * 1000)
const AIRPLANE_SECONDS = Number(process.env.ORCH_AIRPLANE_SECONDS || 6)
const MAX_RUNS = Number(process.env.ORCH_MAX_RUNS || 0)
const BATCH_SIZE = Math.max(1, Number(process.env.ORCH_BATCH || 2))
const EXT_BASE_ENV = process.env.ORCH_EXT_ID || ''

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args)

let EXT = null // { zip, compoundId, extBase, version }
const sessions = new Map()

// ---------------- Octo API ----------------
function octoPort() {
  try {
    const raw = fs.readFileSync(path.join(OCTO_HOME, 'local_port'), 'utf8').trim()
    const n = Number(raw)
    if (Number.isInteger(n) && n > 1 && n < 65536) return n
  } catch {}
  return 58888
}

async function octo(method, target, body, timeoutMs = 30000) {
  const init = { method, headers: {}, signal: AbortSignal.timeout(timeoutMs) }
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`http://127.0.0.1:${octoPort()}${target}`, init)
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!res.ok || (data && data.success === false)) {
    const err = data && data.error
    const message = (err && (err.message || err.code)) || (data && (data.message || data.raw)) || `HTTP ${res.status}`
    const e = new Error(typeof message === 'string' ? message : JSON.stringify(message))
    e.status = res.status
    e.code = err && err.code
    throw e
  }
  return data
}

function versionScore(v) {
  return String(v || '0').split(/[.+-]/).map((x) => Number(x) || 0).reduce((a, x) => a * 1000 + x, 0)
}

function findZip() {
  if (process.env.EXT_ZIP && fs.existsSync(process.env.EXT_ZIP)) return process.env.EXT_ZIP
  const dir = process.cwd()
  const zips = fs.readdirSync(dir)
    .filter((f) => /^gcp-auto-intern-portal-v.*\.zip$/i.test(f))
  if (!zips.length) return ''
  zips.sort((a, b) => {
    const va = a.match(/v([\d.]+)\.zip/i)?.[1]
    const vb = b.match(/v([\d.]+)\.zip/i)?.[1]
    return versionScore(vb) - versionScore(va)
  })
  return path.join(dir, zips[0])
}

async function uploadExtension() {
  const zip = findZip()
  if (!zip) throw new Error('extension zip not found (set EXT_ZIP)')
  const form = new FormData()
  form.append('file', new Blob([fs.readFileSync(zip)], { type: 'application/zip' }), path.basename(zip))
  const res = await fetch(`http://127.0.0.1:${octoPort()}/api/v2/teams/extensions/load_blob?update=true`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(180000),
  })
  const data = await res.json()
  if (!data.success) throw new Error(`extension upload failed: ${JSON.stringify(data.error || data)}`)
  const item = Array.isArray(data.data) ? data.data[0] : data.data
  EXT = { zip, compoundId: item.id, extBase: item.ext_id, version: item.version }
  log(`extension ${EXT.version} ready (${EXT.compoundId})`)
  return EXT
}

async function resolveProfile(uuid, extId) {
  if (uuid && /^[0-9a-fA-F]{32}$/.test(uuid)) return uuid
  const data = await octo('GET', '/api/profiles/active')
  const rows = Array.isArray(data) ? data : (data && data.data) || []
  if (!rows.length) return null
  if (rows.length === 1) return rows[0].uuid
  const matches = []
  if (extId) {
    for (const p of rows) {
      try {
        const d = await octo('GET', `/api/v2/profiles/${encodeURIComponent(p.uuid)}`)
        const exts = (d && d.data && d.data.extensions) || []
        if (exts.some((e) => (e.ext_id || '') === extId)) matches.push(p)
      } catch {}
    }
  }
  const pool = matches.length ? matches : rows
  pool.sort((a, b) => (Number(b.start_time) || 0) - (Number(a.start_time) || 0))
  return pool[0] ? pool[0].uuid : null
}

async function deleteProfile(uuid, extId, delayMs = 0) {
  const target = await resolveProfile(uuid, extId)
  if (!target) return { ok: false, error: 'no active profile found' }
  if (delayMs > 0) await sleep(delayMs)

  try { await octo('POST', '/api/profiles/stop', { uuid: target }) } catch {}
  await sleep(1200)

  let last = null
  for (let i = 0; i < 10; i += 1) {
    try {
      await octo('POST', '/api/v2/profiles/delete', { uuids: [target] })
      return { ok: true, uuid: target }
    } catch (e) {
      last = e
      if (/cannot delete active/i.test(e.message)) {
        try { await octo('POST', '/api/profiles/force_stop', { uuid: target }) } catch {}
      }
      await sleep(700 + i * 250)
    }
  }
  throw last || new Error('delete failed')
}

// ---------------- profiles ----------------
async function cleanupOldProfiles() {
  try {
    const list = await octo('POST', '/api/v2/profiles/list', { start: 0, length: 100 })
    const profiles = (list.data && list.data.profiles) || list.profiles || []
    const active = await octo('GET', '/api/profiles/active')
    const activeRows = Array.isArray(active) ? active : (active && active.data) || []
    const activeSet = new Set(activeRows.map((p) => p.uuid))
    const cutoff = Date.now() - 15 * 60 * 1000
    const old = profiles
      .filter((p) => {
        if (activeSet.has(p.uuid)) return false
        const title = String(p.title || p.name || '')
        if (title.startsWith(PROFILE_PREFIX)) return true
        // Octo names quick-created profiles "Quick <words>"; reclaim our own
        // recent orphans when a launch failed before we could rename them.
        if (title.startsWith('Quick ')) {
          const ts = Date.parse(p.created_at || '')
          if (Number.isFinite(ts) && ts >= cutoff) return true
        }
        return false
      })
      .sort((a, b) => (Number(a.created_at ? Date.parse(a.created_at) : 0) - Number(b.created_at ? Date.parse(b.created_at) : 0)))
    for (const p of old.slice(0, 3)) {
      try {
        await octo('POST', '/api/v2/profiles/delete', { uuids: [p.uuid] })
        log(`cleanup: deleted old profile ${p.uuid} (${p.title || p.name || ''})`)
      } catch (e) {
        log(`cleanup: could not delete ${p.uuid}: ${e.message}`)
      }
    }
  } catch (e) {
    log('cleanup failed:', e.message)
  }
}

function isProfileCreationError(error) {
  const text = `${(error && error.code) || ''} ${(error && error.message) || ''}`.toLowerCase()
  return /maximum|limit|profile.*(create|save|creation)|saved_error|cannot delete active/.test(text)
}

async function restartOctoApp() {
  log('profile reset: restarting Octo Browser to clear the active lock...')
  try {
    execFileSync('osascript', ['-e', 'tell application "Octo Browser" to quit'], { timeout: 15000 })
  } catch {}
  try { execFileSync('pkill', ['-f', '/Applications/Octo Browser.app/Contents/MacOS/Octo Browser'], { timeout: 5000 }) } catch {}
  try { execFileSync('pkill', ['-f', '/Octium.app/Contents/MacOS/Octium'], { timeout: 5000 }) } catch {}
  try { execFileSync('sleep', ['4']) } catch {}
  try { execFileSync('open', ['-a', 'Octo Browser'], { timeout: 10000 }) } catch {}
  for (let i = 0; i < 60; i += 1) {
    try {
      await octo('GET', '/api/profiles/active')
      log('profile reset: Octo API is ready')
      return true
    } catch {}
    await sleep(1000)
  }
  log('profile reset: Octo API did not return after restart')
  return false
}

async function deleteAllProfilesPass() {
  const uuids = new Set()
  let blocked = false
  try {
    const active = await octo('GET', '/api/profiles/active')
    const rows = Array.isArray(active) ? active : (active && active.data) || []
    for (const p of rows) {
      if (!p.uuid) continue
      uuids.add(p.uuid)
      try { await octo('POST', '/api/profiles/stop', { uuid: p.uuid }) } catch {}
    }
  } catch (e) {
    log('profile reset: active list failed:', e.message)
  }
  await sleep(2000)
  try {
    const list = await octo('POST', '/api/v2/profiles/list', { start: 0, length: 100 })
    const profiles = (list.data && list.data.profiles) || list.profiles || []
    for (const p of profiles) if (p.uuid) uuids.add(p.uuid)
  } catch (e) {
    log('profile reset: list failed:', e.message)
  }

  let deleted = 0
  for (const uuid of uuids) {
    try {
      await octo('POST', '/api/profiles/force_stop', { uuid })
    } catch {}
    try {
      await deleteProfile(uuid, null, 0)
      deleted += 1
      log(`profile reset: deleted ${uuid}`)
    } catch (e) {
      if (/cannot delete active/i.test(e.message)) blocked = true
      log(`profile reset: could not delete ${uuid}: ${e.message}`)
    }
  }
  return { deleted, blocked }
}

async function deleteAllProfiles() {
  log('profile reset: deleting ALL Octo profiles...')
  let total = 0
  for (let pass = 0; pass < 2; pass += 1) {
    const result = await deleteAllProfilesPass()
    total += result.deleted
    if (!result.blocked) break
    if (pass === 0) await restartOctoApp()
  }
  log(`profile reset: deleted ${total} profile(s)`)
  return total
}

async function createProfile(name, extId) {
  const quick = { alias: name, os: 'mac', os_arch: 'x86' }
  let created
  try {
    created = await octo('POST', '/api/v2/profiles/quick', quick)
  } catch (e) {
    if (!isProfileCreationError(e)) throw e
    log(`profile creation failed (${e.message}); deleting all profiles and restarting batch`)
    await deleteAllProfiles()
    const reset = new Error(`all profiles deleted after profile creation error: ${e.message}`)
    reset.restartBatch = true
    throw reset
  }
  const payload = created && created.data ? created.data : created
  const uuid = payload.uuid || (payload.profile && payload.profile.uuid)
  if (!uuid) throw new Error('Octo did not return a profile uuid')

  const detail = (await octo('GET', `/api/v2/profiles/${uuid}`)).data
  const proxyServer = process.env.ORCH_PROXY_SERVER || ''
  const launchArgs = Array.isArray(detail.launch_args) ? detail.launch_args.slice() : []
  if (proxyServer) launchArgs.push(`--proxy-server=${proxyServer}`)
  const body = {
    name,
    description: detail.description ?? '',
    start_pages: detail.start_pages ?? [],
    bookmarks: detail.bookmarks ?? [],
    launch_args: launchArgs,
    logo: detail.image ?? null,
    tags: detail.tags ?? [],
    folder: detail.folder ?? null,
    pinned_tag: detail.pinned_tag ?? null,
    fp: (detail.fingerprint && detail.fingerprint.data) || detail.fp || {},
    proxy: detail.proxy || { type: 'direct' },
    storage_options: detail.storage_options ?? {},
    local_cache: Boolean(detail.local_cache),
    extensions: [extId],
  }
  await octo('PATCH', `/api/v2/profiles/${uuid}`, body)
  return uuid
}

async function startProfile(uuid) {
  await octo('POST', '/api/profiles/start', { uuid, debug_port: true }, 120000)
  for (let i = 0; i < 90; i += 1) {
    const active = await octo('GET', '/api/profiles/active')
    const rows = Array.isArray(active) ? active : (active && active.data) || []
    const entry = rows.find((p) => p.uuid === uuid)
    if (entry && entry.debug_port && /STARTED|RUNNING/i.test(String(entry.state || ''))) {
      return { debugPort: Number(entry.debug_port), wsEndpoint: entry.ws_endpoint || null }
    }
    await sleep(1000)
  }
  throw new Error('profile did not become ready')
}

// ---------------- CDP ----------------
function cdpEvaluate(wsUrl, expression, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let done = false
    const finish = (fn, value) => {
      if (done) return
      done = true
      try { ws.close() } catch {}
      fn(value)
    }
    const timer = setTimeout(() => finish(reject, new Error('cdp timeout')), timeoutMs)
    ws.addEventListener('open', () => {
      const id = 1
      ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }))
    })
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== 1) return
      clearTimeout(timer)
      if (msg.error) return finish(reject, new Error(JSON.stringify(msg.error)))
      if (msg.result && msg.result.exceptionDetails) {
        return finish(reject, new Error(JSON.stringify(msg.result.exceptionDetails)))
      }
      const value = msg.result && msg.result.result ? msg.result.result.value : null
      finish(resolve, value)
    })
    ws.addEventListener('error', () => { clearTimeout(timer); finish(reject, new Error('cdp ws error')) })
  })
}

function cdpCall(wsUrl, method, params, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let done = false
    const finish = (fn, value) => {
      if (done) return
      done = true
      try { ws.close() } catch {}
      fn(value)
    }
    const timer = setTimeout(() => finish(reject, new Error('cdp timeout')), timeoutMs)
    const id = 1
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id, method, params })))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== id) return
      clearTimeout(timer)
      if (msg.error) return finish(reject, new Error(JSON.stringify(msg.error)))
      finish(resolve, msg.result)
    })
    ws.addEventListener('error', () => { clearTimeout(timer); finish(reject, new Error('cdp ws error')) })
  })
}

async function openExtensionPage(debugPort, browserWs, extBase) {
  let targetId = null
  if (browserWs) {
    try {
      const r = await cdpCall(browserWs, 'Target.createTarget', {
        url: `chrome-extension://${extBase}/popup.html`,
      })
      targetId = r && r.targetId
    } catch {}
  }
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json())
      const t = (list || []).find((x) => x.type === 'page' && String(x.url || '').includes('/popup.html'))
      if (t && t.webSocketDebuggerUrl) return { targetId: targetId || t.id, ws: t.webSocketDebuggerUrl }
    } catch {}
    await sleep(500)
  }
  throw new Error('extension page did not open')
}

// Runs inside popup.html (email-gen.js is loaded there), so assignment does not
// depend on the MV3 service worker waking up.
function assignExpression(targetEmail, profileUuid) {
  return `(async () => {
    const RESET = {
      upiSelected: false, upiSelectedFor: -1,
      qrReady: false, qrReadyFor: -1, qrImage: '', qrEmail: '', qrAt: 0, qrLog: [],
      payRetryFor: -1, payRetryCount: 0,
      startFreeTaps: 0, startFreeTapsFor: -1,
      paySuccess: false, paySuccessFor: -1, paySuccessAt: 0,
      qrGrabbed: false, qrGrabbedFor: -1, qrGrabRequest: null
    };
    const TARGET_EMAIL = ${JSON.stringify(targetEmail)};
    const PROFILE_UUID = ${JSON.stringify(profileUuid)};
    const s = await chrome.storage.local.get(null);
    const interns = (s.interns || []).slice();
    let idx = typeof s.currentIndex === 'number' ? s.currentIndex : 0;
    const cur = interns[idx];
    const isActive = cur && ['pending', 'in_progress'].includes(String(cur.status || '').toLowerCase());

    if (isActive) {
      interns[idx] = Object.assign({}, cur, {
        name: TARGET_EMAIL.split('@')[0],
        email: TARGET_EMAIL,
        status: 'pending',
        note: 'profile-open'
      });
    } else {
      interns.push({ name: TARGET_EMAIL.split('@')[0], email: TARGET_EMAIL, status: 'pending', note: 'profile-open' });
      idx = interns.length - 1;
    }

    const addrMap = Object.assign({}, s.addrMap || {});
    delete addrMap[idx];

    await chrome.storage.local.set(Object.assign({
      domain: TARGET_EMAIL.split('@')[1],
      interns,
      currentIndex: idx,
      flowEpoch: Date.now(),
      addrMap,
      emailHistory: [...(s.emailHistory || []), TARGET_EMAIL].slice(-5000),
      profileUuid: PROFILE_UUID,
      autoAssignDone: true,
      autoAssign: false,
      autoEmail: false,
      deleteAfterQr: true,
      sheetOn: true
    }, RESET));

    const tabs = await chrome.tabs.query({});
    for (const t of (tabs || [])) {
      const u = String(t.url || "");
      if (u.includes("console.cloud.google.com") || u.includes("accounts.cloud.google.com")) {
        try { await chrome.tabs.remove(t.id); } catch (e) {}
      }
    }
    await chrome.tabs.create({ url: '${SIGNUP_URL}' });
    return { email: TARGET_EMAIL };
  })()`
}

async function assignViaExtensionPage(debugPort, browserWs, targetEmail, profileUuid) {
  const page = await openExtensionPage(debugPort, browserWs, EXT.extBase)
  try {
    const value = await cdpEvaluate(page.ws, assignExpression(targetEmail, profileUuid), 45000)
    if (!value || !value.email) throw new Error(`assignment failed: ${(value && value.error) || 'no email'}`)
    return value.email
  } finally {
    if (page.targetId && browserWs) cdpCall(browserWs, 'Target.closeTarget', { targetId: page.targetId }).catch(() => {})
  }
}

// The extension may open its own signup tab on install/startup. After the
// assignment, keep a single flow tab (prefer the most advanced one).
async function dedupeFlowTabs(debugPort, browserWs) {
  try {
    const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json())
    const flow = (list || []).filter((t) => t.type === 'page' && /accounts\.cloud\.google\.com\/(signup|login)|console\.cloud\.google\.com\/freetrial/i.test(String(t.url || '')))
    if (flow.length <= 1) return 0
    const rank = (u) => {
      const s = String(u || '')
      if (s.includes('verify-oob-code')) return 5
      if (s.includes('/tos')) return 4
      if (s.includes('billing')) return 3
      if (s.includes('signup/email')) return 2
      return 1
    }
    flow.sort((a, b) => rank(b.url) - rank(a.url))
    let closed = 0
    for (const t of flow.slice(1)) {
      try {
        if (browserWs) await cdpCall(browserWs, 'Target.closeTarget', { targetId: t.id })
        else await fetch(`http://127.0.0.1:${debugPort}/json/close/${t.id}`)
        closed += 1
      } catch {}
    }
    if (closed) log(`closed ${closed} duplicate flow tab(s)`)
    return closed
  } catch {
    return 0
  }
}

// ---------------- session ----------------
function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve, settled: false }
}

function finishSession(sess, reason) {
  if (!sess) return
  if (!sess.done.settled) {
    sess.done.settled = true
    sess.done.resolve(reason)
  }
}

function resetSessions(reason) {
  for (const [uuid, sess] of sessions) {
    try { clearInterval(sess.poller) } catch {}
    finishSession(sess, reason)
    sessions.delete(uuid)
  }
}

async function deleteSession(sess, reason, delayMs) {
  if (!sess) return
  if (sess.deleting) return sess.deleting
  sess.deleting = (async () => {
    try {
      const r = await deleteProfile(sess.uuid, EXT.extBase, delayMs)
      log(`profile ${sess.uuid} deleted (${reason})${r.ok ? '' : ' ' + (r.error || '')}`)
    } catch (e) {
      log(`delete failed for ${sess.uuid}: ${e.message}`)
    } finally {
      finishSession(sess, reason)
      sess.deleting = null
    }
  })()
  return sess.deleting
}

async function checkSignupError(sess) {
  try {
    const active = await octo('GET', '/api/profiles/active')
    const rows = Array.isArray(active) ? active : (active && active.data) || []
    const entry = rows.find((p) => p.uuid === sess.uuid)
    if (!entry) {
      log(`profile ${sess.uuid} is no longer active (${sess.email})`)
      finishSession(sess, 'stopped')
      return
    }
    const state = String(entry.state || '').toUpperCase()
    if (state === 'ERROR' || state === 'CRASHED' || state === 'STOPPED') {
      log(`profile ${sess.uuid} state ${state}; deleting (${sess.email})`)
      await deleteSession(sess, 'profile-' + state.toLowerCase(), 0)
      return
    }
  } catch {}

  try {
    const list = await fetch(`http://127.0.0.1:${sess.debugPort}/json/list`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json())
    const bad = (list || []).some((t) => {
      const u = String(t.url || '').toLowerCase()
      const title = String(t.title || '').toLowerCase()
      return u.includes('signup/error') || u.includes('error=bad_request') || title.includes("let's try something else")
    })
    if (bad) {
      log(`signup error page detected for ${sess.email}, deleting profile`)
      await deleteSession(sess, 'signup-error', 0)
    }
  } catch {}
}

async function startSession(email) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + Math.random().toString(36).slice(2, 6)
  const name = `${PROFILE_PREFIX} ${stamp}`
  const uuid = await createProfile(name, EXT.compoundId)
  let started
  try {
    started = await startProfile(uuid)
    const assigned = await assignViaExtensionPage(started.debugPort, started.wsEndpoint, email, uuid)
    await sleep(4000)
    await dedupeFlowTabs(started.debugPort, started.wsEndpoint)
    const sess = {
      uuid,
      name,
      email: assigned || email,
      debugPort: started.debugPort,
      done: deferred(),
      poller: null,
      deleting: null,
    }
    sess.poller = setInterval(() => { checkSignupError(sess).catch(() => {}) }, 5000)
    sessions.set(uuid, sess)
    log(`started ${name} uuid=${uuid} port=${started.debugPort} email=${sess.email}`)
    return sess
  } catch (e) {
    if (isProfileCreationError(e)) {
      log(`profile start failed (${e.message}); deleting all profiles and restarting batch`)
      await deleteAllProfiles()
      const reset = new Error(`all profiles deleted after profile start error: ${e.message}`)
      reset.restartBatch = true
      throw reset
    }
    await deleteProfile(uuid, EXT.extBase, 0).catch(() => {})
    throw e
  }
}

async function waitSession(sess) {
  const timer = setTimeout(() => {
    log(`session timeout after ${Math.round(SESSION_TIMEOUT_MS / 1000)}s for ${sess.email}`)
    deleteSession(sess, 'timeout', 0).catch(() => {})
  }, SESSION_TIMEOUT_MS)
  const reason = await sess.done.promise
  clearTimeout(timer)
  clearInterval(sess.poller)
  sessions.delete(sess.uuid)
  log(`session ended (${reason}) for ${sess.email}`)
}

// ---------------- network ----------------
const config = loadConfig()
const android = new AndroidService(config.android)

async function ensureTether() {
  const requireUsb = config.android.requireUsbTether !== false
  if (!requireUsb) {
    const net = await hostNetwork()
    if (!net.internet) throw new Error('internet is not reachable')
    return net
  }
  await android.adb.verifyDevice()
  try {
    await android.tetherAction({ action: 'on' })
  } catch (e) {
    if (requireUsb) throw e
  }
  if (requireUsb) await android.waitForUsbTether(60000)
  const net = await hostNetwork()
  if (!net.internet) throw new Error('internet is not reachable')
  if (requireUsb && !net.egressViaUsb) {
    throw new Error('USB tether internet is not active on the host')
  }
  return net
}

async function cycleIp(beforeIp) {
  const requireUsb = config.android.requireUsbTether !== false
  if (!requireUsb) {
    const net = await hostNetwork()
    if (!net.internet) throw new Error('internet is not reachable')
    return { before: beforeIp || net.egressIp, after: net.egressIp, network: net }
  }
  const before = beforeIp || (await hostNetwork()).egressIp
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    log(`flight mode cycle ${attempt}/3 (${AIRPLANE_SECONDS}s)...`)
    await android.reset({ duration: AIRPLANE_SECONDS })

    let net = null
    for (let wait = 0; wait < 12; wait += 1) {
      await sleep(2500)
      net = await hostNetwork()
      const usbOk = requireUsb ? net.egressViaUsb : true
      if (net.internet && usbOk && net.egressIp && net.egressIp !== before) {
        return { before, after: net.egressIp, network: net }
      }
    }

    log(`IP unchanged (${(net && net.egressIp) || 'none'}), retrying`)
    await android.tetherAction({ action: 'on' }).catch(() => {})
    await sleep(3000)
  }
  throw new Error('could not get a new IP via flight mode')
}

// ---------------- HTTP control for the extension ----------------
function send(res, status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy() })
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')) } catch { resolve({}) }
    })
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    })
    res.end()
    return
  }
  if (req.method === 'GET' && req.url.startsWith('/health')) {
    send(res, 200, {
      ok: true,
      runs: true,
      batch: BATCH_SIZE,
      sessions: [...sessions.values()].map((s) => ({ uuid: s.uuid, email: s.email, debugPort: s.debugPort })),
      extension: EXT,
      octoPort: octoPort(),
    })
    return
  }
  if (req.method === 'POST' && req.url.startsWith('/delete')) {
    const body = await readBody(req)
    const extId = String(body.extId || (EXT && EXT.extBase) || '')
    const uuid = String(body.uuid || '')
    try {
      const target = await resolveProfile(uuid, extId)
      if (!target) { send(res, 200, { ok: false, error: 'no active profile' }); return }
      const delay = body.delayMs === undefined ? 3500 : Number(body.delayMs)
      const reason = String(body.reason || 'qr-saved')
      const result = await deleteProfile(target, '', delay)
      const sess = sessions.get(target)
      if (sess) finishSession(sess, reason)
      log(`profile ${target} deleted via /delete (${reason})`)
      send(res, 200, result)
    } catch (e) {
      log(`/delete failed: ${e.message}`)
      send(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && req.url.startsWith('/failed')) {
    const body = await readBody(req)
    const email = String(body.email || '').toLowerCase()
    let sess = null
    if (email) {
      for (const s of sessions.values()) if (String(s.email).toLowerCase() === email) sess = s
    }
    if (!sess && sessions.size === 1) sess = [...sessions.values()][0]
    log(`/failed from extension (${body.email || '?'})`)
    if (sess) deleteSession(sess, 'extension-failed', 1200).catch(() => {})
    send(res, 200, { ok: true })
    return
  }
  send(res, 404, { ok: false, error: 'not found' })
})

// ---------------- main ----------------
async function main() {
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
  log(`control server on http://127.0.0.1:${PORT}`)
  log(`octo api port ${octoPort()}`)

  await uploadExtension()
  if (process.env.ORCH_RESET_PROFILES === '1') {
    try {
      await deleteAllProfiles()
    } catch (e) {
      log('startup profile reset failed:', e.message)
    }
  }
  if (EXT_BASE_ENV && EXT.extBase !== EXT_BASE_ENV) {
    log(`warning: uploaded ext base ${EXT.extBase} != ORCH_EXT_ID ${EXT_BASE_ENV}`)
  }

  try {
    const initial = await ensureTether()
    log(`android ready; usb tether connected, egress ${initial.egressIp}`)
  } catch (e) {
    log(`android not ready yet: ${e.message} (will keep retrying)`)
  }

  let batch = 0
  while (MAX_RUNS === 0 || batch < MAX_RUNS) {
    batch += 1
    log(`===== batch ${batch}${MAX_RUNS ? '/' + MAX_RUNS : ''} (${BATCH_SIZE} profile${BATCH_SIZE > 1 ? 's' : ''}) =====`)
    try {
      await ensureTether()
      const before = (await hostNetwork()).egressIp
      const cycled = await cycleIp(before)
      log(`IP ${cycled.before} -> ${cycled.after} (USB tether)`)

      const emails = generateBatchEmails(BATCH_SIZE)
      log(`batch emails: ${emails.join(', ')}`)

      const started = []
      for (const email of emails) {
        let ok = false
        for (let attempt = 1; attempt <= 2 && !ok; attempt += 1) {
          try {
            started.push(await startSession(email))
            ok = true
          } catch (e) {
            if (e && e.restartBatch) throw e
            log(`start failed for ${email} (attempt ${attempt}/2): ${e.message}`)
            if (attempt < 2) await sleep(3000)
          }
        }
      }

      if (started.length === 0) {
        log('no profiles started this batch')
        await sleep(5000)
        continue
      }

      log(`waiting for ${started.length} profile(s): ${started.map((s) => s.email).join(', ')}`)
      await Promise.allSettled(started.map((s) => waitSession(s)))
      log(`batch ${batch} complete — toggling IP for next batch`)
    } catch (e) {
      if (e && e.restartBatch) {
        resetSessions('profile-reset')
        batch -= 1
        log('all profiles deleted — rerunning the 3-profile batch')
        await sleep(3000)
        continue
      }
      log(`batch ${batch} error: ${e.message}`)
      await sleep(5000)
    }
  }

  log('finished')
  server.close()
  process.exit(0)
}

process.on('SIGINT', () => {
  log('interrupted; leaving any running profile in place')
  server.close()
  process.exit(0)
})

main().catch((e) => {
  console.error('[orchestrator] fatal:', e)
  process.exit(1)
})
