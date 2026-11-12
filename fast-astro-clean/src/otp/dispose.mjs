export const DISPOSE_GOOGLE_CODE_URL = process.env.DISPOSE_API_BASE || 'https://dispose.lol/api/google-code'
export const DEFAULT_DISPOSE_KEY = process.env.DISPOSE_API_KEY || 'gclvcodekeyq82nfhs7dkap01mzx'

export class DisposeError extends Error {
  constructor(message, { status = 502, body = null } = {}) {
    super(message)
    this.name = 'DisposeError'
    this.status = status
    this.body = body
  }
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export async function fetchGoogleCode(email, { key = DEFAULT_DISPOSE_KEY, timeoutMs = 15000 } = {}) {
  const address = String(email ?? '').trim()
  if (!address || !validEmail(address)) {
    throw new DisposeError('A valid email address is required.', { status: 400 })
  }

  const url = new URL(DISPOSE_GOOGLE_CODE_URL)
  url.searchParams.set('key', String(key || DEFAULT_DISPOSE_KEY).trim())
  url.searchParams.set('to', address)

  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'antiG/0.1' },
    })
  } catch (error) {
    throw new DisposeError(`dispose.lol request failed: ${error.message}`, { status: 502 })
  }

  const rawText = await response.text()
  let data = null
  try {
    data = rawText ? JSON.parse(rawText) : null
  } catch {
    data = { raw: rawText }
  }

  if (!response.ok) {
    const detail = data?.error || data?.message || data?.raw || `HTTP ${response.status}`
    throw new DisposeError(`dispose.lol returned ${detail}`, {
      status: response.status === 404 ? 404 : 502,
      body: data,
    })
  }

  const code = data?.code ?? data?.otp ?? data?.result ?? null
  return {
    ok: true,
    email: address,
    found: Boolean(code),
    code,
    timestamp: data?.timestamp ?? data?.time ?? null,
    raw: data,
  }
}
