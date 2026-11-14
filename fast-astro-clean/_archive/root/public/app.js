const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector))

const VIEW_TITLES = {
  overview: 'Overview',
  profiles: 'Profiles',
  extensions: 'Extensions',
  connectivity: 'Connectivity',
  automation: 'Automation',
  activity: 'Activity',
}

const state = {
  status: null,
  profiles: [],
  extensions: [],
  runs: [],
  lastRotation: null,
  live: { data: null, timer: null, clock: null, loading: false },
  view: 'overview',
  search: '',
  manage: null,
  android: {
    devices: [],
    connection: null,
    deviceError: null,
    connectionError: null,
    busy: false,
  },
  hid: {
    status: null,
    error: null,
    busy: false,
  },
}

let toastTimer = null

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]))
}

function initials(value) {
  return String(value ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || 'EX'
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  })
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
    throw new Error(data?.error || `Request failed (${response.status})`)
  }
  return data
}

function toast(message, kind = 'ok') {
  const element = $('#toast')
  element.textContent = message
  element.className = `toast ${kind}`
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => element.classList.add('hidden'), 4200)
}

function timeAgo(value) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function setView(view) {
  state.view = view
  $$('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view)
  })
  $$('[data-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.panel === view)
  })
  $('#view-title').textContent = VIEW_TITLES[view] || view
  if (view === 'overview') startLive()
  else stopLive()
  if (view === 'connectivity') void refreshAndroid({ silent: true })
  if (view === 'automation') void refreshHid({ silent: true })
}

function setLiveStat(selector, value, detail, tone = '') {
  const el = $(selector)
  if (!el) return
  el.textContent = value
  const stat = el.closest('.live-stat')
  if (!stat) return
  stat.className = `live-stat ${tone}`.trim()
  const small = stat.querySelector('small')
  if (small) small.textContent = detail
}

function liveEventInfo(event) {
  if (event.type === 'ip-change') {
    const changed = event.changed === true
      ? 'changed'
      : (event.changed === false ? 'unchanged' : 'checked')
    return {
      title: `Proxy / IP ${changed}`,
      detail: `${event.before || '?'} → ${event.after || '?'}${event.via ? ` · ${event.via}` : ''}`,
      kind: event.changed === false ? 'err' : 'ip',
    }
  }
  if (event.type === 'operation-start') {
    return {
      title: `${event.operation?.action || 'Operation'} started`,
      detail: 'running…',
      kind: '',
    }
  }
  if (event.type === 'operation-end') {
    const operation = event.operation || {}
    const summary = event.summary || {}
    let detail = event.detail || ''
    if (summary.profile) {
      detail = summary.profile.name || summary.profile.uuid || detail
    } else if (summary.previous) {
      detail = `previous ${summary.previous.name || summary.previous.uuid || ''}`
    }
    if (summary.network?.hostIpChanged) {
      detail += ` · IP ${summary.network.hostBeforeIp || '?'} → ${summary.network.hostAfterIp || '?'}`
    }
    return {
      title: `${operation.action || 'Operation'} ${operation.status === 'success' ? 'done' : 'failed'}`,
      detail,
      kind: operation.status === 'success' ? '' : 'err',
    }
  }
  if (event.type === 'stuck-action') {
    const label = event.action === 'reload'
      ? 'page refreshed'
      : event.action === 'restart'
        ? 'live flow restarted'
        : event.action === 'rotate'
          ? 'profile rotated'
          : 'stuck tab closed'
    return {
      title: `Stuck detected — ${label}`,
      detail: `${event.profile || ''}${event.url ? ` · ${event.url}` : ''}`,
      kind: 'err',
    }
  }
  if (event.type === 'server') {
    return { title: 'Live engine online', detail: event.message || '', kind: 'ip' }
  }
  return { title: event.type, detail: event.detail || '', kind: '' }
}

