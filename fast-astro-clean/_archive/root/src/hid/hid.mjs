import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SOURCE = path.join(ROOT_DIR, 'native', 'hid.swift')
const BUILD_DIR = path.join(ROOT_DIR, 'native', '.build')
const BINARY = path.join(BUILD_DIR, 'antig-hid')

const MODIFIER_ALIASES = {
  cmd: 'cmd',
  command: 'cmd',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  ctrl: 'ctrl',
  control: 'ctrl',
  fn: 'fn',
  caps: 'caps',
  capslock: 'caps',
}

const BUTTONS = new Set(['left', 'right', 'middle', 'center'])

export class HidError extends Error {
  constructor(message, { status = 502 } = {}) {
    super(message)
    this.name = 'HidError'
    this.status = status
  }
}

export function normalizeModifiers(value) {
  if (value === undefined || value === null) return []
  const list = Array.isArray(value) ? value : [value]
  const result = []

  for (const raw of list) {
    const key = String(raw).trim().toLowerCase()
    if (!key) continue
    const normalized = MODIFIER_ALIASES[key]
    if (!normalized) {
      throw new HidError(`Unknown modifier "${raw}". Use cmd, shift, alt, ctrl, fn, or caps.`, { status: 400 })
    }
    if (!result.includes(normalized)) result.push(normalized)
  }

  return result
}

export function parseCombo(combo) {
  const parts = String(combo ?? '').split('+').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) throw new HidError('Key combo is required.', { status: 400 })
  const key = parts.pop()
  return { key, modifiers: normalizeModifiers(parts) }
}

function requireString(value, name, { max = 20000, trim = false } = {}) {
  if (typeof value !== 'string') throw new HidError(`${name} must be a string.`, { status: 400 })
  const result = trim ? value.trim() : value
  if (trim && result.length === 0) throw new HidError(`${name} is required.`, { status: 400 })
  if (result.length > max) throw new HidError(`${name} is too long.`, { status: 400 })
  return result
}

function requireNumber(value, name) {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new HidError(`${name} must be a number.`, { status: 400 })
  return number
}

function requireInteger(value, name, { min, max }) {
  const number = Number(value)
  if (!Number.isInteger(number)) throw new HidError(`${name} must be a whole number.`, { status: 400 })
  if (number < min || number > max) {
    throw new HidError(`${name} must be between ${min} and ${max}.`, { status: 400 })
  }
  return number
}

function requireButton(value) {
  const button = String(value ?? 'left').trim().toLowerCase()
  if (!BUTTONS.has(button)) throw new HidError('button must be left, right, or middle.', { status: 400 })
  return button
}

export class HidAutomation {
  constructor({
    source = SOURCE,
    binary = BINARY,
    buildDir = BUILD_DIR,
    swiftc = 'swiftc',
  } = {}) {
    this.source = source
    this.binary = binary
    this.buildDir = buildDir
    this.swiftc = swiftc
  }

  async ensureHelper() {
    let sourceStat = null
    try {
      sourceStat = fs.statSync(this.source)
    } catch {
      throw new HidError('HID helper source not found at native/hid.swift.', { status: 500 })
    }

    let binaryStat = null
    try {
      binaryStat = fs.statSync(this.binary)
    } catch {}

    if (binaryStat && binaryStat.mtimeMs >= sourceStat.mtimeMs) return this.binary

    fs.mkdirSync(this.buildDir, { recursive: true })
    try {
      await execFileAsync(this.swiftc, ['-O', this.source, '-o', this.binary], {
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8',
      })
    } catch (error) {
      const detail = String(error.stderr || error.stdout || error.message || '').trim()
      throw new HidError(`Could not build the HID helper: ${detail}`, { status: 500 })
    }

    return this.binary
  }

