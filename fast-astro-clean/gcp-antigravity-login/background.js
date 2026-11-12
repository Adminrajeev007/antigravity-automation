// GCP AG background: storage defaults, OAuth tab, OTP lookup, proxy and cookies.

const DOMAINS = [
  "cyberstrive.org", "dataglint.org", "devglow.org", "devmosaic.org", "devnimble.org", "devstride.org",
  "devvibe.org", "netfuze.org", "netnexa.org", "netquill.org", "netspry.org", "netstride.org",
  "scriptcrux.org", "scriptglide.org", "algohivehub.org", "algoloom.org", "algomatrix.org", "algonesthub.org",
  "bytecraze.org", "byteglintpro.org", "bytenexus.org", "codeglyphs.org", "codepatna.org", "corefuze.org",
  "coreluxe.org", "cybercrux.org", "cyberfuze.org", "cyberpatna.org", "cyberquanta.org", "cybrazehub.org",
  "devaurahub.org", "devpatna.org", "devsparkle.org", "devspectra.org", "logichive.org", "netluxe.org",
  "patnacyber.org", "patnadev.org", "patnatech.org", "scriptnesthub.org", "scriptvista.org", "techcrysta.org",
  "technesthub.org", "techvireo.org", "algentis.org", "algocrate.org", "algocrux.org", "algoforgenet.org",
  "algozen.org", "algvex.org", "bitglintnet.org", "bithatch.org", "bytepulsenet.org", "cryptixis.org",
  "cybermeld.org", "cybernestnet.org", "cybranta.org", "cybrantix.org", "cybrillo.org", "cybrova.org",
  "devsyte.org", "devvanta.org", "netcrate.org", "netvista.org", "scripthatch.org", "scriptix.org",
  "scriptnestnet.org", "scriptnexus.org", "scriptpulsenet.org", "techcrate.org", "techpulsenet.org", "techspry.org",
  "techstra.org", "techvex.org", "algoblink.org", "algoglow.org", "algomint.org", "algoquill.org",
  "algosynth.org", "algozenith.org", "bitcrux.org", "bitglide.org", "bitpulsenet.org", "bitsynth.org",
  "bitvortex.org", "bytefuze.org", "byteglint.org", "bytesynth.org", "codeglide.org", "codeglow.org",
  "codemosaic.org", "codenimbus.org", "codestrive.org", "codevireo.org", "corezenith.org", "cyberglint.org",
  "cyberquill.org", "devcrest.org", "devglint.org", "devhatch.org", "netsynth.org", "scriptloom.org",
  "scriptnest.org", "techriven.org", "algofuse.org", "algohive.org", "algonimble.org", "algospark.org",
  "algospry.org", "bitcrypta.org", "bytecrest.org", "byteglide.org", "bytequanta.org", "bytesummit.org",
  "bytevortex.org", "codeflick.org", "codespritz.org", "coreaura.org", "corenimble.org", "coresynth.org",
  "cyberfluent.org", "cybermint.org", "cybernovae.org", "cybervibe.org", "devcrux.org", "devglide.org",
  "devorbix.org", "devvortex.org", "netcrypta.org", "scriptbloom.org", "scriptglow.org", "scriptvibe.org",
  "technexis.org", "techquill.org", "algodyna.org", "bitcrest.org", "bitsprint.org", "bitsprout.org",
  "bytesprint.org", "codelyric.org", "codespry.org", "corehatch.org", "cyberfleck.org", "cybernimble.org",
  "cyberzenith.org", "datanimble.org", "netsprint.org", "scriptmint.org", "scriptnimble.org", "scriptnova.org",
  "scriptvanta.org", "scriptvortex.org", "techcraze.org", "techmeld.org", "algocraft.org", "algocrafty.org",
  "algosprint.org", "bytehatch.org", "bytevanta.org", "coreblink.org", "coresprint.org", "netloom.org",
  "techblink.org", "techvra.org", "algohaven.org", "algonest.org", "algovanta.org", "codalis.org",
  "cybrant.org", "netglint.org", "nethatch.org", "scriptaura.org", "scriptflux.org", "scriptrise.org",
  "algobeacon.org", "algoflux.org", "algonexa.org", "algoorbit.org", "bitvora.org", "bytecrux.org",
  "bytevera.org", "dataglide.org", "dataquill.org", "netglide.org", "bitaura.org", "bitloom.org",
  "byteglyph.org", "bytevex.org", "codeglyph.org", "coreglyph.org", "cybrance.org", "devaura.org",
  "devglyph.org", "devhaven.org", "devsolis.org", "netaura.org", "techaura.org", "techglyph.org",
  "techluxe.org", "algoharbor.org", "bitnimble.org", "bitquill.org", "bytenova.org", "cloudbeacon.org",
  "codeglint.org", "coderift.org", "codezephyr.org", "coremint.org", "cryptvia.org", "cybraze.org",
  "devnook.org", "devzenith.org", "scriptsummit.org", "technimble.org", "cloudstrix.org", "codestratus.org",
  "cyberaegis.org", "devaxion.org", "devnexia.org", "devnova.org", "devpulsex.org", "devsynapse.org",
  "devsynthx.org", "opshalox.org", "opsnova.org", "opsvanta.org", "opsvox.org", "techaxion.org",
  "technexa.org", "codeaxiom.org", "codetrail.org", "cyberglide.org", "cybersynthx.org", "devsynth.org",
  "algoflick.org", "algoglide.org", "algoglint.org", "algoluxe.org", "algonimbus.org", "algoquanta.org",
  "algostream.org", "algostride.org", "algostrive.org", "algovertex.org", "algovibe.org", "algovortex.org",
  "always4.org", "apphive.org", "astroaitech.org", "bitluxe.org", "bitmeld.org", "bitspry.org",
  "bitstrive.org", "bitvanta.org", "bitzenith.org", "bytecrafty.org", "byteluxe.org", "bytevibe.org",
  "bytevista.org", "bytevolt.org", "bytezenith.org", "clonessh.com", "cloudlyst.org", "cloudnexis.org",
  "cloudpulsepro.com", "cloudquanta.org", "cloudsurge.org", "cloudsynth.org", "codeblink.org", "codecrux.org",
  "codeflect.org", "codefuze.org", "codehelix.org", "codemeld.org", "codemotive.org", "codeninnja.online",
  "codeplexus.org", "codequanta.org", "coderafter.org", "codestride.org", "codevox.org", "corecrux.org",
  "coreglint.org", "corequanta.org", "corequest.org", "corevertex.org", "corevireo.org", "cyberaxiom.org",
  "cyberdevops.org", "cyberluxe.org", "cybermotive.org", "cyberpulsex.com", "cybersynth.org", "cybervanta.org",
  "datasynth.org", "devaxis.org", "devbeacon.org", "devblink.org", "devhalo.org", "devinnovation.org",
  "devluxe.org", "devlynx.org", "devmotive.org", "devnexis.org", "devopsbeacon.org", "devopscore.org",
  "devopshive.org", "devopshub.org", "devopsia.org", "devopsiq.org", "devopsloom.org", "devopsnest.org",
  "devopsnexa.org", "devopsnimble.com", "devopspulse.org", "devopstrail.org", "devquanta.org", "devsentry.org",
  "devsurge.org", "devvertex.org", "dnewcloud.org", "enewvission.org", "everyai4all.org", "furryx.dev",
  "geniai0.org", "hackingtect.site", "help-bot.org", "innoloom.org", "innovanta.org", "itnimble.org",
  "kuber2x.online", "kuberearn.online", "kuberx.online", "logicquest.org", "mark-et.org", "mescasoft.org",
  "ncltek.com", "nexaravox.org", "ngetek.com", "notebookllm.org", "opencodehub.org", "opslynx.org",
  "opsnexa.org", "opsnexis.org", "opsnimble.org", "opsspark.org", "opssynth.org", "savanahseeds.com",
  "scriptblink.org", "scriptglint.org", "scriptquanta.org", "scriptsprint.org", "sqlpg.com", "techaiforum.org",
  "techaxiom.org", "techbeacon.org", "techcrest.org", "techhalo.org", "techhivex.org", "techkernel.org",
  "techlance.org", "techlura.org", "techlynx.org", "technexishub.org", "technimbl.org", "technimbus.org",
  "techquanta.org", "techsera.org", "techsynth.org", "techvance.org", "techvantax.com", "turtlecode.org",
  "virova.org", "voltnest.org", "web3tekx.com", "zyntek.org"
];

function randomDomain() {
  return DOMAINS[Math.floor(Math.random() * DOMAINS.length)];
}

const DEFAULT_API_KEY = "9dfe1d39f1238d25dd122cc6d2a07b12q554aa97fc37a5be17e7c49ef0bd62e1";

const ACCOUNT_TIMEOUT_ALARM = "gcp-account-timeout";
const PROXY_WATCH_ALARM = "gcp-proxy-watch";
const FLOW_WATCH_ALARM = "gcp-flow-watch";
const SHEET_SYNC_ALARM = "gcp-sheet-sync";
const DOCTOR_ALARM = "gcp-doctor";
const DOCTOR_GRACE_MS = 60000;
const PROXY_RECOVERY_TIMEOUT_MS = 120000;

const DEFAULTS = {
  domain: "cyberstrive.org",
  interns: [],
  currentIndex: 0,
  apiKey: DEFAULT_API_KEY,
  usedEmails: [],
  successEmails: [],
  oauthCodes: [],
  sheetWebhookUrl: "https://script.google.com/macros/s/AKfycbzoCHT0aGmxBzTD_j9gEU1JFxBW52_NUj7x-NHW_D_W_PmIZ4YIWWCOWtIcR2fojkfs/exec",
  sheetToken: "change-this-sheet-token",
  config: {
    autoRun: true,
    fastMode: false,
    live: true,
    stuckMinutes: 2.5,
    emailOrder: "desc"
  },
  proxy: {
    enabled: false,
    customUrl: "http://testuser:testpass@192.168.31.250:1080"
  }
};

let proxyAuthCache = null;

function refreshProxyAuthCache(rawUrl) {
  const parsed = parseCustomProxyUrl(rawUrl);
  if (parsed && parsed.username) {
    proxyAuthCache = { username: parsed.username, password: parsed.password };
  }
}

refreshProxyAuthCache(DEFAULTS.proxy.customUrl);

// Names used for email generation (kept in the background so allocation is
// serialized and guaranteed unique across popup + content scripts).
const FIRST_NAMES = [
  "aarav","vivaan","aditya","vihaan","arjun","reyansh","ayaan","ananya","diya",
  "isha","kavya","meera","priya","riya","saanvi","tara","nisha","pooja","rahul",
  "rohit","amit","sunil","vikram","nikhil","karan","dev","hari","sanjay","ravi",
  "ajay","mohan","gopal","krish","aryan","ishan","rohan","varun","sid","aman",
  "neha","swati","divya","shreya","parul","tanvi","jatin","kunal","mohit","sahil"
];
const LAST_NAMES = [
  "sharma","verma","patel","kumar","singh","gupta","joshi","rao","reddy","nair",
  "iyer","das","bose","sen","mehta","shah","jain","pandey","mishra","chopra",
  "khanna","malhotra","agarwal","banerjee","mukherjee","dutta","ghosh","pillai",
  "menon","chauhan","thakur","yadav","tiwari","dubey","srivastava","saxena"
];

function randPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function strongSuffix(len) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const out = [];
  try {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < len; i++) out.push(chars[bytes[i] % chars.length]);
  } catch (e) {
    for (let i = 0; i < len; i++) out.push(chars[Math.floor(Math.random() * chars.length)]);
  }
  return out.join("");
}

let emailQueue = Promise.resolve();

function generateEmails(domain, count) {
  const run = emailQueue.then(() => doGenerateEmails(domain, count));
  emailQueue = run.catch(() => {});
  return run;
}