function renderLive(data) {
  state.live.data = data
  const host = data.connection?.host || {}
  const phone = data.connection?.phone || {}
  const usb = host.usbTether || {}
  const records = data.records || {}
  const network = data.lastRotation?.network || {}
  const current = data.currentProfile

  setLiveStat(
    '#lv-ip',
    host.egressIp || 'unknown',
    network.hostBeforeIp && network.hostAfterIp
      ? `${network.hostIpChanged ? 'changed' : 'stable'} · ${network.hostBeforeIp} → ${network.hostAfterIp}`
      : (usb.connected ? `via ${usb.provider || 'BetterTether'}` : 'direct route'),
    usb.connected && host.egressViaUsb ? 'ok' : 'warn',
  )
  setLiveStat(
    '#lv-usb',
    usb.connected && host.egressViaUsb ? 'ONLINE' : 'OFFLINE',
    usb.connected
      ? `${usb.provider || 'BetterTether'} · ${usb.interface || 'usb'} · ${usb.routesActive ? 'routes active' : 'routes missing'}`
      : (usb.error || 'BetterTether not connected'),
    usb.connected && host.egressViaUsb ? 'ok' : 'err',
  )
  setLiveStat(
    '#lv-profile',
    current ? current.name : 'none',
    current
      ? `${current.extensions?.map((ext) => ext.version).filter(Boolean).join(', ') || 'no extension'} · ${current.state}`
      : 'waiting for a running profile',
    current ? 'ok' : 'warn',
  )
  setLiveStat(
    '#lv-profiles',
    `${data.running?.length || 0} / ${data.profiles?.length || 0}`,
    'running / total',
  )
  setLiveStat(
    '#lv-phone',
    phone.connected ? 'LINKED' : 'OFFLINE',
    phone.connected
      ? `${phone.deviceModel || phone.deviceSerial || ''} · ${phone.dataConnected ? 'data on' : 'data off'} · ${phone.mobileIp || 'no IP'}`
      : (phone.error || 'no device'),
    phone.connected && phone.dataConnected ? 'ok' : 'warn',
  )
  setLiveStat(
    '#lv-records',
    String(records.total || 0),
    `${records.passed || 0} passed · ${records.failed || 0} failed`,
    records.failed > 0 && records.passed === 0 ? 'warn' : '',
  )

  const successes = records.successes || []
  $('#lv-success-count').textContent = `${successes.length}`
  $('#lv-success-list').innerHTML = successes.length
    ? successes.slice(0, 30).map((item) => `
        <div class="live-success">
          <span class="ok-dot"></span>
          <div>
            <strong>${escapeHtml(item.email)}</strong>
            <small>${escapeHtml(item.notes || item.status || 'passed')}</small>
          </div>
          <span class="live-event-meta">${escapeHtml(timeAgo(item.createdAt))}</span>
        </div>`).join('')
    : '<div class="live-empty">No successful emails yet.</div>'

  $('#lv-octo').textContent = data.status?.connected
    ? `Octo connected · :${data.status.port}`
    : `Octo offline${data.status?.error ? ` · ${data.status.error}` : ''}`

  const operations = data.activeOperations || []
  $('#lv-op-count').textContent = `${operations.length} active`
  $('#lv-ops').innerHTML = operations.length
    ? operations.map((operation) => `
        <div class="live-op">
          <span class="live-spinner"></span>
          <div>
            <strong>${escapeHtml(operation.action)}</strong>
            <small>started ${escapeHtml(timeAgo(operation.startedAt))}</small>
          </div>
        </div>`).join('')
    : '<div class="live-empty">Idle — watching for the next operation.</div>'

  const events = (data.events || []).slice(0, 18)
  $('#lv-events').innerHTML = events.length
    ? events.map((event) => {
      const info = liveEventInfo(event)
      return `<div class="live-event ${info.kind}">
        <span class="live-event-dot"></span>
        <div>
          <strong>${escapeHtml(info.title)}</strong>
          <small>${escapeHtml(info.detail)}</small>
        </div>
        <span class="live-event-meta">${escapeHtml(timeAgo(event.at))}</span>
      </div>`
    }).join('')
    : '<div class="live-empty">No events yet.</div>'

  const profiles = data.profiles || []
  $('#lv-radar-count').textContent = `${profiles.length}`
  $('#lv-radar').innerHTML = profiles.length
    ? profiles.map((profile) => {
      const versions = (profile.extensions || [])
        .map((ext) => ext.version)
        .filter(Boolean)
        .join(', ')
      return `<div class="live-profile ${profile.running ? 'running' : ''}">
        <span class="lp-dot"></span>
        <div class="lp-copy">
          <strong>${escapeHtml(profile.name)}</strong>
          <small>${escapeHtml(profile.running ? 'running' : (profile.state || 'stopped'))}${profile.proxy ? ` · ${escapeHtml(profile.proxy)}` : ''}</small>
        </div>
        <span class="lp-version">${escapeHtml(versions || 'no ext')}</span>
      </div>`
    }).join('')
    : '<div class="live-empty">No profiles.</div>'
}

async function loadLive() {
  if (state.live.loading) return
  state.live.loading = true
  try {
    const data = await api('/api/live')
    if (state.view === 'overview') renderLive(data)
  } catch (error) {
    const octo = $('#lv-octo')
    if (octo) octo.textContent = `live feed error · ${error.message}`
  } finally {
    state.live.loading = false
  }
}

function startLive() {
  if (state.live.timer) return
  void loadLive()
  state.live.timer = setInterval(() => {
    if (document.hidden) return
    void loadLive()
  }, 2000)
  state.live.clock = setInterval(() => {
    const clock = $('#lv-clock')
    if (clock) clock.textContent = new Date().toLocaleTimeString()
  }, 1000)
}

function stopLive() {
  if (state.live.timer) {
    clearInterval(state.live.timer)
    state.live.timer = null
  }
  if (state.live.clock) {
    clearInterval(state.live.clock)
    state.live.clock = null
  }
}

function renderStatus() {
  const connected = Boolean(state.status?.connected)
  $('#sidebar-dot').className = `dot ${connected ? 'on' : 'off'}`
  $('#live-dot').className = `dot ${connected ? 'on' : 'off'}`
  $('#sidebar-state').textContent = connected ? 'Octo connected' : 'Octo offline'
  $('#sidebar-port').textContent = connected
    ? `Local API :${state.status.port}`
    : (state.status?.error || 'Local API not found')
  $('#live-text').textContent = connected ? `Connected · :${state.status.port}` : 'Disconnected'
  $('#metric-state').textContent = connected ? 'Online' : 'Offline'
  $('#metric-state-hint').textContent = connected ? `port ${state.status.port}` : 'start Octo Browser'
}

