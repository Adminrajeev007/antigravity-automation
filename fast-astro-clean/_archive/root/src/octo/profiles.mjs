import { OctoError } from './client.mjs'

export const UUID_RE = /^[0-9a-fA-F]{32}$/

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function compoundExtension(ext) {
  if (!ext) return ''
  if (ext.compound_ext_id) return String(ext.compound_ext_id)
  if (ext.ext_id) {
    const version = ext.version === undefined || ext.version === null ? '' : String(ext.version)
    return version ? `${ext.ext_id}@${version}` : String(ext.ext_id)
  }
  return String(ext.id || ext.uuid || '')
}

export function extensionName(ext) {
  return String(ext?.name || ext?.title || ext?.full_name || compoundExtension(ext) || '')
}

export function normalizeExtensions(extensions) {
  if (!Array.isArray(extensions)) return []
  return extensions
    .map((ext) => ({
      name: extensionName(ext),
      id: compoundExtension(ext),
      version: ext?.version === undefined ? null : ext.version,
      extId: ext?.ext_id ?? null,
      uuid: ext?.uuid ?? null,
    }))
    .filter((ext) => ext.id || ext.name)
}

function compareVersions(a, b) {
  const left = String(a ?? '').split(/[.+-]/)
  const right = String(b ?? '').split(/[.+-]/)
  const length = Math.max(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const l = Number(left[index])
    const r = Number(right[index])
    if (Number.isNaN(l) || Number.isNaN(r)) {
      const result = String(left[index] ?? '').localeCompare(String(right[index] ?? ''))
      if (result !== 0) return result
    } else if (l !== r) {
      return l - r
    }
  }
  return 0
}

function latestVersion(matches) {
  return [...matches].sort((a, b) => compareVersions(b.version, a.version))[0]
}

export function pickExtension(extensions, selector = '') {
  const list = Array.isArray(extensions) ? extensions : []
  if (list.length === 0) {
    throw new OctoError('No extensions are installed in this Octo account.', { status: 404 })
  }

  const query = String(selector ?? '').trim()
  if (!query) return list[0]

  const lower = query.toLowerCase()
  const exact = list.filter((ext) => {
    const values = [ext.uuid, ext.ext_id, ext.id, ext.full_name, ext.name, ext.title, compoundExtension(ext)]
    return values.some((value) => value !== undefined && value !== null
      && (String(value) === query || String(value).toLowerCase() === lower))
  })

  if (exact.length > 0) {
    const identities = new Set(exact.map((ext) => ext.ext_id || ext.uuid || ext.id || extensionName(ext)))
    if (identities.size === 1) return latestVersion(exact)
    const names = exact.slice(0, 5).map(extensionName).join(', ')
    throw new OctoError(`Extension "${query}" is ambiguous: ${names}`, { status: 409 })
  }

  const partial = list.filter((ext) => {
    const values = [ext.name, ext.title, ext.full_name, compoundExtension(ext)]
    return values.some((value) => value !== undefined && value !== null
      && String(value).toLowerCase().includes(lower))
  })

  if (partial.length === 1) return partial[0]
  if (partial.length > 1) {
    const names = partial.slice(0, 5).map(extensionName).join(', ')
    throw new OctoError(`Extension "${query}" is ambiguous: ${names}`, { status: 409 })
  }

  throw new OctoError(`Extension "${query}" was not found.`, { status: 404 })
}

export function parseProxy(value) {
  if (value === undefined || value === null) return { type: 'direct' }
  if (typeof value === 'object') return value

  const raw = String(value).trim()
  if (!raw || ['direct', 'none', 'off'].includes(raw.toLowerCase())) return { type: 'direct' }

  let parsed
  try {
    parsed = new URL(raw.includes('://') ? raw : `socks5://${raw}`)
  } catch {
    throw new OctoError(`Invalid proxy address "${raw}".`, { status: 400 })
  }

  const type = parsed.protocol.replace(':', '').toLowerCase()
  if (!['socks5', 'socks4', 'http', 'https'].includes(type)) {
    throw new OctoError(`Unsupported proxy protocol "${type}". Use socks5, socks4, http, or https.`, { status: 400 })
  }

  const port = Number(parsed.port || (type === 'https' ? 443 : 80))
  if (!parsed.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new OctoError(`Invalid proxy address "${raw}".`, { status: 400 })
  }

  return {
    type: 'new',
    data: {
      type,
      ip: parsed.hostname,
      port,
      login: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
      title: raw,
    },
  }
}