async function doGenerateEmails(domain, count) {
  const store = await chrome.storage.local.get(["usedEmails", "interns"]);
  const used = new Set(
    (Array.isArray(store.usedEmails) ? store.usedEmails : []).map((e) => String(e).toLowerCase())
  );
  (store.interns || []).forEach((i) => {
    if (i && i.email) used.add(String(i.email).toLowerCase());
  });

  const emails = [];
  for (let n = 0; n < count; n++) {
    let email;
    let guard = 0;
    do {
      email = randPick(FIRST_NAMES) + randPick(LAST_NAMES) + strongSuffix(10) + "@" + domain;
      guard++;
    } while (used.has(email.toLowerCase()) && guard < 1000);

    if (used.has(email.toLowerCase())) {
      email = randPick(FIRST_NAMES) + randPick(LAST_NAMES) +
        Date.now().toString(36) + strongSuffix(4) + "@" + domain;
    }

    used.add(email.toLowerCase());
    emails.push(email);
  }

  await chrome.storage.local.set({ usedEmails: [...used] });
  return emails;
}

// Keys from older builds that no longer apply to the AG flow.
const OBSOLETE_KEYS = [
  "qrDashboard",
  "currentAddr",
  "currentAddrIndex",
  "upiSelected",
  "qrVisible",
  "startFreeArmed",
  "startFreeAttempt",
  "startFreeClickedAt",
  "agOauthOpenedAt",
  "oauthUrl",
  "proxyDefaultOffMigrated",
  "proxyOnMigrated",
  "autoContinueEmail",
  "autoContinueAt",
  "scriptVersion"
];

function parseCustomProxyUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  let u;
  try { u = new URL(text); } catch (e) { return null; }
  const scheme = String(u.protocol || "").replace(":", "").toLowerCase();
  if (!["http", "https", "socks4", "socks5"].includes(scheme)) return null;
  const host = u.hostname;
  if (!host) return null;
  const port = Number(u.port) || ((scheme === "socks4" || scheme === "socks5") ? 1080 : 8080);
  return {
    scheme,
    host,
    port,
    username: decodeURIComponent(u.username || ""),
    password: decodeURIComponent(u.password || "")
  };
}

// Signup starts here. When signed out it redirects to the email/OTP screen.
const SIGNUP_URL = "https://console.cloud.google.com/freetrial";
const LOGIN_URL = "https://console.cloud.google.com/AddSession";
const LOGOUT_URL = "https://accounts.google.com/Logout";

// Account API. The key is stored in chrome.storage.local (popup field).
const API_BASE = "http://agy-agylb-wu9iuq-1cc4ca-38-46-221-168.sslip.io/";
const API_TIMEOUT = 60000;
const CALLBACK_TIMEOUT = 90000;

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(null);
  const storedConfig = stored.config || {};
  const merged = {
    ...DEFAULTS,
    ...stored,
    config: {
      autoRun: typeof storedConfig.autoRun === "boolean" ? storedConfig.autoRun : DEFAULTS.config.autoRun,
      fastMode: !!storedConfig.fastMode,
      live: typeof storedConfig.live === "boolean" ? storedConfig.live : true,
      stuckMinutes: typeof storedConfig.stuckMinutes === "number"
        ? storedConfig.stuckMinutes
        : DEFAULTS.config.stuckMinutes,
      emailOrder: storedConfig.emailOrder === "asc" ? "asc" : "desc"
    },
    proxy: { ...DEFAULTS.proxy, ...(stored.proxy || {}) }
  };
  // One-time migration: use the HTTP proxy URL.
  if (!stored.httpProxyMigrated) {
    merged.proxy.enabled = true;
    merged.proxy.customUrl = DEFAULTS.proxy.customUrl;
    merged.proxy.httpProxyMigrated = true;
  }

  // Login extension runs direct: no proxy, live on.
  if (!stored.loginNoProxyMigrated) {
    merged.proxy.enabled = false;
    merged.loginNoProxyMigrated = true;
  }
  if (!stored.loginAutoLiveMigrated) {
    merged.config = { ...merged.config, live: true, autoRun: true };
    merged.loginAutoLiveMigrated = true;
  }

  // One-time migration: point at the current (billing/QR) Sheet.
  if (!stored.sheetWebhookMigratedV2) {
    merged.sheetWebhookUrl = DEFAULTS.sheetWebhookUrl;
    merged.sheetToken = DEFAULTS.sheetToken;
    merged.sheetWebhookMigratedV2 = true;
  }
  if (!merged.sheetWebhookUrl) merged.sheetWebhookUrl = DEFAULTS.sheetWebhookUrl;
  if (!merged.sheetToken) merged.sheetToken = DEFAULTS.sheetToken;

  // Login extension is direct by default; keep the URL for later but do not
  // enable the proxy automatically. The SOCKS proxy is not used for login.
  if (!stored.socks5ProxyMigrated) {
    merged.proxy.enabled = false;
    merged.proxy.customUrl = DEFAULTS.proxy.customUrl;
    merged.proxy.socks5ProxyMigrated = true;
  }
  const used = new Set(
    (Array.isArray(stored.usedEmails) ? stored.usedEmails : []).map((e) => String(e).toLowerCase())
  );
  (stored.interns || []).forEach((i) => {
    if (i && i.email) used.add(String(i.email).toLowerCase());
  });
  merged.usedEmails = [...used];
  merged.apiKey = DEFAULT_API_KEY;
  if (!stored.domain || stored.domain === "fussion.studio") {
    merged.domain = randomDomain();
  }
  merged.config = { ...merged.config, live: true, autoRun: true };
  await chrome.storage.local.set(merged);
  await chrome.storage.local.remove(OBSOLETE_KEYS);
  try { await applyProxy(); } catch (e) {}
  await chrome.storage.local.set({
    proxyHold: false,
    proxyRecovering: false,
    proxyFailAt: 0,
    proxyEgressIp: null,
    lastProxyError: null
  });
  reconcileAccountTimeout().catch(() => {});
  try { chrome.alarms.create(PROXY_WATCH_ALARM, { periodInMinutes: 0.5 }); } catch (e) {}
  try { chrome.alarms.create(FLOW_WATCH_ALARM, { periodInMinutes: 0.5 }); } catch (e) {}
  try { chrome.alarms.create(DOCTOR_ALARM, { periodInMinutes: 0.5 }); } catch (e) {}
  try { chrome.alarms.create(SHEET_SYNC_ALARM, { periodInMinutes: 1 }); } catch (e) {}
  markAutoStartHandled().catch(() => {});
  startLiveRun().catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  try { await applyProxy(); } catch (e) {}
  const startupState = await chrome.storage.local.get("config");
  await chrome.storage.local.set({
    config: { ...(startupState.config || {}), live: true, autoRun: true }
  });
  await chrome.storage.local.set({
    proxyHold: false,
    proxyRecovering: false,
    proxyFailAt: 0,
    proxyEgressIp: null,
    lastProxyError: null
  });
  reconcileAccountTimeout().catch(() => {});
  try { chrome.alarms.create(PROXY_WATCH_ALARM, { periodInMinutes: 0.5 }); } catch (e) {}
  try { chrome.alarms.create(FLOW_WATCH_ALARM, { periodInMinutes: 0.5 }); } catch (e) {}
  try { chrome.alarms.create(DOCTOR_ALARM, { periodInMinutes: 0.5 }); } catch (e) {}
  try { chrome.alarms.create(SHEET_SYNC_ALARM, { periodInMinutes: 1 }); } catch (e) {}
  ensureLiveBoot().catch(() => {});
});

// Proxy authentication uses the configured custom proxy credentials.
chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    if (proxyAuthCache) {
      callback({ authCredentials: proxyAuthCache });
      return;
    }
    chrome.storage.local.get("proxy").then(({ proxy }) => {
      const p = proxy || {};
      if (!p.enabled) {
        callback({});
        return;
      }
      const custom = parseCustomProxyUrl(p.customUrl);
      if (!custom || !custom.username) {
        callback({});
        return;
      }
      proxyAuthCache = { username: custom.username, password: custom.password };
      callback({ authCredentials: proxyAuthCache });
    });
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);

chrome.webRequest.onErrorOccurred.addListener((details) => {
  if (!details.url || !/(google\.com|antigravity\.google)/i.test(details.url)) return;
  const error = String(details.error || "");
  if (!/PROXY|TUNNEL|CONNECTION_RESET|TIMED_OUT|ADDRESS_UNREACHABLE|CONNECTION_CLOSED/i.test(error)) return;
  const now = Date.now();
  if (now - lastProxyErrorRecoverAt < 15000) return;
  lastProxyErrorRecoverAt = now;
  chrome.storage.local.get("proxy").then(({ proxy }) => {
    if (proxy && proxy.enabled) {
      recoverFromProxyChange("Proxy error: " + error).catch(() => {});
    }
  });
}, { urls: ["<all_urls>"] });

async function proxySettingsSnapshot() {
  try {
    const current = await chrome.proxy.settings.get({});
    return {
      mode: (current && current.value && current.value.mode) || "",
      levelOfControl: (current && current.levelOfControl) || ""
    };
  } catch (e) {
    return { mode: "", levelOfControl: "" };
  }
}

async function applyProxy() {
  const stored = await chrome.storage.local.get("proxy");
  const proxy = { ...DEFAULTS.proxy, ...(stored.proxy || {}) };

  if (!proxy.enabled) {
    await chrome.proxy.settings.set({ value: { mode: "direct" }, scope: "regular" });
    const snap = await proxySettingsSnapshot();
    return { enabled: false, mode: snap.mode, levelOfControl: snap.levelOfControl };
  }

  const parsed = parseCustomProxyUrl(proxy.customUrl);
  if (!parsed) throw new Error("Invalid proxy URL");
  if (parsed.username) {
    proxyAuthCache = { username: parsed.username, password: parsed.password };
  }

  const config = {
    mode: "fixed_servers",
    rules: {
      singleProxy: {
        scheme: parsed.scheme,
        host: parsed.host,
        port: parsed.port
      },
      bypassList: [
        "<local>"
      ]
    }
  };
  await chrome.proxy.settings.set({ value: config, scope: "regular" });
  const snap = await proxySettingsSnapshot();
  return {
    enabled: true,
    scheme: parsed.scheme,
    host: parsed.host,
    port: parsed.port,
    mode: snap.mode,
    levelOfControl: snap.levelOfControl
  };
}

async function setDirectForOauth() {
  try {
    const stored = await chrome.storage.local.get("proxy");
    if (stored.proxy && stored.proxy.enabled) {
      await applyProxy();
      return;
    }
    await chrome.proxy.settings.set({ value: { mode: "direct" }, scope: "regular" });
  } catch (e) {}
}

async function fetchProxyInfo() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch("https://ipinfo.io/json?ts=" + Date.now(), {
      cache: "no-store",
      signal: controller.signal
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    return {
      ip: String(data.ip || ""),
      city: data.city || "",
      region: data.region || "",
      country: data.country || "",
      org: data.org || ""
    };
  } finally {
    clearTimeout(timer);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.proxy) return;
  const oldValue = changes.proxy.oldValue || {};
  const newValue = changes.proxy.newValue || {};
  if (!!oldValue.enabled !== !!newValue.enabled ||
      oldValue.customUrl !== newValue.customUrl) {
    applyProxy().catch(() => {});
  }
});

function stuckTimeoutMs(config) {
  const minutes = Number(config && config.stuckMinutes);
  return Math.max(3, Math.min(60, minutes || 3)) * 60000;
}

async function noteActivity(reason) {
  const stored = await chrome.storage.local.get(["config", "accountStartedAt"]);
  const config = stored.config || {};
  if (config.live === false || !stored.accountStartedAt) return;
  const now = Date.now();
  const timeoutAt = now + stuckTimeoutMs(config);
  await chrome.storage.local.set({
    lastActivityAt: now,
    accountTimeoutAt: timeoutAt
  });
  await scheduleAccountTimeout(timeoutAt);
}

async function rearmStuckTimer() {
  const stored = await chrome.storage.local.get([
    "config", "accountStartedAt", "lastActivityAt"
  ]);
  const config = stored.config || {};
  if (config.live === false) {
    await clearAccountTimeout();
    return;
  }
  if (!stored.accountStartedAt) return;
  const base = Number(stored.lastActivityAt) || Date.now();
  const timeoutAt = base + stuckTimeoutMs(config);
  if (Date.now() >= timeoutAt) {
    handleAccountStuck().catch(() => {});
    return;
  }
  await chrome.storage.local.set({ accountTimeoutAt: timeoutAt });
  await scheduleAccountTimeout(timeoutAt);
}

