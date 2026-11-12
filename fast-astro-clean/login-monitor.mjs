#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const LOG = path.join(os.homedir(), 'Desktop', 'antig-logs', 'login-monitor.log')
const OCTO = 'http://127.0.0.1:58888'
const EXT_ID = process.env.MONITOR_EXT_ID || 'hodjpfamccbkkjhfjcamkbgkjhlbffhg'
const EXPECTED_VERSION = process.env.MONITOR_EXPECTED_VERSION || '2.9.39'
const TARGET = Number(process.env.MONITOR_TARGET || 8)
const START_COMPLETED = Number(process.env.MONITOR_START_COMPLETED || 0)
const STOP_ON_TARGET = process.env.MONITOR_STOP_ON_TARGET === '1'
const START_BATCH = Number(process.env.MONITOR_BATCH_START || 1)

function log(message) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true })
  const line = `${new Date().toISOString().slice(0, 19).replace('T', ' ')} ${message}`
  fs.appendFileSync(LOG, line + '\n')
  console.log(line)
}

async function octo(target) {
  const res = await fetch(OCTO + target, { signal: AbortSignal.timeout(15000) })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 120)}`)
  return data
}

async function activeLogin() {
  const active = await octo('/api/profiles/active')
  const rows = Array.isArray(active) ? active : (active && active.data) || []
  for (const row of rows) {
    try {
      const detail = await octo(`/api/v2/profiles/${encodeURIComponent(row.uuid)}`)
      const title = String((detail.data && detail.data.title) || '')
      if (/^GCP Antigravity Login/i.test(title)) {
        return {
          uuid: row.uuid,
          debugPort: Number(row.debug_port) || 0,
          state: row.state,
          title,
        }
      }
    } catch (e) {}
  }
  return null
}

function cdpCall(wsUrl, method, params, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let done = false
    const finish = (fn, value) => {
      if (done) return
      done = true
      try { ws.close() } catch (e) {}
      fn(value)
    }
    const timer = setTimeout(() => finish(reject, new Error('cdp timeout')), timeoutMs)
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method, params })))
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id !== 1) return
      clearTimeout(timer)
      if (msg.error) finish(reject, new Error(JSON.stringify(msg.error)))
      else finish(resolve, msg.result)
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      finish(reject, new Error('ws error'))
    })
  })
}

async function extensionState(port) {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(8000),
  }).then((res) => res.json())
  const target = targets.find((x) => x.type === 'service_worker' && x.url.includes(EXT_ID))
    || targets.find((x) => x.type === 'service_worker' && x.url.includes('background.js'))
    || targets.find((x) => x.type === 'page' && x.url.includes('/popup.html'))
  if (!target) throw new Error('login extension target not found')

  const result = await cdpCall(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: `(async () => {
      const state = await chrome.storage.local.get(null)
      const proxy = state.proxy || {}
      let proxyMode = ''
      try {
        const settings = await chrome.proxy.settings.get({})
        proxyMode = (settings && settings.value && settings.value.mode) || ''
      } catch (e) {}
      const interns = Array.isArray(state.interns) ? state.interns : []
      const current = interns[Number(state.currentIndex) || 0] || {}
      return {
        version: chrome.runtime.getManifest().version,
        total: interns.length,
        currentIndex: Number(state.currentIndex) || 0,
        email: String(current.email || ''),
        status: String(current.status || ''),
        done: interns.filter((x) => x.status === 'done').map((x) => x.email),
        inProgress: interns.filter((x) => x.status === 'in_progress').map((x) => x.email),
        failed: interns.filter((x) => x.status === 'failed').length,
        pending: interns.filter((x) => x.status === 'pending').length,
        sheet: String(state.sheetSyncStatus || ''),
        proxyEnabled: !!proxy.enabled,
        proxyMode,
        oauthApiResult: String(state.oauthApiResult || ''),
        lastOauthApiError: String(state.lastOauthApiError || ''),
        oauthCompletedEmail: String(state.oauthCompletedEmail || ''),
      }
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  return result.result ? result.result.value : null
}

const seenDone = new Set()
const everInProgress = new Set()
let totalDone = START_COMPLETED
let batch = START_BATCH
let profile = null
let lastEmail = ''
let lastStatus = ''
let lastDoneCount = 0
let lastSheet = ''
let lastError = ''
let readingSince = 0
let lastSummaryAt = 0
let targetLogged = false
let missingSince = 0
let seededDone = false

log(`MONITOR start: target=${TARGET}, already_completed=${START_COMPLETED}, batch=${START_BATCH}`)

while (true) {
  try {
    const active = await activeLogin()
    if (!active) {
      if (!missingSince) missingSince = Date.now()
      if (Date.now() - missingSince > 60000) {
        log('ERROR no active GCP Antigravity Login profile for >60s')
        missingSince = Date.now() - 60000
      }
    } else {
      missingSince = 0
      if (profile && active.uuid !== profile.uuid) {
        log(`BATCH_PROFILE_CHANGE ${profile.uuid} -> ${active.uuid}`)
        batch++
        lastEmail = ''
        lastStatus = ''
        lastDoneCount = 0
        readingSince = 0
        log(`BATCH_START batch=${batch} profile=${active.uuid} title=${active.title}`)
      }
      profile = active
      const state = await extensionState(active.debugPort)
      if (!state) throw new Error('empty extension state')

      if (state.version !== EXPECTED_VERSION) {
        if (lastError !== 'version:' + state.version) log(`ERROR extension version=${state.version}, expected ${EXPECTED_VERSION}`)
        lastError = 'version:' + state.version
      }
      if (!state.proxyEnabled || state.proxyMode !== 'fixed_servers') {
        const key = `proxy:${state.proxyEnabled}:${state.proxyMode}`
        if (lastError !== key) log(`ERROR proxy not active: enabled=${state.proxyEnabled} mode=${state.proxyMode}`)
        lastError = key
      }

      if (!seededDone) {
        for (const email of state.done) {
          const key = String(email || '').toLowerCase()
          if (key) seenDone.add(key)
        }
        seededDone = true
        log(`SEEDED existing done=${state.done.length}; watching new completions only`)
      }
      if (state.done.length < lastDoneCount) {
        log(`BUG done count dropped ${lastDoneCount} -> ${state.done.length} profile=${active.uuid}`)
      }
      if (state.inProgress.length > 1) {
        log(`BUG multiple in_progress emails: ${state.inProgress.join(', ')}`)
      }
      for (const email of state.inProgress) {
        const key = String(email || '').toLowerCase()
        if (key) everInProgress.add(key)
      }
      for (const email of state.done) {
        const key = String(email || '').toLowerCase()
        if (!key || seenDone.has(key)) continue
        seenDone.add(key)
        // Ignore rows the sheet already marks completed; only count emails we
        // actually watched move through in_progress in this run.
        if (!everInProgress.has(key)) continue
        if (String(email).toLowerCase() === String(lastEmail).toLowerCase() && lastStatus === 'done') {
          log(`BUG duplicate completed email ${email} in profile=${active.uuid}`)
        }
        totalDone++
        log(`COMPLETED total=${totalDone}/${TARGET} batch=${batch} email=${email}`)
        if (totalDone >= TARGET && !targetLogged) {
          targetLogged = true
          log(`TARGET_REACHED ${TARGET} emails`)
          if (STOP_ON_TARGET && profile) {
            try {
              await fetch(`${OCTO}/api/profiles/stop`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ uuid: profile.uuid }),
              })
              log(`TARGET_STOP profile=${profile.uuid}`)
            } catch (e) {
              log(`TARGET_STOP_ERROR ${e.message}`)
            }
            process.exit(0)
          }
        }
      }

      if (lastEmail && state.email && state.email !== lastEmail) {
        const lastWasActive = lastStatus === 'in_progress'
        const noNewDone = state.done.length === lastDoneCount
        if (lastWasActive && noNewDone) {
          log(`BUG email changed mid-flight: ${lastEmail} -> ${state.email} (done=${state.done.length})`)
        }
      }
      if (lastEmail && lastEmail === state.email && lastStatus === 'done' && state.status === 'pending') {
        log(`BUG done email reset to pending: ${state.email}`)
      }
      if (state.done.some((e) => String(e).toLowerCase() === String(state.email).toLowerCase()) && state.status !== 'done') {
        log(`BUG active email already completed: ${state.email} status=${state.status}`)
      }

      if (state.sheet !== lastSheet) {
        if (/fail|error|busy/i.test(state.sheet)) {
          log(`ERROR sheet: ${state.sheet}`)
        }
        if (/reading sheet/i.test(state.sheet)) readingSince = Date.now()
        else readingSince = 0
        lastSheet = state.sheet
      } else if (/reading sheet/i.test(state.sheet) && readingSince && Date.now() - readingSince > 180000) {
        log('ERROR sheet sync stuck >3m')
        readingSince = Date.now()
      }

      if (state.oauthApiResult === 'rejected' && state.lastOauthApiError) {
        const key = 'api:' + state.lastOauthApiError.slice(0, 100)
        if (lastError !== key) log(`ERROR OAuth API rejected: ${state.lastOauthApiError.slice(0, 180)}`)
        lastError = key
      }

      lastEmail = state.email
      lastStatus = state.status
      lastDoneCount = state.done.length
      if (Date.now() - lastSummaryAt > 60000) {
        lastSummaryAt = Date.now()
        log(`STATUS batch=${batch} total=${totalDone}/${TARGET} profile=${active.uuid} current=${state.email} status=${state.status} done=${state.done.length} failed=${state.failed} queued=${state.total} sheet="${state.sheet}" proxy=${state.proxyEnabled}/${state.proxyMode}`)
      }
    }
  } catch (e) {
    log(`ERROR monitor: ${e.message}`)
  }
  await new Promise((resolve) => setTimeout(resolve, 10000))
}
