#!/usr/bin/env node
/**
 * Domain report from domain-stats.json (written by domain-tracker.mjs).
 *
 * Per domain:
 *   Tried       = started attempts
 *   Running     = attempts with no outcome yet (excluded from rates)
 *   SignupErr   = outcome signup-error
 *   Failed      = finished attempts that did not reach billing
 *   Error %     = signup-error / finished
 *   Success %   = (finished - failed) / finished  =  billing / finished
 *   Score       = Success %
 */
import fs from 'node:fs'
import path from 'node:path'

const STATS = path.join(process.cwd(), 'domain-stats.json')
const OUT = path.join(process.cwd(), 'domain-report.csv')

let data
try {
  data = JSON.parse(fs.readFileSync(STATS, 'utf8'))
} catch (e) {
  console.error('No domain-stats.json. Start domain-tracker.mjs first.')
  process.exit(1)
}

const attempts = Object.values(data.attempts || {})
const map = new Map()

for (const a of attempts) {
  const domain = a.domain || '(none)'
  if (!map.has(domain)) {
    map.set(domain, {
      domain,
      tried: 0,
      running: 0,
      billing: 0,
      signupError: 0,
      timeout: 0,
      other: 0
    })
  }
  const r = map.get(domain)
  r.tried += 1
  const outcome = String(a.outcome || '')
  if (!outcome) r.running += 1
  else if (outcome === 'billing') r.billing += 1
  else if (outcome === 'signup-error') r.signupError += 1
  else if (outcome === 'timeout') r.timeout += 1
  else r.other += 1
}

const rows = [...map.values()].map((r) => {
  const finished = r.tried - r.running
  const failed = finished - r.billing
  return {
    ...r,
    finished,
    failed,
    errorPct: finished ? (r.signupError / finished) * 100 : 0,
    successPct: finished ? (r.billing / finished) * 100 : 0
  }
})

rows.sort((a, b) => b.successPct - a.successPct || b.finished - a.finished || a.domain.localeCompare(b.domain))

const header = ['Domain', 'Tried', 'Running', 'SignupErr', 'Failed', 'Error%', 'Success%']
const lines = [header.join('\t')]
for (const r of rows) {
  lines.push([
    r.domain,
    r.tried,
    r.running,
    r.signupError,
    r.failed,
    r.errorPct.toFixed(1),
    r.successPct.toFixed(1)
  ].join('\t'))
}

console.log(lines.join('\n'))
fs.writeFileSync(OUT, lines.join('\n') + '\n')
console.log('\nWrote ' + OUT)
