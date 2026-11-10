// Background: defaults + signup/signout + OTP fetch + FLEET remote control.
// Fleet = hybrid WS (realtime) + REST (fallback/recovery) to the dashboard.
importScripts("sheet-sync.js"); // additive: QR email -> Google Sheet
importScripts("email-gen.js", "auto-email.js"); // additive: auto next email
importScripts("auto-assign.js"); // additive: assign email when profile opens
importScripts("combo-oauth.js"); // combo: OAuth after billing
// importScripts("combo-oauth-proxy.js"); // approach A: bypass proxy for OAuth hosts only
importScripts("combo-direct-on-signup.js"); // approach B: full direct internet after signup
importScripts("combo-flow.js"); // combo: step state machine + retries

const DEFAULTS = {
  domain: "fussion.studio",
  interns: [],
  currentIndex: 0,
  config: {
    autoRun: true,
    country: "India",
    affirmAge: true
  },
  // Ready-to-use fleet defaults: paired to the dashboard out of the box.
  // (Popup can still override per profile.)
  fleetOn: true,
  fleetUrl: "https://gcpauto.adminrajeev.uk",
  fleetToken: "946c039c3f81944b5cd6b434553c83781fab6384e410c5b221ada5eee83e539a"
};

const SIGNUP_URL = "https://console.cloud.google.com/freetrial";
const LOGOUT_URL = "https://accounts.google.com/Logout";
const EXT_VERSION = "1.4.0";

chrome.runtime.onInstalled.addListener(async (details) => {
  const stored = await chrome.storage.local.get(null);
  const merged = { ...DEFAULTS, ...stored };
  merged.config = { ...DEFAULTS.config, ...(stored.config || {}) };
  await chrome.storage.local.set(merged);
  await seedFleetDefaults();
  detectProfile().catch(() => {});
  // Fresh install + fleet on: open the signup flow immediately so the page
  // heartbeat (every 3s) starts and the dashboard sees this browser in seconds.
  // Updates/reloads must NOT open tabs.
  try {
    const cfg = await chrome.storage.local.get(["fleetOn"]);
    if (details && details.reason === "install" && cfg.fleetOn !== false) {
      chrome.tabs.create({ url: SIGNUP_URL });
    }
  } catch (e) {}
  fleetPoll().catch(() => {});
  fleetEnsureWs().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => { ensureAlarms(); seedFleetDefaults(); detectProfile().catch(() => {}); fleetPoll().catch(() => {}); fleetEnsureWs().catch(() => {}); });
function ensureAlarms() {
  try { chrome.alarms.create("fleet-poll", { periodInMinutes: 1 }); } catch (e) {}
}

// Ready-to-use: fill fleet defaults whenever they're missing (fresh profiles
// AND existing installs that predate the defaults). Never overrides values
// the user explicitly saved — only undefined/empty keys.
async function seedFleetDefaults() {
  try {
    const s = await chrome.storage.local.get(["fleetOn", "fleetUrl", "fleetToken"]);
    const patch = {};
    if (s.fleetOn === undefined) patch.fleetOn = DEFAULTS.fleetOn;
    if (!s.fleetUrl) patch.fleetUrl = DEFAULTS.fleetUrl;
    if (!s.fleetToken) patch.fleetToken = DEFAULTS.fleetToken;
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  } catch (e) {}
}
seedFleetDefaults();

// Re-inject content scripts on full page loads (heals dead tabs after reload).
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  try {
    if (!info || info.status !== "complete" || !tab || !tab.url) return;
    const u = tab.url;
    const hit = u.startsWith("https://accounts.cloud.google.com/") ||
      u.startsWith("https://console.cloud.google.com/") ||
      u.startsWith("https://payments.google.com/") ||
      u.startsWith("https://cloud.google.com/");
    if (!hit) return;
    fleetTick().catch(() => {});   // any tab activity is a free chance to beat
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"]
    });
  } catch (e) {}
});

