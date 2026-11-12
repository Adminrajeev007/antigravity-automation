import { CdpClient, CdpError } from './client.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function listTargets(debugPort, { timeoutMs = 10000 } = {}) {
  let response
  try {
    response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new CdpError(`Could not reach the browser debug port ${debugPort}: ${error.message}`, { status: 502 })
  }
  if (!response.ok) {
    throw new CdpError(`Browser debug port ${debugPort} returned HTTP ${response.status}.`, { status: 502 })
  }
  return response.json()
}

export function pickPageTarget(targets, { urlFilter } = {}) {
  const pages = (targets || []).filter((target) => target.type === 'page')
  if (urlFilter) {
    const filtered = pages.find((target) => urlFilter(target.url || ''))
    if (filtered) return filtered
  }
  return pages.find((target) => target.url && !target.url.startsWith('chrome://'))
    || pages[0]
    || null
}

export async function connectToProfile({ debugPort, urlFilter, timeoutMs = 15000 } = {}) {
  const targets = await listTargets(debugPort)
  const target = pickPageTarget(targets, { urlFilter })
  if (!target?.webSocketDebuggerUrl) {
    throw new CdpError('No debuggable page target was found in the profile.', { status: 404 })
  }

  const client = await new CdpClient(target.webSocketDebuggerUrl, { timeoutMs }).ready
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  return { client, target, targets }
}

export async function evaluate(client, expression, { awaitPromise = true, timeoutMs = 30000 } = {}) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
    userGesture: true,
  }, { timeoutMs })

  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'JavaScript evaluation failed.'
    throw new CdpError(detail)
  }
  return result.result?.value
}

export async function pageInfo(client) {
  return evaluate(client, `(() => ({
    url: location.href,
    title: document.title,
    text: document.body && document.body.innerText ? document.body.innerText.slice(0, 3000) : ''
  }))()`)
}

export async function navigate(client, url, { waitMs = 30000, settleMs = 2500 } = {}) {
  const loaded = client.once('Page.loadEventFired', { timeoutMs: waitMs }).catch(() => null)
  const result = await client.send('Page.navigate', { url }, { timeoutMs: waitMs })
  if (result.errorText) {
    throw new CdpError(`Navigation to ${url} failed: ${result.errorText}`)
  }
  await loaded
  await sleep(settleMs)
  return result
}

export async function clickText(client, patterns, { selector } = {}) {
  const terms = (Array.isArray(patterns) ? patterns : [patterns])
    .map((value) => String(value).toLowerCase())
  const query = selector || 'a, button, [role="button"], [role="link"], input[type="button"], input[type="submit"]'

  const expression = `(() => {
    const terms = ${JSON.stringify(terms)};
    const elements = [];
    const collect = (root) => {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll(${JSON.stringify(query)}).forEach((element) => elements.push(element));
      root.querySelectorAll('*').forEach((element) => {
        if (element.shadowRoot) collect(element.shadowRoot);
      });
    };
    collect(document);

    const items = [];
    for (const element of elements) {
      const raw = (element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('title') || '')
        .replace(/\\s+/g, ' ')
        .trim();
      if (!raw) continue;
      const lower = raw.toLowerCase();
      let rank = -1;
      for (let index = 0; index < terms.length; index += 1) {
        if (lower === terms[index]) { rank = index; break; }
        if (lower.includes(terms[index]) && (rank === -1 || 100 + index < rank)) rank = 100 + index;
      }
      if (rank === -1) continue;

      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width < 2 || rect.height < 2) continue;
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;

      items.push({ element, raw, rank, top: rect.top, area: rect.width * rect.height });
    }

    items.sort((a, b) => a.rank - b.rank || a.top - b.top || b.area - a.area);
    const chosen = items[0];
    if (!chosen) {
      return {
        ok: false,
        url: location.href,
        title: document.title,
        text: document.body && document.body.innerText ? document.body.innerText.slice(0, 2500) : '',
        matches: []
      };
    }

    chosen.element.scrollIntoView({ block: 'center', inline: 'center' });
    chosen.element.click();
    return {
      ok: true,
      text: chosen.raw,
      href: chosen.element.href || null,
      tag: chosen.element.tagName,
      url: location.href,
      title: document.title,
      matches: items.slice(0, 8).map((item) => item.raw)
    };
  })()`

  return evaluate(client, expression)
}

export async function waitForNewTarget(debugPort, { knownIds = [], timeoutMs = 15000 } = {}) {
  const known = new Set(knownIds)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const targets = await listTargets(debugPort).catch(() => [])
    const next = targets.find((target) => target.type === 'page' && !known.has(target.id))
    if (next) return next
    await sleep(500)
  }
  return null
}