async function scheduleAccountTimeout(when) {
  try { await chrome.alarms.clear(ACCOUNT_TIMEOUT_ALARM); } catch (e) {}
  if (!when) return;
  try {
    await chrome.alarms.create(ACCOUNT_TIMEOUT_ALARM, {
      when: Math.max(Date.now() + 500, Number(when))
    });
  } catch (e) {}
}

async function clearAccountTimeout() {
  try { await chrome.alarms.clear(ACCOUNT_TIMEOUT_ALARM); } catch (e) {}
  await chrome.storage.local.set({ accountStartedAt: 0, lastActivityAt: 0, accountTimeoutAt: 0 });
}

async function reconcileAccountTimeout() {
  const stored = await chrome.storage.local.get(["config", "accountStartedAt", "accountTimeoutAt"]);
  const config = stored.config || {};
  if (config.live === false || !stored.accountStartedAt) {
    try { await chrome.alarms.clear(ACCOUNT_TIMEOUT_ALARM); } catch (e) {}
    return;
  }
  const base = Number(stored.lastActivityAt) || Number(stored.accountStartedAt);
  const timeoutAt = Number(stored.accountTimeoutAt) || (base + stuckTimeoutMs(config));
  if (Date.now() >= timeoutAt) {
    handleAccountStuck().catch(() => {});
  } else {
    await scheduleAccountTimeout(timeoutAt);
  }
}

let stuckHandling = false;
let proxyRecovering = false;
let lastProxyErrorRecoverAt = 0;

async function handleAccountStuck() {
  return await doctorCheck();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ACCOUNT_TIMEOUT_ALARM) {
    handleAccountStuck().catch(() => {});
  } else if (alarm.name === PROXY_WATCH_ALARM) {
    checkProxyHealth().catch(() => {});
  } else if (alarm.name === FLOW_WATCH_ALARM) {
    ensureFlowAlive().catch(() => {});
    doctorCheck().catch(() => {});
  } else if (alarm.name === DOCTOR_ALARM) {
    doctorCheck().catch(() => {});
  } else if (alarm.name === SHEET_SYNC_ALARM) {
    syncSheetEmails().catch(() => {});
  }
});

async function createProxyHoldTab() {
  let tab = null;
  try { tab = await chrome.tabs.create({ url: "about:blank", active: true }); } catch (e) {}
  if (!tab) {
    try { tab = await chrome.tabs.create({ active: true }); } catch (e) {}
  }
  if (tab && tab.id) {
    try {
      const tabs = await chrome.tabs.query({});
      for (const item of tabs) {
        if (item.id !== tab.id && isFlowTab(item.url)) {
          try { await chrome.tabs.remove(item.id); } catch (e) {}
        }
      }
    } catch (e) {}
  }
  return tab;
}

async function waitForProxyHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const info = await fetchProxyInfo();
      if (info && info.ip) return info;
    } catch (e) {}
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

async function recoverFromProxyChange(reason) {
  if (proxyRecovering || stuckHandling) return;
  const stored = await chrome.storage.local.get([
    "config", "proxy", "proxyHold", "accountStartedAt",
    "interns", "currentIndex", "oauthCompletedEmail", "oauthApiResult"
  ]);
  const config = stored.config || {};
  if (config.live === false) return;
  if (!stored.proxy || !stored.proxy.enabled) return;
  if (!stored.accountStartedAt && !stored.proxyHold) return;
  if (stored.oauthCompletedEmail) return;
  if (stored.oauthApiResult === "pending") return;

  const current = (stored.interns || [])[Number(stored.currentIndex) || 0];
  if (current && current.status === "done") return;

  proxyRecovering = true;
  try {
    await chrome.storage.local.set({
      proxyHold: true,
      proxyRecovering: true,
      lastProxyError: String(reason || "Proxy changed"),
      proxyRecoveryStartedAt: Date.now()
    });
    await clearAccountTimeout();
    try { await clearGcpCookies(); } catch (e) {}
    const hold = await createProxyHoldTab();
    await clearExtensionFlowData();

    const info = await waitForProxyHealth(PROXY_RECOVERY_TIMEOUT_MS);
    const latest = await chrome.storage.local.get(["proxyHold", "proxyRecovering"]);
    if (!latest.proxyHold || !latest.proxyRecovering) return;
    if (!info) {
      await chrome.storage.local.set({
        proxyHold: true,
        proxyRecovering: false,
        lastProxyError: "Proxy unreachable. Paused until the proxy is healthy."
      });
      return;
    }

    await chrome.storage.local.set({
      proxyHold: false,
      proxyRecovering: false,
      proxyEgressIp: info.ip,
      proxyHealthyAt: Date.now(),
      proxyFailAt: 0,
      lastProxyError: null
    });
    const res = await prepareLiveAccount(hold && hold.id);
    if (!res || !res.ok) {
      await chrome.storage.local.set({
        lastLiveError: (res && res.error) || "Could not restart after proxy change."
      });
    }
  } finally {
    proxyRecovering = false;
    const state = await chrome.storage.local.get("proxyRecovering");
    if (state.proxyRecovering && !proxyRecovering) {
      await chrome.storage.local.set({ proxyRecovering: false });
    }
  }
}

async function checkProxyHealth() {
  if (proxyRecovering) return;
  const stored = await chrome.storage.local.get([
    "config", "proxy", "proxyHold", "accountStartedAt",
    "proxyEgressIp", "proxyFailAt", "oauthStartEmail", "oauthAuthUrl", "oauthStartPending"
  ]);
  const config = stored.config || {};
  if (!stored.proxy || !stored.proxy.enabled || config.live === false) return;

  if (stored.proxyHold) {
    if (stored.oauthStartEmail || stored.oauthAuthUrl || stored.oauthStartPending) {
      await chrome.storage.local.set({
        proxyHold: false,
        proxyRecovering: false,
        proxyFailAt: 0,
        lastProxyError: null
      });
      return;
    }
    if (proxyRecovering) return;
    try {
      const info = await waitForProxyHealth(10000);
      if (!info || !info.ip) return;
      await chrome.storage.local.set({
        proxyHold: false,
        proxyRecovering: false,
        proxyEgressIp: info.ip,
        proxyHealthyAt: Date.now(),
        proxyFailAt: 0,
        lastProxyError: null
      });
      const tabs = await chrome.tabs.query({});
      const blank = tabs.find((tab) => !tab.url || tab.url === "about:blank");
      const res = await prepareLiveAccount(blank && blank.id);
      if (!res || !res.ok) {
        await chrome.storage.local.set({
          lastLiveError: (res && res.error) || "Could not resume after proxy recovery."
        });
      }
    } catch (e) {}
    return;
  }

  if (stored.oauthStartEmail || stored.oauthAuthUrl || stored.oauthStartPending) return;

  try {
    const info = await fetchProxyInfo();
    if (!info || !info.ip) throw new Error("No proxy IP returned");
    if (stored.proxyEgressIp && info.ip !== stored.proxyEgressIp) {
      await chrome.storage.local.set({ proxyEgressIp: info.ip, proxyFailAt: 0 });
      await recoverFromProxyChange("Proxy IP changed to " + info.ip);
      return;
    }
    await chrome.storage.local.set({
      proxyEgressIp: info.ip,
      proxyHealthyAt: Date.now(),
      proxyFailAt: 0
    });
  } catch (e) {
    const now = Date.now();
    const failAt = Number(stored.proxyFailAt) || 0;
    if (!failAt) {
      await chrome.storage.local.set({ proxyFailAt: now });
      return;
    }
    if (now - failAt < 8000) return;
    await recoverFromProxyChange("Proxy unreachable: " + String((e && e.message) || e));
  }
}

function startLiveRun() {
  return prepareLiveAccount();
}

let preparePromise = null;
let flowTransition = false;

function prepareLiveAccount(preferredTabId) {
  if (preparePromise) return preparePromise;
  preparePromise = doPrepareLiveAccount(preferredTabId).finally(() => { preparePromise = null; });
  return preparePromise;
}

let flowOwnerTabId = null;

