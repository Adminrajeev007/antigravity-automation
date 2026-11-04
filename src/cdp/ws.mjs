import net from 'node:net'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export class WebSocketError extends Error {
  constructor(message) {
    super(message)
    this.name = 'WebSocketError'
  }
}

export class WebSocketClient extends EventEmitter {
  constructor(url, { timeoutMs = 10000 } = {}) {
    super()
    this.url = new URL(url)
    if (this.url.protocol !== 'ws:') {
      throw new WebSocketError(`Unsupported WebSocket protocol: ${this.url.protocol}`)
    }
    this.timeoutMs = timeoutMs
    this.socket = null
    this.buffer = Buffer.alloc(0)
    this.fragments = null
    this.open = false
    this.closed = false
    this._connect()
  }

  _connect() {
    const key = crypto.randomBytes(16).toString('base64')
    const host = this.url.hostname
    const port = Number(this.url.port || 80)
    const requestPath = `${this.url.pathname}${this.url.search}`
    const socket = net.connect({ host, port })
    this.socket = socket

    let handshakeDone = false
    let headerBuffer = Buffer.alloc(0)

    const timer = setTimeout(() => {
      socket.destroy()
      this._fail(new WebSocketError('WebSocket connection timed out.'))
    }, this.timeoutMs)

    socket.once('connect', () => {
      socket.write([
        `GET ${requestPath} HTTP/1.1`,
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'))
    })

    socket.on('data', (chunk) => {
      if (!handshakeDone) {
        headerBuffer = Buffer.concat([headerBuffer, chunk])
        const headerEnd = headerBuffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) {
          if (headerBuffer.length > 64 * 1024) {
            socket.destroy()
            this._fail(new WebSocketError('WebSocket handshake response is too large.'))
          }
          return
        }

        const header = headerBuffer.slice(0, headerEnd).toString('latin1')
        const rest = headerBuffer.slice(headerEnd + 4)
        const statusLine = header.split('\r\n')[0]
        const status = Number(statusLine.split(' ')[1])
        if (status !== 101) {
          socket.destroy()
          this._fail(new WebSocketError(`WebSocket handshake failed: ${statusLine}`))
          return
        }

        const expected = crypto.createHash('sha1').update(key + WS_GUID).digest('base64')
        const acceptLine = header.split('\r\n').find((line) => /^sec-websocket-accept:/i.test(line))
        const accept = acceptLine?.split(':')[1]?.trim()
        if (accept !== expected) {
          socket.destroy()
          this._fail(new WebSocketError('WebSocket handshake returned an invalid accept key.'))
          return
        }

        handshakeDone = true
        clearTimeout(timer)
        this.open = true
        this.emit('open')
        if (rest.length > 0) this._receive(rest)
        return
      }

      this._receive(chunk)
    })

    socket.on('error', (error) => {
      clearTimeout(timer)
      this._fail(new WebSocketError(error.message))
    })

    socket.on('close', () => {
      clearTimeout(timer)
      if (!this.closed) {
        this.closed = true
        this.open = false
        this.emit('close')
      }
    })
  }

  _receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const frame = this._parseFrame()
      if (!frame) return
      this._handleFrame(frame)
    }
  }

  _parseFrame() {
    const buffer = this.buffer
    if (buffer.length < 2) return null

    const first = buffer[0]
    const second = buffer[1]
    const fin = (first & 0x80) !== 0
    const opcode = first & 0x0f
    const masked = (second & 0x80) !== 0
    let length = second & 0x7f
    let offset = 2

    if (length === 126) {
      if (buffer.length < 4) return null
      length = buffer.readUInt16BE(2)
      offset = 4
    } else if (length === 127) {
      if (buffer.length < 10) return null
      const bigLength = buffer.readBigUInt64BE(2)
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new WebSocketError('WebSocket frame is too large.')
      }
      length = Number(bigLength)
      offset = 10
    }

    let mask = null
    if (masked) {
      if (buffer.length < offset + 4) return null
      mask = buffer.slice(offset, offset + 4)
      offset += 4
    }
    if (buffer.length < offset + length) return null

    let payload = buffer.slice(offset, offset + length)
    if (masked) {
      payload = Buffer.from(payload)
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4]
      }
    }

    this.buffer = buffer.slice(offset + length)
    return { fin, opcode, payload }
  }

  _handleFrame(frame) {
    if (frame.opcode === 0x8) {
      this.close()
      return
    }
    if (frame.opcode === 0x9) {
      try {
        this._sendFrame(0xa, frame.payload)
      } catch {}
      return
    }
    if (frame.opcode === 0xa) return
    if (frame.opcode !== 0x1 && frame.opcode !== 0x0) return

    if (!this.fragments) this.fragments = []
    this.fragments.push(frame.payload)
    if (!frame.fin) return

    const payload = Buffer.concat(this.fragments)
    this.fragments = null
    this.emit('message', payload.toString('utf8'))
  }

  _sendFrame(opcode, payload) {
    if (!this.open || !this.socket || this.socket.destroyed) {
      throw new WebSocketError('WebSocket is not open.')
    }

    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8')
    const mask = crypto.randomBytes(4)
    let header

    if (data.length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | data.length])
    } else if (data.length < 65536) {
      header = Buffer.alloc(4)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 126
      header.writeUInt16BE(data.length, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(data.length), 2)
    }

    const masked = Buffer.alloc(data.length)
    for (let index = 0; index < data.length; index += 1) {
      masked[index] = data[index] ^ mask[index % 4]
    }

    this.socket.write(Buffer.concat([header, mask, masked]))
  }

  send(text) {
    this._sendFrame(0x1, text)
  }

  close() {
    if (this.closed) return
    const wasOpen = this.open
    try {
      if (wasOpen) this._sendFrame(0x8, Buffer.alloc(0))
    } catch {}
    this.closed = true
    this.open = false
    this.socket?.end()
    this.emit('close')
  }

  _fail(error) {
    if (this.closed) return
    this.closed = true
    this.open = false
    if (this.listenerCount('error') > 0) this.emit('error', error)
    this.emit('close')
  }
}
