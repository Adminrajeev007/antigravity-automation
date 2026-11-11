#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'

const execFileAsync = promisify(execFile)
const API = 'http://127.0.0.1:9400/api/status'
const LOG_FILE = '/var/log/antig-usbroutewatch.log'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`
  try { fs.appendFileSync(LOG_FILE, line) } catch {}
  process.stderr.write(line)
}

async function run(command, args, timeout = 8000) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    })
    return stdout
  } catch {
    return ''
  }
}

async function betterTether() {
  try {
    const response = await fetch(API, { signal: AbortSignal.timeout(2500) })
    const data = await response.json()
    const relay = data.relay || {}
    return { connected: relay.connected === true, clientIP: relay.clientIP || null }
  } catch {
    return { connected: false, clientIP: null }
  }
}

async function interfaceForIp(ip) {
  if (!ip) return null
  const text = await run('/sbin/ifconfig', ['-a'])
  let name = null
  for (const line of text.split('\n')) {
    if (line && !line.startsWith(' ') && line.includes(':')) {
      name = line.split(':')[0]
      continue
    }
    if (name && line.includes('inet ') && line.split(/\s+/).includes(ip)) return name
  }
  return null
}

async function usbAlive(iface) {
  if (!iface) return false
  const result = await run('/usr/bin/curl', ['-s', '-m', '4', '--interface', iface, 'https://api.ipify.org'], 7000)
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(result.trim())
}

async function splitRoutes() {
  const text = await run('/usr/sbin/netstat', ['-rn', '-f', 'inet'])
  const found = {}
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts[0] === '0/1' || parts[0] === '128.0/1') found[parts[0]] = parts[1] || null
  }
  return found
}

async function routeChange(action, iface) {
  for (const net of ['0/1', '128.0/1']) {
    const args = ['-n', action, '-net', net]
    if (action === 'add') args.push('-interface', iface)
    await run('/sbin/route', args, 5000)
  }
}

async function main() {
  log('route watcher started')
  let lastState = ''
  let fails = 0

  while (true) {
    const status = await betterTether()
    const iface = await interfaceForIp(status.clientIP)
    const alive = status.connected && await usbAlive(iface)
    const routes = await splitRoutes()
    const state = `${alive}|${iface}|${JSON.stringify(routes)}`

    if (state !== lastState) {
      log(`usb=${alive ? 'up' : 'down'} iface=${iface || 'none'} routes=${JSON.stringify(routes)}`)
      lastState = state
    }

    if (status.connected && iface) {
      const missing = Object.keys(routes).length < 2
      const wrong = Object.values(routes).some((name) => name !== iface)
      if (missing || wrong) {
        log(`restoring split routes via ${iface}`)
        await routeChange('delete')
        await routeChange('add', iface)
      }
      if (alive) fails = 0
      else fails += 1
    } else {
      fails += 1
    }

    if (fails >= 3 && Object.keys(routes).length > 0) {
      log('USB down: removing split routes for Wi-Fi failover')
      await routeChange('delete')
      fails = 0
    }

    await sleep(2000)
  }
}

main().catch((error) => {
  log(`route watcher fatal: ${error.message}`)
  process.exit(1)
})