function sameEmail(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

async function currentFlowOwner() {
  if (flowOwnerTabId) {
    try {
      await chrome.tabs.get(flowOwnerTabId);
      return flowOwnerTabId;
    } catch (e) { flowOwnerTabId = null; }
  }
  try {
    const session = await chrome.storage.session.get("flowOwnerTabId");
    if (session.flowOwnerTabId) {
      await chrome.tabs.get(session.flowOwnerTabId);
      flowOwnerTabId = session.flowOwnerTabId;
      return flowOwnerTabId;
    }
  } catch (e) { flowOwnerTabId = null; }
  return null;
}

async function claimFlowOwner(tabId) {
  if (!tabId) return null;
  flowOwnerTabId = tabId;
  try { await chrome.storage.session.set({ flowOwnerTabId: tabId }); } catch (e) {}
  await collapseFlowTabs(tabId);
  return tabId;
}

async function enforceSingleFlowTab(updatedId, url) {
  if (!updatedId || flowTransition || preparePromise) return;
  if (/oauth-callback/i.test(String(url || ""))) {
    await claimFlowOwner(updatedId);
    return;
  }
  const owner = await currentFlowOwner();
  if (!owner) {
    await claimFlowOwner(updatedId);
    return;
  }
  if (updatedId === owner) return;
  try {
    const ownerTab = await chrome.tabs.get(owner);
    const ownerUrl = ownerTab.url || ownerTab.pendingUrl || "";
    if (isFlowTab(ownerUrl)) {
      try { await chrome.tabs.remove(updatedId); } catch (e) {}
      return;
    }
  } catch (e) {}
  await claimFlowOwner(updatedId);
}

async function ensureFlowAlive() {
  const stored = await chrome.storage.local.get([
    "config", "proxyHold", "proxyRecovering", "proxyRecoveryStartedAt",
    "oauthStartPending", "oauthApiResult"
  ]);
  const config = stored.config || {};
  if (config.live === false) return;
  if (stored.proxyRecovering && !stored.proxyHold) return;
  if (stored.captchaWaiting) {
    await chrome.storage.local.set({
      lastActivityAt: Date.now(),
      accountTimeoutAt: Date.now() + 30 * 60 * 1000
    });
    await scheduleAccountTimeout(Date.now() + 30 * 60 * 1000);
    return { action: "wait", reason: "captcha", email: stored.captchaEmail || "" };
  }

  if (stored.proxyHold) {
    const holdAt = Number(stored.proxyRecoveryStartedAt) || 0;
    if (holdAt && Date.now() - holdAt < 30000) return;
    await chrome.storage.local.set({
      proxyHold: false,
      proxyRecovering: false,
      proxyFailAt: 0,
      lastProxyError: null
    });
  }
  if (stored.oauthStartPending || stored.oauthApiResult === "pending" ||
      flowTransition || preparePromise) return;

  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (e) { return; }
  const flowTabs = tabs.filter((tab) => isFlowTab(tab.url) || isFlowTab(tab.pendingUrl));
  if (flowTabs.length > 1) {
    await collapseFlowTabs();
    return;
  }
  if (flowTabs.length === 1) {
    await trimExtraneousTabs(flowTabs[0].id);
    return;
  }

  const blanks = tabs.filter((tab) =>
    tab.url === "about:blank" || (!tab.url && !tab.pendingUrl)
  );
  const keep = blanks.find((tab) => tab.active) || blanks[0] || null;
  for (const tab of blanks) {
    if (keep && tab.id !== keep.id) {
      try { await chrome.tabs.remove(tab.id); } catch (e) {}
    }
  }
  try {
    const res = await prepareLiveAccount(keep && keep.id);
    if (!res || !res.ok) syncSheetEmails().catch(() => {});
  } catch (e) {
    syncSheetEmails().catch(() => {});
  }
}

function decideDoctorAction(input) {
  const now = Number(input.now) || Date.now();
  if (!input.live) return { action: "idle", reason: "live off" };
  if (input.proxyHold || input.proxyRecovering) return { action: "wait", reason: "proxy" };
  if (input.preparing || input.pendingOauthStart || input.pendingApi) {
    return { action: "wait", reason: "transition" };
  }
  const doctor = input.doctorState;
  const graceMs = Number(input.graceMs) || DOCTOR_GRACE_MS;
  if (doctor && doctor.stage === "refresh") {
    const currentUrl = String(input.currentUrl || "");
    const doctorUrl = String(doctor.url || "");
    if (currentUrl && doctorUrl && currentUrl !== doctorUrl) {
      return { action: "clear", reason: "page changed after refresh" };
    }
    if (now - Number(doctor.at) < graceMs) {
      return { action: "wait", reason: "doctor grace" };
    }
    return { action: "escalate", reason: "refresh did not help" };
  }
  if (!input.hasFlow) return { action: "start", reason: "no flow" };
  const stuckMs = Number(input.stuckMs) || 150000;
  if (now - Number(input.lastActivityAt) < stuckMs) {
    return { action: "idle", reason: "progress" };
  }
  return { action: "refresh", reason: "stuck" };
}

function doctorPhase(url) {
  const value = String(url || "");
  if (/accounts\.google\.com\/(o\/oauth2|signin\/oauth|AccountChooser)/i.test(value) ||
      /antigravity\.google/i.test(value)) return "oauth";
  if (/accounts\.google\.com\/AddSession|accounts\.cloud\.google\.com|accounts\.google\.com/i.test(value)) {
    return "login";
  }
  return "other";
}

async function doctorStartRefresh(tabs, stored) {
  const tab = tabs.find((item) => item.active && isFlowTab(item.url)) ||
    tabs.find((item) => isFlowTab(item.url));
  if (!tab || !tab.id) {
    await ensureFlowAlive();
    return { action: "start", reason: "no flow" };
  }
  const intern = (stored.interns || [])[Number(stored.currentIndex) || 0];
  await chrome.storage.local.set({
    doctorState: {
      stage: "refresh",
      at: Date.now(),
      email: intern ? intern.email : "",
      url: tab.url || "",
      tabId: tab.id
    },
    doctorStatus: "Refreshing stuck page..."
  });
  try {
    await chrome.tabs.reload(tab.id);
  } catch (e) {
    await chrome.storage.local.set({ doctorStatus: "Refresh failed: " + String(e) });
  }
  try {
    await chrome.alarms.create(DOCTOR_ALARM, { when: Date.now() + DOCTOR_GRACE_MS });
  } catch (e) {}
  return { action: "refresh" };
}

async function doctorRestartNewEmail(stored) {
  const interns = Array.isArray(stored.interns) ? stored.interns.slice() : [];
  const idx = Number(stored.currentIndex) || 0;
  if (interns[idx]) {
    interns[idx] = {
      ...interns[idx],
      status: "failed",
      note: "Doctor: stuck page after refresh"
    };
    await chrome.storage.local.set({ interns });
  }
  await chrome.storage.local.set({ doctorStatus: "Refreshing did not help; starting the next email..." });
  if (interns[idx] && interns[idx].email) {
    await markSheetRejected(interns[idx].email, "stuck page after refresh");
  }
  await resetAndRestart();
}

async function doctorEscalate(tabs, stored) {
  const doctor = stored.doctorState || {};
  const tab = tabs.find((item) => item.id === doctor.tabId) ||
    tabs.find((item) => item.active && isFlowTab(item.url)) ||
    tabs.find((item) => isFlowTab(item.url));
  const intern = (stored.interns || [])[Number(stored.currentIndex) || 0];
  const email = String((intern && intern.email) || doctor.email || "");
  const phase = doctorPhase((tab && tab.url) || doctor.url || "");

  await chrome.storage.local.set({ doctorState: null });

  if (phase === "billing" || phase === "oauth") {
    await chrome.storage.local.set({ doctorStatus: "Retrying OAuth for the same account..." });
    try {
      const oauth = await chrome.storage.local.get(["oauthAuthUrl", "oauthStartEmail"]);
      if (oauth.oauthAuthUrl) {
        await openStoredOauthTab(tab && tab.id);
      } else if (email) {
        await startOauth(email, tab && tab.id);
      } else {
        await resetAndRestart();
      }
    } catch (e) {
      await chrome.storage.local.set({ doctorStatus: "OAuth retry failed: " + String(e) });
    }
    return { action: "oauth-retry" };
  }

  await doctorRestartNewEmail(stored);
  return { action: "new-email" };
}

let doctorBusy = false;

async function doctorCheck() {
  if (doctorBusy) return { action: "busy" };
  doctorBusy = true;
  try {
    return await doDoctorCheck();
  } finally {
    doctorBusy = false;
  }
}

async function doDoctorCheck() {
  const stored = await chrome.storage.local.get([
    "config", "proxyHold", "proxyRecovering", "proxyRecoveryStartedAt",
    "accountStartedAt", "lastActivityAt",
    "oauthStartPending", "oauthStartPendingAt", "oauthApiResult", "oauthPendingAt",
    "doctorState", "billingReached", "captchaWaiting", "captchaEmail", "interns", "currentIndex"
  ]);
  const config = stored.config || {};
  if (config.live === false) {
    await clearAccountTimeout();
    return { action: "idle", reason: "live off" };
  }

  if (stored.proxyHold) {
    const holdAt = Number(stored.proxyRecoveryStartedAt) || 0;
    if (!holdAt || Date.now() - holdAt > 60000) {
      await chrome.storage.local.set({
        proxyHold: false,
        proxyRecovering: false,
        proxyFailAt: 0,
        lastProxyError: null
      });
      stored.proxyHold = false;
      stored.proxyRecovering = false;
    }
  }

  if (stored.oauthStartPending) {
    const at = Number(stored.oauthStartPendingAt) || 0;
    if (at && Date.now() - at < 120000) return { action: "wait", reason: "oauth start" };
    await chrome.storage.local.set({ oauthStartPending: false, oauthStartPendingAt: 0 });
  }
  if (stored.oauthApiResult === "pending") {
    const at = Number(stored.oauthPendingAt) || 0;
    if (at && Date.now() - at < 180000) return { action: "wait", reason: "oauth api" };
    await chrome.storage.local.set({
      oauthApiResult: "rejected",
      oauthApiMessage: "Code submission stopped responding."
    });
  }

  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (e) {}
  const hasFlow = tabs.some((tab) => isFlowTab(tab.url) || isFlowTab(tab.pendingUrl));
  const currentFlow = tabs.find((tab) => tab.active && isFlowTab(tab.url)) ||
    tabs.find((tab) => isFlowTab(tab.url));
  const decision = decideDoctorAction({
    live: true,
    proxyHold: !!stored.proxyHold,
    proxyRecovering: !!stored.proxyRecovering,
    preparing: !!preparePromise || flowTransition,
    hasFlow,
    currentUrl: (currentFlow && currentFlow.url) || "",
    lastActivityAt: Number(stored.lastActivityAt) || 0,
    now: Date.now(),
    stuckMs: stuckTimeoutMs(config),
    graceMs: DOCTOR_GRACE_MS,
    doctorState: stored.doctorState || null
  });

  if (decision.action === "refresh") return doctorStartRefresh(tabs, stored);
  if (decision.action === "escalate") return doctorEscalate(tabs, stored);
  if (decision.action === "start") {
    await ensureFlowAlive();
    return decision;
  }
  if (decision.action === "clear") {
    await chrome.storage.local.set({ doctorState: null, doctorStatus: "Recovered after refresh." });
    return decision;
  }
  return decision;
}


async function cleanupResidueTabs(preferredTabId) {
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (e) { return preferredTabId || null; }

  // Keep exactly one tab. Prefer the requested tab, then the active flow tab,
  // then any flow tab, then the active tab, then the first tab.
  let keep = tabs.find((tab) => tab.id === preferredTabId) ||
    tabs.find((tab) => tab.active && isFlowTab(tab.url)) ||
    tabs.find((tab) => isFlowTab(tab.url) || isFlowTab(tab.pendingUrl)) ||
    tabs.find((tab) => tab.active) ||
    tabs[0] || null;
  if (!keep) {
    try { keep = await chrome.tabs.create({ url: "about:blank", active: true }); } catch (e) {}
  }

  if (keep) {
    for (const tab of tabs) {
      if (tab.id === keep.id) continue;
      try { await chrome.tabs.remove(tab.id); } catch (e) {}
    }
  }
  return keep && keep.id ? keep.id : null;
}

// Prepare the next existing email, reset login/OAuth state, and open AddSession.
async function doPrepareLiveAccount(preferredTabId) {
  const stored = await chrome.storage.local.get(["config", "apiKey", "interns", "currentIndex"]);
  const config = stored.config || {};
  if (config.live === false) return { ok: false, error: "Live is stopped." };

  preferredTabId = await cleanupResidueTabs(preferredTabId);
  if (preferredTabId) await claimFlowOwner(preferredTabId);

  if (!String(stored.apiKey || "").trim()) {
    await chrome.storage.local.set({ apiKey: DEFAULT_API_KEY });
  }

  await loadIgnoredEmails();
  const interns = Array.isArray(stored.interns) ? stored.interns : [];
  let ignoredChanged = false;
  interns.forEach((item, ix) => {
    const emailKey = String(item.email || "").trim().toLowerCase();
    const marked = isIgnoredTestEmail(item.email);
    const userMarked = ignoredEmailSet.has(emailKey);
    if (marked && item.status !== "done" && item.status !== "ignored") {
      interns[ix] = {
        ...item,
        status: "ignored",
        note: userMarked ? "Ignored by user" : "Ignored test email"
      };
      ignoredChanged = true;
    } else if (!marked && item.status === "ignored" && item.note === "Ignored by user") {
      interns[ix] = { ...item, status: "pending", note: "" };
      ignoredChanged = true;
    }
  });
  if (ignoredChanged) await chrome.storage.local.set({ interns });
  // Resume the current email if the flow tab vanished during navigation.
  // Never pick a different pending email while another is still in progress.
  const storedCurrentIndex = Number.isInteger(stored.currentIndex) ? stored.currentIndex : 0;
  const currentIntern = interns[storedCurrentIndex];
  const resumeCurrent = currentIntern &&
    (currentIntern.status === "in_progress" || currentIntern.status === "pending");
  const idx = resumeCurrent
    ? storedCurrentIndex
    : interns.findIndex((i) => i.status === "pending");
  if (idx < 0) {
    return { ok: false, error: "Add login emails or reset the list to start again." };
  }

  const email = interns[idx].email;
  interns[idx] = { ...interns[idx], status: "in_progress", note: "Logging in" };
  for (let i = 0; i < interns.length; i++) {
    if (i !== idx && interns[i].status === "in_progress") {
      interns[i] = {
        ...interns[i],
        status: "pending",
        note: "Reset stale parallel flow"
      };
    }
  }
  const accountStartedAt = Date.now();

  await chrome.storage.local.set({
    interns,
    currentIndex: idx,
    accountStartedAt,
    lastActivityAt: accountStartedAt,
    accountTimeoutAt: accountStartedAt + stuckTimeoutMs(config),
    agOauthEmail: email,
    agLoginEmail: email,
    agLoginStartedAt: new Date().toISOString(),
    loginReadyEmail: null,
    oauthStartEmail: null,
    oauthAuthUrl: null,
    oauthState: null,
    oauthCodeVerifier: null,
    oauthStartPending: false,
    oauthStartPendingAt: 0,
    oauthStartAt: 0,
    oauthPickedEmail: null,
    oauthConsentEmail: null,
    oauthApprovedEmail: null,
    oauthCallbackCode: null,
    oauthCompletedEmail: null,
    oauthOpenEmail: null,
    lastLiveError: null,
    proxyHold: false,
    proxyRecovering: false,
    doctorState: null,
    doctorStatus: "",
    invalidRequestStreak: 0,
    invalidRequestPaused: false
  });

  markSheetPicked(email).catch(() => {});
  try { await clearGcpCookies(); } catch (e) {}
  try { await applyProxy(); } catch (e) {}

  // New flow: request the OAuth URL first, then let Google's login screens
  // authenticate the email/OTP inside that OAuth flow. When login completes,
  // the same flow proceeds to consent and the final API code submission.
  let oauthStarted = false;
  try {
    const oauth = await startOauth(email, preferredTabId);
    oauthStarted = !!(oauth && oauth.ok);
    if (!oauthStarted) console.warn('OAuth-first start failed:', oauth && oauth.error);
  } catch (e) {
    console.warn('OAuth-first start error:', String((e && e.message) || e));
  }
  if (!oauthStarted) await openLoginTab(preferredTabId);
  await scheduleAccountTimeout(accountStartedAt + stuckTimeoutMs(config));
  return { ok: true, email, oauthFirst: oauthStarted };
}

async function openLoginTab(preferredTabId) {
  if (preferredTabId) {
    try {
      await chrome.tabs.update(preferredTabId, { url: LOGIN_URL, active: true });
      await claimFlowOwner(preferredTabId);
      return { id: preferredTabId };
    } catch (e) {}
  }

  let tab = null;
  try {
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find((t) => t.url && t.url.startsWith(LOGIN_URL));
    if (existing && existing.id) {
      try {
        await chrome.tabs.update(existing.id, { url: LOGIN_URL, active: true });
        await claimFlowOwner(existing.id);
        tab = existing;
      } catch (e) {}
    }
  } catch (e) {}

  if (!tab) {
    try { tab = await chrome.tabs.create({ url: LOGIN_URL, active: true }); } catch (e) {}
  }
  if (tab && tab.id) await claimFlowOwner(tab.id);
  return tab;
}

function isExtraneousTab(url) {
  const u = String(url || "");
  if (!u || u === "about:blank") return true;
  if (u.startsWith("chrome://newtab")) return true;
  if (u.startsWith("chrome://new-tab-page")) return true;
  if (/^chrome-extension:\/\/[a-p]{32}\/popup\.html/.test(u)) return true;
  return false;
}

// Close leftover blank/new-tab/popup tabs so the login browser stays at one tab.
async function trimExtraneousTabs(keepId) {
  if (flowTransition || preparePromise) return;
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (e) { return; }
  if (tabs.length <= 1) return;
  for (const tab of tabs) {
    if (tab.id === keepId) continue;
    if (!isExtraneousTab(tab.url || tab.pendingUrl || "")) continue;
    try { await chrome.tabs.remove(tab.id); } catch (e) {}
  }
}

async function closeAllExcept(tabId) {
  try {
    const tabs = await chrome.tabs.query({});
    if (!tabs.some((tab) => tab.id === tabId)) return;
    for (const tab of tabs) {
      if (tab.id !== tabId) {
        try { await chrome.tabs.remove(tab.id); } catch (e) {}
      }
    }
  } catch (e) {}
}

async function collapseFlowTabs(keepId) {
  try {
    const tabs = await chrome.tabs.query({});
    const flow = tabs.filter((tab) => isFlowTab(tab.url) || isFlowTab(tab.pendingUrl));
    if (flow.length <= 1) return;
    const keep = (keepId && flow.find((tab) => tab.id === keepId)) ||
      flow.find((tab) => tab.active) ||
      flow[flow.length - 1];
    for (const tab of flow) {
      if (keep && tab.id === keep.id) continue;
      try { await chrome.tabs.remove(tab.id); } catch (e) {}
    }
  } catch (e) {}
}

async function clearExtensionFlowData() {
  await chrome.storage.local.set({
    invalidRequestStreak: 0,
    invalidRequestPaused: false,
    doctorState: null,
    doctorStatus: ""
  });
  await chrome.storage.local.remove([
    "agOauthEmail",
    "agLoginEmail",
    "agLoginStartedAt",
    "loginReadyEmail",
    "oauthStartEmail",
    "oauthAuthUrl",
    "oauthState",
    "oauthCodeVerifier",
    "oauthStartPending",
    "oauthStartPendingAt",
    "oauthPickedEmail",
    "oauthConsentEmail",
    "oauthApprovedEmail",
    "oauthCallbackCode",
    "oauthCompletedEmail",
    "oauthOpenEmail",
    "lastOauthCode",
    "lastOauthCodeEmail",
    "lastOauthCodeAt",
    "oauthApiResult",
    "oauthApiMessage",
    "lastOauthApiStatus",
    "lastOauthApiError",
    "autoContinueEmail",
    "autoContinueAt",
    "oauthStartAt",
    "oauthCompletedAt"
  ]);
}

async function prepareInFreshTab() {
  let newTab = null;
  try { newTab = await chrome.tabs.create({ url: "about:blank", active: true }); } catch (e) {}
  if (!newTab) {
    try { newTab = await chrome.tabs.create({ active: true }); } catch (e) {}
  }

  if (newTab && newTab.id) {
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id !== newTab.id && isFlowTab(tab.url)) {
          try { await chrome.tabs.remove(tab.id); } catch (e) {}
        }
      }
    } catch (e) {}
    return await prepareLiveAccount(newTab.id);
  }

  return await prepareLiveAccount();
}

