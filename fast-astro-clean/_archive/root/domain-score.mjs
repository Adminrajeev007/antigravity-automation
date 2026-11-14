#!/usr/bin/env node
/**
 * Domain score from the orchestrator log.
 *
 * Tried  = every email in "batch emails:" lines (all generated attempts)
 * Saved  = that email's session ended with "qr-saved" (saved to the Sheet)
 * Score  = Saved / Tried * 100
 *
 * Persists state in domain-score-state.json so restarting the orchestrator
 * (which truncates /tmp/orch.log) does not lose earlier attempts.
 *
 * Usage:
 *   node domain-score.mjs              # only domains with Tried >= 5
 *   node domain-score.mjs --all        # all domains
 *   MIN_TRIED=10 node domain-score.mjs # custom threshold
 */
import fs from 'node:fs'
import path from 'node:path'

const LOG = process.env.ORCH_LOG || '/tmp/orch.log'
const STATE = path.join(process.cwd(), 'domain-score-state.json')
const CSV = path.join(process.cwd(), 'domain-score.csv')
const MIN_TRIED = process.argv.includes('--all')
  ? 0
  : Number(process.env.MIN_TRIED || 5)

let state = { offset: 0, seq: 0, attempts: {} }
try {
  const loaded = JSON.parse(fs.readFileSync(STATE, 'utf8'))
  if (loaded && typeof loaded === 'object') state = { ...state, ...loaded }
} catch (e) {}

function domainOf(email) {
  const e = String(email || '').trim().toLowerCase()
  const i = e.lastIndexOf('@')
  return i > 0 ? e.slice(i + 1) : '(none)'
}

function addAttempt(email) {
  const value = String(email || '').trim()
  if (!value || !value.includes('@')) return
  state.seq += 1
  const id = 'a' + state.seq
  state.attempts[id] = {
    email: value,
    domain: domainOf(value),
    saved: false,
    error: false,
    timeout: false,
    other: false,
    at: new Date().toISOString()
  }
}

function latest(email) {
  const target = String(email || '').trim().toLowerCase()
  if (!target) return null
  let best = null
  let bestSeq = -1
  for (const [id, a] of Object.entries(state.attempts)) {
    if (String(a.email).toLowerCase() !== target) continue
    const n = Number(id.slice(1)) || 0
    if (n > bestSeq) { bestSeq = n; best = a }
  }
  return best
}

function mark(email, field) {
  const a = latest(email)
  if (a) a[field] = true
  return a
}

function processLine(line) {
  const batch = line.match(/batch emails:\s*(.+)$/i)
  if (batch) {
    for (const email of batch[1].split(/,\s*/)) addAttempt(email)
    return
  }
  const signupErr = line.match(/signup error page detected for ([^\s,]+)/i)
  if (signupErr) {
    mark(signupErr[1], 'error')
    return
  }
  const ended = line.match(/session ended \(([^)]+)\) for (\S+)/i)
  if (ended) {
    const reason = ended[1].toLowerCase()
    const email = ended[2]
    if (reason === 'qr-saved') mark(email, 'saved')
    else if (reason === 'signup-error') mark(email, 'error')
    else if (reason === 'timeout') mark(email, 'timeout')
    else if (reason === 'extension-failed') mark(email, 'other')
    return
  }
}

function readNew() {
  let stat
  try { stat = fs.statSync(LOG) } catch (e) { return }
  if (stat.size < state.offset) state.offset = 0
  if (stat.size === state.offset) return
  let buf
  try { buf = fs.readFileSync(LOG) } catch (e) { return }
  const chunk = buf.slice(state.offset).toString('utf8')
  state.offset = buf.length
  for (const line of chunk.split('\n')) {
    if (line.trim()) processLine(line)
  }
}

function save() {
  fs.writeFileSync(STATE, JSON.stringify(state))
}

function report() {
  const map = new Map()
  for (const a of Object.values(state.attempts)) {
    const d = a.domain || '(none)'
    if (!map.has(d)) map.set(d, { domain: d, tried: 0, saved: 0, error: 0, timeout: 0, other: 0 })
    const r = map.get(d)
    r.tried += 1
    if (a.saved) r.saved += 1
    else if (a.error) r.error += 1
    else if (a.timeout) r.timeout += 1
    else r.other += 1
  }
  const rows = [...map.values()]
    .filter((r) => r.tried >= MIN_TRIED)
    .map((r) => ({ ...r, score: r.tried ? (r.saved / r.tried) * 100 : 0 }))
    .sort((a, b) => b.score - a.score || b.tried - a.tried || a.domain.localeCompare(b.domain))

  if (!rows.length) {
    console.log(`No domains with Tried >= ${MIN_TRIED} yet. Use --all to show everything.`)
    return
  }
  const header = ['Domain', 'Tried', 'Saved', 'SignupErr', 'Timeout', 'Other', 'Score%']
  const lines = [header.join('\t')]
  for (const r of rows) {
    lines.push([r.domain, r.tried, r.saved, r.error, r.timeout, r.other, r.score.toFixed(1)].join('\t'))
  }
  console.log(lines.join('\n'))
  fs.writeFileSync(CSV, lines.join('\n') + '\n')
  console.log(`\nWrote ${CSV} (threshold Tried >= ${MIN_TRIED})`)
}

readNew()
save()
report()