export function proxySummary(proxy) {
  if (!proxy || proxy.type === 'direct') return 'Direct'
  const data = proxy.data || proxy
  const type = data.type || 'proxy'
  const host = data.ip || data.host || ''
  const port = data.port ? `:${data.port}` : ''
  return host ? `${type}://${host}${port}` : String(proxy.type || 'Proxy')
}

function patchBody(profile, overrides = {}) {
  const body = {
    name: profile?.title ?? profile?.name ?? '',
    description: profile?.description ?? '',
    start_pages: profile?.start_pages ?? [],
    bookmarks: profile?.bookmarks ?? [],
    launch_args: profile?.launch_args ?? [],
    logo: profile?.image ?? null,
    tags: profile?.tags ?? [],
    folder: profile?.folder ?? null,
    pinned_tag: profile?.pinned_tag ?? null,
    fp: profile?.fingerprint?.data ?? profile?.fp ?? {},
    proxy: profile?.proxy ?? { type: 'direct' },
    storage_options: profile?.storage_options ?? {},
    local_cache: Boolean(profile?.local_cache),
  }

  if (Array.isArray(profile?.extensions)) {
    body.extensions = profile.extensions.map(compoundExtension).filter(Boolean)
  }

  return { ...body, ...overrides }
}

async function mapLimit(items, limit, fn) {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      await fn(item)
    }
  })
  await Promise.all(workers)
}

function formatRunning(entry) {
  if (!entry) return null
  return {
    state: entry.state || 'RUNNING',
    wsEndpoint: entry.ws_endpoint || null,
    debugPort: entry.debug_port || null,
    browserPid: entry.browser_pid || null,
    ip: (entry.connection_data || {}).ip || null,
  }
}

export class ProfileService {
  constructor(client, { defaultExtension = '', defaultProxy = 'direct', launchArgs = [] } = {}) {
    this.client = client
    this.defaultExtension = defaultExtension
    this.defaultProxy = defaultProxy
    this.launchArgs = Array.isArray(launchArgs) ? launchArgs : []
    this.rotatePromise = null
  }

  async ensureReady() {
    return this.client.ensureApp()
  }

  async status() {
    try {
      const [username, port] = await Promise.all([this.client.username(), this.client.detectPort()])
      return {
        ok: true,
        connected: true,
        port,
        username: typeof username === 'string'
          ? username
          : (username?.data?.username ?? username?.username ?? null),
      }
    } catch (error) {
      return { ok: false, connected: false, error: error.message }
    }
  }

  async list({ withDetails = false } = {}) {
    await this.ensureReady()
    const [rows, active] = await Promise.all([
      this.client.listProfiles(),
      this.client.activeProfiles().catch(() => []),
    ])
    const activeByUuid = new Map(active.map((entry) => [entry.uuid, entry]))

    const profiles = rows.map((row) => {
      const running = formatRunning(activeByUuid.get(row.uuid))
      return {
        name: row.title ?? row.name ?? '',
        uuid: row.uuid,
        running: Boolean(running),
        state: running?.state
          || (Number(row.status) === 0 ? 'STOPPED' : 'STOPPED'),
        ip: running?.ip || (row.connection_data || {}).ip || null,
        wsEndpoint: running?.wsEndpoint || null,
        debugPort: running?.debugPort || null,
        browserPid: running?.browserPid || null,
        proxy: proxySummary(row.proxy),
        extensions: [],
      }
    })

    if (withDetails) {
      await mapLimit(profiles, 5, async (profile) => {
        try {
          const detail = await this.client.getProfile(profile.uuid)
          profile.extensions = normalizeExtensions(detail.extensions)
          profile.proxy = proxySummary(detail.proxy)
        } catch {
          profile.extensions = []
        }
      })
    }

    return {
      profiles,
      total: profiles.length,
      running: profiles.filter((profile) => profile.running).length,
    }
  }

