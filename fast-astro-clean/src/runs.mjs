const MAX_RUNS = 200

export class RunLog {
  constructor(max = MAX_RUNS) {
    this.max = max
    this.items = []
  }

  record({ action, status, detail = '', durationMs = 0 }) {
    const item = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      action,
      status,
      detail,
      durationMs,
      at: new Date().toISOString(),
    }
    this.items.unshift(item)
    if (this.items.length > this.max) this.items.length = this.max
    return item
  }

  list(limit = 20) {
    const count = Math.max(1, Math.min(this.max, Number(limit) || 20))
    return this.items.slice(0, count)
  }
}
