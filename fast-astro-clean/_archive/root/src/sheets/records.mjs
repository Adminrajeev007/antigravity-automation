import { ROOT_DIR } from '../octo/config.mjs'
import { GoogleTokenProvider, loadServiceAccount } from './auth.mjs'
import { SheetsClient, quoteSheetName } from './client.mjs'

export const RECORD_FIELDS = [
  { key: 'id', header: 'ID' },
  { key: 'email', header: 'Email' },
  { key: 'token', header: 'Token' },
  { key: 'status', header: 'Status' },
  { key: 'profileId', header: 'Profile ID' },
  { key: 'notes', header: 'Notes' },
  { key: 'createdAt', header: 'Created At' },
  { key: 'updatedAt', header: 'Updated At' },
]

const HEADER_KEYS = new Map(RECORD_FIELDS.map((field) => [field.header.toLowerCase(), field.key]))
const LAST_COLUMN = columnLetter(RECORD_FIELDS.length)

export class RecordsError extends Error {
  constructor(message, { status = 500 } = {}) {
    super(message)
    this.name = 'RecordsError'
    this.status = status
  }
}

export function columnLetter(index) {
  let value = Number(index)
  let letters = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    letters = String.fromCharCode(65 + remainder) + letters
    value = Math.floor((value - 1) / 26)
  }
  return letters
}