  async resolve(ref) {
    const query = String(ref ?? '').trim()
    if (!query) {
      throw new OctoError('Profile name or UUID is required.', { status: 400 })
    }

    if (UUID_RE.test(query)) {
      return this.client.getProfile(query.toLowerCase())
    }

    const rows = await this.client.listProfiles()
    const exact = rows.filter((row) => (row.title ?? row.name ?? '') === query)
    if (exact.length === 1) return this.client.getProfile(exact[0].uuid)
    if (exact.length > 1) {
      throw new OctoError(`Profile name "${query}" is ambiguous. Use the UUID instead.`, { status: 409 })
    }

    const lower = query.toLowerCase()
    const partial = rows.filter((row) => String(row.title ?? row.name ?? '').toLowerCase().includes(lower))
    if (partial.length === 1) return this.client.getProfile(partial[0].uuid)
    if (partial.length > 1) {
      const names = partial.slice(0, 5).map((row) => row.title ?? row.name ?? row.uuid).join(', ')
      throw new OctoError(`Profile name "${query}" is ambiguous: ${names}`, { status: 409 })
    }

    throw new OctoError(`Profile "${query}" was not found.`, { status: 404 })
  }

  async get(ref) {
    await this.ensureReady()
    const detail = await this.resolve(ref)
    const active = await this.client.activeProfiles().catch(() => [])
    const running = formatRunning(active.find((entry) => entry.uuid === detail.uuid))
    return {
      name: detail.title ?? detail.name ?? '',
      uuid: detail.uuid,
      running: Boolean(running),
      state: running?.state || 'STOPPED',
      ip: running?.ip || (detail.connection_data || {}).ip || null,
      wsEndpoint: running?.wsEndpoint || null,
      debugPort: running?.debugPort || null,
      browserPid: running?.browserPid || null,
      proxy: detail.proxy || { type: 'direct' },
      proxySummary: proxySummary(detail.proxy),
      extensions: normalizeExtensions(detail.extensions),
      launchArgs: detail.launch_args || [],
    }
  }

  async create({
    name,
    os = 'mac',
    osArch = 'x86',
    extension,
    extensions,
    proxy,
    launch = false,
    launchArgs,
  } = {}) {
    const title = String(name ?? '').trim()
    if (!title) throw new OctoError('Profile name is required.', { status: 400 })
    if (title.length > 120) throw new OctoError('Profile name must be 120 characters or fewer.', { status: 400 })

    await this.ensureReady()
    const rows = await this.client.listProfiles()
    if (rows.some((row) => (row.title ?? row.name ?? '') === title)) {
      throw new OctoError(`Profile "${title}" already exists.`, { status: 409 })
    }

    const selectors = Array.isArray(extensions)
      ? extensions.filter(Boolean)
      : (extension !== undefined && extension !== ''
        ? [extension]
        : (this.defaultExtension ? [this.defaultExtension] : []))

    let available = []
    if (selectors.length > 0) {
      available = await this.client.listExtensions()
    }
    const picked = selectors.map((selector) => pickExtension(available, selector))
    const extensionIds = [...new Set(picked.map(compoundExtension).filter(Boolean))]

    const created = await this.client.quickCreate({ alias: title, os, osArch })
    const uuid = created?.uuid ?? created?.profile?.uuid
    if (!uuid) throw new OctoError('Octo did not return a UUID for the new profile.')

    const current = await this.client.getProfile(uuid)
    const overrides = { name: title }
    if (extensionIds.length > 0) overrides.extensions = extensionIds

    const proxyValue = proxy !== undefined ? proxy : this.defaultProxy
    if (proxyValue !== undefined && proxyValue !== null && proxyValue !== '') {
      overrides.proxy = parseProxy(proxyValue)
    }

    const args = Array.isArray(launchArgs)
      ? launchArgs
      : (launchArgs !== undefined ? [launchArgs] : this.launchArgs)
    if (args.length > 0) overrides.launch_args = args

    let updated
    let started = null
    try {
      updated = await this.client.updateProfile(uuid, patchBody(current, overrides))
      if (launch) {
        started = await this.launch(uuid, { debugPort: true })
      }
    } catch (error) {
      try { await this.client.deleteProfiles([uuid]) } catch (e) {}
      throw error
    }

    const applied = await this.client.getProfile(uuid)

    return {
      ok: true,
      uuid,
      name: applied.title ?? updated.title ?? title,
      extensions: normalizeExtensions(applied.extensions ?? updated.extensions ?? current.extensions),
      proxy: proxySummary(applied.proxy ?? updated.proxy ?? current.proxy),
      started,
    }
  }

  async rotate(options = {}) {
    if (this.rotatePromise) return this.rotatePromise
    this.rotatePromise = this.rotateNow(options).finally(() => {
      this.rotatePromise = null
    })
    return this.rotatePromise
  }

