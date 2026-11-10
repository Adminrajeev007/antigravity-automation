// Combo OAuth module: signup profile billing -> OAuth -> API -> sheet complete.
// Loaded from background.js via importScripts("combo-oauth.js").

const COMBO_API_BASE = "http://agy-agylb-wu9iuq-1cc4ca-38-46-221-168.sslip.io";
const COMBO_DEFAULT_API_KEY = "9dfe1d39f1238d25dd122cc6d2a07b12q554aa97fc37a5be17e7c49ef0bd62e1";
const COMBO_PROXY_URL = "http://testuser:testpass@192.168.31.250:1080";
const COMBO_SHEET_URL = "https://script.google.com/macros/s/AKfycbzoCHT0aGmxBzTD_j9gEU1JFxBW52_NUj7x-NHW_D_W_PmIZ4YIWWCOWtIcR2fojkfs/exec";
const COMBO_SHEET_TOKEN = "change-this-sheet-token";
const COMBO_ORCH = "http://127.0.0.1:8791";

let comboSubmitPromise = null;
let comboProxyApplied = false;

function comboFetchText(url, timeoutMs, init) {
  return Promise.resolve().then(function () {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    var opts = Object.assign({ cache: "no-store", signal: controller.signal }, init || {});
    return fetch(url, opts).then(function (res) {
      return res.text().then(function (text) {
        return { status: res.status, ok: res.ok, text: text };
      });
    }).finally(function () { clearTimeout(timer); });
  });
}

async function comboProxyConfig() {
  var u = new URL(COMBO_PROXY_URL);
  var scheme = String(u.protocol || "http:").replace(":", "");
  return {
    mode: "fixed_servers",
    rules: {
      singleProxy: { scheme: scheme, host: u.hostname, port: Number(u.port || 80) },
      bypassList: [
        "<local>",
        "192.168.31.250",
        "agy-agylb-wu9iuq-1cc4ca-38-46-221-168.sslip.io",
        "dispose.lol"
      ]
    }
  };
}

async function comboApplyProxy() {
  try {
    if (!chrome.proxy || !chrome.proxy.settings) return;
    await chrome.proxy.settings.set({ value: await comboProxyConfig(), scope: "regular" });
    comboProxyApplied = true;
  } catch (e) {
    console.warn("[combo] proxy apply failed", e);
  }
}

async function comboApiKey() {
  var st = await chrome.storage.local.get(["comboApiKey"]);
  return String(st.comboApiKey || "").trim() || COMBO_DEFAULT_API_KEY;
}

async function comboApi(path, payload) {
  await comboApplyProxy();
  var key = await comboApiKey();
  var headers = { Authorization: "Bearer " + key };
  if (payload !== undefined) headers["Content-Type"] = "application/json";
  var res = await comboFetchText(COMBO_API_BASE.replace(/\/+$/, "") + "/" + String(path).replace(/^\/+/, ""), 60000, {
    method: "POST",
    headers: headers,
    body: payload !== undefined ? JSON.stringify(payload) : undefined
  });
  var data = null;
  try { data = res.text ? JSON.parse(res.text) : null; } catch (e) {}
  if (!res.ok) {
    var detail = (data && (data.detail || data.error || data.message)) || res.text.slice(0, 240);
    throw new Error("HTTP " + res.status + ": " + detail);
  }
  return data;
}

async function comboSettings() {
  var st = await chrome.storage.local.get(["sheetUrl", "sheetToken", "sheetTab", "profileUuid"]);
  return {
    url: String(st.sheetUrl || COMBO_SHEET_URL).replace(/\/+$/, ""),
    token: String(st.sheetToken || COMBO_SHEET_TOKEN),
    tab: String(st.sheetTab || "QR"),
    uuid: String(st.profileUuid || "")
  };
}