  async run(command, { timeoutMs = 30000 } = {}) {
    const binary = await this.ensureHelper()

    return new Promise((resolve, reject) => {
      const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let settled = false

      const finish = (error, result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolve(result)
      }

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        finish(new HidError('HID command timed out.', { status: 504 }))
      }, timeoutMs)

      child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
      child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
      child.on('error', (error) => {
        finish(new HidError(`Could not run the HID helper: ${error.message}`, { status: 500 }))
      })
      child.on('close', () => {
        let result = null
        try {
          result = JSON.parse(stdout.trim())
        } catch {
          finish(new HidError(stderr.trim() || 'HID helper returned invalid JSON.', { status: 500 }))
          return
        }

        if (!result.ok) {
          const message = result.error || 'HID command failed.'
          const status = /accessibility permission/i.test(message) ? 403 : 400
          finish(new HidError(message, { status }))
          return
        }

        finish(null, result)
      })

      child.stdin.on('error', () => {})
      child.stdin.end(JSON.stringify(command))
    })
  }

  status() {
    return this.run({ command: 'status' })
  }

  requestPermission() {
    return this.run({ command: 'request' }, { timeoutMs: 15000 })
  }

  screens() {
    return this.run({ command: 'screens' })
  }

  type(value, { intervalMs = 5 } = {}) {
    const valueText = requireString(value, 'text', { max: 50000 })
    const interval = requireInteger(intervalMs, 'intervalMs', { min: 0, max: 1000 })
    return this.run(
      { command: 'type', text: valueText, intervalMs: interval },
      { timeoutMs: Math.max(30000, valueText.length * interval + 10000) },
    )
  }

  key(value, { modifiers = [], repeat = 1, intervalMs = 30 } = {}) {
    const key = requireString(value, 'key', { max: 100, trim: true })
    const mods = normalizeModifiers(modifiers)
    const count = requireInteger(repeat, 'repeat', { min: 1, max: 1000 })
    const interval = requireInteger(intervalMs, 'intervalMs', { min: 0, max: 5000 })
    return this.run(
      { command: 'key', key, modifiers: mods, repeat: count, intervalMs: interval },
      { timeoutMs: Math.max(30000, count * interval + 10000) },
    )
  }

  combo(value, { repeat = 1 } = {}) {
    const { key, modifiers } = parseCombo(value)
    return this.key(key, { modifiers, repeat })
  }

  move(x, y) {
    const px = requireNumber(x, 'x')
    const py = requireNumber(y, 'y')
    return this.run({ command: 'move', x: px, y: py })
  }

  click(x, y, { button = 'left', count = 1 } = {}) {
    const px = requireNumber(x, 'x')
    const py = requireNumber(y, 'y')
    const clicks = requireInteger(count, 'count', { min: 1, max: 3 })
    return this.run({ command: 'click', x: px, y: py, button: requireButton(button), count: clicks })
  }

  scroll(dx = 0, dy = 0) {
    const horizontal = requireNumber(dx, 'dx')
    const vertical = requireNumber(dy, 'dy')
    if (horizontal === 0 && vertical === 0) {
      throw new HidError('Scroll dx or dy must be non-zero.', { status: 400 })
    }
    return this.run({ command: 'scroll', dx: horizontal, dy: vertical })
  }

  drag(fromX, fromY, toX, toY, { durationMs = 400, button = 'left' } = {}) {
    const startX = requireNumber(fromX, 'fromX')
    const startY = requireNumber(fromY, 'fromY')
    const endX = requireNumber(toX, 'toX')
    const endY = requireNumber(toY, 'toY')
    const duration = requireInteger(durationMs, 'durationMs', { min: 0, max: 60000 })
    return this.run(
      {
        command: 'drag',
        fromX: startX,
        fromY: startY,
        toX: endX,
        toY: endY,
        durationMs: duration,
        button: requireButton(button),
      },
      { timeoutMs: Math.max(30000, duration + 10000) },
    )
  }

  activate(app) {
    const name = requireString(app, 'app', { max: 200, trim: true })
    return this.run({ command: 'activate', app: name })
  }

  wait(ms) {
    const duration = requireInteger(ms, 'ms', { min: 0, max: 60000 })
    return this.run({ command: 'wait', ms: duration }, { timeoutMs: duration + 10000 })
  }

  sequence(steps) {
    if (!Array.isArray(steps) || steps.length === 0 || steps.length > 200) {
      throw new HidError('steps must be a non-empty array of commands.', { status: 400 })
    }
    for (const step of steps) {
      if (!step || typeof step !== 'object' || Array.isArray(step)) {
        throw new HidError('Each step must be a command object.', { status: 400 })
      }
    }
    return this.run({ command: 'sequence', steps }, { timeoutMs: 120000 })
  }
}
