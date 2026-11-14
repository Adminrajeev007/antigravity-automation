#!/usr/bin/env node
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { loadConfig, ROOT_DIR } from './octo/config.mjs'
import { OctoClient } from './octo/client.mjs'
import { ProfileService } from './octo/profiles.mjs'
import { AndroidService } from './android/service.mjs'
import { HidAutomation } from './hid/hid.mjs'
import { fetchGoogleCode } from './otp/dispose.mjs'
import {
  DEFAULT_EMAIL_DOMAIN,
  EMAIL_DOMAINS,
  EXTENSION_ACCOUNT_API_BASE,
  randomEmailDomain,
} from './otp/domains.mjs'
import { RunLog } from './runs.mjs'
import { RecordsService } from './sheets/records.mjs'
import { startStuckMonitor } from './monitor.mjs'

const VERSION = '0.1.0'
const config = loadConfig()
const client = new OctoClient()
const service = new ProfileService(client, config.octo)
const android = new AndroidService(config.android)
const hid = new HidAutomation()
const runs = new RunLog()
const records = new RecordsService(config.sheets)
let lastRotation = null

const liveEvents = []
const activeOperations = new Map()
let liveEventSeq = 0
let liveOperationSeq = 0

function emitLiveEvent(type, data = {}) {
  const event = {
    id: ++liveEventSeq,
    type,
    at: new Date().toISOString(),
    ...data,
  }
  liveEvents.unshift(event)
  if (liveEvents.length > 120) liveEvents.length = 120
  return event
}

emitLiveEvent('server', { message: 'antiG live dashboard online' })

function summarizeResult(result) {
  if (!result || typeof result !== 'object') return null
  const summary = {}
  for (const key of ['name', 'uuid', 'ok', 'state', 'proxy', 'ip', 'email', 'status']) {
    if (result[key] !== undefined && typeof result[key] !== 'object') {
      summary[key] = result[key]
    }
  }
  if (Array.isArray(result.extensions)) {
    summary.extensions = result.extensions
      .map((item) => [item.name, item.version].filter(Boolean).join(' '))
      .filter(Boolean)
  }
  if (result.profile) {
    summary.profile = { name: result.profile.name, uuid: result.profile.uuid }
  }
  if (result.previous) {
    summary.previous = { name: result.previous.name, uuid: result.previous.uuid }
  }
  if (result.network) {
    summary.network = {
      hostBeforeIp: result.network.hostBeforeIp || null,
      hostAfterIp: result.network.hostAfterIp || null,
      hostIpChanged: result.network.hostIpChanged ?? null,
      egressViaUsb: result.network.egressViaUsb ?? null,
    }
  }
  return summary
}
const PUBLIC_DIR = path.join(ROOT_DIR, 'public')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type',
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...CORS })
  res.end(JSON.stringify(body))
}

function sendError(res, error) {
  const status = Number(error?.status)
  const code = status >= 400 && status <= 599 ? status : 500
  sendJson(res, code, { ok: false, error: error?.message || String(error) })
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1_000_000) {
      const error = new Error('Request body is too large.')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(raw)
  } catch {
    const error = new Error('Request body must be valid JSON.')
    error.status = 400
    throw error
  }
}

function setLastRotation(action, network, profile, extra = {}) {
  lastRotation = {
    at: new Date().toISOString(),
    rotatedAt: new Date().toISOString(),
    action,
    network,
    profile,
    ...extra,
  }
}

