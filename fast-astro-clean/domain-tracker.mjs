#!/usr/bin/env node
/**
 * Local domain scorer for the orchestrator.
 *
 * Tails /tmp/orch.log (or ORCH_LOG), records every started profile and its
 * final reason, and writes:
 *   domain-stats.json       (raw attempts)
 *   domain-attempts.csv     (flat history)
 *   domain-scores.csv       (aggregated scores)
 *
 * Usage:
 *   node domain-tracker.mjs            # run continuously
 *   node domain-tracker.mjs --report   # print scores and exit
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const LOG = process.env.ORCH_LOG || '/tmp/orch.log'
const STATS = path.join(ROOT, 'domain-stats.json')
const ATTEMPTS_CSV = path.join(ROOT, 'domain-attempts.csv')
const SCORES_CSV = path.join(ROOT, 'domain-scores.csv')

const RE_START = /started .*?uuid=([0-9a-f]{32}).*?email=(\S+)/
const RE_END = /session ended \(([^)]+)\) for (\S+)/
const RE_TIMEOUT = /session timeout .* for (\S+)/

const attempts = new Map() // key -> { email, domain, startedAt, outcome, reason, endedAt }
let offset = 0

function domainOf(email) {
  const e = String(email || '').trim().toLowerCase()
  const i = e.lastIndexOf('@')
  return i > 0 ? e.slice(i + 1) : ''
}

function outcomeOf(reason) {
  const r = String(reason || '').toLowerCase()
  if (r === 'qr-saved') return 'billing'
  if (r === 'signup-error') return 'signup-error'
  if (r === 'timeout') return 'timeout'
  if (r === 'extension-failed') return 'failed'
  return 'other'
}

function keyFor(uuid, email) {
  return uuid ? `u:${uuid}` : `e:${email.toLowerCase()}:${Date.now()}`
}

function recordStart(uuid, email) {
  if (!uuid || !email) return
  const key = keyFor(uuid, email)
  const existing = attempts.get(key)
  if (existing) return
  attempts.set(key, {
    email,
    domain: domainOf(email),
    startedAt: new Date().toISOString(),
    outcome: '',
    reason: '',
    endedAt: '',
  })
}

function recordEnd(email, reason) {
  const target = String(email || '').trim().toLowerCase()
  if (!target) return
  let found = null
  for (const item of attempts.values()) {
    if (item.email.toLowerCase() !== target) continue
    if (item.outcome) continue
    if (!found || String(item.startedAt) > String(found.startedAt)) found = item
  }
  if (!found) {
    const key = keyFor('', email)
    found = {
      email,
      domain: domainOf(email),
      startedAt: '',
      outcome: '',
      reason: '',
      endedAt: '',
    }
    attempts.set(key, found)
  }
  found.outcome = outcomeOf(reason)
  found.reason = String(reason || '')
  found.endedAt = new Date().toISOString()
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(STATS, 'utf8'))
    for (const [k, v] of Object.entries(data.attempts || {})) {
      attempts.set(k, v)
    }
  } catch (e) {}
}

function save() {
  const obj = { updatedAt: new Date().toISOString(), attempts: Object.fromEntries(attempts) }
  fs.writeFileSync(STATS, JSON.stringify(obj, null, 2))

  const rows = [['startedAt', 'email', 'domain', 'outcome', 'reason', 'endedAt']]
  for (const a of attempts.values()) {
    rows.push([a.startedAt, a.email, a.domain, a.outcome, a.reason, a.endedAt])
  }
  fs.writeFileSync(ATTEMPTS_CSV, rows.map((r) => r.map(csv).join(',')).join('\n') + '\n')
}

function csv(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function scoreRows() {
  const map = new Map()
  for (const a of attempts.values()) {
    const d = a.domain || '(none)'
    if (!map.has(d)) {
      map.set(d, { domain: d, tried: 0, billing: 0, signupError: 0, timeout: 0, other: 0 })
    }
    const row = map.get(d)
    row.tried += 1
    if (a.outcome === 'billing') row.billing += 1
    else if (a.outcome === 'signup-error') row.signupError += 1
    else if (a.outcome === 'timeout') row.timeout += 1
    else row.other += 1
  }
  const rows = [...map.values()].map((r) => {
    const score = ((r.billing + 1) / (r.tried + 5)) * 100
    return {
      ...r,
      billingPct: r.tried ? (r.billing / r.tried) * 100 : 0,
      errorPct: r.tried ? (r.signupError / r.tried) * 100 : 0,
      score,
    }
  })
  rows.sort((a, b) => b.score - a.score || b.tried - a.tried)
  return rows
}

function report() {
  const rows = scoreRows()
  if (!rows.length) {
    console.log('No attempts recorded yet. Is /tmp/orch.log present and is the orchestrator running?')
    return
  }
  const header = ['Domain', 'Tried', 'Billing', 'SignupErr', 'Timeout', 'Other', 'Bill%', 'Err%', 'Score']
  const lines = [header.join('\t')]
  for (const r of rows) {
    lines.push([
      r.domain, r.tried, r.billing, r.signupError, r.timeout, r.other,
      r.billingPct.toFixed(1), r.errorPct.toFixed(1), r.score.toFixed(1),
    ].join('\t'))
  }
  console.log(lines.join('\n'))
  fs.writeFileSync(SCORES_CSV, lines.join('\n') + '\n')
  console.log('\nWrote ' + SCORES_CSV)
}

function processChunk(text) {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const s = line.match(RE_START)
    if (s) {
      recordStart(s[1], s[2])
      continue
    }
    const e = line.match(RE_END)
    if (e) {
      recordEnd(e[2], e[1])
      continue
    }
    const t = line.match(RE_TIMEOUT)
    if (t) {
      // the following "session ended (timeout)" line sets the outcome
      continue
    }
  }
}

function readNew() {
  let stat
  try {
    stat = fs.statSync(LOG)
  } catch (e) {
    return
  }
  if (stat.size === offset) return
  if (stat.size < offset) offset = 0
  let buf
  try {
    buf = fs.readFileSync(LOG)
  } catch (e) {
    return
  }
  if (buf.length <= offset) return
  const chunk = buf.slice(offset).toString('utf8')
  offset = buf.length
  processChunk(chunk)
  save()
}

load()
readNew()

if (process.argv.includes('--report')) {
  save()
  report()
  process.exit(0)
}

// First pass reads the whole existing log, then tail incrementally.
readNew()
setInterval(readNew, 2000)
setInterval(save, 10000)
setInterval(report, 60000)