function makeId() {
  return `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function cell(value) {
  return value === undefined || value === null ? '' : String(value)
}

function rowValues(record) {
  return RECORD_FIELDS.map((field) => cell(record[field.key]))
}

function headerKeys(header) {
  const mapped = header.map((name) => HEADER_KEYS.get(String(name).trim().toLowerCase()))
  if (mapped.some(Boolean)) return mapped
  return RECORD_FIELDS.map((field) => field.key)
}

function toRecord(keys, row) {
  const record = {}
  keys.forEach((key, index) => {
    if (key) record[key] = cell(row[index])
  })
  for (const field of RECORD_FIELDS) {
    if (record[field.key] === undefined) record[field.key] = ''
  }
  return record
}

export class RecordsService {
  constructor(config = {}, { fetchImpl } = {}) {
    this.config = config || {}
    this.fetchImpl = fetchImpl
    this.client = null
  }

  isConfigured() {
    return Boolean(this.config.spreadsheetId && this.config.credentialsPath)
  }

  sheetName() {
    return this.config.sheetName || 'Records'
  }

  assertConfigured() {
    if (!this.config.spreadsheetId) {
      throw new RecordsError(
        'Google Sheets is not configured: set sheets.spreadsheetId (ANTIG_SHEET_ID).',
        { status: 503 },
      )
    }
    if (!this.config.credentialsPath) {
      throw new RecordsError(
        'Google Sheets is not configured: set sheets.credentialsPath (GOOGLE_APPLICATION_CREDENTIALS).',
        { status: 503 },
      )
    }
  }

  getClient() {
    this.assertConfigured()
    if (!this.client) {
      const account = loadServiceAccount(this.config.credentialsPath, ROOT_DIR)
      const tokens = new GoogleTokenProvider(account, { fetchImpl: this.fetchImpl })
      this.client = new SheetsClient({
        spreadsheetId: this.config.spreadsheetId,
        tokens,
        fetchImpl: this.fetchImpl,
      })
    }
    return this.client
  }

  status() {
    return {
      ok: true,
      configured: this.isConfigured(),
      spreadsheetId: this.config.spreadsheetId || '',
      sheetName: this.sheetName(),
      credentialsPath: this.config.credentialsPath || '',
      fields: RECORD_FIELDS.map((field) => field.key),
    }
  }

  async ensureSheet(client) {
    const name = this.sheetName()
    try {
      await client.getSheetId(name)
    } catch (error) {
      if (error?.status !== 404) throw error
      await client.addSheet(name)
    }
  }

  async readRows() {
    const client = this.getClient()
    const name = this.sheetName()
    await this.ensureSheet(client)

    const range = quoteSheetName(name)
    const payload = await client.getValues(range, { majorDimension: 'ROWS' })
    const rows = payload.values || []

    if (rows.length === 0) {
      const header = RECORD_FIELDS.map((field) => field.header)
      await client.updateValues(`${quoteSheetName(name)}!A1:${LAST_COLUMN}1`, [header])
      return { header, records: [] }
    }

    const header = rows[0].map(cell)
    const keys = headerKeys(header)
    const records = rows
      .slice(1)
      .map((row) => toRecord(keys, row))
      .filter((record) => record.id || record.email)

    return { header, records }
  }

  async list({ limit, status } = {}) {
    const { records } = await this.readRows()
    let items = records

    if (status) {
      const wanted = String(status).toLowerCase()
      items = items.filter((record) => record.status.toLowerCase() === wanted)
    }

    const count = Number(limit)
    if (Number.isFinite(count) && count > 0) items = items.slice(0, count)

    return {
      ok: true,
      sheet: this.sheetName(),
      total: records.length,
      count: items.length,
      records: items,
    }
  }

  async get(id) {
    if (!id) throw new RecordsError('A record id is required.', { status: 400 })
    const { records } = await this.readRows()
    const record = records.find((item) => item.id === String(id))
    if (!record) throw new RecordsError(`Record ${id} was not found.`, { status: 404 })
    return { ok: true, record }
  }

  async create(input = {}) {
    const email = cell(input.email).trim()
    if (!email) throw new RecordsError('Record email is required.', { status: 400 })

    const now = new Date().toISOString()
    const record = {
      id: cell(input.id).trim() || makeId(),
      email,
      token: cell(input.token),
      status: cell(input.status).trim() || 'new',
      profileId: cell(input.profileId),
      notes: cell(input.notes),
      createdAt: cell(input.createdAt) || now,
      updatedAt: now,
    }

    const { records } = await this.readRows()
    if (records.some((item) => item.id === record.id)) {
      throw new RecordsError(`Record ${record.id} already exists.`, { status: 409 })
    }

    await this.getClient().appendValues(
      `${quoteSheetName(this.sheetName())}!A:${LAST_COLUMN}`,
      [rowValues(record)],
    )

    return { ok: true, record }
  }

  async update(id, patch = {}) {
    if (!id) throw new RecordsError('A record id is required.', { status: 400 })
    const { records } = await this.readRows()
    const index = records.findIndex((item) => item.id === String(id))
    if (index === -1) throw new RecordsError(`Record ${id} was not found.`, { status: 404 })

    const record = { ...records[index] }
    for (const field of RECORD_FIELDS) {
      if (field.key === 'id' || field.key === 'createdAt') continue
      if (patch[field.key] !== undefined) record[field.key] = cell(patch[field.key])
    }
    record.updatedAt = new Date().toISOString()

    const rowNumber = index + 2
    const range = `${quoteSheetName(this.sheetName())}!A${rowNumber}:${LAST_COLUMN}${rowNumber}`
    await this.getClient().updateValues(range, [rowValues(record)])

    return { ok: true, record }
  }

  async upsert(input = {}) {
    const id = cell(input.id).trim()
    const email = cell(input.email).trim()
    const { records } = await this.readRows()

    const match = records.find((record) => {
      if (id) return record.id === id
      if (!email) return false
      return record.email.toLowerCase() === email.toLowerCase()
    })

    if (match) return { ...(await this.update(match.id, input)), created: false }
    return { ...(await this.create({ ...input, email })), created: true }
  }

  async remove(id) {
    if (!id) throw new RecordsError('A record id is required.', { status: 400 })
    const { records } = await this.readRows()
    const index = records.findIndex((item) => item.id === String(id))
    if (index === -1) throw new RecordsError(`Record ${id} was not found.`, { status: 404 })

    const record = records[index]
    await this.getClient().deleteRow(this.sheetName(), index + 2)

    return { ok: true, record }
  }
}