async function prepareProfileNetwork({ serial, duration, resetNetwork } = {}) {
  if (resetNetwork === false) return null

  const target = android.withSerial(serial)
  const before = await target.connection().catch(() => null)
  let network = await target.reset({ duration })
  let after = await target.connection().catch(() => null)

  const ipChanged = () => Boolean(
    before?.host?.egressIp
    && after?.host?.egressIp
    && before.host.egressIp !== after.host.egressIp,
  )
  const usbActive = () => after?.host?.egressViaUsb === true

  let retries = 0
  while (retries < 2 && (!ipChanged() || !usbActive())) {
    retries += 1
    network = await target.reset({ duration })
    after = await target.connection().catch(() => null)
  }

  if (config.android.requireUsbTether !== false && !usbActive()) {
    const error = new Error(
      'USB tether (BetterTether) is not the active egress; refusing to open the Octo profile.',
    )
    error.status = 502
    throw error
  }

  const hostBeforeIp = before?.host?.egressIp || null
  const hostAfterIp = after?.host?.egressIp || null

  emitLiveEvent('ip-change', {
    before: hostBeforeIp,
    after: hostAfterIp,
    changed: hostBeforeIp && hostAfterIp ? hostBeforeIp !== hostAfterIp : null,
    via: after?.host?.egressViaUsb
      ? 'bettertether'
      : (after?.host?.defaultInterface || null),
    usbTether: after?.host?.usbTether?.connected === true,
    mobileBefore: before?.phone?.mobileIp || null,
    mobileAfter: after?.phone?.mobileIp || null,
  })

  return {
    ...network,
    usbTether: after?.host?.usbTether || network?.usbTether || null,
    hostBeforeIp,
    hostAfterIp,
    hostIpChanged: hostBeforeIp && hostAfterIp ? hostBeforeIp !== hostAfterIp : null,
    hostDefaultInterfaceBefore: before?.host?.defaultInterface || null,
    hostDefaultInterfaceAfter: after?.host?.defaultInterface || null,
    egressViaUsb: after?.host?.egressViaUsb ?? null,
    retries,
  }
}

async function logged(action, fn) {
  const started = Date.now()
  const id = ++liveOperationSeq
  const operation = {
    id,
    action,
    status: 'running',
    startedAt: new Date(started).toISOString(),
  }
  activeOperations.set(id, operation)
  emitLiveEvent('operation-start', { operation })

  try {
    const result = await fn()
    const detail = result?.name
      ? `${result.name}${result.uuid ? ` (${result.uuid})` : ''}`
      : 'Completed'
    const durationMs = Date.now() - started
    activeOperations.delete(id)
    runs.record({ action, status: 'success', detail, durationMs })
    emitLiveEvent('operation-end', {
      operation: {
        ...operation,
        status: 'success',
        durationMs,
        finishedAt: new Date().toISOString(),
      },
      detail,
      summary: summarizeResult(result),
    })
    return result
  } catch (error) {
    const durationMs = Date.now() - started
    activeOperations.delete(id)
    runs.record({ action, status: 'error', detail: error.message, durationMs })
    emitLiveEvent('operation-end', {
      operation: {
        ...operation,
        status: 'error',
        durationMs,
        finishedAt: new Date().toISOString(),
      },
      detail: error.message,
    })
    throw error
  }
}

let liveProfilesCache = { at: 0, value: null }
let liveConnectionCache = { at: 0, value: null, promise: null }
let liveRecordsCache = { at: 0, value: null, promise: null }

async function getLiveProfiles(maxAge = 1500) {
  if (liveProfilesCache.value && Date.now() - liveProfilesCache.at < maxAge) {
    return liveProfilesCache.value
  }
  try {
    const value = await service.list({ withDetails: true })
    liveProfilesCache = { at: Date.now(), value }
    return value
  } catch (error) {
    if (liveProfilesCache.value) return liveProfilesCache.value
    throw error
  }
}

async function getLiveConnection(maxAge = 4000) {
  if (liveConnectionCache.value && Date.now() - liveConnectionCache.at < maxAge) {
    return liveConnectionCache.value
  }
  if (liveConnectionCache.promise) return liveConnectionCache.promise

  liveConnectionCache.promise = android.connection()
    .then((value) => {
      liveConnectionCache = { at: Date.now(), value, promise: null }
      return value
    })
    .catch((error) => {
      liveConnectionCache.promise = null
      return liveConnectionCache.value
        || { ok: false, error: error.message, phone: null, host: null }
    })
  return liveConnectionCache.promise
}

