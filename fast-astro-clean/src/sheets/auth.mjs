import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

export function loadServiceAccount(credentialsPath, rootDir = process.cwd()) {
  const resolved = path.isAbsolute(credentialsPath)
    ? credentialsPath
    : path.resolve(rootDir, credentialsPath)

  let raw
  try {
    raw = fs.readFileSync(resolved, 'utf8')
  } catch (error) {
    throw new Error(`Cannot read Google service account credentials at ${resolved}: ${error.message}`)
  }

  let account
  try {
    account = JSON.parse(raw)
  } catch {
    throw new Error(`Google service account credentials at ${resolved} are not valid JSON.`)
  }

  if (!account.client_email || !account.private_key) {
    throw new Error('Service account JSON must include client_email and private_key.')
  }

  return account
}

export function signJwt(account, { now = Math.floor(Date.now() / 1000), lifetime = 3600 } = {}) {
  const header = { alg: 'RS256', typ: 'JWT' }
  if (account.private_key_id) header.kid = account.private_key_id

  const claims = {
    iss: account.client_email,
    scope: SHEETS_SCOPE,
    aud: account.token_uri || TOKEN_URL,
    iat: now,
    exp: now + lifetime,
  }

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(account.private_key)
  return `${unsigned}.${signature.toString('base64url')}`
}

export class GoogleTokenProvider {
  constructor(account, { fetchImpl } = {}) {
    this.account = account
    this.fetchImpl = fetchImpl
    this.token = ''
    this.expiresAt = 0
  }

  async accessToken() {
    const now = Math.floor(Date.now() / 1000)
    if (this.token && this.expiresAt - 60 > now) return this.token

    const fetchFn = this.fetchImpl || globalThis.fetch
    const assertion = signJwt(this.account, { now })
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    })

    const response = await fetchFn(this.account.token_uri || TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    const text = await response.text()
    let payload = {}
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      payload = {}
    }

    if (!response.ok || !payload.access_token) {
      const detail = payload.error_description || payload.error || text || `HTTP ${response.status}`
      throw new Error(`Google token request failed: ${detail}`)
    }

    this.token = payload.access_token
    this.expiresAt = now + Number(payload.expires_in || 3600)
    return this.token
  }
}