function renderMetrics() {
  $('#metric-total').textContent = String(state.profiles.length)
  $('#metric-running').textContent = String(state.profiles.filter((profile) => profile.running).length)
  $('#metric-extensions').textContent = String(state.extensions.length)
}

async function loadStatus() {
  try {
    state.status = await api('/api/status')
  } catch (error) {
    state.status = { connected: false, error: error.message }
  }
  renderStatus()
}

async function loadExtensions() {
  try {
    const data = await api('/api/extensions')
    state.extensions = data.extensions || []
  } catch {
    state.extensions = []
  }
  renderExtensionOptions()
  renderExtensions()
  renderMetrics()
}

async function loadProfiles() {
  try {
    const data = await api('/api/profiles?details=1')
    state.profiles = data.profiles || []
  } catch {
    state.profiles = []
  }
  renderProfiles()
  renderExtensions()
  renderMetrics()
}

async function loadRuns() {
  try {
    const data = await api('/api/runs?limit=30')
    state.runs = data.runs || []
  } catch {
    state.runs = []
  }
  renderRuns()
}

async function refreshAll({ silent = true } = {}) {
  await loadStatus()
  await loadRuns()

  if (state.status?.connected) {
    await Promise.all([loadExtensions(), loadProfiles()])
  } else {
    state.extensions = []
    state.profiles = []
    renderExtensionOptions()
    renderExtensions()
    renderProfiles()
    renderMetrics()
  }

  if (!silent) toast('Refreshed')
}

function profileRow(profile) {
  const extensionBadges = (profile.extensions || [])
    .map((extension) => `<span class="badge">${escapeHtml(extension.name)}</span>`)
    .join('') || '<span class="muted">None</span>'

  const actionButton = profile.running
    ? `<button class="button small" data-action="stop" data-uuid="${escapeHtml(profile.uuid)}">Stop</button>`
    : `<button class="button small primary" data-action="launch" data-uuid="${escapeHtml(profile.uuid)}">Launch</button>`

  return `<tr>
    <td>
      <div class="profile-cell">
        <strong>${escapeHtml(profile.name)}</strong>
        <code>${escapeHtml(profile.uuid)}</code>
      </div>
    </td>
    <td><span class="status ${profile.running ? 'ok' : 'muted'}"><span class="dot"></span>${escapeHtml(profile.state)}</span></td>
    <td><div class="badges">${extensionBadges}</div></td>
    <td class="mono">${escapeHtml(profile.proxy)}</td>
    <td class="actions">
      ${actionButton}
      <button class="button small" data-action="manage" data-uuid="${escapeHtml(profile.uuid)}">Manage</button>
      <button class="button small danger" data-action="delete" data-uuid="${escapeHtml(profile.uuid)}">Delete</button>
    </td>
  </tr>`
}

function renderProfiles() {
  const query = state.search.trim().toLowerCase()
  const list = query
    ? state.profiles.filter((profile) => profile.name.toLowerCase().includes(query)
      || profile.uuid.toLowerCase().includes(query)
      || (profile.extensions || []).some((extension) => extension.name.toLowerCase().includes(query)))
    : state.profiles

  const empty = `<tr><td colspan="5" class="empty">No profiles${query ? ' match your search' : ''}.</td></tr>`
  const body = list.length ? list.map(profileRow).join('') : empty

  const recent = state.profiles.slice(0, 5)
  const recentBody = recent.length
    ? recent.map(profileRow).join('')
    : '<tr><td colspan="5" class="empty">No profiles yet. Create one to get started.</td></tr>'

  $('#profiles-body').innerHTML = body
  $('#recent-profiles').innerHTML = recentBody
}

function renderExtensionOptions() {
  const select = $('#profile-extension')
  const current = select.value
  const options = ['<option value="">No extension</option>']
    .concat(state.extensions.map((extension) => {
      return `<option value="${escapeHtml(extension.id)}">${escapeHtml(extension.name)}</option>`
    }))
  select.innerHTML = options.join('')
  if (current && Array.from(select.options).some((option) => option.value === current)) {
    select.value = current
  }
  $('#extension-hint').textContent = state.extensions.length
    ? 'Extensions are attached before launch and load with the profile.'
    : 'No extensions found in this Octo account.'
}

function renderExtensions() {
  const container = $('#extensions-grid')
  if (!state.extensions.length) {
    container.innerHTML = '<div class="empty-block">No extensions found. Sign in to Octo and refresh.</div>'
    return
  }

  container.innerHTML = state.extensions.map((extension) => {
    const uses = state.profiles.filter((profile) => {
      return (profile.extensions || []).some((item) => item.id === extension.id)
    }).length
    const version = extension.version ? `<span>v${escapeHtml(extension.version)}</span>` : ''
    return `<article class="extension-card">
      <div class="extension-icon">${escapeHtml(initials(extension.name))}</div>
      <div class="extension-copy">
        <strong>${escapeHtml(extension.name)}</strong>
        <code>${escapeHtml(extension.id)}</code>
      </div>
      <div class="extension-meta">
        <span>${uses} profile${uses === 1 ? '' : 's'}</span>
        ${version}
      </div>
    </article>`
  }).join('')
}