async function getLiveRecords(maxAge = 15000) {
  if (!records.isConfigured()) {
    return {
      configured: false,
      total: 0,
      passed: 0,
      failed: 0,
      last: null,
      successes: [],
    }
  }
  if (liveRecordsCache.value && Date.now() - liveRecordsCache.at < maxAge) {
    return liveRecordsCache.value
  }
  if (liveRecordsCache.promise) return liveRecordsCache.promise

  liveRecordsCache.promise = records.list()
    .then((result) => {
      const items = result.records || []
      const successes = items
        .filter((item) => item.status === 'passed' || item.status === 'registered')
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, 30)
        .map((item) => ({
          email: item.email,
          status: item.status,
          notes: item.notes,
          profileId: item.profileId,
          createdAt: item.createdAt,
        }))
      const value = {
        configured: true,
        total: items.length,
        passed: items.filter((item) => item.status === 'passed').length,
        failed: items.filter((item) => item.status === 'failed').length,
        last: items[items.length - 1] || null,
        successes,
      }
      liveRecordsCache = { at: Date.now(), value, promise: null }
      return value
    })
    .catch((error) => {
      liveRecordsCache.promise = null
      return liveRecordsCache.value
        || {
          configured: true,
          total: 0,
          passed: 0,
          failed: 0,
          last: null,
          successes: [],
          error: error.message,
        }
    })
  return liveRecordsCache.promise
}

function invalidateLiveRecords() {
  liveRecordsCache = { at: 0, value: null, promise: null }
}

function matchProfileRoute(pathname) {
  const match = pathname.match(/^\/api\/profiles\/([^/]+)(?:\/([^/]+))?$/)
  if (!match) return null
  try {
    return {
      ref: decodeURIComponent(match[1]),
      action: match[2] ? decodeURIComponent(match[2]) : '',
    }
  } catch {
    return null
  }
}

