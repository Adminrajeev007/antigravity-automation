import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const OCTO_HOME = path.join(os.homedir(), '.Octo Browser')

const DEFAULTS = {
  server: {
    host: '127.0.0.1',
    port: 8787,
  },
  octo: {
    defaultExtension: '',
    defaultProxy: 'direct',
    launchArgs: [],
  },
  sheets: {
    spreadsheetId: '',
    sheetName: 'Records',
    credentialsPath: '',
  },
  android: {
    adbPath: 'adb',
    serial: '',
    adbTimeoutMs: 12000,
    deviceWaitMs: 20000,
    uiSettleMs: 2000,
    stateSettleMs: 3000,
    tapAttempts: 3,
    minDuration: 1,
    maxDuration: 300,
    requireUsbTether: true,
    usbTetherTimeoutMs: 90000,
    airplaneDumpPath: '/sdcard/antig_airplane.xml',
    tetherDumpPath: '/sdcard/antig_tether.xml',
  },
}

function merge(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
    return extra === undefined ? base : extra
  }
  const out = { ...base }
  for (const [key, value] of Object.entries(extra)) {
    if (
      value && typeof value === 'object' && !Array.isArray(value)
      && base?.[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
    ) {
      out[key] = merge(base[key], value)
    } else {
      out[key] = value
    }
  }
  return out
}

export function loadConfig() {
  const configPath = path.join(ROOT_DIR, 'config.json')
  let fileConfig = {}

  try {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`Cannot read ${configPath}: ${error.message}`)
    }
  }

  const config = merge(DEFAULTS, fileConfig)
  const env = process.env

  if (env.ANTIG_HOST) config.server.host = env.ANTIG_HOST
  if (env.ANTIG_PORT) config.server.port = Number(env.ANTIG_PORT)
  if (env.OCTO_DEFAULT_EXTENSION) config.octo.defaultExtension = env.OCTO_DEFAULT_EXTENSION
  if (env.OCTO_DEFAULT_PROXY) config.octo.defaultProxy = env.OCTO_DEFAULT_PROXY
  if (env.OCTO_LAUNCH_ARGS) {
    config.octo.launchArgs = env.OCTO_LAUNCH_ARGS.split(/\s+/).filter(Boolean)
  }
  if (env.ANTIG_SHEET_ID) config.sheets.spreadsheetId = env.ANTIG_SHEET_ID
  if (env.ANTIG_SHEET_NAME) config.sheets.sheetName = env.ANTIG_SHEET_NAME
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    config.sheets.credentialsPath = env.GOOGLE_APPLICATION_CREDENTIALS
  }
  if (env.ANTIG_SHEET_CREDENTIALS) config.sheets.credentialsPath = env.ANTIG_SHEET_CREDENTIALS
  if (env.ANTIG_ADB) config.android.adbPath = env.ANTIG_ADB
  if (env.ANTIG_ANDROID_SERIAL) config.android.serial = env.ANTIG_ANDROID_SERIAL
  else if (env.ANDROID_SERIAL) config.android.serial = env.ANDROID_SERIAL
  if (env.ANTIG_ADB_TIMEOUT_MS) config.android.adbTimeoutMs = Number(env.ANTIG_ADB_TIMEOUT_MS)
  if (env.ANTIG_REQUIRE_USB_TETHER !== undefined) {
    config.android.requireUsbTether = !['0', 'false', 'off', 'no'].includes(
      String(env.ANTIG_REQUIRE_USB_TETHER).toLowerCase(),
    )
  }
  if (env.ANTIG_USB_TETHER_TIMEOUT_MS) {
    config.android.usbTetherTimeoutMs = Number(env.ANTIG_USB_TETHER_TIMEOUT_MS)
  }

  for (const key of ['adbTimeoutMs', 'deviceWaitMs', 'uiSettleMs', 'stateSettleMs', 'tapAttempts', 'minDuration', 'maxDuration', 'usbTetherTimeoutMs']) {
    const value = Number(config.android[key])
    config.android[key] = Number.isFinite(value) && value > 0 ? value : DEFAULTS.android[key]
  }

  if (!Number.isInteger(config.server.port) || config.server.port < 1 || config.server.port > 65535) {
    throw new Error(`Invalid server port: ${config.server.port}`)
  }

  return { ...config, configPath }
}