  async rotateNow({ extension, profile, name } = {}) {
    await this.ensureReady()

    let detail = null
    if (profile) {
      detail = await this.resolve(profile)
    } else {
      const listed = await this.list({ withDetails: true })
      const running = listed.profiles.filter((item) => item.running)
      const selector = String(extension ?? '').trim()
      const matches = selector
        ? running.filter((item) => item.extensions.some((ext) => (
          ext.id === selector || ext.extId === selector || ext.uuid === selector
        )))
        : running

      if (matches.length === 0) {
        throw new OctoError('No running profile matches the rotation request.', { status: 404 })
      }
      if (matches.length > 1) {
        throw new OctoError(
          'Multiple running profiles match the rotation request; specify a profile.',
          { status: 409 },
        )
      }
      detail = await this.client.getProfile(matches[0].uuid)
    }

    const oldName = detail.title ?? detail.name ?? ''
    const oldUuid = detail.uuid
    const currentExtensions = normalizeExtensions(detail.extensions)
    let extensionIds = currentExtensions.map((item) => item.id).filter(Boolean)
    try {
      const available = await this.client.listExtensions()
      extensionIds = currentExtensions.map((item) => {
        const matches = available.filter((candidate) => candidate.ext_id === item.extId)
        if (matches.length === 0) return item.id
        return compoundExtension(latestVersion(matches))
      }).filter(Boolean)
    } catch {
      // Keep the profile's ids if the extension list cannot be read.
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(11, 19)
    const baseName = String(oldName || 'AG Auto')
      .replace(/(\s+(?:\d{4}-\d{2}-\d{2}T[\d-]+|\d{2}-\d{2}-\d{2}))+$/g, '')
      .trim() || 'AG Auto'
    const title = String(name ?? '').trim() || `${baseName} ${stamp}`.slice(0, 100)

    const build = () => this.create({
      name: title,
      extensions: extensionIds,
      proxy: detail.proxy,
      launch: true,
      launchArgs: detail.launch_args || [],
    })
    const buildWithRetry = async (attempts = 3) => {
      let lastError = null
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          return await build()
        } catch (error) {
          lastError = error
          if (attempt < attempts) await sleep(1500 * attempt)
        }
      }
      throw lastError
    }

    let created
    let oldDeleted = false
    try {
      created = await buildWithRetry()
    } catch (error) {
      const message = String(error?.message || '').toLowerCase()
      if (!/limit|maximum|exceed|too many|profile/.test(message)) throw error
      await this.remove(oldUuid, { force: true })
      oldDeleted = true
      try {
        created = await buildWithRetry()
      } catch (retryError) {
        // Best effort: restore the previous profile so the account is not left empty.
        try {
          await this.create({
            name: oldName,
            extensions: extensionIds,
            proxy: detail.proxy,
            launch: true,
            launchArgs: detail.launch_args || [],
          })
        } catch {
          // Ignore restore failures; the original error is more useful.
        }
        throw retryError
      }
    }

    if (!oldDeleted) {
      await this.remove(oldUuid, { force: true })
    }