function renderRuns() {
  const container = $('#runs-list')
  if (!state.runs.length) {
    container.innerHTML = '<div class="empty-block">No activity yet.</div>'
    return
  }
  container.innerHTML = state.runs.map((run) => {
    return `<div class="run-row">
      <span class="run-status ${run.status === 'success' ? 'ok' : 'err'}"></span>
      <div class="run-copy">
        <strong>${escapeHtml(run.action)}</strong>
        <small>${escapeHtml(run.detail)}</small>
      </div>
      <div class="run-meta">
        <span>${escapeHtml(timeAgo(run.at))}</span>
        <code>${Math.round(run.durationMs)}ms</code>
      </div>
    </div>`
  }).join('')
}

function stateCard(label, value, { tone = '', detail = '' } = {}) {
  return `<article class="state-card ${tone}">
    <span class="state-label">${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
  </article>`
}

function boolLabel(value, on = 'On', off = 'Off') {
  if (value === true) return on
  if (value === false) return off
  return 'Unknown'
}

function renderAndroidDevices() {
  const select = $('#android-device')
  if (!select) return
  const current = select.value
  const options = ['<option value="">Auto-detect</option>']

  for (const device of state.android.devices) {
    const model = device.model ? ` · ${device.model}` : ''
    options.push(`<option value="${escapeHtml(device.serial)}">${escapeHtml(device.serial)} · ${escapeHtml(device.state)}${escapeHtml(model)}</option>`)
  }

  select.innerHTML = options.join('')
  if (current && Array.from(select.options).some((option) => option.value === current)) {
    select.value = current
  }
}

function renderLastRotation() {
  const grid = $('#rotation-ip-grid')
  if (!grid) return
  const rotation = state.lastRotation
  if (!rotation) {
    grid.innerHTML = '<div class="empty-block">No rotation recorded yet.</div>'
    return
  }

  const network = rotation.network || {}
  const changed = network.hostIpChanged
  grid.innerHTML = [
    stateCard('Host before', network.hostBeforeIp || 'Unknown', {
      detail: network.hostDefaultInterfaceBefore || 'egress',
    }),
    stateCard('Host after', network.hostAfterIp || 'Unknown', {
      detail: network.hostDefaultInterfaceAfter || 'egress',
    }),
    stateCard('IP changed', changed === true ? 'Yes' : changed === false ? 'No' : 'Unknown', {
      tone: changed === true ? 'ok' : changed === false ? 'err' : '',
      detail: 'host egress comparison',
    }),
    stateCard('Phone before', network.beforeIp || 'Unknown', { detail: 'mobile IP' }),
    stateCard('Phone after', network.afterIp || 'Unknown', { detail: 'mobile IP' }),
    stateCard(
      'USB egress',
      network.egressViaUsb === true ? 'Yes' : network.egressViaUsb === false ? 'No' : 'Unknown',
      {
        tone: network.egressViaUsb === true ? 'ok' : 'warn',
        detail: network.usbTether?.interface
          ? `bettertether · ${network.usbTether.interface}`
          : network.hostDefaultInterfaceAfter || '',
      },
    ),
    stateCard(
      'USB routes',
      network.usbTether?.routesActive ? 'Active' : 'Inactive',
      {
        tone: network.usbTether?.routesActive ? 'ok' : 'warn',
        detail: network.usbTether?.clientIP || '0/1 + 128.0/1',
      },
    ),
    stateCard('Rotated', rotation.rotatedAt ? new Date(rotation.rotatedAt).toLocaleString() : 'Unknown', {
      detail: rotation.profile?.name || rotation.profile?.uuid || '',
    }),
  ].join('')
}

