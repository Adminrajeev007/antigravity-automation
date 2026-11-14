import { Adb, AdbError, resolveAdbPath, sleep } from './adb.mjs'
import { AirplaneController, validateDuration } from './airplane.mjs'
import { TetherController } from './tether.mjs'
import { phoneStatus } from './phone.mjs'
import { connectionStatus } from './connection.mjs'
import { betterTetherStatus } from './host.mjs'

export class AndroidService {
  constructor(config = {}, { serial = '' } = {}) {
    this.config = config
    this.adb = new Adb({
      binary: resolveAdbPath(config.adbPath || 'adb'),
      serial: serial || config.serial || '',
      timeoutMs: config.adbTimeoutMs ?? 12000,
      deviceWaitMs: config.deviceWaitMs ?? 20000,
    })
    this.airplane = new AirplaneController(this.adb, config)
    this.tether = new TetherController(this.adb, config)
  }

  withSerial(serial) {
    if (!serial || serial === this.adb.serial) return this
    return new AndroidService(this.config, { serial })
  }

  devices() {
    return this.adb.devices()
  }

  status() {
    return phoneStatus(this.adb)
  }

  connection() {
    return connectionStatus(this.adb)
  }

  async airplaneAction({ action = 'status', duration } = {}) {
    if (action === 'status') return this.airplane.status()

    if (action === 'on' || action === 'off') {
      const device = await this.adb.verifyDevice()
      const result = await this.airplane.set(action === 'on')
      return { ok: true, device, ...result }
    }

    if (action === 'cycle') {
      return this.airplane.cycle(duration)
    }

    throw new AdbError(`Unknown airplane action: ${action}`, { status: 400 })
  }

  async tetherAction({ action = 'status' } = {}) {
    if (action === 'status') return this.tether.status()

    if (action === 'on' || action === 'off') {
      const device = await this.adb.verifyDevice()
      const result = await this.tether.set(action === 'on')
      return { ok: true, device, ...result }
    }

    throw new AdbError(`Unknown tether action: ${action}`, { status: 400 })
  }

  async waitForMobileData(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs
    let last = null

    while (Date.now() < deadline) {
      try {
        last = await phoneStatus(this.adb)
        if (last.dataConnected) return last
      } catch {
        // Keep polling while the radio reconnects.
      }
      await sleep(1000)
    }

    throw new AdbError(
      `Mobile data did not reconnect after the airplane cycle (state: ${last ? last.dataConnected : 'unknown'}).`,
      { status: 502 },
    )
  }

  async waitForUsbTether(timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs
    let last = null

    while (Date.now() < deadline) {
      last = await betterTetherStatus()
      if (last.connected) return last
      await sleep(2000)
    }

    throw new AdbError(
      `USB tether (BetterTether) did not reconnect within ${Math.round(timeoutMs / 1000)}s (${last?.error || 'not connected'}).`,
      { status: 502 },
    )
  }

  async reset({ duration = 5 } = {}) {
    const seconds = validateDuration(duration, {
      min: this.config.minDuration ?? 1,
      max: this.config.maxDuration ?? 300,
    })

    const device = await this.adb.verifyDevice()
    const before = await phoneStatus(this.adb).catch(() => null)
    const airplane = await this.airplane.cycle(seconds)
    const after = await this.waitForMobileData(30000)
    const tether = await this.tether.set(true)

    let usbTether = null
    if (this.config.requireUsbTether !== false) {
      usbTether = await this.waitForUsbTether(this.config.usbTetherTimeoutMs ?? 90000)
    }

    return {
      ok: true,
      device,
      duration: seconds,
      airplane,
      tether,
      usbTether,
      beforeIp: before ? before.mobileIp : null,
      afterIp: after ? after.mobileIp : null,
      message: `Airplane mode cycled for ${seconds}s, mobile data reconnected, then USB tethering was enabled.`,
    }
  }
}