// Any relevant storage change means the SW is awake — beat + keep the WS
// honest. Ignore our own heartbeat-key writes (else storage→beat→storage loops).
try {
  chrome.storage.onChanged.addListener((changes) => {
    try {
      if (!changes) return;
      const matters = ["interns", "currentIndex", "config", "qrGrabRequest", "qrReady", "paySuccess"];
      if (!matters.some((k) => k in changes)) return;
      wsRetryAt = 0;
      fleetTick().catch(() => {});
    } catch (e) {}
  });
} catch (e) {}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "OPEN_SIGNUP") {
    chrome.tabs.create({ url: SIGNUP_URL });
    sendResponse({ ok: true });
    return true;
  }
  if (msg && msg.type === "SIGN_OUT") {
    chrome.tabs.create({ url: LOGOUT_URL });
    sendResponse({ ok: true });
    return true;
  }
  if (msg && msg.type === "FETCH_OTP") {
    fetchOtp(msg.email)
      .then((data) => sendResponse({ ok: true, code: data.code, timestamp: data.timestamp }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg && msg.type === "FLEET_EVENT") {
    fleetOnEvent(msg).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === "FLEET_BEAT") {
    fleetContentBeat(msg.page || "").then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === "FLEET_TICK") {
    // 2s ticker from the offscreen keepalive (or any page): reconnect + beat.
    if (msg.reconnect) {
      try { wsRetryAt = 0; } catch (e) {}
    }
    ensureOffscreen().catch(() => {});
    fleetTick().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === "FLEET_DETECT_PROFILE") {
    detectProfile().then((p) => sendResponse(p || { ok: false })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === "fleet-poll") {
    ensureOffscreen().catch(() => {});
    fleetPoll().catch(() => {});
  }
});

const OTP_API_BASE = "https://dispose.lol/api/google-code";
const OTP_API_KEY = "gclvcodekeyq82nfhs7dkap01mzx";

async function fetchOtp(email) {
  const store = await chrome.storage.local.get("otpApiKey");
  const key = (store && store.otpApiKey) || OTP_API_KEY;
  const url = `${OTP_API_BASE}?key=${encodeURIComponent(key)}&to=${encodeURIComponent(email)}`;
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

// ==================== FLEET ====================

async function fleetCfg() {
  const s = await chrome.storage.local.get(["fleetUrl", "fleetToken", "fleetDeviceId", "fleetOn"]);
  if (!s.fleetDeviceId) {
    s.fleetDeviceId = "ext-" + Math.random().toString(36).slice(2, 8);
    await chrome.storage.local.set({ fleetDeviceId: s.fleetDeviceId });
  }
  s.fleetUrl = (s.fleetUrl || "").replace(/\/+$/, "");
  return s;
}

function fleetHeaders(token) {
  return { "content-type": "application/json", "x-api-key": token || "" };
}

// ---- WebSocket (realtime) ----
let ws = null;
let wsRetryAt = 0;
let wsPingTimer = null;

async function fleetEnsureWs() {
  const cfg = await fleetCfg();
  if (!cfg.fleetOn || !cfg.fleetUrl || !cfg.fleetToken) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (Date.now() < wsRetryAt) return;
  try {
    const wsUrl = cfg.fleetUrl.replace(/^http/, "ws") + "/ws/fleet?key=" + encodeURIComponent(cfg.fleetToken) + "&deviceId=" + encodeURIComponent(cfg.fleetDeviceId);
    const sock = new WebSocket(wsUrl);
    ws = sock;
    sock.onopen = async () => {
      wsRetryAt = 0;
      startWsPing();
      try { await fleetPush({ type: "heartbeat", body: await fleetSnapshot() }); } catch (e) {}
    };
    sock.onmessage = (ev) => {
      try { fleetOnServerMsg(JSON.parse(ev.data)); } catch (e) {}
    };
    const dead = () => {
      if (ws === sock) ws = null;
      stopWsPing();
      wsRetryAt = Date.now() + 3000;           // fast reconnect (was 20s)
      ensureOffscreen().catch(() => {});       // keep the 2s ticker alive
    };
    sock.onclose = dead;
    sock.onerror = dead;
  } catch (e) {
    ws = null;
    wsRetryAt = Date.now() + 3000;
  }
}

// App-level keepalive ping every 25s: keeps the socket (and Cloudflare's idle
// timer) warm even when there is nothing else to send.
function startWsPing() {
  stopWsPing();
  wsPingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "ping", now: Date.now() })); } catch (e) {}
    }
  }, 25000);
}
function stopWsPing() { if (wsPingTimer) { clearInterval(wsPingTimer); wsPingTimer = null; } }