async function restartLiveFlow() {
  if (flowTransition) return;
  flowTransition = true;
  try {
    return await doRestartLiveFlow();
  } finally {
    flowTransition = false;
  }
}

async function doRestartLiveFlow() {
  const stored = await chrome.storage.local.get("config");
  const config = stored.config || {};
  await chrome.storage.local.set({ config: { ...config, live: true, autoRun: true } });

  if (preparePromise) {
    try { await preparePromise; } catch (e) {}
  }

  await clearAccountTimeout();
  await chrome.storage.local.set({
    proxyHold: false,
    proxyRecovering: false,
    lastProxyError: null,
    proxyFailAt: 0
  });
  await clearExtensionFlowData();
  try { await clearGcpCookies(); } catch (e) {}
  return await prepareInFreshTab();
}

async function resetExtensionFlow() {
  const stored = await chrome.storage.local.get(["config", "interns"]);
  const config = stored.config || {};
  const interns = Array.isArray(stored.interns)
    ? stored.interns.map((i) => ({ ...i, status: "pending", note: "" }))
    : [];
  await chrome.storage.local.set({
    config: { ...config, live: false, autoRun: false },
    interns,
    currentIndex: 0,
    proxyHold: false,
    proxyRecovering: false,
    lastProxyError: null,
    proxyFailAt: 0
  });
  await clearAccountTimeout();
  await clearExtensionFlowData();
  try { await clearGcpCookies(); } catch (e) {}
  return { ok: true };
}

function isFlowTab(url) {
  if (!url) return false;
  if (url.startsWith(LOGIN_URL)) return true;
  if (url.startsWith("https://console.cloud.google.com/")) return true;
  if (url.startsWith("https://accounts.google.com/")) return true;
  if (url.startsWith("https://accounts.google.com/") &&
      (url.includes("/signin") || url.includes("/o/oauth2") ||
       url.includes("/ServiceLogin") || url.includes("/AccountChooser") ||
       url.includes("/speedbump") || url.includes("/challenge") ||
       url.includes("/v3/signin"))) return true;
  if (url.startsWith("https://accounts.cloud.google.com/") &&
      (url.includes("/signup") || url.includes("/login") ||
       url.includes("verify") || url.includes("/challenge"))) return true;
  if (url.startsWith("https://antigravity.google/oauth-callback")) return true;
  return false;
}

// Progress signals reset the stuck timer. Only no-progress periods can time out.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "complete") return;
  const url = (tab && tab.url) || changeInfo.url || "";
  if (isFlowTab(url)) {
    noteActivity("tab").catch(() => {});
    enforceSingleFlowTab(tabId, url).catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes.config) {
    const oldConfig = changes.config.oldValue || {};
    const newConfig = changes.config.newValue || {};
    if (newConfig.live === false && oldConfig.live !== false) {
      clearAccountTimeout().catch(() => {});
    } else if (oldConfig.live !== newConfig.live ||
               oldConfig.stuckMinutes !== newConfig.stuckMinutes) {
      rearmStuckTimer().catch(() => {});
    }
  }

  if (changes.ignoredEmails) {
    loadIgnoredEmails().catch(() => {});
  }

  if (changes.interns || changes.oauthStartEmail || changes.oauthCallbackCode ||
      changes.oauthCompletedEmail || changes.oauthApiResult) {
    noteActivity("storage").catch(() => {});
  }
});

// Focus an existing flow; "auto" starts at most once per browser session.
async function ensureLive(start) {
  const stored = await chrome.storage.local.get("config");
  const config = stored.config || {};
  if (config.live === false) return { ok: false, error: "Live is stopped." };

  try {
    const tabs = await chrome.tabs.query({});
    const active = tabs.find((t) => t.active && isFlowTab(t.url));
    const flowTabs = tabs
      .filter((t) => isFlowTab(t.url))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    const existing = active || flowTabs[0];
    if (existing && existing.id) {
      try {
        await chrome.tabs.update(existing.id, { active: true });
        await markAutoStartHandled();
        if (start === true) {
          setTimeout(() => { trimExtraneousTabs(existing.id).catch(() => {}); }, 1500);
        }
        return { ok: true, focused: true };
      } catch (e) {}
    }
  } catch (e) {}

  if (start === false) {
    return { ok: false, focused: false, error: "No active flow tab." };
  }

  if (start === "auto") {
    try {
      const session = await chrome.storage.session.get("autoStartHandled");
      if (session.autoStartHandled) {
        return { ok: false, focused: false, error: "No active flow tab." };
      }
    } catch (e) {}
  }

  await markAutoStartHandled();
  await startLiveRun();
  return { ok: true, started: true };
}

async function markAutoStartHandled() {
  try { await chrome.storage.session.set({ autoStartHandled: true }); } catch (e) {}
}

let liveBootChecked = false;

// On a fresh browser/service-worker start: only start if Live is on AND no flow
// tab already exists. Never steal focus just because the worker woke up.
async function ensureLiveBoot() {
  if (liveBootChecked) return;
  liveBootChecked = true;

  const stored = await chrome.storage.local.get("config");
  const config = stored.config || {};
  if (config.live === false) return;

  // Give the browser a moment to restore previous tabs before deciding.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const tabs = await chrome.tabs.query({});
    if (tabs.some((t) => isFlowTab(t.url))) return;
  } catch (e) {}

  await markAutoStartHandled();
  await startLiveRun();
}