async function handleApi(req, res, url) {
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  const method = req.method || 'GET'

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }

  if (pathname === '/api/health' && method === 'GET') {
    sendJson(res, 200, { ok: true, name: 'antiG', version: VERSION })
    return
  }

  if (pathname === '/api/status' && method === 'GET') {
    sendJson(res, 200, await service.status())
    return
  }

  if (pathname === '/api/android/devices' && method === 'GET') {
    try {
      sendJson(res, 200, { ok: true, devices: await android.devices() })
    } catch (error) {
      sendJson(res, 200, { ok: false, devices: [], error: error.message })
    }
    return
  }

  if (pathname === '/api/android/status' && method === 'GET') {
    sendJson(res, 200, await android.status())
    return
  }

  if (pathname === '/api/android/connection' && method === 'GET') {
    sendJson(res, 200, await android.connection())
    return
  }

  if (pathname === '/api/android/airplane' && method === 'POST') {
    const body = await readJson(req)
    const target = android.withSerial(body.serial)
    const action = body.action || (body.duration !== undefined ? 'cycle' : 'status')
    const result = await logged(`Airplane ${action}`, () => target.airplaneAction({
      action,
      duration: body.duration,
    }))
    sendJson(res, 200, result)
    return
  }

  if (pathname === '/api/android/tether' && method === 'POST') {
    const body = await readJson(req)
    const target = android.withSerial(body.serial)
    const action = body.action || 'status'
    const result = await logged(`USB tether ${action}`, () => target.tetherAction({ action }))
    sendJson(res, 200, result)
    return
  }

  if (pathname === '/api/android/reset' && method === 'POST') {
    const body = await readJson(req)
    const target = android.withSerial(body.serial)
    const result = await logged('Reset network', () => target.reset({ duration: body.duration }))
    sendJson(res, 200, result)
    return
  }

  if (pathname === '/api/hid/status' && method === 'GET') {
    sendJson(res, 200, await hid.status())
    return
  }

  if (pathname === '/api/hid/screens' && method === 'GET') {
    sendJson(res, 200, await hid.screens())
    return
  }

  if (pathname === '/api/hid/permission' && method === 'POST') {
    sendJson(res, 200, await logged('Request accessibility permission', () => hid.requestPermission()))
    return
  }

  if (pathname === '/api/hid/type' && method === 'POST') {
    const body = await readJson(req)
    sendJson(res, 200, await logged('HID type', async () => {
      if (body.app) await hid.activate(body.app)
      return hid.type(body.text, { intervalMs: body.intervalMs })
    }))
    return
  }

  if (pathname === '/api/hid/key' && method === 'POST') {
    const body = await readJson(req)
    sendJson(res, 200, await logged('HID key', async () => {
      if (body.app) await hid.activate(body.app)
      return hid.key(body.key, { modifiers: body.modifiers, repeat: body.repeat })
    }))
    return
  }

  if (pathname === '/api/hid/combo' && method === 'POST') {
    const body = await readJson(req)
    sendJson(res, 200, await logged('HID combo', async () => {
      if (body.app) await hid.activate(body.app)
      return hid.combo(body.combo, { repeat: body.repeat })
    }))
    return
  }

  if (pathname === '/api/hid/move' && method === 'POST') {
    const body = await readJson(req)
    sendJson(res, 200, await logged('HID move', () => hid.move(body.x, body.y)))
    return
  }

  if (pathname === '/api/hid/click' && method === 'POST') {
    const body = await readJson(req)
    sendJson(res, 200, await logged('HID click', () => hid.click(body.x, body.y, {
      button: body.button,
      count: body.count,
    })))
    return
  }

  if (pathname === '/api/hid/scroll' && method === 'POST') {
    const body = await readJson(req)
    sendJson(res, 200, await logged('HID scroll', () => hid.scroll(body.dx, body.dy)))
    return
  }

  if (pathname === '/api/hid/drag' && method === 'POST') {
    const body = await readJson(req)
    sendJson(res, 200, await logged('HID drag', () => hid.drag(
      body.fromX,
      body.fromY,
      body.toX,
      body.toY,
      { durationMs: body.durationMs, button: body.button },
    )))
    return
  }

  if (pathname === '/api/hid/activate' && method === 'POST') {
    const body = await readJson(req)
    sendJson(res, 200, await logged('HID activate app', () => hid.activate(body.app)))
    return
  }

  if (pathname === '/api/hid/wait' && method === 'POST') {
    const body = await readJson(req)
    sendJson(res, 200, await logged('HID wait', () => hid.wait(body.ms)))
    return
  }

  if (pathname === '/api/hid/sequence' && method === 'POST') {
    const body = await readJson(req)
    sendJson(res, 200, await logged('HID sequence', () => hid.sequence(body.steps)))
    return
  }

  if (pathname === '/api/otp/dispose' && (method === 'GET' || method === 'POST')) {
    const body = method === 'POST' ? await readJson(req) : {}
    const email = body.email || url.searchParams.get('email')
    const key = body.key || url.searchParams.get('key') || undefined
    sendJson(res, 200, await logged('Fetch dispose OTP', () => fetchGoogleCode(email, { key })))
    return
  }

  if (pathname === '/api/otp/domains' && method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      total: EMAIL_DOMAINS.length,
      defaultDomain: DEFAULT_EMAIL_DOMAIN,
      accountApiBase: EXTENSION_ACCOUNT_API_BASE,
      domains: EMAIL_DOMAINS,
    })
    return
  }

  if (pathname === '/api/otp/domains/random' && method === 'GET') {
    sendJson(res, 200, { ok: true, domain: randomEmailDomain() })
    return
  }

  if (pathname === '/api/app/open' && method === 'POST') {
    const data = await logged('Open Octo Browser', async () => {
      await client.ensureApp()
      return { name: 'Octo Browser' }
    })
    sendJson(res, 200, { ok: true, ...data, status: await service.status() })
    return
  }

  if (pathname === '/api/extensions' && method === 'GET') {
    sendJson(res, 200, await service.listExtensions())
    return
  }

  if (pathname === '/api/runs' && method === 'GET') {
    sendJson(res, 200, { runs: runs.list(url.searchParams.get('limit') || 20) })
    return
  }

  if (pathname === '/api/live' && method === 'GET') {
    const [status, profiles, connection, recordsSummary] = await Promise.all([
      service.status().catch((error) => ({ ok: false, connected: false, error: error.message })),
      getLiveProfiles().catch((error) => ({ profiles: [], total: 0, running: 0, error: error.message })),
      getLiveConnection(),
      getLiveRecords(),
    ])
    const profileList = profiles.profiles || []
    const running = profileList.filter((profile) => profile.running)
    const current = running.find((profile) => (profile.extensions || []).some((ext) => (
      ext.extId === 'bcbhcjepimpgfjimmcnlbajgikcadoob' || ext.name === 'AG Account Creator'
    ))) || running[0] || null
    sendJson(res, 200, {
      ok: true,
      now: new Date().toISOString(),
      server: { version: VERSION, uptimeSeconds: Math.round(process.uptime()) },
      status,
      profiles: profileList,
      running,
      currentProfile: current,
      connection,
      records: recordsSummary,
      lastRotation,
      activeOperations: [...activeOperations.values()],
      events: liveEvents.slice(0, 50),
    })
    return
  }

  if (pathname === '/api/records' && method === 'GET') {
    sendJson(res, 200, await records.list({
      limit: url.searchParams.get('limit'),
      status: url.searchParams.get('status'),
    }))
    return
  }

  if (pathname === '/api/records' && method === 'POST') {
    const body = await readJson(req)
    const result = await logged('Create record', () => records.create(body))
    invalidateLiveRecords()
    sendJson(res, 201, result)
    return
  }

  if (pathname === '/api/records/status' && method === 'GET') {
    sendJson(res, 200, records.status())
    return
  }

  if (pathname === '/api/records/upsert' && method === 'POST') {
    const body = await readJson(req)
    const result = await logged('Upsert record', () => records.upsert(body))
    invalidateLiveRecords()
    sendJson(res, result.created ? 201 : 200, result)
    return
  }

  const recordMatch = pathname.match(/^\/api\/records\/([^/]+)$/)
  if (recordMatch) {
    const id = decodeURIComponent(recordMatch[1])

    if (method === 'GET') {
      sendJson(res, 200, await records.get(id))
      return
    }

    if (method === 'PUT' || method === 'PATCH' || method === 'POST') {
      const body = await readJson(req)
      const result = await logged('Update record', () => records.update(id, body))
      invalidateLiveRecords()
      sendJson(res, 200, result)
      return
    }

    if (method === 'DELETE') {
      const result = await logged('Delete record', () => records.remove(id))
      invalidateLiveRecords()
      sendJson(res, 200, result)
      return
    }
  }

  if (pathname === '/api/profiles' && method === 'GET') {
    const withDetails = url.searchParams.get('details') !== '0'
    sendJson(res, 200, await service.list({ withDetails }))
    return
  }

  if (pathname === '/api/profiles' && method === 'POST') {
    const body = await readJson(req)
    const result = await logged('Create profile', async () => {
      const network = await prepareProfileNetwork({
        serial: body.serial,
        duration: body.duration,
        resetNetwork: body.resetNetwork,
      })
      const created = await service.create({
        name: body.name,
        os: body.os,
        osArch: body.osArch,
        extension: body.extension,
        extensions: body.extensions,
        proxy: body.proxy,
        launch: body.launch === true,
        launchArgs: body.launchArgs,
      })
      if (network) setLastRotation('create', network, created)
      return network ? { ...created, network } : created
    })
    sendJson(res, 201, result)
    return
  }

  if (pathname === '/api/profiles/rotate' && method === 'POST') {
    const body = await readJson(req)
    sendJson(res, 200, await logged('Rotate profile', async () => {
      const network = await prepareProfileNetwork({
        serial: body.serial,
        duration: body.duration,
        resetNetwork: body.resetNetwork,
      })
      const rotated = await service.rotate({
        extension: body.extension,
        profile: body.profile,
        name: body.name,
      })
      const result = { ...rotated, network }
      setLastRotation('rotate', network, rotated.profile, { previous: rotated.previous })
      return result
    }))
    return
  }

  if (pathname === '/api/network/last-rotation' && method === 'GET') {
    sendJson(res, 200, { ok: true, rotation: lastRotation })
    return
  }

  const route = matchProfileRoute(pathname)
  if (route) {
    const { ref, action } = route

    if (!action && method === 'GET') {
      sendJson(res, 200, await service.get(ref))
      return
    }

    if (!action && method === 'DELETE') {
      const force = url.searchParams.get('force') !== '0'
      sendJson(res, 200, await logged('Delete profile', () => service.remove(ref, { force })))
      return
    }

    if (action === 'launch' && method === 'POST') {
      const body = await readJson(req)
      sendJson(res, 200, await logged('Launch profile', async () => {
        const network = await prepareProfileNetwork({
          serial: body.serial,
          duration: body.duration,
          resetNetwork: body.resetNetwork,
        })
        const launched = await service.launch(ref, {
          debugPort: body.debugPort !== false,
        })
        if (network) setLastRotation('launch', network, launched)
        return network ? { ...launched, network } : launched
      }))
      return
    }

    if (action === 'stop' && method === 'POST') {
      sendJson(res, 200, await logged('Stop profile', () => service.stop(ref)))
      return
    }

    if (action === 'extensions' && method === 'POST') {
      const body = await readJson(req)
      if (body.action === 'detach' || body.detach === true) {
        sendJson(res, 200, await logged('Detach extension', () => service.detachExtension(ref, body.extension)))
      } else {
        sendJson(res, 200, await logged('Attach extension', () => service.attachExtension(ref, body.extension)))
      }
      return
    }

    if (action === 'proxy' && method === 'POST') {
      const body = await readJson(req)
      sendJson(res, 200, await logged('Set proxy', () => service.setProxy(ref, body.proxy)))
      return
    }

    if (action === 'rename' && method === 'POST') {
      const body = await readJson(req)
      sendJson(res, 200, await logged('Rename profile', () => service.rename(ref, body.name)))
      return
    }

    if (action === 'launch-args' && method === 'POST') {
      const body = await readJson(req)
      sendJson(res, 200, await logged('Set launch args', () => service.setLaunchArgs(ref, body.args)))
      return
    }
  }

  const error = new Error(`Unknown API route: ${method} ${pathname}`)
  error.status = 404
  throw error
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const error = new Error('Method not allowed.')
    error.status = 405
    throw error
  }

  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    pathname = url.pathname
  }

  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const filePath = path.resolve(PUBLIC_DIR, relative)
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    const error = new Error('Not found.')
    error.status = 404
    throw error
  }

  try {
    const data = await fs.readFile(filePath)
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', ...CORS })
    res.end(req.method === 'HEAD' ? undefined : data)
  } catch {
    const error = new Error('Not found.')
    error.status = 404
    throw error
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url)
    } else {
      await serveStatic(req, res, url)
    }
  } catch (error) {
    if (res.headersSent) {
      res.end()
      return
    }
    sendError(res, error)
  }
})

startStuckMonitor({
  getProfiles: () => getLiveProfiles(2000),
  isBusy: () => activeOperations.size > 0,
  emitEvent: emitLiveEvent,
  log: (message) => console.log(message),
})

server.listen(config.server.port, config.server.host, () => {
  const address = `http://${config.server.host}:${config.server.port}`
  console.log(`antiG dashboard  ${address}`)
  console.log(`MCP server       node mcp/server.mjs`)
  if (config.octo.defaultExtension) console.log(`Default extension  ${config.octo.defaultExtension}`)
  if (records.isConfigured()) console.log(`Records sheet      ${config.sheets.sheetName}`)
})

function shutdown(signal) {
  console.log(`\n${signal} received, shutting down.`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