function renderAndroidStatus() {
  const connection = state.android.connection
  const phone = connection?.phone
  const host = connection?.host
  const error = state.android.deviceError || state.android.connectionError || phone?.error

  let deviceState = '…'
  if (connection) {
    if (phone?.connected) deviceState = 'Connected'
    else if (phone?.deviceStatus === 'adb_missing') deviceState = 'ADB missing'
    else if (phone?.deviceStatus === 'unauthorized') deviceState = 'Unauthorized'
    else if (phone?.deviceStatus === 'multiple') deviceState = 'Multiple'
    else deviceState = 'Not connected'
  }

  const deviceDetail = error
    || (phone?.deviceSerial
      ? `${phone.deviceSerial}${phone.deviceModel ? ` · ${phone.deviceModel}` : ''}`
      : 'no device')

  $('#android-device-state').textContent = deviceState
  $('#android-device-detail').textContent = deviceDetail
  $('#android-airplane').textContent = boolLabel(phone?.airplaneMode)
  $('#android-tether').textContent = boolLabel(phone?.usbTethering)
  $('#android-usb-state').textContent = phone?.usbState ? `usb: ${phone.usbState}` : 'phone state'
  $('#android-internet').textContent = host ? (host.internet ? 'Online' : 'Offline') : '…'
  $('#android-egress').textContent = host ? (host.egressIp ? `egress ${host.egressIp}` : 'no egress IP') : 'checking egress'

  const phoneCards = phone ? [
    stateCard('Device', phone.connected ? 'Connected' : 'Disconnected', {
      tone: phone.connected ? 'ok' : 'err',
      detail: phone.deviceSerial || phone.error || phone.deviceStatus,
    }),
    stateCard('Airplane mode', boolLabel(phone.airplaneMode), {
      tone: phone.airplaneMode ? 'warn' : 'ok',
      detail: 'airplane_mode_on',
    }),
    stateCard('USB tethering', boolLabel(phone.usbTethering), {
      tone: phone.usbTethering ? 'ok' : 'warn',
      detail: phone.usbState || 'sys.usb.state',
    }),
    stateCard('Mobile data', boolLabel(phone.mobileData), {
      tone: phone.mobileData ? 'ok' : 'warn',
      detail: 'settings global mobile_data',
    }),
    stateCard('Data connection', boolLabel(phone.dataConnected), {
      tone: phone.dataConnected ? 'ok' : 'warn',
      detail: 'telephony.registry',
    }),
    stateCard('Mobile IP', phone.mobileIp || 'None', { detail: 'rmnet / ccmni / wwan' }),
  ] : [stateCard('Phone', 'Unavailable', { tone: 'err', detail: error || 'ADB status not loaded' })]

  const hostCards = host ? [
    stateCard('Internet', host.internet ? 'Online' : 'Offline', {
      tone: host.internet ? 'ok' : 'err',
      detail: 'TCP 1.1.1.1:443',
    }),
    stateCard('Egress IP', host.egressIp || 'Unknown', { detail: 'api.ipify.org' }),
    stateCard('Default interface', host.defaultInterface || 'Unknown', {
      detail: host.defaultGateway ? `gateway ${host.defaultGateway}` : 'route -n get default',
    }),
    stateCard('Default IP', host.defaultIp || 'Unknown', { detail: host.platform }),
    stateCard('USB egress', host.egressViaUsb ? 'Yes' : 'No', {
      tone: host.egressViaUsb ? 'ok' : 'warn',
      detail: host.usbTether?.interface
        ? `bettertether · ${host.usbTether.interface} · ${host.usbTether.clientIP || ''}`
        : 'route via tether candidate',
    }),
    stateCard(
      'USB routes',
      host.usbTether?.routesActive ? 'Active' : 'Inactive',
      {
        tone: host.usbTether?.routesActive ? 'ok' : 'warn',
        detail: host.usbTether?.splitRoutes?.['0/1']
          ? `0/1 + 128.0/1 via ${host.usbTether.splitRoutes['0/1']}`
          : '0/1 + 128.0/1',
      },
    ),
    stateCard(
      'Tethered interfaces',
      host.tetherCandidates?.length
        ? host.tetherCandidates.map((item) => `${item.name} ${item.ipv4}`).join(', ')
        : 'None',
      { detail: 'utun / bridge / USB ranges' },
    ),
  ] : [stateCard('Host', 'Unavailable', { tone: 'err', detail: error || 'connection status not loaded' })]

  $('#android-status-grid').innerHTML = phoneCards.join('')
  $('#host-status-grid').innerHTML = hostCards.join('')
}

async function loadAndroidDevices() {
  try {
    const data = await api('/api/android/devices')
    state.android.devices = data.devices || []
    state.android.deviceError = data.ok === false ? (data.error || 'ADB unavailable') : null
  } catch (error) {
    state.android.devices = []
    state.android.deviceError = error.message
  }
  renderAndroidDevices()
}

async function loadAndroidConnection() {
  try {
    state.android.connection = await api('/api/android/connection')
    state.android.connectionError = null
  } catch (error) {
    state.android.connection = { ok: false, phone: null, host: null, error: error.message }
    state.android.connectionError = error.message
  }
  renderAndroidStatus()
}

async function loadLastRotation() {
  try {
    const data = await api('/api/network/last-rotation')
    state.lastRotation = data.rotation || null
  } catch {
    state.lastRotation = null
  }
  renderLastRotation()
}

async function refreshAndroid({ silent = true } = {}) {
  await Promise.all([loadAndroidDevices(), loadAndroidConnection(), loadLastRotation()])
  if (!silent) toast('Connectivity refreshed')
}

function androidResult(element, message, kind = 'ok') {
  element.textContent = message
  element.className = `result ${kind}`
}

function selectedSerial() {
  return $('#android-device')?.value || undefined
}

function setAndroidBusy(busy) {
  state.android.busy = busy
  const ids = [
    '#airplane-on',
    '#airplane-off',
    '#airplane-cycle',
    '#tether-on',
    '#tether-off',
    '#tether-status',
    '#network-reset',
  ]
  for (const id of ids) {
    const element = $(id)
    if (element) element.disabled = busy
  }
}

async function runAndroidAction(path, body, resultElement, pending) {
  if (state.android.busy) return
  setAndroidBusy(true)
  androidResult(resultElement, pending, 'ok')

  try {
    const result = await api(path, { method: 'POST', body: JSON.stringify(body) })
    androidResult(resultElement, result.message || 'Done', 'ok')
    await refreshAndroid({ silent: true })
  } catch (error) {
    androidResult(resultElement, error.message, 'error')
  } finally {
    setAndroidBusy(false)
  }
}

