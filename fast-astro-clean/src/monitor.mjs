import { CdpClient } from './cdp/client.mjs'

const AG_EXTENSION_NAME = 'AG Account Creator'
const AG_EXTENSION_ID = 'bcbhcjepimpgfjimmcnlbajgikcadoob'
const STUCK_MS = 45000
const POLL_MS = 10000
const MAX_RELOADS = 2
const MAX_RESTARTS = 2

const states = new Map()

function withTimeout(promise, ms, label) {
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function isMonitorable(url) {
  if (!url) return false
  if (url.includes('accounts.google.com/o/oauth2')) return false
  if (url.includes('accounts.google.com/signin/oauth')) return false
  if (url.includes('antigravity.google')) return false
  return url.includes('accounts.cloud.google.com/')
    || url.includes('console.cloud.google.com/freetrial')
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(3000),
  })
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}`)
  return response.json()
}

async function withClient(webSocketUrl, fn) {
  const client = new CdpClient(webSocketUrl)
  await client.ready
  try {
    return await fn(client)
  } finally {
    client.close()
  }
}

async function readExtensionState(client) {
  const result = await client.send('Runtime.evaluate', {
    expression: `chrome.storage.local.get(['config','rotating','profileAttempts','maxAttemptsPerProfile']).then(x=>JSON.stringify(x))`,
    awaitPromise: true,
    returnByValue: true,
  })
  try {
    return JSON.parse(result.result.value || '{}')
  } catch {
    return {}
  }
}

async function evaluateBackground(client, expression, timeoutMs = 60000) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: timeoutMs,
  })
  return result.result && result.result.value
}

async function reloadPage(target) {
  await withClient(target.webSocketDebuggerUrl, (client) => (
    client.send('Page.reload', { ignoreCache: true }, { timeoutMs: 15000 })
  ))
}

async function checkProfile(profile, { emitEvent, log }) {
  const port = profile.debugPort
  const targets = await listTargets(port)
  const pages = targets.filter((target) => target.type === 'page' && isMonitorable(target.url))
  if (pages.length === 0) {
    states.delete(profile.uuid)
    return
  }

  const page = pages[0]
  const worker = targets.find((target) => (
    target.type === 'service_worker' && target.url.includes('/background.js')
  ))
  const current = states.get(profile.uuid)

  if (!current || current.url !== page.url) {
    states.set(profile.uuid, {
      url: page.url,
      since: Date.now(),
      reloads: 0,
      restarts: 0,
      lastActionAt: 0,
    })
    log(`monitor: watching ${profile.name} · ${page.url}`)
    return
  }

  const deadEnd = page.url.includes('signin-error')
  const threshold = deadEnd ? 10000 : STUCK_MS
  if (Date.now() - current.since < threshold) return

  let extension = {}
  if (worker) {
    try {
      extension = await withClient(worker.webSocketDebuggerUrl, readExtensionState)
    } catch {
      extension = {}
    }
  }

  if (extension.config && extension.config.live === false) {
    states.delete(profile.uuid)
    return
  }
  if (extension.rotating) return

  if (deadEnd) {
    if (Date.now() - (current.lastActionAt || 0) < 20000) return
    current.lastActionAt = Date.now()
    current.since = Date.now()
    if (worker) {
      await withClient(worker.webSocketDebuggerUrl, (client) => (
        evaluateBackground(client, 'restartLiveFlow().then(r=>JSON.stringify(r))')
      ))
      emitEvent('stuck-action', {
        action: 'restart',
        profile: profile.name,
        url: page.url,
        reason: 'signin-error',
      })
      log(`monitor: signin-error dead end; restarted live flow for ${profile.name}`)
    } else {
      await withClient(page.webSocketDebuggerUrl, (client) => client.send('Page.close'))
      emitEvent('stuck-action', {
        action: 'close',
        profile: profile.name,
        url: page.url,
        reason: 'signin-error',
      })
      log(`monitor: signin-error dead end; closed stuck page for ${profile.name}`)
    }
    return
  }

  if (current.reloads < MAX_RELOADS) {
    current.reloads += 1
    current.since = Date.now()
    await reloadPage(page)
    emitEvent('stuck-action', {
      action: 'reload',
      profile: profile.name,
      url: page.url,
      attempt: current.reloads,
    })
    log(`monitor: reloaded stuck page for ${profile.name} (${current.reloads}/${MAX_RELOADS})`)
    return
  }

  if (current.restarts < MAX_RESTARTS && worker) {
    current.restarts += 1
    current.since = Date.now()
    await withClient(worker.webSocketDebuggerUrl, (client) => (
      evaluateBackground(client, 'restartLiveFlow().then(r=>JSON.stringify(r))')
    ))
    emitEvent('stuck-action', {
      action: 'restart',
      profile: profile.name,
      url: page.url,
      attempt: current.restarts,
    })
    log(`monitor: restarted live flow for ${profile.name} (${current.restarts}/${MAX_RESTARTS})`)
    return
  }

  if (worker) {
    current.since = Date.now()
    await withClient(worker.webSocketDebuggerUrl, (client) => (
      evaluateBackground(client, 'rotateProfile("stuck monitor").then(r=>JSON.stringify(r))', 90000)
    ))
    emitEvent('stuck-action', {
      action: 'rotate',
      profile: profile.name,
      url: page.url,
    })
    log(`monitor: rotated profile after repeated stuck state: ${profile.name}`)
    states.delete(profile.uuid)
    return
  }

  await withClient(page.webSocketDebuggerUrl, (client) => client.send('Page.close'))
  current.since = Date.now()
  emitEvent('stuck-action', {
    action: 'close',
    profile: profile.name,
    url: page.url,
  })
  log(`monitor: closed stuck page for ${profile.name}`)
}

export function startStuckMonitor({ getProfiles, isBusy, emitEvent, log = console.log }) {
  let busy = false
  log('stuck monitor started (45s page · 10s signin-error)')

  const timer = setInterval(async () => {
    if (busy || isBusy()) return
    busy = true
    try {
      const data = await withTimeout(getProfiles(), 15000, 'profile lookup')
      const profiles = (data.profiles || []).filter((profile) => (
        profile.running
        && profile.debugPort
        && (profile.extensions || []).some((ext) => (
          ext.name === AG_EXTENSION_NAME || ext.extId === AG_EXTENSION_ID
        ))
      ))
      for (const profile of profiles) {
        try {
          await withTimeout(
            checkProfile(profile, { emitEvent, log }),
            30000,
            `stuck check for ${profile.name}`,
          )
        } catch (error) {
          log(`monitor ${profile.name}: ${error.message}`)
        }
      }
    } catch (error) {
      log(`monitor: ${error.message}`)
    } finally {
      busy = false
    }
  }, POLL_MS)

  return () => clearInterval(timer)
}