async function comboSheet(params) {
  var cfg = await comboSettings();
  var url = new URL(cfg.url);
  url.searchParams.set("token", cfg.token);
  url.searchParams.set("tab", cfg.tab);
  Object.keys(params || {}).forEach(function (k) {
    if (params[k] !== undefined && params[k] !== null) url.searchParams.set(k, String(params[k]));
  });
  var last = null;
  for (var attempt = 1; attempt <= 3; attempt += 1) {
    try {
      var res = await comboFetchText(url.toString(), 60000, { method: "GET" });
      if (!res.ok) {
        last = new Error("HTTP " + res.status + ": " + res.text.slice(0, 200));
      } else {
        var data = null;
        try { data = JSON.parse(res.text); } catch (e) {}
        if (data && data.ok === false) {
          last = new Error((data && (data.error || data.message)) || "sheet error");
        } else {
          return data || res.text;
        }
      }
    } catch (e) {
      last = e;
    }
    await new Promise(function (r) { setTimeout(r, 2000 * attempt); });
  }
  throw last || new Error("sheet request failed");
}

function comboExtractToken(data) {
  var keys = ["antigravityToken", "access_token", "accessToken", "token", "id_token", "apiToken", "rowToken"];
  function walk(node, depth) {
    if (!node || depth > 5) return "";
    if (typeof node === "string") return "";
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i += 1) {
        var t = walk(node[i], depth + 1);
        if (t) return t;
      }
      return "";
    }
    if (typeof node === "object") {
      for (var k = 0; k < keys.length; k += 1) {
        var v = node[keys[k]];
        if (typeof v === "string" && v.length > 12) return v;
      }
      for (var kk in node) {
        if (!Object.prototype.hasOwnProperty.call(node, kk)) continue;
        var nested = walk(node[kk], depth + 1);
        if (nested) return nested;
      }
    }
    return "";
  }
  return walk(data, 0) || "";
}

async function comboNotify(path, body) {
  try {
    await comboFetchText(COMBO_ORCH + path, 15000, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {})
    });
  } catch (e) {
    console.warn("[combo] notify failed", path, e);
  }
}

async function comboFail(email, reason) {
  var cfg = await comboSettings();
  try {
    await comboSheet({ action: "reject", email: email, notes: String(reason || "combo oauth failed").slice(0, 300) });
  } catch (e) {}
  await comboNotify("/failed", { email: email, uuid: cfg.uuid, reason: String(reason || "combo oauth failed") });
}

async function comboStartOauth(email) {
  var value = String(email || "").trim().toLowerCase();
  if (!value) return { ok: false, error: "missing email" };
  if (!comboProxyApplied) await comboApplyProxy();
  var cfg = await comboSettings();
  try {
    await comboFlowEnsure(value, cfg.uuid);
    await comboFlowDone("billing_reached");
  } catch (e) {}
  var stored = await chrome.storage.local.get(["comboOauth"]);
  var prior = stored.comboOauth || null;
  if (prior && prior.email === value && prior.authUrl && prior.state && prior.codeVerifier &&
      Date.now() - (prior.startedAt || 0) < 10 * 60 * 1000) {
    await chrome.tabs.create({ url: prior.authUrl, active: true });
    return { ok: true, reused: true };
  }
  await chrome.storage.local.set({
    comboOauth: { email: value, uuid: cfg.uuid, status: "starting", message: "Starting OAuth...", startedAt: Date.now() }
  });
  try {
    var data = await comboApi("/api/accounts/oauth/start");
    var authUrl = data && data.auth_url;
    var state = data && data.state;
    var codeVerifier = data && data.code_verifier;
    if (!authUrl || !state || !codeVerifier) throw new Error("API did not return auth_url/state/code_verifier");
    await chrome.storage.local.set({
      comboOauth: {
        email: value,
        uuid: cfg.uuid,
        authUrl: authUrl,
        state: state,
        codeVerifier: codeVerifier,
        status: "pending",
        message: "Waiting for OAuth consent...",
        startedAt: Date.now()
      }
    });
    try { await comboFlowDone("oauth_started"); } catch (e2) {}
    await chrome.tabs.create({ url: authUrl, active: true });
    return { ok: true };
  } catch (e) {
    await chrome.storage.local.set({
      comboOauth: { email: value, uuid: cfg.uuid, status: "start-failed", message: String(e.message || e), error: String(e.message || e), startedAt: Date.now() }
    });
    try { await comboFlowFail("oauth_started", "OAuth start failed: " + String(e.message || e)); } catch (e2) {}
    return { ok: false, error: String(e.message || e) };
  }
}