function renderHidStatus() {
  const status = state.hid.status
  const screens = status?.screens || []
  const main = screens.find((screen) => screen.main) || screens[0]
  const trusted = status?.trusted === true

  $('#hid-trusted').textContent = status ? (trusted ? 'Granted' : 'Required') : '…'
  $('#hid-helper').textContent = status ? 'Ready' : '…'
  $('#hid-screen').textContent = main ? `${Math.round(main.width)} × ${Math.round(main.height)}` : '…'
  $('#hid-screen-detail').textContent = main
    ? `${screens.length} display${screens.length === 1 ? '' : 's'} · scale ${main.scale}`
    : (state.hid.error || 'main display')
}

async function refreshHid({ silent = true } = {}) {
  try {
    state.hid.status = await api('/api/hid/status')
    state.hid.error = null
  } catch (error) {
    state.hid.status = null
    state.hid.error = error.message
  }
  renderHidStatus()
  if (!silent) toast('HID status refreshed')
}

function hidResult(message, kind = 'ok') {
  const element = $('#hid-result')
  element.textContent = message
  element.className = `result ${kind}`
}

function setHidBusy(busy) {
  state.hid.busy = busy
  const ids = [
    '#hid-request',
    '#hid-activate',
    '#hid-type',
    '#hid-send-key',
    '#hid-move',
    '#hid-click',
    '#hid-scroll',
    '#hid-drag',
  ]
  for (const id of ids) {
    const element = $(id)
    if (element) element.disabled = busy
  }
}

function setCursor(x, y) {
  $('#hid-cursor').textContent = `${Math.round(Number(x))}, ${Math.round(Number(y))}`
}

async function runHid(path, body, pending) {
  if (state.hid.busy) return
  setHidBusy(true)
  hidResult(pending)

  try {
    const result = await api(path, { method: 'POST', body: JSON.stringify(body) })
    hidResult(result.message || 'Done')
    await refreshHid({ silent: true })
  } catch (error) {
    hidResult(error.message, 'error')
  } finally {
    setHidBusy(false)
  }
}

function showCreateResult(message, kind = 'ok') {
  const element = $('#create-result')
  element.textContent = message
  element.className = `result ${kind}`
}

function findProfile(uuid) {
  return state.profiles.find((profile) => profile.uuid === uuid)
}

function proxyValue(profile) {
  const proxy = profile?.proxy
  if (!proxy || proxy.type === 'direct') return 'direct'
  const data = proxy.data || proxy
  if (!data?.ip) return 'direct'
  const auth = data.login ? `${encodeURIComponent(data.login)}${data.password ? `:${encodeURIComponent(data.password)}` : ''}@` : ''
  return `${data.type || 'socks5'}://${auth}${data.ip}${data.port ? `:${data.port}` : ''}`
}

async function manageAction(path, body, message) {
  try {
    await api(path, { method: 'POST', body: JSON.stringify(body) })
    const detail = await api(`/api/profiles/${encodeURIComponent(state.manage.profile.uuid)}`)
    state.manage = { profile: detail }
    renderManage()
    await refreshAll({ silent: true })
    toast(message)
  } catch (error) {
    toast(error.message, 'error')
  }
}

function renderManage() {
  const profile = state.manage?.profile
  if (!profile) return

  $('#modal-title').textContent = profile.name || 'Profile'
  $('#modal-uuid').textContent = profile.uuid

  const attached = new Set((profile.extensions || []).map((extension) => extension.id))
  const extensionRows = state.extensions.map((extension) => {
    const isAttached = attached.has(extension.id)
    return `<div class="manage-ext">
      <div>
        <strong>${escapeHtml(extension.name)}</strong>
        <code>${escapeHtml(extension.id)}</code>
      </div>
      <span class="badge ${isAttached ? 'ok' : ''}">${isAttached ? 'Attached' : 'Available'}</span>
      <button
        class="button small ${isAttached ? 'danger' : 'primary'}"
        data-ext-action="${isAttached ? 'detach' : 'attach'}"
        data-ext-id="${escapeHtml(extension.id)}"
        ${profile.running ? 'disabled' : ''}
      >${isAttached ? 'Detach' : 'Attach'}</button>
    </div>`
  }).join('') || '<div class="empty-block">No extensions installed.</div>'

  $('#modal-body').innerHTML = `
    <div class="manage-grid">
      <form id="rename-form" class="form compact">
        <div class="field">
          <label for="rename-input">Profile name</label>
          <input id="rename-input" name="name" value="${escapeHtml(profile.name)}" ${profile.running ? 'disabled' : ''}>
        </div>
        <button class="button" type="submit" ${profile.running ? 'disabled' : ''}>Rename</button>
      </form>
      <form id="proxy-form" class="form compact">
        <div class="field">
          <label for="proxy-input">Proxy</label>
          <input id="proxy-input" name="proxy" value="${escapeHtml(proxyValue(profile))}" placeholder="direct or socks5://host:1080" ${profile.running ? 'disabled' : ''}>
        </div>
        <button class="button" type="submit" ${profile.running ? 'disabled' : ''}>Save proxy</button>
      </form>
    </div>
    <div class="section-head">
      <h3>Extensions</h3>
      <span>${attached.size} attached</span>
    </div>
    <div class="manage-list">${extensionRows}</div>
    ${profile.running ? '<p class="note">Stop the profile before changing its name, proxy, or extensions.</p>' : ''}
  `

  $('#rename-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const name = event.currentTarget.elements.name.value.trim()
    if (!name) return
    await manageAction(`/api/profiles/${encodeURIComponent(profile.uuid)}/rename`, { name }, 'Profile renamed')
  })

  $('#proxy-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const proxy = event.currentTarget.elements.proxy.value.trim() || 'direct'
    await manageAction(`/api/profiles/${encodeURIComponent(profile.uuid)}/proxy`, { proxy }, 'Proxy updated')
  })

  $$('[data-ext-action]', $('#modal-body')).forEach((button) => {
    button.addEventListener('click', async () => {
      await manageAction(
        `/api/profiles/${encodeURIComponent(profile.uuid)}/extensions`,
        { extension: button.dataset.extId, action: button.dataset.extAction },
        button.dataset.extAction === 'detach' ? 'Extension detached' : 'Extension attached',
      )
    })
  })
}

