import { AdbError, sleep } from './adb.mjs'
import { dumpUi, parseBounds } from './ui.mjs'

const LABEL_RE = /(?:airplane|aeroplane|flight|飞行|飛航|機内)/i

export function findAirplaneSwitch(xml) {
  const nodes = String(xml).split('<node')
  let labelY = null

  for (const node of nodes) {
    if (!node.includes('android:id/title')) continue
    if (!LABEL_RE.test(node)) continue
    const bounds = parseBounds(node)
    if (bounds) labelY = (bounds[1] + bounds[3]) >> 1
    break
  }

  const switches = []
  for (const node of nodes) {
    if (!node.includes('Switch')) continue
    if (!(node.includes('switch_widget') || node.includes('android.widget.Switch'))) continue
    const bounds = parseBounds(node)
    if (bounds) {
      switches.push({
        x: (bounds[0] + bounds[2]) >> 1,
        y: (bounds[1] + bounds[3]) >> 1,
      })
    }
  }

  if (switches.length === 0) return null
  if (labelY !== null) {
    switches.sort((a, b) => Math.abs(a.y - labelY) - Math.abs(b.y - labelY))
  }
  return switches[0]
}

export function validateDuration(value, { min = 1, max = 300 } = {}) {
  const seconds = Number(value)
  if (!Number.isInteger(seconds)) {
    throw new AdbError('Duration must be a whole number of seconds.', { status: 400 })
  }
  if (seconds < min || seconds > max) {
    throw new AdbError(`Duration must be between ${min} and ${max} seconds.`, { status: 400 })
  }
  return seconds
}

export class AirplaneController {
  constructor(adb, options = {}) {
    this.adb = adb
    this.uiSettleMs = options.uiSettleMs ?? 2000
    this.stateSettleMs = options.stateSettleMs ?? 3000
    this.tapAttempts = options.tapAttempts ?? 3
    this.dumpPath = options.airplaneDumpPath || '/sdcard/antig_airplane.xml'
    this.minDuration = options.minDuration ?? 1
    this.maxDuration = options.maxDuration ?? 300
  }

  async read() {
    try {
      const value = String(await this.adb.shell('cmd', 'connectivity', 'airplane-mode')).trim().toLowerCase()
      if (value === 'enabled') return true
      if (value === 'disabled') return false
    } catch {
      // Fall back to the global setting below.
    }

    const value = String(await this.adb.shell('settings', 'get', 'global', 'airplane_mode_on')).trim()
    if (value === '1') return true
    if (value === '0') return false
    return null
  }

  async status() {
    const device = await this.adb.verifyDevice()
    return { ok: true, device, enabled: await this.read() }
  }

  async findSwitch() {
    await this.adb.shell('am', 'start', '-a', 'android.settings.AIRPLANE_MODE_SETTINGS')
    await sleep(this.uiSettleMs)
    const xml = await dumpUi(this.adb, this.dumpPath, { attempts: 2 })
    return findAirplaneSwitch(xml)
  }

  async pressHome() {
    try {
      await this.adb.shell('input', 'keyevent', 'KEYCODE_HOME')
    } catch {}
  }

  async set(enabled) {
    const target = Boolean(enabled)
    const label = target ? 'on' : 'off'
    let before = null

    try {
      before = await this.read()
    } catch {
      await this.adb.waitForDevice()
      before = await this.read()
    }

    if (before === target) {
      return {
        ok: true,
        changed: false,
        enabled: target,
        method: 'adb',
        message: `Airplane mode already ${label}.`,
      }
    }

    await this.adb.shell('cmd', 'connectivity', 'airplane-mode', target ? 'enable' : 'disable')

    const deadline = Date.now() + 15000
    let observed = null
    while (Date.now() < deadline) {
      await sleep(500)
      observed = await this.read().catch(() => null)
      if (observed === target) {
        return {
          ok: true,
          changed: true,
          enabled: target,
          method: 'adb',
          message: `Airplane mode ${target ? 'enabled' : 'disabled'}.`,
        }
      }
    }

    throw new AdbError(
      `Airplane mode did not become ${label} (observed ${observed}).`,
      { status: 502 },
    )
  }

  async cycle(duration) {
    const seconds = validateDuration(duration, { min: this.minDuration, max: this.maxDuration })
    const device = await this.adb.verifyDevice()
    let enabled = false

    try {
      const on = await this.set(true)
      enabled = true
      await sleep(seconds * 1000)
      await this.adb.verifyDevice()
      const off = await this.set(false)
      enabled = false
      return {
        ok: true,
        duration: seconds,
        device,
        steps: [on, off],
        message: `Airplane mode cycled for ${seconds}s.`,
      }
    } catch (error) {
      if (enabled) {
        try {
          await this.set(false)
        } catch {}
      }
      throw error
    }
  }
}