async function comboSubmitOauthCode(code) {
  if (comboSubmitPromise) return comboSubmitPromise;
  comboSubmitPromise = (async function () {
    var value = String(code || "").trim();
    if (!value) return { ok: false, error: "missing code" };
    var stored = await chrome.storage.local.get(["comboOauth"]);
    var oauth = stored.comboOauth || null;
    if (!oauth || !oauth.email || !oauth.state || !oauth.codeVerifier) {
      return { ok: false, error: "no active combo OAuth" };
    }
    if (oauth.status === "completed") return { ok: true, already: true };
    try { await comboFlowDone("callback_code"); } catch (e2) {}
    await chrome.storage.local.set({ comboOauth: Object.assign({}, oauth, { status: "submitting", message: "Sending code to API...", submittedAt: Date.now() }) });

    var last = null;
    var accepted = null;
    for (var attempt = 1; attempt <= 12; attempt += 1) {
      try {
        accepted = await comboApi("/api/accounts/oauth/callback", {
          code: value,
          state: oauth.state,
          code_verifier: oauth.codeVerifier
        });
        last = null;
        break;
      } catch (e) {
        last = e;
        var msg = String((e && e.message) || e);
        if (!/timeout|network|ECONN|ETIMEDOUT|HTTP 5\d\d|HTTP 429/i.test(msg)) break;
        await new Promise(function (r) { setTimeout(r, Math.min(15000, 2500 + attempt * 1500)); });
      }
    }
    if (accepted === null) {
      var reason = String((last && last.message) || last || "OAuth callback failed");
      await chrome.storage.local.set({ comboOauth: Object.assign({}, oauth, { status: "failed", message: reason, error: reason }) });
      try { await comboFlowFail("api_callback", "OAuth callback failed: " + reason); } catch (e2) {}
      return { ok: false, error: reason };
    }

    try { await comboFlowDone("api_callback"); } catch (e2) {}
    var token = comboExtractToken(accepted);
    try {
      if (token) await comboSheet({ action: "qr", email: oauth.email, userToken: token });
      var done = await comboSheet({ action: "complete", email: oauth.email, notes: "completed" });
      if (done && done.status && String(done.status).toLowerCase() !== "completed") {
        throw new Error("sheet status not completed: " + String(done.status));
      }
    } catch (e) {
      console.warn("[combo] sheet complete failed", e);
      try { await comboFlowFail("sheet_completed", "Sheet complete failed: " + String(e.message || e)); } catch (e2) {}
      return { ok: false, error: String(e.message || e) };
    }

    try { await comboFlowDone("sheet_completed"); } catch (e2) {}
    await chrome.storage.local.set({
      comboOauth: Object.assign({}, oauth, { status: "completed", message: "Completed", completedAt: Date.now(), token: token })
    });
    await comboNotify("/combo-complete", { email: oauth.email, uuid: oauth.uuid || "", extId: chrome.runtime.id });
    try { await comboFlowDone("profile_closed"); } catch (e2) {}
    return { ok: true, email: oauth.email, token: token ? true : false };
  })().finally(function () { comboSubmitPromise = null; });
  return comboSubmitPromise;
}

try {
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === "COMBO_OAUTH_CODE") {
      comboSubmitOauthCode(msg.code)
        .then(function (r) { sendResponse(r); })
        .catch(function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); });
      return true;
    }
    if (msg && msg.type === "COMBO_START_OAUTH" && msg.email) {
      comboStartOauth(msg.email)
        .then(function (r) { sendResponse(r); })
        .catch(function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); });
      return true;
    }
    return undefined;
  });
} catch (e) {}

try {
  chrome.webRequest.onAuthRequired.addListener(
    function (details, callback) {
      callback({ authCredentials: { username: "testuser", password: "testpass" } });
    },
    { urls: ["<all_urls>"] },
    ["asyncBlocking"]
  );
} catch (e) {}
