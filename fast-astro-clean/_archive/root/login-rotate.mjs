#!/usr/bin/env node
import fs from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const ROOT = path.join(os.homedir(), 'Desktop', 'antig-logs')
const CWD = process.cwd()
const BUNDLE = process.env.LOGIN_BUNDLE || (fs.existsSync(path.join(CWD, 'antig-orchestrator-mac')) ? path.join(CWD, 'antig-orchestrator-mac') : CWD)
const ROTATE_AFTER = Number(process.env.LOGIN_ROTATE_AFTER || 4)
const LOG = path.join(ROOT, 'login-rotate.log')

function log(message) {
  fs.mkdirSync(ROOT, { recursive: true })
  const line = `${new Date().toISOString().slice(0, 19).replace('T', ' ')} ${message}`
  fs.appendFileSync(LOG, line + '\n')
  console.log(line)
}

async function octo(method, target, body) {
  const init = { method, headers: {}, signal: AbortSignal.timeout(20000) }
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`http://127.0.0.1:58888${target}`, init)
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok || (data && data.success === false)) throw new Error(`${res.status} ${text.slice(0, 200)}`)
  return data
}

async function loginProfile() {
  const active = await octo('GET', '/api/profiles/active')
  const rows = Array.isArray(active) ? active : (active && active.data) || []
  for (const row of rows) {
    try {
      const detail = await octo('GET', `/api/v2/profiles/${encodeURIComponent(row.uuid)}`)
      const title = String((detail.data && detail.data.title) || '')
      if (/^GCP Antigravity Login/i.test(title)) {
        return { uuid: row.uuid, startTime: Number(row.start_time) || 0, state: row.state, debugPort: Number(row.debug_port) || 0 }
      }
    } catch {}
  }
  return null
}

async function doneCount(port) {
  if (!port) throw new Error('login profile has no debug port')
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
  const target = targets.find((x) => x.type === 'service_worker' && x.url.includes('background.js'))
    || targets.find((x) => x.type === 'page' && x.url.includes('/popup.html'))
  if (!target) throw new Error('login extension target not found')

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  const call = (method, params = {}) => new Promise((resolve) => {
    const callId = ++id
    pending.set(callId, resolve)
    ws.send(JSON.stringify({ id: callId, method, params }))
    setTimeout(() => resolve({ error: 'timeout' }), 10000)
  })

  const result = await call('Runtime.evaluate', {
    expression: `(async () => {
      const storage = await chrome.storage.local.get(null)
      const interns = storage.interns || []
      return {
        done: interns.filter((x) => x.status === 'done').length,
        total: interns.length,
        sheet: storage.sheetSyncStatus || '',
      }
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  ws.close()
  if (result.error) throw new Error('CDP evaluate failed')
  return result.result?.result?.value || { done: 0, total: 0, sheet: '' }
}

function startNewLogin() {
  const toggle = path.join(BUNDLE, 'toggle-batch-ip.sh')
  if (fs.existsSync(toggle)) {
    try {
      log('rotating proxy IP before next batch')
      execFileSync(toggle, [], { cwd: BUNDLE, timeout: 240000, stdio: 'ignore' })
      log('proxy IP rotation completed')
    } catch (e) {
      log(`phone IP toggle failed: ${e.message}`)
    }
  }
  log('starting a fresh login profile')
  const child = spawn(path.join(BUNDLE, 'login-setup.sh'), [], {
    cwd: BUNDLE,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, LOGIN_USE_PROXY: process.env.LOGIN_USE_PROXY || '1' },
  })
  child.unref()
}

let rotating = false
while (true) {
  try {
    const profile = await loginProfile()
    if (!profile) {
      log('no active login profile')
    } else if (!rotating) {
      const state = await doneCount(profile.debugPort)
      log(`login profile ${profile.uuid}: ${state.done}/${ROTATE_AFTER} completed, ${state.total} queued`)
      if (state.done >= ROTATE_AFTER) {
        rotating = true
        log(`rotation threshold reached; closing ${profile.uuid}`)
        try { await octo('POST', '/api/profiles/stop', { uuid: profile.uuid }) } catch {}
        await new Promise((r) => setTimeout(r, 2000))
        try { await octo('POST', '/api/v2/profiles/delete', { uuids: [profile.uuid] }) } catch (e) { log(`delete failed: ${e.message}`) }
        await new Promise((r) => setTimeout(r, 1500))
        startNewLogin()
        await new Promise((r) => setTimeout(r, 15000))
        rotating = false
      }
    }
  } catch (e) {
    log(`error: ${e.message}`)
  }
  await new Promise((r) => setTimeout(r, 30000))
}
