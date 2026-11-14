#!/usr/bin/env node
/**
 * Domain analytics (conservative ranking).
 *
 * Reads domain-stats.json (from domain-tracker.mjs) and produces:
 *   Domain, Tried, Running, Finished, Billing, SignupErr, Timeout, Other,
 *   Success%, Error%, Wilson95%, MedianMin, LastSeen
 *
 * Ranking uses the Wilson 95% lower bound for success (billing / finished),
 * so 2/2 does not outrank 18/25. Infra outcomes are not counted as domain
 * failures.
 */
import fs from 'node:fs'
import path from 'node:path'

const STATS = path.join(process.cwd(), 'domain-stats.json')
const OUT = path.join(process.cwd(), 'domain-analytics.csv')
const Z = 1.96

const INFRA = new Set([
  'stopped', 'profile-error', 'profile-crashed', 'profile-stopped',
  'extension-failed', 'failed'
])

function wilsonLower(successes, n) {
  if (!n) return 0
  const p = successes / n
  const denom = 1 + (Z * Z) / n
  const centre = p + (Z * Z) / (2 * n)
  const margin = Z * Math.sqrt((p * (1 - p) + (Z * Z) / (4 * n)) / n)
  return Math.max(0, Math.min(1, (centre - margin) / denom)) * 100
}

let data
try {
  data = JSON.parse(fs.readFileSync(STATS, 'utf8'))
} catch (e) {
  console.error('No domain-stats.json. Run domain-tracker.mjs first.')
  process.exit(1)
}

const map = new Map()
for (const a of Object.values(data.attempts || {})) {
  const domain = a.domain || '(none)'
  if (!map.has(domain)) {
    map.set(domain, {
      domain, tried: 0, running: 0, billing: 0, signupError: 0,
      timeout: 0, other: 0, infra: 0, durations: [], lastSeen: ''
    })
  }
  const r = map.get(domain)
  r.tried += 1
  const reason = String(a.reason || '').toLowerCase()
  const outcome = String(a.outcome || '').toLowerCase()
  const ended = String(a.endedAt || '')
  if (ended && ended > r.lastSeen) r.lastSeen = ended
  const started = String(a.startedAt || '')

  if (!outcome) {
    r.running += 1
    continue
  }
  if (INFRA.has(reason) || outcome === 'failed') {
    r.infra += 1
    continue
  }
  if (outcome === 'billing') r.billing += 1
  else if (outcome === 'signup-error') r.signupError += 1
  else if (outcome === 'timeout') r.timeout += 1
  else r.other += 1

  if (started && ended) {
    const ms = Date.parse(ended) - Date.parse(started)
    if (Number.isFinite(ms) && ms >= 0) r.durations.push(ms)
  }
}

function median(list) {
  if (!list.length) return null
  const s = [...list].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const rows = [...map.values()].map((r) => {
  const finished = r.billing + r.signupError + r.timeout + r.other
  const success = finished ? (r.billing / finished) * 100 : 0
  const error = finished ? (r.signupError / finished) * 100 : 0
  const med = median(r.durations)
  return {
    ...r,
    finished,
    success,
    error,
    wilson: wilsonLower(r.billing, finished),
    medianMin: med === null ? null : med / 60000
  }
})

rows.sort((a, b) => b.wilson - a.wilson || b.finished - a.finished || a.domain.localeCompare(b.domain))

const header = [
  'Domain', 'Tried', 'Running', 'Finished', 'Billing', 'SignupErr',
  'Timeout', 'Other', 'Infra', 'Success%', 'Error%', 'Wilson95%',
  'MedianMin', 'LastSeen'
]
const lines = [header.join('\t')]
for (const r of rows) {
  lines.push([
    r.domain,
    r.tried,
    r.running,
    r.finished,
    r.billing,
    r.signupError,
    r.timeout,
    r.other,
    r.infra,
    r.success.toFixed(1),
    r.error.toFixed(1),
    r.wilson.toFixed(1),
    r.medianMin === null ? '-' : r.medianMin.toFixed(1),
    r.lastSeen || '-'
  ].join('\t'))
}

console.log(lines.join('\n'))
fs.writeFileSync(OUT, lines.join('\n') + '\n')
console.log('\nWrote ' + OUT)
console.log('\nRank by Wilson95% (conservative). Use Finished>=5 before trusting a domain.')
