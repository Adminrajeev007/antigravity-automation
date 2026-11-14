import { AdbError, sleep } from './adb.mjs'

export const BOUNDS_RE = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/

export function parseBounds(node) {
  const match = String(node).match(BOUNDS_RE)
  return match ? match.slice(1, 5).map(Number) : null
}

export function nodeAttribute(node, name) {
  const match = String(node).match(new RegExp(`${name}="([^"]*)"`))
  return match ? match[1] : null
}

export async function dumpUi(adb, remotePath, { attempts = 3, delayMs = 1500 } = {}) {
  let lastError = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await adb.shell('uiautomator', 'dump', remotePath)
      const xml = await adb.shell('cat', remotePath)
      if (xml.includes('<hierarchy')) return xml
      lastError = new Error('empty UI dump')
    } catch (error) {
      lastError = error
    }
    await sleep(delayMs)
  }

  throw new AdbError(
    `UI dump failed after ${attempts} attempts: ${lastError?.message || 'empty dump'}`,
    { status: 502 },
  )
}