async function openManage(uuid) {
  try {
    const detail = await api(`/api/profiles/${encodeURIComponent(uuid)}`)
    state.manage = { profile: detail }
    renderManage()
    $('#modal').classList.remove('hidden')
  } catch (error) {
    toast(error.message, 'error')
  }
}

function closeModal() {
  state.manage = null
  $('#modal').classList.add('hidden')
}

$$('.nav-item').forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view))
})

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-goto]')
  if (target) setView(target.dataset.goto)
})

$('#profile-search').addEventListener('input', (event) => {
  state.search = event.target.value
  renderProfiles()
})

$('#refresh').addEventListener('click', async () => {
  await refreshAll({ silent: false })
  if (state.view === 'connectivity') await refreshAndroid({ silent: true })
  if (state.view === 'automation') await refreshHid({ silent: true })
})

$('#airplane-on').addEventListener('click', () => {
  void runAndroidAction(
    '/api/android/airplane',
    { action: 'on', serial: selectedSerial() },
    $('#airplane-result'),
    'Turning airplane mode on…',
  )
})

$('#airplane-off').addEventListener('click', () => {
  void runAndroidAction(
    '/api/android/airplane',
    { action: 'off', serial: selectedSerial() },
    $('#airplane-result'),
    'Turning airplane mode off…',
  )
})

$('#airplane-cycle').addEventListener('click', () => {
  const duration = Number($('#airplane-duration').value) || 10
  void runAndroidAction(
    '/api/android/airplane',
    { action: 'cycle', duration, serial: selectedSerial() },
    $('#airplane-result'),
    `Cycling airplane mode for ${duration}s…`,
  )
})

$('#tether-on').addEventListener('click', () => {
  void runAndroidAction(
    '/api/android/tether',
    { action: 'on', serial: selectedSerial() },
    $('#tether-result'),
    'Turning USB tethering on…',
  )
})

$('#tether-off').addEventListener('click', () => {
  void runAndroidAction(
    '/api/android/tether',
    { action: 'off', serial: selectedSerial() },
    $('#tether-result'),
    'Turning USB tethering off…',
  )
})

$('#tether-status').addEventListener('click', () => {
  void runAndroidAction(
    '/api/android/tether',
    { action: 'status', serial: selectedSerial() },
    $('#tether-result'),
    'Reading USB tethering state…',
  )
})

$('#network-reset').addEventListener('click', () => {
  const duration = Number($('#airplane-duration').value) || 10
  void runAndroidAction(
    '/api/android/reset',
    { duration, serial: selectedSerial() },
    $('#tether-result'),
    `Cycling airplane mode for ${duration}s, then enabling tethering…`,
  )
})

$('#android-refresh').addEventListener('click', () => {
  void refreshAndroid({ silent: false })
})

$('#hid-request').addEventListener('click', () => {
  void runHid('/api/hid/permission', {}, 'Opening the macOS permission prompt…')
})

$('#hid-activate').addEventListener('click', () => {
  const app = $('#hid-app').value.trim()
  if (!app) {
    hidResult('Enter a running app name.', 'error')
    return
  }
  void runHid('/api/hid/activate', { app }, `Activating ${app}…`)
})

$('#hid-type').addEventListener('click', () => {
  const text = $('#hid-text').value
  if (!text) {
    hidResult('Enter text to type.', 'error')
    return
  }
  const app = $('#hid-app').value.trim()
  void runHid('/api/hid/type', { text, app: app || undefined }, `Typing ${text.length} characters…`)
})

$('#hid-send-key').addEventListener('click', () => {
  const combo = $('#hid-combo').value.trim()
  if (!combo) {
    hidResult('Enter a key or combo.', 'error')
    return
  }
  const repeat = Number($('#hid-repeat').value) || 1
  const app = $('#hid-app').value.trim()
  void runHid('/api/hid/combo', { combo, repeat, app: app || undefined }, `Sending ${combo}…`)
})