async function apiRequest(path, payload, timeoutMs) {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  const key = String(apiKey || "").trim() || DEFAULT_API_KEY;
  if (!key) throw new Error("Add the API key in the popup.");

  const headers = { Authorization: "Bearer " + key };
  if (payload) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timeout = timeoutMs || API_TIMEOUT;
  const timer = setTimeout(() => controller.abort(new Error("Request timed out after " + timeout + "ms")), timeout);
  try {
    const endpoint = API_BASE.replace(/\/+$/, "") + "/" + String(path).replace(/^\/+/, "");
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) {
      const detail = (data && (data.detail || data.error_description || data.error)) ||
        text.slice(0, 220) || ("HTTP " + res.status);
      const error = new Error("HTTP " + res.status + ": " + detail);
      error.httpStatus = res.status;
      error.responseText = text;
      error.responseData = data;
      throw error;
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

let startOauthPromise = null;

function startOauth(email, tabId) {
  if (startOauthPromise) return startOauthPromise;
  startOauthPromise = doStartOauth(email, tabId).finally(() => { startOauthPromise = null; });
  return startOauthPromise;
}

async function openOauthUrl(url, tabId) {
  if (tabId) {
    try {
      await chrome.tabs.update(tabId, { url, active: true });
      await claimFlowOwner(tabId);
      return tabId;
    } catch (e) {}
  }
  let created = null;
  try { created = await chrome.tabs.create({ url, active: true }); } catch (e) {}
  if (created && created.id) await claimFlowOwner(created.id);
  return created && created.id;
}

async function doStartOauth(email, tabId) {
  const stored = await chrome.storage.local.get([
    "oauthStartEmail", "oauthAuthUrl", "oauthState", "oauthCodeVerifier"
  ]);
  // Never request a second OAuth token for the same account.
  if (stored.oauthStartEmail === email) {
    if (stored.oauthAuthUrl && stored.oauthState && stored.oauthCodeVerifier) {
      await setDirectForOauth();
      await openOauthUrl(stored.oauthAuthUrl, tabId);
      return { ok: true, reused: true };
    }
    return { ok: false, error: "OAuth already started for this account." };
  }

  await chrome.storage.local.set({ oauthStartPending: true, oauthStartPendingAt: Date.now() });
  try {
    const { status, data } = await apiRequest("/api/accounts/oauth/start");
    const authUrl = data && data.auth_url;
    const state = data && data.state;
    const codeVerifier = data && data.code_verifier;
    if (!authUrl || !state || !codeVerifier) {
      throw new Error("API did not return auth_url/state/code_verifier.");
    }

    await chrome.storage.local.set({
      agOauthEmail: email,
      oauthStartEmail: email,
      oauthAuthUrl: authUrl,
      oauthState: state,
      oauthCodeVerifier: codeVerifier,
      oauthStartAt: Date.now(),
      oauthPickedEmail: null,
      oauthConsentEmail: null,
      oauthApprovedEmail: null,
      oauthCallbackCode: null,
      oauthCompletedEmail: null,
      oauthOpenEmail: null,
      lastOauthApiStatus: status
    });

    await setDirectForOauth();
    await openOauthUrl(authUrl, tabId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    await chrome.storage.local.set({ oauthStartPending: false, oauthStartPendingAt: 0 });
  }
}

async function openStoredOauthTab(tabId) {
  const { oauthAuthUrl } = await chrome.storage.local.get("oauthAuthUrl");
  const url = String(oauthAuthUrl || "").trim();
  if (!url) return { ok: false, error: "No OAuth link yet. Start an account first." };

  await setDirectForOauth();

  let targetId = tabId;
  if (!targetId) {
    try {
      const tabs = await chrome.tabs.query({});
      const active = tabs.find((t) => t.active && isFlowTab(t.url));
      const recent = tabs
        .filter((t) => isFlowTab(t.url))
        .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
      const flow = active || recent;
      targetId = flow && flow.id;
    } catch (e) {}
  }

  await openOauthUrl(url, targetId);
  return { ok: true };
}

async function postToSheetWebhook(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: controller.signal
    });
    const accepted = res.type === "opaqueredirect" ||
      res.status === 0 ||
      res.status === 302 ||
      (res.status >= 200 && res.status < 300);
    if (!accepted) throw new Error("HTTP " + res.status);
  } finally {
    clearTimeout(timer);
  }
}

async function pushOauthCodeToSheet(entry) {
  // The current sheet stores one row per email (no per-code rows), so interim
  // code/result updates are intentionally not written. Only picked / rejected /
  // completed transitions are sent.
  return;
}

async function sheetAction(params) {
  const stored = await chrome.storage.local.get(["sheetWebhookUrl", "sheetToken"]);
  const base = String(stored.sheetWebhookUrl || DEFAULTS.sheetWebhookUrl || "").trim();
  const token = String(stored.sheetToken || DEFAULTS.sheetToken || "").trim();
  if (!base) return { ok: false, error: "No sheet URL" };

  async function parseResponse(res) {
    try {
      const text = await res.text();
      if (!text) return null;
      try { return JSON.parse(text); } catch (e) { return null; }
    } catch (e) {
      return null;
    }
  }

  // GET only for read-only actions; writes go straight to POST.
  const action = String(params.action || "").toLowerCase();
  const readOnly = ["list", "rows", "get", "health", "ping"].includes(action);
  if (readOnly) {
    try {
      const url = new URL(base);
      if (token) url.searchParams.set("key", token);
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000);
      try {
        const res = await fetch(url.toString(), { cache: "no-store", signal: controller.signal });
        const data = await parseResponse(res);
        if (data && data.ok !== false) return data;
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {}
  }

  // Fallback: POST action to the same webhook.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const body = { key: token, ...params };
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
        redirect: "follow",
        signal: controller.signal
      });
      const data = await parseResponse(res);
      if (data) return data;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {}

  return { ok: false, error: "Sheet request failed/timed out" };
}

let ignoredEmailSet = new Set();

async function loadIgnoredEmails() {
  const stored = await chrome.storage.local.get("ignoredEmails");
  ignoredEmailSet = new Set(
    (Array.isArray(stored.ignoredEmails) ? stored.ignoredEmails : [])
      .map((email) => String(email || "").trim().toLowerCase())
      .filter(Boolean)
  );
}

loadIgnoredEmails().catch(() => {});

function isIgnoredTestEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  if (!value.includes("@")) return true;
  if (ignoredEmailSet.has(value)) return true;
  const local = value.split("@")[0];
  if (/@example\.(com|org|net)$/i.test(value)) return true;
  if (/^billing-delete[-_.]/i.test(local)) return true;
  return /^(verify|passed[-_]?check|test|example|noreply|no[-_]?reply)([-_.].*)?$/.test(local) ||
    value === "test@example.com";
}

async function addPendingSheetEmail(email) {
  const value = String(email || "").trim();
  if (!value || isIgnoredTestEmail(value)) return false;
  const stored = await chrome.storage.local.get(["interns", "currentIndex"]);
  const interns = Array.isArray(stored.interns) ? stored.interns.slice() : [];
  const key = value.toLowerCase();
  const existingIdx = interns.findIndex((item) => String(item.email || "").toLowerCase() === key);
  if (existingIdx >= 0) {
    const status = interns[existingIdx].status;
    if (status === "done" || status === "pending" || status === "in_progress") return false;
    interns[existingIdx] = {
      ...interns[existingIdx],
      status: "pending",
      note: "Retry rejected email from Google Sheet",
      loginAttempts: 0
    };
    // Never move the active email just because a rejected row was re-queued.
    await chrome.storage.local.set({ interns });
    return true;
  }
  interns.push({
    name: value.split("@")[0],
    email: value,
    status: "pending",
    note: "From Google Sheet"
  });
  const current = Number(stored.currentIndex);
  const safeCurrent = Number.isInteger(current) && current >= 0 && current < interns.length
    ? current
    : 0;
  await chrome.storage.local.set({ interns, currentIndex: safeCurrent });
  return true;
}

let sheetSyncBusy = false;

async function syncSheetEmails() {
  if (sheetSyncBusy) return;
  sheetSyncBusy = true;
  try {
    return await syncSheetEmailsUnlocked();
  } finally {
    sheetSyncBusy = false;
  }
}

async function syncSheetEmailsUnlocked() {
  const stored = await chrome.storage.local.get(["config", "interns"]);
  const config = stored.config || {};
  if (config.live === false) return;

  await loadIgnoredEmails();
  await chrome.storage.local.set({ sheetSyncStatus: "Sheet sync: reading sheet..." });
    const data = await sheetAction({ action: "list" });
    if (!data || !Array.isArray(data.rows)) {
      await chrome.storage.local.set({
        sheetSyncStatus: "Sheet sync failed: " + String((data && data.error) || "no rows/JSON returned")
      });
      return;
    }

    const byEmail = new Map();
    for (const row of data.rows) {
      const email = String(row.email || "").trim();
      if (!email || !email.includes("@") || isIgnoredTestEmail(email)) continue;
      const key = email.toLowerCase();
      if (!byEmail.has(key)) byEmail.set(key, { email, row });
    }

    const now = Date.now();

    // Keep the local list in sync with the Sheet. A previously-pending email
    // that is now completed/rejected must never be picked again.
    const latest = await chrome.storage.local.get(['interns', 'currentIndex']);
    const localInterns = Array.isArray(latest.interns) ? latest.interns.slice() : [];
    const activeIndex = Number(latest.currentIndex) || 0;
    let statusChanged = false;
    for (let i = 0; i < localInterns.length; i++) {
      const item = localInterns[i];
      const key = String(item.email || '').trim().toLowerCase();
      const match = byEmail.get(key);
      if (!match) continue;
      // The active email is owned by the login flow. The Sheet may still show
      // an old rejected/done value for it, which must not interrupt the login.
      if (item.status === 'done' || item.status === 'in_progress') continue;
      if (i === activeIndex && item.status === 'pending') continue;
      const row = match.row || {};
      const rowStatus = String(row.status || '').toLowerCase();
      if (row.successful || rowStatus === 'completed' || rowStatus === 'successful') {
        if (item.status !== 'done') {
          item.status = 'done';
          item.note = 'Sheet completed';
          statusChanged = true;
        }
      } else if (row.rejected || rowStatus === 'rejected') {
        if (item.status !== 'failed') {
          item.status = 'failed';
          item.note = 'Sheet rejected';
          statusChanged = true;
        }
      }
    }
    const candidates = [...byEmail.values()].filter(({ row }) => {
      const status = String(row.status || "").toLowerCase();
      const notes = String(row.notes || "").toLowerCase();
      // Only completed/successful rows are excluded. Pending, picked,
      // rejected, reserved and failed rows are all eligible for a retry.
      if (row.successful) return false;
      if (status === "successful" || status === "completed") return false;
      if (notes.includes("completed")) return false;
      return true;
    });

    const order = String(config.emailOrder || "desc").toLowerCase() === "asc" ? "asc" : "desc";
    const rowTime = (row) => {
      const value = row.created || row.lastOperation || row.successful || row.rejected || "";
      const time = Date.parse(String(value));
      return Number.isFinite(time) ? time : 0;
    };
    candidates.sort((a, b) => {
      const at = rowTime(a.row);
      const bt = rowTime(b.row);
      return order === "asc" ? at - bt : bt - at;
    });

    const queuedKeys = new Set(localInterns.map((item) => String(item.email || '').trim().toLowerCase()));
    let added = 0;
    let alreadyLocal = 0;
    for (const candidate of candidates) {
      const key = String(candidate.email || '').trim().toLowerCase();
      if (!key || queuedKeys.has(key)) {
        alreadyLocal++;
        continue;
      }
      queuedKeys.add(key);
      const existingIdx = localInterns.findIndex((item) => String(item.email || '').trim().toLowerCase() === key);
      if (existingIdx >= 0) {
        const status = localInterns[existingIdx].status;
        if (status === 'done' || status === 'pending' || status === 'in_progress') {
          alreadyLocal++;
          continue;
        }
        localInterns[existingIdx] = {
          ...localInterns[existingIdx],
          status: 'pending',
          note: 'Retry rejected email from Google Sheet',
          loginAttempts: 0
        };
      } else {
        localInterns.push({
          name: key.split('@')[0],
          email: candidate.email,
          status: 'pending',
          note: 'From Google Sheet'
        });
      }
      added++;
      statusChanged = true;
    }

    if (statusChanged) {
      const current = Number(latest.currentIndex);
      const safeCurrent = Number.isInteger(current) && current >= 0 && current < localInterns.length
        ? current
        : 0;
      // One merge only: never overwrite a login that completed during the
      // Sheet request with a stale pre-request snapshot.
      await chrome.storage.local.set({ interns: localInterns, currentIndex: safeCurrent });
    }

    await chrome.storage.local.set({
      sheetSyncStatus: added > 0
        ? "Imported " + added + " email(s) from the sheet."
        : alreadyLocal > 0
          ? "Sheet sync: " + alreadyLocal + " pending email(s) already in the local list."
          : "Sheet sync: no pending emails."
    });
    if (added > 0) {
      const after = await chrome.storage.local.get(['interns', 'currentIndex']);
      const current = (after.interns || [])[Number(after.currentIndex) || 0];
      if (!current || current.status === 'done' || current.status === 'failed') {
        try { await ensureLive(true); } catch (e) {}
      }
    }
}

async function markSheetPicked(email) {
  const value = String(email || "").trim();
  if (!value) return;
  // Notes only: status is deliberately left untouched until the last API call.
  await sheetAction({ action: "note", email: value, notes: "picked" });
}

async function markSheetRejected(email, reason) {
  const value = String(email || "").trim();
  if (!value) return;
  await sheetAction({ action: "reject", email: value, notes: String(reason || "") });
}