function fleetPush(msg) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error("ws down"));
    try { ws.send(JSON.stringify(msg)); resolve(true); }
    catch (e) { reject(e); }
  });
}

async function fleetOnServerMsg(msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "command") {
    const r = await fleetApplyCommand(msg.kind, msg.args || {});
    try { await fleetPush({ type: "ack", id: msg.id, status: r.ok ? "done" : "failed", result: r.text || "" }); }
    catch (e) { await fleetRest(`/api/fleet/commands/${msg.id}/ack`, { status: r.ok ? "done" : "failed", result: r.text || "" }); }
  } else if (msg.type === "email" && msg.email) {
      await fleetIntakeEmail(msg.email);
    } else if (msg.type === "hb-ack") {
      await fleetHandleHb(msg);
    }
}

function safeJson(s) { try { return JSON.parse(s || "{}"); } catch { return {}; } }

// ---- REST (fallback/recovery) ----
async function fleetRest(path, body) {
  const cfg = await fleetCfg();
  if (!cfg.fleetOn || !cfg.fleetUrl || !cfg.fleetToken) throw new Error("fleet off");
  const res = await fetch(cfg.fleetUrl + path, {
    method: "POST",
    headers: fleetHeaders(cfg.fleetToken),
    body: JSON.stringify({ deviceId: cfg.fleetDeviceId, ...(body || {}) })
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

// Optional profile-name reporting. Runs on install/startup or from the popup's
// Detect button only — never in the heartbeat/signup automation path.
async function detectProfile() {
  let list = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    try {
      const res = await fetch("http://127.0.0.1:58888/api/profiles/active", { signal: ctrl.signal, cache: "no-store" });
      if (res.ok) list = await res.json();
    } finally { clearTimeout(timer); }
  } catch (e) { return { ok: false }; }
  if (!Array.isArray(list) || !list.length) return { ok: false };
  let pick = list.length === 1 ? list[0] : null;
  if (!pick) {
    let best = Infinity;
    const now = Date.now();
    for (const p of list) {
      const started = Number(p.start_time || 0) * 1000;
      if (!started) continue;
      const gap = Math.abs(started - now);
      if (gap < best) { best = gap; pick = p; }
    }
    if (pick && best > 15 * 60 * 1000) pick = null;
  }
  if (!pick) return { ok: false };
  const patch = { profileUuid: String(pick.uuid || "") };
  const nm = pick.name || pick.title || pick.profile_name;
  if (nm) patch.profileName = String(nm);
  await chrome.storage.local.set(patch);
  return { ok: true, ...patch };
}

async function fleetSnapshot() {
  const s = await chrome.storage.local.get(["interns", "currentIndex", "config", "profileName", "profileUuid"]);
  const interns = Array.isArray(s.interns) ? s.interns : [];
  const cur = interns[s.currentIndex] || null;
  const st = await chrome.storage.local.get(["qrReady", "paySuccess"]);
  return {
    version: EXT_VERSION,
    status: st.qrReady ? "qr-showing" : st.paySuccess ? "completed" : (cur ? cur.status : "idle"),
    currentEmail: cur ? cur.email : "",
    currentStatus: cur ? cur.status : "",
    total: interns.length,
    done: interns.filter((i) => i.status === "done").length,
    failed: interns.filter((i) => i.status === "failed").length,
    autoRun: !!(s.config && s.config.autoRun !== false),
    profileName: s.profileName || "",
    profileUuid: s.profileUuid || ""
  };
}

// Shared: apply commands + intake email from any heartbeat answer (WS/REST).
async function fleetHandleHb(res) {
  if (!res) return;
  try { await chrome.storage.local.set({ fleetLastBeat: Date.now() }); } catch (e) {}
  if (Array.isArray(res.commands)) {
    for (const c of res.commands) {
      const r = await fleetApplyCommand(c.kind, safeJson(c.args));
      try { await fleetPush({ type: "ack", id: c.id, status: r.ok ? "done" : "failed", result: r.text || "" }); }
      catch (e) {
        try { await fleetRest(`/api/fleet/commands/${c.id}/ack`, { status: r.ok ? "done" : "failed", result: r.text || "" }); } catch (e2) {}
      }
    }
  }
  if (res.email && res.email.email) await fleetIntakeEmail(res.email.email);
  // Dashboard may resolve the profile name (UUID/IP match) before we do.
  if (res.profileName || res.profileUuid) {
    const patch = {};
    if (res.profileName) patch.profileName = String(res.profileName);
    if (res.profileUuid) patch.profileUuid = String(res.profileUuid);
    try { await chrome.storage.local.set(patch); } catch (e) {}
  }
}

let lastServerBeat = 0;

// Last fleet error, surfaced in the popup so "beat never" is diagnosable.
async function fleetNoteErr(text) {
  try { await chrome.storage.local.set({ fleetLastError: String(text || "error").slice(0, 160), fleetLastErrorAt: Date.now() }); } catch (e) {}
}
async function fleetClearErr() {
  try { await chrome.storage.local.set({ fleetLastError: "", fleetLastBeat: Date.now() }); } catch (e) {}
}

// 2s ticker path: guarantee the WS is (re)connecting and the beat goes out.
// Runs on every offscreen tick, so as long as the browser has internet the
// device keeps heart-beating — no manual intervention, ever.
async function fleetTick() {
  const cfg = await fleetCfg();
  if (!cfg.fleetOn || !cfg.fleetUrl || !cfg.fleetToken) return;
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    wsRetryAt = 0;
    fleetEnsureWs().catch(() => {});
  }
  await fleetContentBeat("");
}

// Fast path: live-page beat (every 3s) -> full snapshot heartbeat -> instant
// email claim + commands. WS first, REST fallback.
async function fleetContentBeat(page) {
  const cfg = await fleetCfg();
  if (!cfg.fleetOn || !cfg.fleetUrl || !cfg.fleetToken) return;
  fleetEnsureWs().catch(() => {});
  const snap = await fleetSnapshot();
  if (page) snap.page = page;
  if (Date.now() - lastServerBeat < 10000) {
    // Cheap path: WS only — but if the socket is down, fall through to REST so
    // the beat is never silently dropped.
    try { await fleetPush({ type: "heartbeat", body: snap }); await fleetClearErr(); return; }
    catch (e) { /* fall through to REST */ }
  }
  lastServerBeat = Date.now();
  try {
    await fleetPush({ type: "heartbeat", body: snap });
    await fleetClearErr();
  } catch (e) {
    try { await fleetHandleHb(await fleetRest("/api/fleet/heartbeat", snap)); await fleetClearErr(); }
    catch (e2) { await fleetNoteErr("beat failed: " + ((e2 && e2.message) || e2)); }
  }
}

// REST poll (alarm): heartbeat + flush outbox + pull commands/email.
async function fleetPoll() {
  const cfg = await fleetCfg();
  if (!cfg.fleetOn || !cfg.fleetUrl || !cfg.fleetToken) return;
  fleetEnsureWs().catch(() => {});
  try {
    const snap = await fleetSnapshot();
    const res = await fleetRest("/api/fleet/heartbeat", snap);
    lastServerBeat = Date.now();
    await fleetFlushOutbox();
    await fleetHandleHb(res);
    await fleetClearErr();
  } catch (e) { await fleetNoteErr("poll failed: " + ((e && e.message) || e)); }
}

// Events from content.js (qr / failed / success).
async function fleetOnEvent(msg) {
  const cfg = await chrome.storage.local.get(["fleetOn", "portalToken"]);
  if (!cfg.fleetOn) return;
  // Portal routing: every QR + billing result carries the target user's
  // portal token, so it shows up there with zero user-side setup.
  const userToken = (cfg.portalToken || "").trim();
  const kind = msg.kind;
  if (kind === "qr") {
    const payload = { email: msg.email || "", image: msg.image || "", at: msg.at || Date.now(), userToken };
    if (!await fleetSendQr(payload)) await fleetOutbox({ kind: "qr", payload });
  } else if (kind === "failed" || kind === "success" || kind === "progress" || kind === "retrying") {
    const payload = { email: msg.email || "", kind, text: msg.text || "", userToken };
    if (!await fleetSendStatus(payload)) await fleetOutbox({ kind: "status", payload });
  }
}

async function fleetSendQr(p) {
  try { await fleetPush({ type: "qr", ...p }); return true; } catch (e) {}
  try { await fleetRest("/api/fleet/qr", p); return true; } catch (e) {}
  return false;
}

async function fleetSendStatus(p) {
  try { await fleetPush({ type: "status", ...p }); return true; } catch (e) {}
  try { await fleetRest("/api/fleet/status", p); return true; } catch (e) {}
  return false;
}

async function fleetOutbox(item) {
  try {
    const s = await chrome.storage.local.get(["fleetOutbox"]);
    const box = Array.isArray(s.fleetOutbox) ? s.fleetOutbox : [];
    box.push({ ...item, ts: Date.now() });
    await chrome.storage.local.set({ fleetOutbox: box.slice(-20) });
  } catch (e) {}
}

async function fleetFlushOutbox() {
  const s = await chrome.storage.local.get(["fleetOutbox"]);
  const box = Array.isArray(s.fleetOutbox) ? s.fleetOutbox : [];
  if (!box.length) return;
  const rest = [];
  for (const item of box) {
    const ok = item.kind === "qr" ? await fleetSendQr(item.payload) : await fleetSendStatus(item.payload);
    if (!ok) rest.push(item);
  }
  await chrome.storage.local.set({ fleetOutbox: rest });
}

// Dashboard-assigned email -> current slot (or append if slot live).
// When it becomes the current pending email and no GCP tab is open, open the
// signup flow so a fresh profile starts working on its own.
async function fleetIntakeEmail(email) {
  const em = String(email || "").trim().toLowerCase();
  if (!em || !em.includes("@")) return { ok: false, text: "bad email" };
  const s = await chrome.storage.local.get(["interns", "currentIndex", "config"]);
  const interns = Array.isArray(s.interns) ? s.interns.slice() : [];
  const idx = typeof s.currentIndex === "number" ? s.currentIndex : 0;
  const cur = interns[idx];
  const fresh = { name: em.split("@")[0], email: em, status: "pending", note: "from dashboard" };
  if (!cur || cur.status === "done" || cur.status === "failed") {
    interns[idx] = fresh;
    await chrome.storage.local.set({ interns, currentIndex: idx });
    const autoRun = !s.config || s.config.autoRun !== false;
    if (autoRun) {
      try {
        const tabs = await chrome.tabs.query({});
        const onFlow = (tabs || []).some((t) => {
          const u = t.url || "";
          return u.includes("accounts.cloud.google.com") || u.includes("console.cloud.google.com") || u.includes("payments.google.com");
        });
        if (!onFlow) chrome.tabs.create({ url: SIGNUP_URL });
      } catch (e) {}
    }
    return { ok: true, text: "email set as current" };
  }
  if (!interns.some((i) => i.email === em)) {
    interns.push(fresh);
    await chrome.storage.local.set({ interns });
    return { ok: true, text: "email queued" };
  }
  return { ok: true, text: "email already present" };
}

// Apply a dashboard command. Mirrors content.js advance() semantics.
async function fleetApplyCommand(kind, args) {
  try {
    if (kind === "pause") {
      const s = await chrome.storage.local.get(["config"]);
      const config = { ...(s.config || {}), autoRun: false };
      await chrome.storage.local.set({ config });
      return { ok: true, text: "paused" };
    }
    if (kind === "resume") {
      const s = await chrome.storage.local.get(["config"]);
      const config = { ...(s.config || {}), autoRun: true };
      await chrome.storage.local.set({ config });
      // Start = run now: if no GCP tab is open, open the signup flow so the
      // assigned email starts processing immediately.
      try {
        const tabs = await chrome.tabs.query({});
        const onFlow = (tabs || []).some((t) => {
          const u = t.url || "";
          return u.includes("accounts.cloud.google.com") || u.includes("console.cloud.google.com") || u.includes("payments.google.com");
        });
        if (!onFlow) chrome.tabs.create({ url: SIGNUP_URL });
      } catch (e) {}
      return { ok: true, text: "resumed, signup tab ensured" };
    }
    if (kind === "open-signup") {
      chrome.tabs.create({ url: SIGNUP_URL });
      return { ok: true, text: "signup tab opened" };
    }
    if (kind === "sign-out") {
      chrome.tabs.create({ url: LOGOUT_URL });
      return { ok: true, text: "sign-out tab opened" };
    }
    if (kind === "grab-qr") {
      const s = await chrome.storage.local.get(["currentIndex"]);
      await chrome.storage.local.set({ qrGrabRequest: { at: Date.now(), for: s.currentIndex || 0 } });
      return { ok: true, text: "grab requested" };
    }
    if (kind === "retry") {
      // User-driven retry: content.js watches retryRequest and re-taps Start
      // free to mint a fresh QR on the same account.
      const s = await chrome.storage.local.get(["currentIndex"]);
      await chrome.storage.local.set({ retryRequest: { at: Date.now(), for: s.currentIndex || 0 } });
      return { ok: true, text: "retry requested" };
    }
    if (kind === "next" || kind === "skip") {
      const s = await chrome.storage.local.get(["interns", "currentIndex"]);
      const interns = Array.isArray(s.interns) ? s.interns.slice() : [];
      const idx = typeof s.currentIndex === "number" ? s.currentIndex : 0;
      if (!interns[idx]) return { ok: false, text: "no current intern" };
      interns[idx] = { ...interns[idx], status: kind === "skip" ? "failed" : "done", note: kind === "skip" ? "skipped by dashboard" : (interns[idx].note || "") };
      await chrome.storage.local.set({
        interns,
        currentIndex: Math.min(idx + 1, interns.length),
        upiSelected: false, upiSelectedFor: -1,
        payRetryFor: -1, payRetryCount: 0,
        startFreeTaps: 0, startFreeTapsFor: -1
      });
      return { ok: true, text: kind + " applied" };
    }
    return { ok: false, text: "unknown command" };
  } catch (e) {
    return { ok: false, text: String((e && e.message) || e) };
  }
}

// Offscreen keepalive: creates (or reuses) the ticker document that wakes us
// every 2s. Called on boot + every alarm so a killed ticker always revives.
async function ensureOffscreen() {
  try {
    if (!chrome.offscreen || !chrome.offscreen.createDocument) return false;
    try {
      if (chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument())) return true;
    } catch (e) {}
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Fleet heartbeat keepalive: heartbeat the dashboard every 2 seconds",
    });
    return true;
  } catch (e) {
    return false;
  }
}

// Boot connect: runs on EVERY service-worker start (install, browser start,
// wake). Sequences seed-then-connect with retries, then a guaranteed REST
// beat — so a freshly loaded extension is online within seconds, no clicks.
async function fleetBootConnect() {
  try { await seedFleetDefaults(); } catch (e) {}
  try { await ensureOffscreen(); } catch (e) {}
  try { await ensureOffscreen(); } catch (e) {}
  for (let i = 0; i < 3; i++) {
    try {
      const cfg = await fleetCfg();
      if (!cfg.fleetOn || !cfg.fleetUrl || !cfg.fleetToken) return;
      if (!ws || (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING)) {
        wsRetryAt = 0;
        await fleetEnsureWs();
      } else {
        return;
      }
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 4000));
  }
  try { await fleetPoll(); } catch (e) {}
}

// Kick on load.
fleetBootConnect().catch(() => {});