$('#hid-move').addEventListener('click', () => {
  const x = Number($('#hid-x').value)
  const y = Number($('#hid-y').value)
  setCursor(x, y)
  void runHid('/api/hid/move', { x, y }, `Moving to ${x}, ${y}…`)
})

$('#hid-click').addEventListener('click', () => {
  const x = Number($('#hid-x').value)
  const y = Number($('#hid-y').value)
  const button = $('#hid-button').value
  const count = Number($('#hid-count').value) || 1
  setCursor(x, y)
  void runHid('/api/hid/click', { x, y, button, count }, `Clicking ${button} at ${x}, ${y}…`)
})

$('#hid-scroll').addEventListener('click', () => {
  const dx = Number($('#hid-dx').value) || 0
  const dy = Number($('#hid-dy').value) || 0
  void runHid('/api/hid/scroll', { dx, dy }, 'Scrolling…')
})

$('#hid-drag').addEventListener('click', () => {
  const fromX = Number($('#hid-from-x').value)
  const fromY = Number($('#hid-from-y').value)
  const toX = Number($('#hid-to-x').value)
  const toY = Number($('#hid-to-y').value)
  const durationMs = Number($('#hid-duration').value) || 400
  const button = $('#hid-button').value
  setCursor(toX, toY)
  void runHid(
    '/api/hid/drag',
    { fromX, fromY, toX, toY, durationMs, button },
    `Dragging from ${fromX}, ${fromY} to ${toX}, ${toY}…`,
  )
})

$('#open-octo').addEventListener('click', async () => {
  const button = $('#open-octo')
  button.disabled = true
  button.textContent = 'Opening…'
  try {
    await api('/api/app/open', { method: 'POST', body: '{}' })
    toast('Octo Browser is ready')
    await refreshAll({ silent: true })
  } catch (error) {
    toast(error.message, 'error')
  } finally {
    button.disabled = false
    button.textContent = 'Open Octo'
  }
})

$('#create-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const form = event.currentTarget
  const button = $('#create-button')
  const name = form.elements.name.value.trim()
  if (!name) return

  const body = {
    name,
    os: form.elements.os.value,
    osArch: form.elements.osArch.value,
    extension: form.elements.extension.value || '',
    launch: form.elements.launch.checked,
  }
  const proxy = form.elements.proxy.value.trim()
  if (proxy) body.proxy = proxy

  button.disabled = true
  button.textContent = body.launch ? 'Creating and opening…' : 'Creating…'

  try {
    const result = await api('/api/profiles', { method: 'POST', body: JSON.stringify(body) })
    const extras = result.extensions?.length
      ? ` with ${result.extensions.map((extension) => extension.name).join(', ')}`
      : ''
    const launched = body.launch ? ' The browser is opening.' : ''
    showCreateResult(`Created ${result.name}${extras}.${launched}`, 'ok')
    form.elements.name.value = ''
    form.elements.launch.checked = false
    await refreshAll({ silent: true })
  } catch (error) {
    showCreateResult(error.message, 'error')
  } finally {
    button.disabled = false
    button.textContent = 'Create profile'
  }
})

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]')
  if (!button) return

  const uuid = button.dataset.uuid
  const action = button.dataset.action
  const profile = findProfile(uuid)

  if (action === 'manage') {
    await openManage(uuid)
    return
  }

  if (action === 'delete' && !window.confirm(`Stop and delete "${profile?.name || uuid}"?`)) {
    return
  }

  button.disabled = true
  try {
    if (action === 'launch') {
      await api(`/api/profiles/${encodeURIComponent(uuid)}/launch`, { method: 'POST', body: '{}' })
      toast('Profile launched')
    } else if (action === 'stop') {
      await api(`/api/profiles/${encodeURIComponent(uuid)}/stop`, { method: 'POST', body: '{}' })
      toast('Profile stopped')
    } else if (action === 'delete') {
      await api(`/api/profiles/${encodeURIComponent(uuid)}?force=1`, { method: 'DELETE' })
      toast('Profile deleted')
    }
    await refreshAll({ silent: true })
  } catch (error) {
    toast(error.message, 'error')
  } finally {
    button.disabled = false
  }
})

$('#lv-copy-success')?.addEventListener('click', async () => {
  const successes = state.live.data?.records?.successes || []
  const emails = successes.map((item) => item.email).filter(Boolean)
  if (!emails.length) {
    toast('No successful emails yet', 'error')
    return
  }
  try {
    await navigator.clipboard.writeText(emails.join('\n'))
    toast(`Copied ${emails.length} email${emails.length === 1 ? '' : 's'}`)
  } catch (error) {
    toast('Copy failed', 'error')
  }
})

$('#modal-close').addEventListener('click', closeModal)
$('#modal').addEventListener('click', (event) => {
  if (event.target === $('#modal')) closeModal()
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.manage) closeModal()
})

renderStatus()
renderMetrics()
renderProfiles()
renderExtensions()
renderRuns()
void refreshAll({ silent: true })
startLive()

setInterval(() => {
  if (document.hidden || state.manage) return
  void refreshAll({ silent: true })
}, 15000)
