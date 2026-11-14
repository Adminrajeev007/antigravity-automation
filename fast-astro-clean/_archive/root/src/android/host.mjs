import net from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function run(command, args, timeoutMs = 6000) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    })
    return stdout
  } catch {
    return ''
  }
}

export function parseDarwinRoute(output) {
  const route = {}
  for (const line of String(output || '').split('\n')) {
    const match = line.match(/^\s*(interface|gateway):\s*(\S+)/)
    if (match) route[match[1]] = match[2]
  }
  return route
}

export function parseLinuxRoute(output) {
  const line = String(output || '').split('\n').find((entry) => entry.trim().startsWith('default'))
  if (!line) return {}
  return {
    gateway: line.match(/via (\S+)/)?.[1] || null,
    interface: line.match(/dev (\S+)/)?.[1] || null,
  }
}

export function parseIfconfig(output) {
  const interfaces = []
  let current = null

  for (const line of String(output || '').split('\n')) {
    const interfaceMatch = line.match(/^([a-z0-9]+): flags=/i)
    if (interfaceMatch) {
      current = { name: interfaceMatch[1] }
      interfaces.push(current)
      continue
    }
    if (!current) continue
    const inet = line.match(/\binet (\d+\.\d+\.\d+\.\d+)/)
    if (inet) current.ipv4 = inet[1]
  }

  return interfaces.filter((item) => item.ipv4)
}

export function parseIpAddr(output) {
  const interfaces = []
  let current = null

  for (const line of String(output || '').split('\n')) {
    const interfaceMatch = line.match(/^\d+:\s+([^:@\s]+)[:@]/)
    if (interfaceMatch) {
      current = { name: interfaceMatch[1] }
      interfaces.push(current)
      continue
    }
    if (!current) continue
    const inet = line.match(/inet (\d+\.\d+\.\d+\.\d+)/)
    if (inet) current.ipv4 = inet[1]
  }

  return interfaces.filter((item) => item.ipv4)
}

export function tcpProbe(host = '1.1.1.1', port = 443, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let settled = false

    const finish = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export async function egressIp(timeoutMs = 6000) {
  try {
    const response = await fetch('https://api.ipify.org', {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'antiG/0.1' },
    })
    if (!response.ok) return null
    const value = (await response.text()).trim()
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(value) ? value : null
  } catch {
    return null
  }
}

export const BETTER_TETHER_API = 'http://127.0.0.1:9400/api/status'

export async function betterTetherStatus(timeoutMs = 2500) {
  try {
    const response = await fetch(BETTER_TETHER_API, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    if (!response.ok) {
      return { available: true, connected: false, running: true, error: `HTTP ${response.status}` }
    }
    const data = await response.json()
    const relay = data.relay || {}
    return {
      available: true,
      running: data.running !== false,
      active: data.active === true,
      connected: relay.connected === true,
      clientIP: relay.clientIP || null,
      phoneMAC: relay.phoneMAC || null,
      connectedAt: relay.connectedAt || null,
      sentBytes: relay.sentBytes ?? null,
      recvBytes: relay.recvBytes ?? null,
      uptime: data.uptime || null,
    }
  } catch (error) {
    return { available: false, connected: false, running: false, error: error.message }
  }
}

export function parseSplitRoutes(output) {
  const routes = {}
  for (const line of String(output || '').split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts[0] === '0/1' || parts[0] === '128.0/1') {
      routes[parts[0]] = parts[1] || null
    }
  }
  return routes
}

export async function hostNetwork() {
  let route = {}
  let interfaces = []
  let splitRoutes = {}

  if (process.platform === 'darwin') {
    route = parseDarwinRoute(await run('route', ['-n', 'get', 'default']))
    interfaces = parseIfconfig(await run('ifconfig', []))
    splitRoutes = parseSplitRoutes(await run('netstat', ['-rn', '-f', 'inet']))
  } else if (process.platform === 'linux') {
    route = parseLinuxRoute(await run('ip', ['route', 'show', 'default']))
    interfaces = parseIpAddr(await run('ip', ['-f', 'inet', 'addr']))
  }

  const defaultInterface = route.interface || null
  const defaultIp = interfaces.find((item) => item.name === defaultInterface)?.ipv4 || null
  const tetherCandidates = interfaces.filter((item) => {
    return /^(utun|bridge)/.test(item.name)
      || /^192\.168\.(42|137)\./.test(item.ipv4 || '')
  })

  const betterTether = await betterTetherStatus()
  const usbInterface = betterTether.clientIP
    ? interfaces.find((item) => item.ipv4 === betterTether.clientIP)?.name || null
    : null
  const usbRoutes = Object.entries(splitRoutes)
  const usbRoutesActive = usbRoutes.length >= 2
    && usbRoutes.every(([, gateway]) => gateway === usbInterface)
  const egressViaUsb = Boolean(
    betterTether.connected
    && (usbRoutesActive || (usbInterface && defaultInterface === usbInterface)),
  )

  const egress = await egressIp(10000)
  const internet = Boolean(egress)

  return {
    platform: process.platform,
    internet,
    egressIp: egress,
    defaultInterface,
    defaultGateway: route.gateway || null,
    defaultIp,
    egressViaUsb,
    usbTether: {
      provider: 'bettertether',
      ...betterTether,
      interface: usbInterface,
      splitRoutes,
      routesActive: usbRoutesActive,
    },
    tetherCandidates,
    interfaces,
  }
}
