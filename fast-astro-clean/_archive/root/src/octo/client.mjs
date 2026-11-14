import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { OCTO_HOME } from './config.mjs'

const execFileAsync = promisify(execFile)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export class OctoError extends Error {
  constructor(message, { status = 502, body = null, target = '' } = {}) {
    super(message)
    this.name = 'OctoError'
    this.status = status
    this.body = body
    this.target = target
  }
}

function upstreamStatus(status) {
  if (status >= 400 && status < 500) return status
  return 502
}

export class OctoClient {
  constructor({ port = 0, timeoutMs = 120000, appName = 'Octo Browser' } = {}) {
    this._port = port || 0
    this.timeoutMs = timeoutMs
    this.appName = appName
  }

  async detectPort(force = false) {
    if (!force && this._port) return this._port

    try {
      const raw = fs.readFileSync(path.join(OCTO_HOME, 'local_port'), 'utf8').trim()
      const port = Number(raw)
      if (Number.isInteger(port) && port > 1 && port < 65536) {
        this._port = port
        return port
      }
    } catch {
      // Fall through to lsof when the port file does not exist.
    }

    try {
      const { stdout } = await execFileAsync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { timeout: 10000 })
      for (const line of stdout.split('\n')) {
        if (!/octo/i.test(line)) continue
        const match = line.match(/:(\d+) \(LISTEN\)/)
        if (!match) continue
        const port = Number(match[1])
        if (Number.isInteger(port) && port > 1 && port < 65536) {
          this._port = port
          return port
        }
      }
    } catch {
      // lsof is unavailable or Octo is not listening.
    }

    throw new OctoError('Octo Browser local API port not found. Start Octo Browser and try again.', { status: 503 })
  }

  async request(method, target, body, { timeoutMs = this.timeoutMs, retry = true } = {}) {
    const port = await this.detectPort()
    const headers = {}
    const init = { method, headers, signal: AbortSignal.timeout(timeoutMs) }

    if (body !== undefined) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    let response
    try {
      response = await fetch(`http://127.0.0.1:${port}${target}`, init)
    } catch (error) {
      if (retry) {
        this._port = 0
        return this.request(method, target, body, { timeoutMs, retry: false })
      }
      throw new OctoError(`Octo API request failed: ${error.message}`, { status: 502, target })
    }

    const text = await response.text()
    let data = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = { raw: text }
      }
    }

    if (!response.ok) {
      const raw = data?.error || data?.message || data?.raw || `HTTP ${response.status}`
      const message = typeof raw === 'string' ? raw : JSON.stringify(raw)
      throw new OctoError(message, {
        status: upstreamStatus(response.status),
        body: data,
        target,
      })
    }

    return data
  }

  async ensureApp({ waitMs = 30000 } = {}) {
    try {
      await this.username()
      return true
    } catch {
      // Octo is not answering yet; try to launch it.
    }

    try {
      await execFileAsync('open', ['-a', this.appName])
    } catch (error) {
      throw new OctoError(`Could not launch ${this.appName}: ${error.message}`, { status: 503 })
    }

    const deadline = Date.now() + waitMs
    while (Date.now() < deadline) {
      await sleep(1000)
      try {
        await this.username()
        return true
      } catch {
        // Keep waiting for the local API.
      }
    }

    throw new OctoError(
      `${this.appName} did not start its local API within ${Math.round(waitMs / 1000)}s.`,
      { status: 504 },
    )
  }

  async username() {
    return this.request('GET', '/api/username', undefined, { timeoutMs: 5000 })
  }

  async listExtensions() {
    const data = await this.request('GET', '/api/v2/extensions')
    if (data && data.success === false) {
      throw new OctoError('Octo returned an error while listing extensions.', { body: data })
    }
    const list = data?.data?.extensions ?? data?.extensions ?? (Array.isArray(data) ? data : [])
    return Array.isArray(list) ? list : []
  }

  async activeProfiles() {
    const data = await this.request('GET', '/api/profiles/active')
    if (Array.isArray(data)) return data
    if (Array.isArray(data?.data)) return data.data
    return []
  }

  async listProfiles() {
    const rows = []
    const length = 100
    let start = 0

    for (;;) {
      const data = await this.request('POST', '/api/v2/profiles/list', { start, length })
      if (data && data.success === false) {
        throw new OctoError('Octo returned an error while listing profiles.', { body: data })
      }
      const page = data?.data?.profiles ?? data?.profiles ?? []
      const total = Number(data?.data?.total ?? data?.total ?? 0)
      if (!Array.isArray(page) || page.length === 0) return rows
      rows.push(...page)
      if (!total || rows.length >= total) return rows
      start += length
      if (start > 100000) return rows
    }
  }

  async getProfile(uuid) {
    const data = await this.request('GET', `/api/v2/profiles/${encodeURIComponent(uuid)}`)
    if (data && data.success === false) {
      throw new OctoError(`Could not load profile ${uuid}.`, { status: 404, body: data })
    }
    return data?.data ?? data
  }

  async quickCreate({ alias, os = 'mac', osArch = 'x86' }) {
    const data = await this.request('POST', '/api/v2/profiles/quick', { alias, os, os_arch: osArch })
    if (data && data.success === false) {
      throw new OctoError('Octo could not create the profile.', { body: data })
    }
    return data?.data ?? data
  }

  async updateProfile(uuid, body) {
    const data = await this.request('PATCH', `/api/v2/profiles/${encodeURIComponent(uuid)}`, body)
    if (data && data.success === false) {
      throw new OctoError('Octo could not update the profile.', { body: data })
    }
    return data?.data ?? data
  }

  async deleteProfiles(uuids) {
    const data = await this.request('POST', '/api/v2/profiles/delete', { uuids })
    if (data && data.success === false) {
      throw new OctoError('Octo could not delete the profile.', { body: data })
    }
    return data?.data ?? data
  }

  async startProfile(uuid, { debugPort = true, timeoutMs = 90000 } = {}) {
    const data = await this.request(
      'POST',
      '/api/profiles/start',
      { uuid, debug_port: debugPort },
      { timeoutMs: 120000 },
    )
    if (data?.ws_endpoint) return data

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await sleep(500)
      const active = await this.activeProfiles()
      const entry = active.find((item) => item.uuid === uuid)
      if (!entry) continue
      const state = String(entry.state || '').toUpperCase()
      if ((state === 'STARTED' || state === 'RUNNING') && (!debugPort || entry.ws_endpoint)) {
        return entry
      }
    }

    throw new OctoError(
      `Profile ${uuid} did not become ready within ${Math.round(timeoutMs / 1000)}s.`,
      { status: 504 },
    )
  }

  async stopProfile(uuid) {
    try {
      return await this.request('POST', '/api/profiles/stop', { uuid })
    } catch (error) {
      if (error.status === 404) return null
      throw error
    }
  }
}
