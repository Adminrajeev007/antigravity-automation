#!/usr/bin/env node
/**
 * Octo profile reaper (local helper).
 *
 * Octo refuses to delete an active profile, and an extension cannot delete the
 * profile it is running in (the browser dies before the second call). This tiny
 * local service does the two-step stop -> delete when the extension asks.
 *
 *   POST http://127.0.0.1:8791/delete  {"uuid":"..."}
 *   GET  http://127.0.0.1:8791/health
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = Number(process.env.REAPER_PORT || 8791)
const OCTO_HOME = path.join(os.homedir(), '.Octo Browser')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function octoPort() {
  try {
    const raw = fs.readFileSync(path.join(OCTO_HOME, 'local_port'), 'utf8').trim()
    const port = Number(raw)
    if (Number.isInteger(port) && port > 1 && port < 65536) return port
  } catch {}
  return 58888
}

async function octo(method, target, body) {
  const port = octoPort()
  const init = { method, headers: {}, signal: AbortSignal.timeout(20000) }
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`http://127.0.0.1:${port}${target}`, init)
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  const failed = !res.ok || (data && data.success === false)
  if (failed) {
    const err = data?.error
    const message = (err && (err.message || err.code)) || data?.message || data?.raw || `HTTP ${res.status}`
    const e = new Error(typeof message === 'string' ? message : JSON.stringify(message))
    e.status = res.status
    e.code = err?.code
    throw e
  }
  return data
}

async function resolveProfile(uuid, extId) {
  if (uuid && /^[0-9a-fA-F]{32}$/.test(uuid)) return uuid

  const data = await octo('GET', '/api/profiles/active')
  const rows = Array.isArray(data) ? data : (data && data.data) || []
  if (!Array.isArray(rows) || rows.length === 0) return null
  if (rows.length === 1) return rows[0].uuid

  const matches = []
  if (extId) {
    for (const p of rows) {
      try {
        const detail = await octo('GET', `/api/v2/profiles/${encodeURIComponent(p.uuid)}`)
        const exts = (detail && detail.data && detail.data.extensions) || []
        if (exts.some((e) => (e.ext_id || '') === extId)) matches.push(p)
      } catch {}
    }
  }

  const pool = matches.length ? matches : rows
  pool.sort((a, b) => (Number(b.start_time) || 0) - (Number(a.start_time) || 0))
  return pool[0] ? pool[0].uuid : null
}

async function deleteProfile(uuid, extId) {
  const target = await resolveProfile(uuid, extId)
  if (!target) throw new Error('no active profile found')
  uuid = target

  // Give the fleet/dashboard a moment to receive the QR image before closing.
  await sleep(3500)

  let stopped = false
  try {
    await octo('POST', '/api/profiles/stop', { uuid })
    stopped = true
  } catch (e) {
    // Already stopped is fine; remember and keep going.
    stopped = /not.*(running|started)|SC\d+/i.test(String(e.message)) ? true : false
  }

  await sleep(1200)

  let lastError = null
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await octo('POST', '/api/v2/profiles/delete', { uuids: [uuid] })
      return { ok: true, uuid, stopped }
    } catch (e) {
      lastError = e
      await sleep(700 + attempt * 250)
    }
  }
  throw lastError || new Error('delete failed')
}

function send(res, status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type'
  })
  res.end(text)
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type'
    })
    res.end()
    return
  }

  if (req.method === 'GET' && req.url.startsWith('/health')) {
    send(res, 200, { ok: true, octoPort: octoPort(), time: new Date().toISOString() })
    return
  }

  if (req.method === 'POST' && req.url.startsWith('/delete')) {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 1e6) req.destroy() })
    req.on('end', async () => {
      let uuid = ''
      let extId = ''
      try {
        const body = JSON.parse(raw || '{}')
        uuid = String(body.uuid || '')
        extId = String(body.extId || body.ext_id || '')
      } catch {}
      try {
        const result = await deleteProfile(uuid, extId)
        console.log(`[reaper] deleted ${result.uuid}`)
        send(res, 200, result)
      } catch (e) {
        console.error(`[reaper] delete failed: ${e.message}`)
        send(res, 500, { ok: false, error: e.message })
      }
    })
    return
  }

  send(res, 404, { ok: false, error: 'not found' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[reaper] listening on http://127.0.0.1:${PORT} (octo ${octoPort()})`)
})