async function markLoginComplete(email, token) {
  const value = String(email || "").trim();
  if (!value) return;
  const realToken = String(token || "").trim();
  if (realToken) {
    // Write the token via userToken (works with the deployed script), preserving
    // the original QR timestamp, then complete without touching the token.
    let qrAt = "";
    try {
      const cur = await sheetAction({ action: "get", email: value });
      qrAt = (cur && cur.record && cur.record.qrGenerated) || "";
    } catch (e) {}
    const qr = { action: "qr", email: value, userToken: realToken };
    if (qrAt) qr.at = qrAt;
    await sheetAction(qr);
  }
  await sheetAction({ action: "complete", email: value, notes: "completed" });
}

async function recordOauthCode(code, email, result) {
  const value = String(code || "").trim();
  if (!value) return;
  const stored = await chrome.storage.local.get("oauthCodes");
  let list = Array.isArray(stored.oauthCodes) ? stored.oauthCodes.slice() : [];
  const entry = {
    code: value,
    email: String(email || ""),
    at: Date.now(),
    result: result || "pending"
  };
  const idx = list.findIndex((item) => item && item.code === value);
  if (idx >= 0) list[idx] = { ...list[idx], ...entry, at: list[idx].at || entry.at };
  else list.push(entry);
  if (list.length > 1000) list = list.slice(-1000);
  await chrome.storage.local.set({ oauthCodes: list });
  // Only final results are sent to Google Sheets. Pending updates can arrive
  // out of order and overwrite an accepted row.
}

async function updateOauthCodeResult(code, result) {
  const value = String(code || "").trim();
  if (!value) return;
  const stored = await chrome.storage.local.get("oauthCodes");
  const list = Array.isArray(stored.oauthCodes) ? stored.oauthCodes.slice() : [];
  const idx = list.findIndex((item) => item && item.code === value);
  if (idx < 0) {
    await recordOauthCode(value, "", result);
    return;
  }
  list[idx] = { ...list[idx], result: result || "unknown", updatedAt: Date.now() };
  await chrome.storage.local.set({ oauthCodes: list });
  await pushOauthCodeToSheet(list[idx]);
}

async function recordSuccessEmail(email) {
  const value = String(email || "").trim();
  if (!value) return;
  const stored = await chrome.storage.local.get("successEmails");
  const list = Array.isArray(stored.successEmails) ? stored.successEmails.slice() : [];
  const entry = { email: value, at: Date.now() };
  const idx = list.findIndex((item) => {
    const existing = String((item && item.email) || item || "").toLowerCase();
    return existing === value.toLowerCase();
  });
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  await chrome.storage.local.set({ successEmails: list });
}

async function setInternStatusByEmail(email, status, note) {
  const { interns } = await chrome.storage.local.get("interns");
  if (!Array.isArray(interns)) return;
  const idx = interns.findIndex((i) => sameEmail(i.email, email));
  if (idx < 0) return;
  interns[idx] = { ...interns[idx], status, note };
  await chrome.storage.local.set({ interns });
}

async function clearAllBrowserData() {
  const types = {
    cookies: true,
    cache: true,
    cacheStorage: true,
    indexedDB: true,
    localStorage: true,
    serviceWorkers: true,
    fileSystems: true,
    webSQL: true
  };
  try {
    await chrome.browsingData.remove({ since: 0 }, types);
  } catch (e) {
    try { await clearGcpCookies(); } catch (e2) {}
  }
}

// After an accepted token: logout, wipe browser + flow data, then log in to the
// next existing email and run OAuth again.
async function resetAndRestart() {
  if (flowTransition) return;
  flowTransition = true;
  try {
    return await doResetAndRestart();
  } finally {
    flowTransition = false;
  }
}

async function doResetAndRestart() {
  const { config } = await chrome.storage.local.get("config");
  if (config && config.live === false) return;

  await clearAccountTimeout();

  await new Promise((resolve) => setTimeout(resolve, 500));

  const again = await chrome.storage.local.get("config");
  if (again.config && again.config.live === false) return;

  // 1) Logout first using the extension's sign-out page.
  try { await chrome.tabs.create({ url: LOGOUT_URL, active: true }); } catch (e) {}
  await new Promise((resolve) => setTimeout(resolve, 800));

  // 2) Remove all browser data / cookies.
  await clearAllBrowserData();

  // 3) Clear extension account data.
  await clearExtensionFlowData();

  // Wait for any in-flight preparation before replacing all tabs.
  if (preparePromise) {
    try { await preparePromise; } catch (e) {}
  }

  // 4) Close all tabs, keep one fresh new tab.
  let newTab = null;
  try { newTab = await chrome.tabs.create({ url: "about:blank", active: true }); } catch (e) {}
  if (!newTab) {
    try { newTab = await chrome.tabs.create({ active: true }); } catch (e) {}
  }
  if (newTab && newTab.id) await closeAllExcept(newTab.id);

  // 5) Log in to the next pending email in the new tab.
  await prepareLiveAccount(newTab && newTab.id);

  // Keep exactly one tab open.
  let keepId = newTab && newTab.id;
  try {
    const after = await chrome.tabs.query({});
    if (!keepId || !after.some((t) => t.id === keepId)) {
      const keep = after.find((t) => t.url && t.url.startsWith(LOGIN_URL)) ||
        after.find((t) => t.active);
      keepId = keep && keep.id;
    }
    if (keepId) {
      await closeAllExcept(keepId);
      // Safety net: close any OAuth/logout tab that appears just after reset.
      setTimeout(() => { closeAllExcept(keepId).catch(() => {}); }, 1000);
    }
  } catch (e) {}
  syncSheetEmails().catch(() => {});
}

const submitPromises = Object.create(null);

syncSheetEmails().catch(() => {});

function submitOauthCode(code, email) {
  if (submitPromises[code]) return submitPromises[code];
  submitPromises[code] = doSubmitOauthCode(code, email).finally(() => {
    delete submitPromises[code];
  });
  return submitPromises[code];
}


function isTransientApiError(err) {
  const msg = String((err && err.message) || err).toLowerCase();
  const definite = /(invalid_grant|invalid code|code.?already|already.?used|expired|used)/i.test(msg);
  const connection400 = /^http 400/.test(msg) &&
    /(connection is bad|no error details|connection|try again|temporarily|bad gateway|gateway|upstream)/i.test(msg);
  return (err && err.name === "AbortError") ||
    msg.includes("aborted") ||
    msg.includes("timeout") ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    /^http 5\d\d/.test(msg) ||
    /^http 429/.test(msg) ||
    (connection400 && !definite);
}

function antigravityTokenFrom(data) {
  if (!data) return "";
  if (typeof data === "string") return data.slice(0, 4000);
  const direct = [
    "access_token", "refresh_token", "accessToken", "refreshToken",
    "token", "oauth_token", "id_token", "antigravity_token",
    "antigravityToken", "auth_token"
  ];
  const parts = [];
  for (const key of direct) {
    const value = data[key];
    if (value) parts.push(key + "=" + String(value));
  }
  if (parts.length) return parts.join(" | ").slice(0, 4000);
  for (const key of ["data", "result", "credentials", "tokens", "account", "payload"]) {
    const nested = data[key];
    if (nested && typeof nested === "object") {
      const token = antigravityTokenFrom(nested);
      if (token) return token;
    }
  }
  try { return JSON.stringify(data).slice(0, 4000); } catch (e) { return ""; }
}