    return {
      ok: true,
      previous: { name: oldName, uuid: oldUuid, deleted: true },
      profile: created,
      rotatedAt: new Date().toISOString(),
    }
  }

  async launch(ref, { debugPort = true } = {}) {
    await this.ensureReady()
    const detail = await this.resolve(ref)
    const uuid = detail.uuid

    const active = await this.client.activeProfiles().catch(() => [])
    let entry = active.find((item) => item.uuid === uuid)

    if (entry && debugPort && !entry.ws_endpoint) {
      await this.client.stopProfile(uuid)
      await sleep(1000)
      entry = null
    }

    if (!entry) {
      entry = await this.client.startProfile(uuid, { debugPort })
    }

    const fresh = await this.client.getProfile(uuid)
    return {
      ok: true,
      name: fresh.title ?? detail.title,
      uuid,
      state: entry?.state || 'RUNNING',
      wsEndpoint: entry?.ws_endpoint || null,
      debugPort: entry?.debug_port || null,
      browserPid: entry?.browser_pid || null,
      ip: (entry?.connection_data || {}).ip || null,
      extensions: normalizeExtensions(fresh.extensions),
    }
  }

  async stop(ref) {
    await this.ensureReady()
    const detail = await this.resolve(ref)
    await this.client.stopProfile(detail.uuid)
    return { ok: true, name: detail.title ?? detail.name ?? '', uuid: detail.uuid }
  }

  async remove(ref, { force = true } = {}) {
    await this.ensureReady()
    const detail = await this.resolve(ref)
    const active = await this.client.activeProfiles().catch(() => [])

    if (active.some((entry) => entry.uuid === detail.uuid)) {
      if (!force) {
        throw new OctoError('Profile is running. Stop it first or retry with force.', { status: 409 })
      }
      await this.client.stopProfile(detail.uuid)
    }

    await this.client.deleteProfiles([detail.uuid])
    return {
      ok: true,
      name: detail.title ?? detail.name ?? '',
      uuid: detail.uuid,
      deleted: true,
    }
  }

  async attachExtension(ref, selector) {
    await this.ensureReady()
    const detail = await this.resolve(ref)
    await this.assertStopped(detail.uuid)

    const query = String(selector ?? '').trim() || this.defaultExtension
    if (!query) throw new OctoError('Extension name or id is required.', { status: 400 })

    const available = await this.client.listExtensions()
    const ext = pickExtension(available, query)
    const id = compoundExtension(ext)
    const currentIds = normalizeExtensions(detail.extensions).map((item) => item.id).filter(Boolean)
    const extensionIds = currentIds.includes(id) ? currentIds : [...currentIds, id]

    const updated = await this.client.updateProfile(detail.uuid, patchBody(detail, { extensions: extensionIds }))
    return {
      ok: true,
      uuid: detail.uuid,
      name: detail.title ?? detail.name ?? '',
      extension: { name: extensionName(ext), id },
      extensions: normalizeExtensions(updated.extensions),
    }
  }

  async detachExtension(ref, selector) {
    await this.ensureReady()
    const detail = await this.resolve(ref)
    await this.assertStopped(detail.uuid)

    const query = String(selector ?? '').trim()
    if (!query) throw new OctoError('Extension name or id is required.', { status: 400 })

    const current = normalizeExtensions(detail.extensions)
    const match = current.find((item) => item.id === query
      || item.name === query
      || item.name.toLowerCase() === query.toLowerCase())

    if (!match) {
      throw new OctoError(`Extension "${query}" is not attached to this profile.`, { status: 404 })
    }

    const extensionIds = current.filter((item) => item.id !== match.id).map((item) => item.id)
    const updated = await this.client.updateProfile(detail.uuid, patchBody(detail, { extensions: extensionIds }))
    return {
      ok: true,
      uuid: detail.uuid,
      name: detail.title ?? detail.name ?? '',
      removed: match,
      extensions: normalizeExtensions(updated.extensions),
    }
  }

  async rename(ref, name) {
    const title = String(name ?? '').trim()
    if (!title) throw new OctoError('New profile name is required.', { status: 400 })
    if (title.length > 120) throw new OctoError('Profile name must be 120 characters or fewer.', { status: 400 })

    await this.ensureReady()
    const detail = await this.resolve(ref)
    await this.assertStopped(detail.uuid)

    const updated = await this.client.updateProfile(detail.uuid, patchBody(detail, { name: title }))
    return {
      ok: true,
      uuid: detail.uuid,
      name: updated.title ?? title,
    }
  }

  async setProxy(ref, value) {
    await this.ensureReady()
    const detail = await this.resolve(ref)
    await this.assertStopped(detail.uuid)

    const proxy = parseProxy(value)
    const updated = await this.client.updateProfile(detail.uuid, patchBody(detail, { proxy }))
    return {
      ok: true,
      uuid: detail.uuid,
      name: detail.title ?? detail.name ?? '',
      proxy,
      proxySummary: proxySummary(updated.proxy ?? proxy),
    }
  }

  async setLaunchArgs(ref, value) {
    const args = Array.isArray(value)
      ? value.map(String)
      : [String(value ?? '')].filter(Boolean)

    await this.ensureReady()
    const detail = await this.resolve(ref)
    await this.assertStopped(detail.uuid)

    const updated = await this.client.updateProfile(detail.uuid, patchBody(detail, { launch_args: args }))
    return {
      ok: true,
      uuid: detail.uuid,
      name: detail.title ?? detail.name ?? '',
      launchArgs: updated.launch_args ?? args,
    }
  }

  async listExtensions() {
    await this.ensureReady()
    const extensions = await this.client.listExtensions()
    return { extensions: normalizeExtensions(extensions) }
  }

  async assertStopped(uuid) {
    const active = await this.client.activeProfiles().catch(() => [])
    if (active.some((entry) => entry.uuid === uuid)) {
      throw new OctoError('Stop the profile before changing its configuration.', { status: 409 })
    }
  }
}
