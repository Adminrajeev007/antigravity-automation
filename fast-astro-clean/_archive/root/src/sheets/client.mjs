export const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

export class SheetsError extends Error {
  constructor(message, { status = 502, detail = '' } = {}) {
    super(message)
    this.name = 'SheetsError'
    this.status = status
    this.detail = detail
  }
}

export function quoteSheetName(name) {
  const value = String(name || '').trim()
  if (!value) throw new SheetsError('A sheet name is required.', { status: 400 })
  return `'${value.replace(/'/g, "''")}'`
}

export class SheetsClient {
  constructor({ spreadsheetId, tokens, fetchImpl } = {}) {
    this.spreadsheetId = spreadsheetId
    this.tokens = tokens
    this.fetchImpl = fetchImpl
    this.sheetIds = new Map()
  }

  async request(pathname, { method = 'GET', body, query } = {}) {
    if (!this.spreadsheetId) {
      throw new SheetsError('No spreadsheet id is configured.', { status: 503 })
    }

    const token = await this.tokens.accessToken()
    const url = new URL(`${SHEETS_BASE}/${encodeURIComponent(this.spreadsheetId)}${pathname}`)
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }

    const fetchFn = this.fetchImpl || globalThis.fetch
    const response = await fetchFn(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const text = await response.text()
    let payload = {}
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      payload = {}
    }

    if (!response.ok) {
      const detail = payload?.error?.message || text || `HTTP ${response.status}`
      const status = response.status === 404 ? 404 : response.status === 403 ? 403 : 502
      throw new SheetsError(`Google Sheets request failed: ${detail}`, { status, detail })
    }

    return payload
  }

  getValues(range, query = {}) {
    return this.request(`/values/${encodeURIComponent(range)}`, { query })
  }

  appendValues(range, values, query = {}) {
    return this.request(`/values/${encodeURIComponent(range)}:append`, {
      method: 'POST',
      query: { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', ...query },
      body: { values },
    })
  }

  updateValues(range, values, query = {}) {
    return this.request(`/values/${encodeURIComponent(range)}`, {
      method: 'PUT',
      query: { valueInputOption: 'USER_ENTERED', ...query },
      body: { values },
    })
  }

  clearValues(range) {
    return this.request(`/values/${encodeURIComponent(range)}:clear`, { method: 'POST', body: {} })
  }

  async getSheetId(sheetName) {
    if (this.sheetIds.has(sheetName)) return this.sheetIds.get(sheetName)

    const payload = await this.request('', { query: { fields: 'sheets.properties' } })
    this.sheetIds.clear()
    for (const entry of payload.sheets || []) {
      const properties = entry.properties || {}
      this.sheetIds.set(properties.title, properties.sheetId)
    }

    if (!this.sheetIds.has(sheetName)) {
      throw new SheetsError(
        `Sheet "${sheetName}" was not found in spreadsheet ${this.spreadsheetId}.`,
        { status: 404 },
      )
    }

    return this.sheetIds.get(sheetName)
  }

  async addSheet(title) {
    await this.request(':batchUpdate', {
      method: 'POST',
      body: { requests: [{ addSheet: { properties: { title } } }] },
    })
    this.sheetIds.delete(title)
  }

  async deleteRow(sheetName, rowNumber) {
    const sheetId = await this.getSheetId(sheetName)
    const startIndex = rowNumber - 1
    return this.request(':batchUpdate', {
      method: 'POST',
      body: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex,
              endIndex: startIndex + 1,
            },
          },
        }],
      },
    })
  }
}
