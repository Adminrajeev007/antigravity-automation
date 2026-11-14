import { AdbError, sleep } from './adb.mjs'
import { dumpUi, parseBounds } from './ui.mjs'

const TETHER_ACTIVITY = 'com.android.settings/.TetherSettings'
const TETHER_ACTIONS = [
  ['am', 'start', '-a', 'android.settings.OPLUS_TETHER_SETTINGS'],
  ['am', 'start', '-a', 'android.settings.TETHER_SETTINGS'],
  ['am', 'start', '-n', TETHER_ACTIVITY],
]

function isUsbTetherLabel(text) {
  const value = String(text || '').trim().toLowerCase()
  if (value === 'usb tethering') return true
  return value.includes('usb') && (value.includes('tether') || value.includes('网络共享'))
}

export function findUsbTetherSwitch(xml) {
  const nodes = String(xml).split('<node')

  let labelBounds = null
  for (const node of nodes) {
    const match = node.match(/text="([^"]*)"/)
    if (!match || !isUsbTetherLabel(match[1])) continue
    labelBounds = parseBounds(node)
    if (labelBounds) break
  }
  if (!labelBounds) return null

  const [lx1, ly1, lx2, ly2] = labelBounds
  let bestRow = null
  let bestArea = Infinity

  for (const node of nodes) {
    if (!node.includes('clickable="true"')) continue
    const bounds = parseBounds(node)
    if (!bounds) continue
    const [rx1, ry1, rx2, ry2] = bounds
    if (rx1 <= lx1 && ry1 <= ly1 && rx2 >= lx2 && ry2 >= ly2) {
      const area = (rx2 - rx1) * (ry2 - ry1)
      if (area < bestArea) {
        bestArea = area
        bestRow = bounds
      }
    }
  }

  let x
  let y
  if (bestRow) {
    x = (bestRow[0] + bestRow[2]) >> 1
    y = (bestRow[1] + bestRow[3]) >> 1
  } else {
    x = (lx1 + lx2) >> 1
    y = (ly1 + ly2) >> 1
  }

  let checked = false
  if (bestRow) {
    const [rx1, ry1, rx2, ry2] = bestRow
    let foundSwitch = false

    for (const node of nodes) {
      const bounds = parseBounds(node)
      if (!bounds) continue
      const [sx1, sy1, sx2, sy2] = bounds
      if (sx1 < rx1 || sy1 < ry1 || sx2 > rx2 || sy2 > ry2) continue
      const className = node.match(/class="([^"]*)"/)?.[1] || ''
      if (!className.includes('Switch') && !node.includes('switchWidget') && !node.includes('switch_widget')) continue
      const state = node.match(/checked="(true|false)"/)
      if (state) checked = state[1] === 'true'
      foundSwitch = true
      break
    }

    if (!foundSwitch) {
      for (const node of nodes) {
        const bounds = parseBounds(node)
        if (!bounds) continue
        const [sx1, sy1, sx2, sy2] = bounds
        if (sx1 < rx1 || sy1 < ry1 || sx2 > rx2 || sy2 > ry2) continue
        const state = node.match(/checked="(true|false)"/)
        if (state) {
          checked = state[1] === 'true'
          break
        }
      }
    }
  }

  return { checked, x, y }
}

export class TetherController {
  constructor(adb, options = {}) {
    this.adb = adb
    this.uiSettleMs = options.uiSettleMs ?? 2000
    this.tapAttempts = options.tapAttempts ?? 3
    this.dumpPath = options.tetherDumpPath || '/sdcard/antig_tether.xml'
  }

  async readState({ attempts = 2 } = {}) {
    await this.adb.waitForDevice()
    let lastError = null

    for (const action of TETHER_ACTIONS) {
      try {
        const output = await this.adb.shell(...action)
        if (/unable to resolve|not found|does not exist|error:/i.test(output)) {
          lastError = new AdbError(output, { status: 502 })
          continue
        }
        lastError = null
        await sleep(this.uiSettleMs)
      } catch (error) {
        lastError = error
        await this.adb.waitForDevice()
        continue
      }

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          const xml = await dumpUi(this.adb, this.dumpPath, { attempts: 2, delayMs: 1500 })
          const state = findUsbTetherSwitch(xml)
          if (state) return state
        } catch (error) {
          lastError = error
        }
        await sleep(1500)
      }

      await this.adb.waitForDevice()
    }

    if (lastError) {
      throw new AdbError(`Could not read the Tether settings screen: ${lastError.message}`, { status: 502 })
    }
    return null
  }

  async usbState() {
    try {
      return String(await this.adb.shell('getprop', 'sys.usb.state')).trim() || null
    } catch {
      return null
    }
  }

  async pressHome() {
    try {
      await this.adb.shell('input', 'keyevent', 'KEYCODE_HOME')
    } catch {}
  }

  async status() {
    const device = await this.adb.verifyDevice()
    const state = await this.usbState()
    return {
      ok: true,
      device,
      on: state ? /rndis/i.test(state) : null,
      usbState: state,
    }
  }

  async set(wantOn) {
    const desired = Boolean(wantOn)
    const label = desired ? 'on' : 'off'

    await this.adb.verifyDevice()

    let state = await this.usbState()
    let on = state ? /rndis/i.test(state) : null
    if (on === desired) {
      return {
        ok: true,
        changed: false,
        on: desired,
        usbState: state,
        method: 'adb',
        message: `USB tethering already ${label}.`,
      }
    }

    // Keep adb in the USB function list so the device stays controllable.
    await this.adb.shell('svc', 'usb', 'setFunctions', desired ? 'rndis,adb' : 'mtp,adb')

    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      await sleep(1000)
      state = await this.usbState()
      on = state ? /rndis/i.test(state) : null
      if (on === desired) {
        return {
          ok: true,
          changed: true,
          on: desired,
          usbState: state,
          method: 'adb',
          message: `USB tethering ${label}.`,
        }
      }
    }

    throw new AdbError(
      `USB tethering did not turn ${label} (state: ${state || 'unknown'}).`,
      { status: 502 },
    )
  }
}
