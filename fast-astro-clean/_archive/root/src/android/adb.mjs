import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export class AdbError extends Error {
  constructor(message, { status = 502, detail = '' } = {}) {
    super(message)
    this.name = 'AdbError'
    this.status = status
    this.detail = detail
  }
}

export function resolveAdbPath(configured = 'adb') {
  const candidates = []

  if (configured) {
    const expanded = configured.startsWith('~/')
      ? path.join(os.homedir(), configured.slice(2))
      : configured
    candidates.push(expanded)
  }

  candidates.push(
    path.join(os.homedir(), 'Downloads', 'platform-tools', 'adb'),
    path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb',
    '/usr/bin/adb',
  )

  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate)
      const binary = stat.isDirectory() ? path.join(candidate, 'adb') : candidate
      const binaryStat = fs.statSync(binary)
      if (!binaryStat.isFile()) continue
      fs.accessSync(binary, fs.constants.X_OK)
      return binary
    } catch {}
  }

  return configured || 'adb'
}

export function parseAdbDevices(text) {
  return String(text || '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('*'))
    .map((line) => {
      const parts = line.split(/\s+/)
      const model = line.match(/\bmodel:(\S+)/)?.[1]?.replace(/_/g, ' ') || ''
      return {
        serial: parts[0],
        state: parts[1] || 'unknown',
        model,
      }
    })
    .filter((device) => device.serial)
}

export class Adb {
  constructor({ binary = 'adb', serial = '', timeoutMs = 12000, deviceWaitMs = 20000 } = {}) {
    this.binary = binary
    this.serial = serial
    this.timeoutMs = timeoutMs
    this.deviceWaitMs = deviceWaitMs
  }

  serialArgs() {
    return this.serial ? ['-s', this.serial] : []
  }

  async spawnRaw(args, { timeoutMs = this.timeoutMs } = {}) {
    try {
      const { stdout } = await execFileAsync(
        this.binary,
        args,
        { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      )
      return stdout.trim()
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new AdbError('adb not found. Install Android platform-tools or set ANTIG_ADB.', { status: 503 })
      }
      if (error.killed || error.signal) {
        throw new AdbError(`adb command timed out after ${timeoutMs}ms.`, { status: 504 })
      }
      const detail = String(error.stderr || error.stdout || error.message || '').trim()
      throw new AdbError(detail || `adb exited with code ${error.code}.`, { status: 502, detail })
    }
  }

  async spawn(args, options = {}) {
    return this.spawnRaw([...this.serialArgs(), ...args], options)
  }

  async run(...args) {
    return this.spawn(args)
  }

  async shell(...args) {
    return this.spawn(['shell', ...args])
  }

  async devices() {
    const text = await this.spawnRaw(['devices', '-l'])
    return parseAdbDevices(text)
  }

  async waitForDevice(timeoutMs = this.deviceWaitMs) {
    const deadline = Date.now() + timeoutMs

    for (;;) {
      let devices = []
      try {
        devices = await this.devices()
      } catch (error) {
        if (error.status === 503) throw error
      }

      if (!this.serial && devices.length > 1) return devices

      const ready = this.serial
        ? devices.some((device) => device.serial === this.serial && device.state === 'device')
        : devices.filter((device) => device.state === 'device').length === 1
      if (ready) return devices
      if (Date.now() >= deadline) return devices

      try {
        await this.spawn(['wait-for-device'], { timeoutMs: 5000 })
      } catch {}
      await sleep(700)
    }
  }

  async verifyDevice() {
    await this.waitForDevice()
    const devices = await this.devices()

    let target = null
    if (this.serial) {
      target = devices.find((device) => device.serial === this.serial) || null
    } else if (devices.length === 1) {
      target = devices[0]
    } else if (devices.length > 1) {
      throw new AdbError('Multiple Android devices connected; select a serial first.', { status: 409 })
    }

    if (!target) {
      throw new AdbError(
        devices.length === 0
          ? 'No Android device connected. Plug in the phone with USB debugging enabled.'
          : `No device with serial "${this.serial}" is connected.`,
        { status: 503 },
      )
    }
    if (target.state === 'unauthorized') {
      throw new AdbError('Device is connected but not authorized. Accept the USB debugging prompt on the phone.', { status: 409 })
    }
    if (target.state !== 'device') {
      throw new AdbError(`Device is in state "${target.state}", not ready.`, { status: 409 })
    }

    return target
  }
}
