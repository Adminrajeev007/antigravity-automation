import { WebSocketClient, WebSocketError } from './ws.mjs'

export class CdpError extends Error {
  constructor(message, { status = 502, code = null } = {}) {
    super(message)
    this.name = 'CdpError'
    this.status = status
    this.code = code
  }
}

export class CdpClient {
  constructor(url, { timeoutMs = 15000 } = {}) {
    this.url = url
    this.nextId = 1
    this.pending = new Map()
    this.events = new Map()
    this.closed = false

    this.ws = new WebSocketClient(url, { timeoutMs })
    this.ready = new Promise((resolve, reject) => {
      this.ws.once('open', () => {
        this.ws.on('message', (text) => this._onMessage(text))
        resolve(this)
      })
      this.ws.once('error', reject)
    })

    this.ws.on('error', (error) => {
      this.closed = true
      for (const request of this.pending.values()) request.reject(error)
      this.pending.clear()
    })

    this.ws.on('close', () => {
      this.closed = true
      for (const request of this.pending.values()) {
        request.reject(new CdpError('CDP connection closed.'))
      }
      this.pending.clear()
    })
  }

  _onMessage(raw) {
    let message = null
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }

    if (message.id !== undefined) {
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      if (message.error) {
        request.reject(new CdpError(`${request.method}: ${message.error.message}`, {
          code: message.error.code,
        }))
      } else {
        request.resolve(message.result)
      }
      return
    }

    if (!message.method) return
    const handlers = this.events.get(message.method)
    if (!handlers) return
    for (const handler of [...handlers]) handler(message.params)
  }

  send(method, params = {}, { timeoutMs = 30000 } = {}) {
    if (this.closed) return Promise.reject(new CdpError('CDP connection is closed.'))

    const id = this.nextId
    this.nextId += 1

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new CdpError(`${method} timed out after ${timeoutMs}ms.`, { status: 504 }))
      }, timeoutMs)

      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })

      try {
        this.ws.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof WebSocketError ? new CdpError(error.message) : error)
      }
    })
  }

  on(method, handler) {
    if (!this.events.has(method)) this.events.set(method, new Set())
    this.events.get(method).add(handler)
    return () => {
      const handlers = this.events.get(method)
      if (handlers) handlers.delete(handler)
    }
  }

  once(method, { timeoutMs = 30000 } = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new CdpError(`${method} event timed out after ${timeoutMs}ms.`, { status: 504 }))
      }, timeoutMs)

      const off = this.on(method, (params) => {
        clearTimeout(timer)
        off()
        resolve(params)
      })
    })
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.ws.close()
  }
}