async function doSubmitOauthCode(code, email) {
  const stored = await chrome.storage.local.get([
    "apiKey", "oauthState", "oauthStartEmail", "oauthCallbackCode", "oauthCodeVerifier"
  ]);

  await recordOauthCode(code, email || stored.oauthStartEmail, "pending");

  if (!String(stored.apiKey || "").trim()) {
    const error = "Add the API key in the popup.";
    await chrome.storage.local.set({ oauthApiResult: "rejected", oauthApiMessage: error });
    await updateOauthCodeResult(code, "rejected");
    return { ok: false, error };
  }
  if (!stored.oauthCodeVerifier) {
    const error = "OAuth code verifier missing. Start OAuth again.";
    await chrome.storage.local.set({ oauthApiResult: "rejected", oauthApiMessage: error });
    await updateOauthCodeResult(code, "rejected");
    setTimeout(() => { resetAndRestart().catch(() => {}); }, 2000);
    return { ok: false, error, retryable: false };
  }
  if (!stored.oauthState || !stored.oauthStartEmail) {
    const error = "OAuth state missing. Start OAuth again.";
    await chrome.storage.local.set({ oauthApiResult: "rejected", oauthApiMessage: error });
    await updateOauthCodeResult(code, "rejected");
    return { ok: false, error };
  }
  if (email && email !== stored.oauthStartEmail) {
    const error = "OAuth email mismatch.";
    await chrome.storage.local.set({ oauthApiResult: "rejected", oauthApiMessage: error });
    await updateOauthCodeResult(code, "rejected");
    return { ok: false, error };
  }
  if (stored.oauthCallbackCode === code) {
    await updateOauthCodeResult(code, "accepted");
    return { ok: true, already: true, email: stored.oauthStartEmail };
  }

  await chrome.storage.local.set({
    oauthApiResult: "pending",
    oauthApiMessage: "Sending code to API...",
    oauthPendingAt: Date.now()
  });

  let status = null;
  let apiResponseData = null;
  let lastError = null;
  let attempt = 0;
  const retryStartedAt = Date.now();
  const maxRetryMs = 150 * 1000;
  let shouldAdvance = true;

  while (true) {
    const elapsed = Date.now() - retryStartedAt;
    const remaining = maxRetryMs - elapsed;
    if (remaining <= 2000) break;
    attempt++;
    try {
      const timeout = Math.min(CALLBACK_TIMEOUT, remaining);
      const result = await apiRequest("/api/accounts/oauth/callback", {
        code,
        state: stored.oauthState,
        code_verifier: stored.oauthCodeVerifier
      }, timeout);
      status = result.status;
      apiResponseData = result.data;
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      if (!isTransientApiError(e)) break;

      const guard = await chrome.storage.local.get([
        "config", "oauthStartEmail", "oauthCallbackCode"
      ]);
      if (guard.oauthCallbackCode) {
        return { ok: true, already: true, email: stored.oauthStartEmail };
      }
      if (guard.config && guard.config.live === false) {
        lastError = new Error("Live stopped while retrying the code.");
        shouldAdvance = false;
        break;
      }
      if (guard.oauthStartEmail && guard.oauthStartEmail !== stored.oauthStartEmail) {
        lastError = new Error("OAuth flow changed while retrying the code.");
        shouldAdvance = false;
        break;
      }
      if (Date.now() - retryStartedAt > maxRetryMs) break;

      const delay = Math.min(15000, 2500 + attempt * 1500, Math.max(1000, remaining - 1500));
      await chrome.storage.local.set({
        oauthApiResult: "pending",
        oauthApiMessage: "Code not accepted yet — retrying (" + attempt + ")...",
        oauthPendingAt: Date.now()
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  if (status !== null) {
    await chrome.storage.local.set({
      oauthCallbackCode: code,
      oauthCompletedEmail: stored.oauthStartEmail,
      oauthCompletedAt: Date.now(),
      lastOauthApiStatus: status,
      oauthApiResult: "accepted",
      oauthApiMessage: "Code accepted (HTTP " + status + ")"
    });
    const token = antigravityTokenFrom(apiResponseData);
    await chrome.storage.local.set({
      lastOauthToken: token,
      lastOauthTokenEmail: stored.oauthStartEmail,
      lastOauthTokenAt: Date.now(),
      lastOauthApiData: apiResponseData
    });
    await recordSuccessEmail(stored.oauthStartEmail);
    await setInternStatusByEmail(stored.oauthStartEmail, "done", "Login + API completed");
    await updateOauthCodeResult(code, "accepted");
    // The Sheet can take ~30s per write. Do not hold the login flow for it:
    // mark completion in the background and start the next email immediately.
    markLoginComplete(stored.oauthStartEmail, token).catch(() => {});
    resetAndRestart().catch(() => {});
    return { ok: true, email: stored.oauthStartEmail };
  }

  const message = String((lastError && lastError.message) || lastError || "Unknown error");
  const rawResponse = String(
    (lastError && lastError.responseText) ||
    (lastError && lastError.responseData ? JSON.stringify(lastError.responseData) : "") ||
    message
  ).slice(0, 4000);
  const displayMessage = rawResponse && rawResponse !== message
    ? message + " | API response: " + rawResponse.slice(0, 1200)
    : message;
  await chrome.storage.local.set({
    oauthCompletedAt: Date.now(),
    lastOauthApiError: message,
    lastOauthApiResponse: rawResponse,
    oauthApiResult: "rejected",
    oauthApiMessage: displayMessage
  });
  await setInternStatusByEmail(
    stored.oauthStartEmail,
    "failed",
    "OAuth API failed: " + message.slice(0, 180)
  );
  await markSheetRejected(stored.oauthStartEmail, message.slice(0, 300));
  await updateOauthCodeResult(code, "rejected");
  if (shouldAdvance) {
    setTimeout(() => { resetAndRestart().catch(() => {}); }, 2000);
  }
  return {
    ok: false,
    error: message,
    retryable: isTransientApiError(lastError)
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "AM_I_FLOW_OWNER") {
    (async () => {
      const tabId = sender.tab && sender.tab.id;
      let owner = await currentFlowOwner();
      if (!owner && tabId && isFlowTab(sender.tab.url)) owner = await claimFlowOwner(tabId);
      sendResponse({ owner: !!tabId && tabId === owner });
    })().catch(() => sendResponse({ owner: false }));
    return true;
  }
  if (msg && msg.type === "GET_RANDOM_DOMAIN") {
    sendResponse({ ok: true, domain: randomDomain() });
    return true;
  }
  if (msg && msg.type === "TEST_SHEET_WEBHOOK") {
    (async () => {
      const data = await sheetAction({ action: "health" });
      sendResponse(data && data.ok
        ? { ok: true, time: data.time || "" }
        : { ok: false, error: String((data && data.error) || "sheet unreachable") });
    })();
    return true;
  }
  if (msg && msg.type === "RECORD_OAUTH_CODE") {
    recordOauthCode(msg.code, msg.email, "pending")
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg && msg.type === "ACTIVITY") {
    noteActivity(msg.reason)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg && msg.type === "ENSURE_LIVE") {
    ensureLive(msg.start).then((res) => sendResponse(res)).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg && msg.type === "SYNC_SHEET") {
    syncSheetEmails().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg && msg.type === "LOGIN_BLOCKED") {
    (async () => {
      const stored = await chrome.storage.local.get(["interns", "currentIndex"]);
      const interns = Array.isArray(stored.interns) ? stored.interns : [];
      const idx = interns.findIndex((i) => sameEmail(i.email, msg.email));
      if (idx < 0) {
        sendResponse({ ok: false, error: "email not found" });
        return;
      }

      const attempts = (Number(interns[idx].loginAttempts) || 0) + 1;
      const maxAttempts = 2;

      if (attempts < maxAttempts) {
        interns[idx] = {
          ...interns[idx],
          status: "in_progress",
          note: "Google temporary error; retrying (" + attempts + "/" + (maxAttempts - 1) + ")",
          loginAttempts: attempts
        };
        await chrome.storage.local.set({ interns, currentIndex: idx, agLoginStartedAt: Date.now() });
        await clearExtensionFlowData();
        try { await clearGcpCookies(); } catch (e) {}
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const res = await prepareInFreshTab();
        sendResponse({
          ok: true,
          retry: true,
          attempts,
          email: msg.email,
          next: res && res.ok ? res.email : null,
          error: res && !res.ok ? res.error : null
        });
        return;
      }

      interns[idx] = {
        ...interns[idx],
        status: "failed",
        note: "Google temporary error (not disabled) - retry later",
        loginAttempts: attempts
      };
      await markSheetRejected(msg.email, "Google temporary error");
      const nextIdx = interns.findIndex((i, j) => j !== idx && i.status === "pending");
      await chrome.storage.local.set({
        interns,
        currentIndex: nextIdx >= 0 ? nextIdx : interns.length
      });
      await clearExtensionFlowData();
      try { await clearGcpCookies(); } catch (e) {}
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const res = await prepareInFreshTab();
      syncSheetEmails().catch(() => {});
      sendResponse({
        ok: true,
        retry: false,
        attempts,
        email: msg.email,
        next: res && res.ok ? res.email : null,
        error: res && !res.ok ? res.error : null
      });
    })();
    return true;
  }
  if (msg && msg.type === "LOGIN_FAILED") {
    (async () => {
      const stored = await chrome.storage.local.get(["interns", "currentIndex"]);
      const interns = Array.isArray(stored.interns) ? stored.interns : [];
      const idx = interns.findIndex((i) => sameEmail(i.email, msg.email));
      if (idx >= 0) {
        interns[idx] = { ...interns[idx], status: "failed", note: msg.reason || "failed" };
        await markSheetRejected(msg.email, msg.reason || "login failed");
      }
      const nextIdx = interns.findIndex((i) => i.status === "pending");
      await chrome.storage.local.set({
        interns,
        currentIndex: nextIdx >= 0 ? nextIdx : interns.length
      });
      await clearExtensionFlowData();
      try { await clearGcpCookies(); } catch (e) {}
      const res = await prepareInFreshTab();
      syncSheetEmails().catch(() => {});
      sendResponse({
        ok: true,
        next: res && res.ok ? res.email : null,
        error: res && !res.ok ? res.error : null
      });
    })();
    return true;
  }
  if (msg && msg.type === "RESTART_LIVE") {
    restartLiveFlow().then((res) => sendResponse(res)).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg && msg.type === "RESET_FLOW") {
    resetExtensionFlow().then((res) => sendResponse(res)).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg && msg.type === "GENERATE_EMAILS") {
    const domain = String(msg.domain || DEFAULTS.domain).trim().toLowerCase()
      .replace(/^@/, "").replace(/[^a-z0-9.-]/g, "");
    const count = Math.max(1, Math.min(500, Number(msg.count) || 1));
    generateEmails(domain, count)
      .then((emails) => sendResponse({ ok: true, emails }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg && msg.type === "ALLOCATE_EMAIL") {
    const domain = String(msg.domain || DEFAULTS.domain).trim().toLowerCase()
      .replace(/^@/, "").replace(/[^a-z0-9.-]/g, "");
    generateEmails(domain, 1)
      .then((emails) => sendResponse({ ok: true, email: emails[0] }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg && msg.type === "OPEN_SIGNUP") {
    (async () => {
      if (msg.clearCookies) {
        try { await clearGcpCookies(); } catch (e) {}
      }
      try { await applyProxy(); } catch (e) {}
      chrome.tabs.create({ url: SIGNUP_URL });
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg && msg.type === "RETRY_SIGNUP") {
    const tabId = sender.tab && sender.tab.id;
    (async () => {
      // A Google invalid-request usually means the proxy IP or email domain was
      // rejected. Rotate to a fresh domain + email before retrying.
      try {
        const stored = await chrome.storage.local.get("interns");
        const domain = randomDomain();
        const emails = await generateEmails(domain, 1);
        const email = emails[0];
        const intern = {
          name: email.split("@")[0],
          email,
          status: "pending",
          note: "Retry after Google invalid request"
        };
        const interns = Array.isArray(stored.interns)
          ? stored.interns.concat(intern)
          : [intern];
        await chrome.storage.local.set({
          domain,
          interns,
          currentIndex: interns.length - 1
        });
      } catch (e) {}

      try { await clearGcpCookies(); } catch (e) {}
      try { await applyProxy(); } catch (e) {}
      if (tabId) chrome.tabs.update(tabId, { url: SIGNUP_URL });
      else chrome.tabs.create({ url: SIGNUP_URL });
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg && msg.type === "START_OAUTH") {
    startOauth(msg.email, sender.tab && sender.tab.id).then((res) => sendResponse(res));
    return true;
  }
  if (msg && msg.type === "SUBMIT_OAUTH_CODE") {
    submitOauthCode(msg.code, msg.email).then((res) => sendResponse(res));
    return true;
  }
  if (msg && msg.type === "OPEN_OAUTH") {
    openStoredOauthTab(sender.tab && sender.tab.id).then((res) => sendResponse(res));
    return true;
  }
  if (msg && msg.type === "SIGN_OUT") {
    chrome.tabs.create({ url: LOGOUT_URL });
    sendResponse({ ok: true });
    return true;
  }
  if (msg && msg.type === "CLEAR_COOKIES") {
    clearGcpCookies().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === "SET_PROXY") {
    applyProxy()
      .then(async (res) => {
        if (res && res.enabled === false && res.mode && res.mode !== "direct") {
          sendResponse({
            ok: false,
            error: "Proxy is off in the extension, but Chrome is still using " +
              res.mode + " (" + (res.levelOfControl || "unknown") + ")",
            ...res
          });
          return;
        }
        if (res && res.enabled === true && res.levelOfControl &&
            res.levelOfControl !== "controlled_by_this_extension") {
          sendResponse({
            ok: false,
            error: "Chrome proxy is controlled by " + res.levelOfControl,
            ...res
          });
          return;
        }
        await chrome.storage.local.set({
          proxyHold: false,
          proxyRecovering: false,
          proxyFailAt: 0,
          proxyEgressIp: null,
          lastProxyError: null
        });
        if (res && res.enabled) {
          const cfg = await chrome.storage.local.get("config");
          if (!cfg.config || cfg.config.live !== false) {
            ensureLive(true).catch(() => {});
          }
        }
        sendResponse({ ok: true, ...res });
      })
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg && msg.type === "PROXY_INFO") {
    fetchProxyInfo()
      .then((info) => sendResponse({ ok: true, ...info }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg && msg.type === "FETCH_OTP") {
    fetchOtp(msg.email)
      .then((data) => sendResponse({ ok: true, code: data.code, timestamp: data.timestamp }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  return false;
});

// OTP retrieval service (dispose.lol). The email is swapped per account; the key
// stays constant. Override the key via storage.otpApiKey if needed.
const OTP_API_BASE = "https://dispose.lol/api/google-code";
const OTP_API_KEY = "gclvcodekeyq82nfhs7dkap01mzx";

async function fetchOtp(email) {
  const store = await chrome.storage.local.get(["otpApiKey", "agLoginStartedAt"]);
  const key = (store && store.otpApiKey) || OTP_API_KEY;
  let url = `${OTP_API_BASE}?key=${encodeURIComponent(key)}&to=${encodeURIComponent(email)}`;
  if (store && store.agLoginStartedAt) {
    url += `&ts=${encodeURIComponent(store.agLoginStartedAt)}`;
  }
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

// Clear all cookies for Google Cloud / accounts / payments domains so a new
// account can be created without leftover session data.
async function clearGcpCookies() {
  const domains = [
    "accounts.cloud.google.com",
    "console.cloud.google.com",
    "cloud.google.com",
    "payments.google.com",
    "accounts.google.com",
    ".google.com"
  ];
  for (const domain of domains) {
    const cookies = await chrome.cookies.getAll({ domain });
    for (const cookie of cookies) {
      const protocol = cookie.secure ? "https://" : "http://";
      const url = protocol + (cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain) + cookie.path;
      await chrome.cookies.remove({ url, name: cookie.name });
    }
  }
}

// Recovery watchdog: proxy health and a single live flow tab.
try {
  chrome.alarms.create(PROXY_WATCH_ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.create(FLOW_WATCH_ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.create(DOCTOR_ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.create(SHEET_SYNC_ALARM, { periodInMinutes: 1 });
} catch (e) {}
setInterval(() => { checkProxyHealth().catch(() => {}); }, 15000);
setInterval(() => { ensureFlowAlive().catch(() => {}); }, 20000);
setInterval(() => { doctorCheck().catch(() => {}); }, 15000);
setTimeout(() => { ensureFlowAlive().catch(() => {}); }, 3000);
setTimeout(() => { syncSheetEmails().catch(() => {}); }, 5000);
