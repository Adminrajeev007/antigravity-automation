/* Popup: proxy, account start, progress, OAuth */

const $ = (id) => document.getElementById(id);

const DEFAULT_PROXY = {
  enabled: false,
  customUrl: "http://testuser:testpass@192.168.31.250:1080"
};


const OAUTH_RESET = {
  agOauthEmail: null,
  oauthStartEmail: null,
  oauthAuthUrl: null,
  oauthState: null,
  oauthPickedEmail: null,
  oauthConsentEmail: null,
  oauthApprovedEmail: null,
  oauthCallbackCode: null,
  oauthCompletedEmail: null,
  oauthOpenEmail: null,
  agLoginEmail: null,
  agLoginStartedAt: null,
  loginReadyEmail: null
};

async function getState() {
  const s = await chrome.storage.local.get(null);
  s.lastOauthCode = typeof s.lastOauthCode === "string" ? s.lastOauthCode : "";
  s.lastOauthCodeEmail = typeof s.lastOauthCodeEmail === "string" ? s.lastOauthCodeEmail : "";
  s.interns = Array.isArray(s.interns) ? s.interns : [];
  s.successEmails = Array.isArray(s.successEmails) ? s.successEmails : [];
  s.ignoredEmails = Array.isArray(s.ignoredEmails) ? s.ignoredEmails : [];
  s.currentIndex = typeof s.currentIndex === "number" ? s.currentIndex : 0;
  s.config = { autoRun: true, fastMode: false, live: true, stuckMinutes: 2.5, emailOrder: "desc", ...(s.config || {}) };
  s.proxy = { ...DEFAULT_PROXY, ...(s.proxy || {}) };
  return s;
}

/* ---------- Rendering ---------- */

let accountTimerTick = null;

async function refreshAccountTimer() {
  const el = $("accountTimer");
  if (!el) return;
  const stored = await chrome.storage.local.get([
    "config", "accountStartedAt", "lastActivityAt", "accountTimeoutAt", "proxyHold"
  ]);
  const config = stored.config || {};
  if (stored.proxyHold) {
    el.textContent = "Stuck timer: proxy pause";
    el.className = "account-timer danger";
    return;
  }
  if (config.live === false || !stored.accountStartedAt) {
    el.textContent = "Stuck timer: stopped";
    el.className = "account-timer off";
    return;
  }
  const stuckMs = Math.max(0.5, Math.min(60, Number(config.stuckMinutes) || 2.5)) * 60000;
  const base = Number(stored.lastActivityAt) || Number(stored.accountStartedAt);
  const end = Number(stored.accountTimeoutAt) || (base + stuckMs);
  const left = Math.max(0, end - Date.now());
  const minutes = Math.floor(left / 60000);
  const seconds = Math.floor((left % 60000) / 1000);
  el.textContent = "Stuck timer: " + minutes + ":" + String(seconds).padStart(2, "0");
  el.className = "account-timer" + (left <= 30000 ? " danger" : "");
}

function startAccountTimer() {
  if (accountTimerTick) clearInterval(accountTimerTick);
  refreshAccountTimer();
  accountTimerTick = setInterval(refreshAccountTimer, 1000);
}

function makeChip(label, value, cls) {
  const chip = document.createElement("span");
  chip.className = "chip " + (cls || "");
  chip.append(label);
  const b = document.createElement("b");
  b.textContent = value;
  chip.append(b);
  return chip;
}

function successEmailText(state) {
  const list = Array.isArray(state.successEmails) ? state.successEmails : [];
  return list
    .map((item) => (typeof item === "string" ? item : item && item.email))
    .filter(Boolean)
    .join("\n");
}

function renderSuccessEmails(state) {
  const el = $("successList");
  if (!el) return;
  const text = successEmailText(state);
  el.textContent = text || "No successful accounts yet.";
  el.classList.toggle("empty", !text);
  if ($("copySuccessBtn")) $("copySuccessBtn").disabled = !text;
}

function renderLastApiFailure(state) {
  const el = $("lastApiResponse");
  if (!el) return;
  const text = state.lastOauthApiResponse || state.lastOauthApiError || "";
  el.textContent = text || "No API failure yet.";
  el.classList.toggle("empty", !text);
}

function ignoredSetOf(state) {
  return new Set(
    (Array.isArray(state.ignoredEmails) ? state.ignoredEmails : [])
      .map((email) => String(email || "").trim().toLowerCase())
      .filter(Boolean)
  );
}

async function setIgnoredEmails(emails) {
  const state = await getState();
  const ignored = [...new Set(
    (Array.isArray(emails) ? emails : [])
      .map((email) => String(email || "").trim().toLowerCase())
      .filter(Boolean)
  )];
  const set = new Set(ignored);
  const interns = state.interns.map((item) => {
    const key = String(item.email || "").trim().toLowerCase();
    if (set.has(key)) {
      if (item.status === "done") return item;
      return { ...item, status: "ignored", note: "Ignored by user" };
    }
    if (item.status === "ignored" && item.note === "Ignored by user") {
      return { ...item, status: "pending", note: "" };
    }
    return item;
  });
  await chrome.storage.local.set({ ignoredEmails: ignored, interns });
  await render();
}

async function toggleIgnored(email, on) {
  const state = await getState();
  const set = ignoredSetOf(state);
  const key = String(email || "").trim().toLowerCase();
  if (!key) return;
  if (on) set.add(key); else set.delete(key);
  await setIgnoredEmails([...set]);
}

function renderProgress(state) {
  const total = state.interns.length;
  const done = state.interns.filter((i) => i.status === "done").length;
  const failed = state.interns.filter((i) => i.status === "failed").length;
  const ignored = state.interns.filter((i) => i.status === "ignored").length;
  const current = total ? Math.min(state.currentIndex + 1, total) : 0;

  const stats = $("stats");
  stats.innerHTML = "";
  stats.append(
    makeChip("Total", total, ""),
    makeChip("Completed", done, "done"),
    makeChip("Failed", failed, "failed"),
    makeChip("Ignored", ignored, "ignored"),
    makeChip("Current", current, "current")
  );

  $("progressBar").style.width = total ? `${Math.round((done / total) * 100)}%` : "0%";

  const list = $("list");
  list.innerHTML = "";
  if (!total) {
    const empty = document.createElement("li");
    empty.className = "list-empty";
    empty.textContent = "No login emails yet. Add emails above.";
    list.append(empty);
    return;
  }

  const ignoredSet = ignoredSetOf(state);
  state.interns.forEach((intern, idx) => {
    const status = intern.status || "pending";
    const marked = ignoredSet.has(String(intern.email || "").trim().toLowerCase());
    const li = document.createElement("li");
    li.className = "item " + status + (idx === state.currentIndex ? " current" : "");
    const hint = idx === state.currentIndex ? "Current account" : "Click to make current";
    li.title = intern.note ? intern.note + " — " + hint : hint;

    const num = document.createElement("span");
    num.className = "item-idx";
    num.textContent = idx + 1;

    const email = document.createElement("span");
    email.className = "item-email";
    email.textContent = intern.email;
    email.title = intern.email;

    const badge = document.createElement("span");
    badge.className = "badge " + status;
    badge.textContent = status === "done" ? "completed" : status.replace("_", " ");

    const mark = document.createElement("label");
    mark.className = "ignore-mark";
    mark.title = marked ? "Ignored — uncheck to use again" : "Ignore this email";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = marked;
    box.addEventListener("click", (event) => event.stopPropagation());
    box.addEventListener("change", async (event) => {
      event.stopPropagation();
      await toggleIgnored(intern.email, box.checked);
    });
    mark.addEventListener("click", (event) => event.stopPropagation());
    const markText = document.createElement("span");
    markText.textContent = "Ignore";
    mark.append(box, markText);

    li.append(num, email, badge, mark);
    li.addEventListener("click", async () => {
      await chrome.storage.local.set({ currentIndex: idx, agOauthEmail: null });
      const next = await getState();
      renderProgress(next);
    });
    list.append(li);
  });
}

function applyCode(state) {
  const code = state.lastOauthCode || "";
  const box = $("lastCode");
  box.textContent = code || "No code yet.";
  box.classList.toggle("empty", !code);
  $("lastCodeMeta").textContent = code && state.lastOauthCodeEmail
    ? "Copied from " + state.lastOauthCodeEmail
    : "";
  $("copyCodeBtn").disabled = !code;
  $("sendCodeBtn").disabled = !code;

  const result = state.oauthApiResult || "";
  const message = state.oauthApiMessage || "";
  const status = $("apiStatus");
  status.className = "api-status " + result;
  status.textContent = result === "accepted"
    ? "API accepted"
    : result === "rejected"
      ? "API rejected — " + message.slice(0, 180)
      : result === "pending"
        ? "API sending..."
        : "";
}

function applyOauthStatus(state) {
  const email = state.oauthStartEmail || "";
  const url = state.oauthAuthUrl || "";
  $("oauthStartStatus").textContent = email && url
    ? "OAuth link already fetched once for " + email + "."
    : "No OAuth link fetched yet.";
}

async function render() {
  const state = await getState();
  const emailsField = $("loginEmails");
  if (document.activeElement !== emailsField) {
    emailsField.value = state.interns.map((i) => i.email).join("\n");
  }
  const ignoredField = $("ignoredEmails");
  if (ignoredField && document.activeElement !== ignoredField) {
    ignoredField.value = (state.ignoredEmails || []).join("\n");
  }
  $("fastMode").checked = !!state.config.fastMode;
  const live = state.config.live !== false;
  $("runDot").classList.toggle("on", live);
  $("startBtn").textContent = live ? "Stop live" : "Start live";
  $("startBtn").className = live ? "btn danger full" : "btn primary full";
  if ($("sheetSyncStatus")) {
    $("sheetSyncStatus").textContent = state.sheetSyncStatus || "Sheet sync: waiting...";
  }
  if ($("emailOrder")) {
    $("emailOrder").value = state.config.emailOrder === "asc" ? "asc" : "desc";
  }
  applyCode(state);
  applyOauthStatus(state);
  renderProgress(state);
  renderSuccessEmails(state);
  renderLastApiFailure(state);
}

async function refreshProgress() {
  const state = await getState();
  const live = state.config.live !== false;
  $("fastMode").checked = !!state.config.fastMode;
  $("runDot").classList.toggle("on", live);
  $("startBtn").textContent = live ? "Stop live" : "Start live";
  $("startBtn").className = live ? "btn danger full" : "btn primary full";
  if ($("sheetSyncStatus")) {
    $("sheetSyncStatus").textContent = state.sheetSyncStatus || "Sheet sync: waiting...";
  }
  renderProgress(state);
  renderSuccessEmails(state);
  renderLastApiFailure(state);
}

$("copySuccessBtn").onclick = async () => {
  const state = await getState();
  const text = successEmailText(state);
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    $("copySuccessBtn").textContent = "Copied";
    setTimeout(() => { $("copySuccessBtn").textContent = "Copy"; }, 1500);
  } catch (e) {}
};

/* ---------- Accounts ---------- */

function parseLoginEmails(text) {
  const out = [];
  const seen = new Set();
  String(text || "").split(/[\s,;]+/).forEach((raw) => {
    const email = raw.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || seen.has(email)) return;
    seen.add(email);
    out.push(email);
  });
  return out;
}

// Merge new emails into the existing list. Existing done/failed/in-progress
// statuses are preserved so adding a new batch never resets progress.
async function mergeLoginEmails(emails) {
  const state = await getState();
  const merged = state.interns.slice();
  const known = new Set(merged.map((i) => String(i.email).toLowerCase()));

  for (const email of emails) {
    if (known.has(email)) continue;
    known.add(email);
    merged.push({
      name: email.split("@")[0],
      email,
      status: ignoredSetOf(state).has(email) ? "ignored" : "pending",
      note: ignoredSetOf(state).has(email) ? "Ignored by user" : ""
    });
  }

  let currentIndex = state.currentIndex;
  const current = merged[currentIndex];
  if (!current || current.status === "done" || current.status === "failed") {
    const next = merged.findIndex((i) => i.status === "pending");
    if (next >= 0) currentIndex = next;
  }

  await chrome.storage.local.set({ interns: merged, currentIndex });
  return merged;
}

// One button: stop live mode, or start it with the saved login list.
$("startBtn").onclick = async () => {
  const pre = await getState();

  // Always merge whatever is in the textarea first; this never resets statuses.
  const emails = parseLoginEmails($("loginEmails").value);
  if (emails.length) {
    await mergeLoginEmails(emails);
  }

  if (pre.config.live !== false) {
    pre.config.live = false;
    pre.config.autoRun = false;
    await chrome.storage.local.set({ config: pre.config });
    await render();
    return;
  }

  const mergedState = await getState();
  if (!mergedState.interns.length) {
    $("loginEmails").focus();
    return;
  }

  await chrome.storage.local.set({
    invalidRequestStreak: 0,
    invalidRequestPaused: false,
    config: { ...pre.config, live: true, autoRun: true }
  });

  await render();
  chrome.runtime.sendMessage({ type: "ENSURE_LIVE", start: true });
};

$("saveEmailsBtn").onclick = async () => {
  const emails = parseLoginEmails($("loginEmails").value);
  if (!emails.length) {
    $("loginEmails").focus();
    return;
  }
  await mergeLoginEmails(emails);
  await render();
  chrome.runtime.sendMessage({ type: "ENSURE_LIVE", start: true });
};

$("restartBtn").onclick = () => {
  const button = $("restartBtn");
  button.disabled = true;
  button.textContent = "Restarting...";
  chrome.runtime.sendMessage({ type: "RESTART_LIVE" }, () => {
    button.disabled = false;
    button.textContent = "Restart flow";
  });
};

$("resetFlowBtn").onclick = () => {
  const button = $("resetFlowBtn");
  button.disabled = true;
  button.textContent = "Resetting...";
  chrome.runtime.sendMessage({ type: "RESET_FLOW" }, () => {
    button.disabled = false;
    button.textContent = "Reset extension";
    render();
  });
};

$("fastMode").onchange = async () => {
  const state = await getState();
  state.config.fastMode = $("fastMode").checked;
  await chrome.storage.local.set({ config: state.config });
};

$("clearBtn").onclick = async () => {
  await chrome.storage.local.set({
    interns: [],
    currentIndex: 0,
    ...OAUTH_RESET,
    invalidRequestStreak: 0,
    invalidRequestPaused: false
  });
  $("loginEmails").value = "";
  await render();
};

$("saveIgnoredBtn").onclick = async () => {
  const button = $("saveIgnoredBtn");
  const emails = parseLoginEmails($("ignoredEmails").value);
  await setIgnoredEmails(emails);
  button.textContent = "Saved";
  setTimeout(() => { button.textContent = "Save ignored"; }, 1500);
};

$("copyCodeBtn").onclick = async () => {
  const code = $("lastCode").textContent || "";
  if (!code || code === "No code yet.") return;
  try {
    await navigator.clipboard.writeText(code);
    const button = $("copyCodeBtn");
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = "Copy"; }, 1500);
  } catch (e) {}
};

$("sendCodeBtn").onclick = () => {
  const code = $("lastCode").textContent || "";
  if (!code || code === "No code yet.") return;

  const button = $("sendCodeBtn");
  button.disabled = true;
  button.textContent = "Sending...";

  chrome.runtime.sendMessage({ type: "SUBMIT_OAUTH_CODE", code }, (res) => {
    const ok = !chrome.runtime.lastError && res && res.ok;
    button.textContent = ok ? "Sent" : "Failed";
    setTimeout(() => {
      button.textContent = "Send";
      button.disabled = false;
    }, 1800);
  });
};

$("clearCookiesBtn").onclick = () => chrome.runtime.sendMessage({ type: "CLEAR_COOKIES" });
$("oauthBtn").onclick = () => chrome.runtime.sendMessage({ type: "OPEN_OAUTH" });

$("skipCurrentBtn").onclick = async () => {
  const state = await getState();
  const intern = state.interns[state.currentIndex];
  if (!intern || intern.status === "done") return;
  await chrome.storage.local.set({ currentIndex: state.currentIndex });
  chrome.runtime.sendMessage({
    type: "LOGIN_FAILED",
    email: intern.email,
    reason: "skipped"
  }, () => { render().catch(() => {}); });
};
$("signoutBtn").onclick = () => chrome.runtime.sendMessage({ type: "SIGN_OUT" });

/* ---------- Proxy ---------- */

function setProxyStatus(text, cls) {
  const el = $("proxyStatus");
  el.textContent = text;
  el.className = "status-text " + (cls || "");
}

function setProxyState(state) {
  const el = $("proxyState");
  if (!el) return;
  el.className = "proxy-state " + (state || "off");
  el.textContent = state === "on" ? "On" : state === "pending" ? "Wait" : "Off";
}

let proxyApplying = false;

function setProxyControlState(enabled) {
  const on = !!enabled;
  if ($("proxyCustomUrl")) $("proxyCustomUrl").disabled = !on;
  if ($("applyProxyBtn")) $("applyProxyBtn").disabled = !on;
}

async function refreshProxyIpStatus(base) {
  try {
    const info = await chrome.runtime.sendMessage({ type: "PROXY_INFO" });
    if (info && info.ok && info.ip) {
      setProxyStatus(base + " · IP " + info.ip, "ok");
    } else {
      setProxyStatus(base + " · IP unavailable", "ok");
    }
  } catch (e) {
    setProxyStatus(base + " · IP unavailable", "ok");
  }
}

async function applyProxyFromForm() {
  const proxy = {
    enabled: $("proxyEnabled").checked,
    customUrl: $("proxyCustomUrl").value.trim() || DEFAULT_PROXY.customUrl
  };
  $("proxyCustomUrl").value = proxy.customUrl;

  proxyApplying = true;
  $("proxyEnabled").disabled = true;
  setProxyControlState(false);
  await chrome.storage.local.set({ proxy });
  setProxyStatus(proxy.enabled ? "Connecting..." : "Disconnecting...", "");
  setProxyState("pending");

  chrome.runtime.sendMessage({ type: "SET_PROXY" }, (res) => {
    proxyApplying = false;
    $("proxyEnabled").disabled = false;

    if (chrome.runtime.lastError || !res || !res.ok) {
      const msg = chrome.runtime.lastError
        ? chrome.runtime.lastError.message
        : String((res && res.error) || "apply failed");
      setProxyStatus("Error: " + msg, "err");
      setProxyState(proxy.enabled ? "on" : "off");
      setProxyControlState(!!proxy.enabled);
      return;
    }

    if (res.enabled) {
      const base = `Connected (${res.scheme} :${res.port})`;
      setProxyStatus(base, "ok");
      setProxyState("on");
      setProxyControlState(true);
      refreshProxyIpStatus(base);
    } else {
      setProxyStatus("Disconnected (direct)", "ok");
      setProxyState("off");
      setProxyControlState(false);
    }
  });
}

async function loadProxy() {
  const state = await getState();
  const p = state.proxy;
  const stuck = Math.max(0.5, Math.min(60, Number(state.config.stuckMinutes) || 2.5));
  if ($("stuckMinutes")) $("stuckMinutes").value = String(stuck);
  const customUrl = String(p.customUrl || "").trim() || DEFAULT_PROXY.customUrl;

  $("proxyEnabled").checked = p.enabled !== false;
  $("proxyCustomUrl").value = customUrl;
  if (customUrl !== p.customUrl) {
    await chrome.storage.local.set({ proxy: { ...p, customUrl } });
  }

  const enabled = p.enabled !== false;
  setProxyState(enabled ? "on" : "off");
  setProxyControlState(enabled);
  if (state.proxyHold) {
    setProxyStatus("Proxy changed - waiting for a healthy IP...", "err");
    setProxyState("pending");
  } else if (enabled) {
    const base = "Connected (proxy)";
    setProxyStatus(base, "ok");
    refreshProxyIpStatus(base);
  } else {
    setProxyStatus("Disconnected (direct)", "ok");
  }
}

$("proxyEnabled").onchange = () => {
  const on = $("proxyEnabled").checked;
  setProxyControlState(on);
  applyProxyFromForm();
};

$("proxyCustomUrl").onchange = () => {
  if ($("proxyEnabled").checked) applyProxyFromForm();
};

$("applyProxyBtn").onclick = applyProxyFromForm;

$("emailOrder").onchange = async () => {
  const state = await getState();
  const emailOrder = $("emailOrder").value === "asc" ? "asc" : "desc";
  await chrome.storage.local.set({
    config: { ...state.config, emailOrder }
  });
  chrome.runtime.sendMessage({ type: "SYNC_SHEET" }, () => {
    if (chrome.runtime.lastError) return;
  });
};

$("stuckMinutes").onchange = async () => {
  const value = Math.max(0.5, Math.min(60, Number($("stuckMinutes").value) || 2.5));
  $("stuckMinutes").value = String(value);
  const state = await getState();
  await chrome.storage.local.set({
    config: { ...state.config, stuckMinutes: value }
  });
  refreshAccountTimer();
};

/* ---------- Init ---------- */

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.lastOauthCode || changes.lastOauthCodeEmail ||
      changes.oauthApiResult || changes.oauthApiMessage) {
    getState().then(applyCode);
  }
  if (changes.oauthStartEmail || changes.oauthAuthUrl) {
    getState().then(applyOauthStatus);
  }
  if (changes.proxyHold) {
    if (changes.proxyHold.newValue) {
      setProxyStatus("Proxy changed - waiting for a healthy IP...", "err");
      setProxyState("pending");
    } else {
      loadProxy().catch(() => {});
    }
  }
  if (changes.proxy) {
    const proxy = changes.proxy.newValue || {};
    if (typeof proxy.enabled === "boolean") $("proxyEnabled").checked = proxy.enabled;
    if (typeof proxy.customUrl === "string" && document.activeElement !== $("proxyCustomUrl")) {
      $("proxyCustomUrl").value = proxy.customUrl;
    }
    if (!proxyApplying) {
      const enabled = proxy.enabled !== false;
      setProxyState(enabled ? "on" : "off");
      setProxyControlState(enabled);
      if (enabled) {
        const base = "Connected (proxy)";
        setProxyStatus(base, "ok");
        refreshProxyIpStatus(base);
      } else {
        setProxyStatus("Disconnected (direct)", "ok");
      }
    }
  }
  if (changes.interns || changes.currentIndex || changes.config || changes.ignoredEmails) {
    refreshProgress();
  }
  if (changes.successEmails || changes.lastOauthApiResponse ||
      changes.lastOauthApiError || changes.sheetSyncStatus) {
    refreshProgress();
  }
  if (changes.config || changes.accountStartedAt || changes.accountTimeoutAt) {
    refreshAccountTimer();
  }
});


async function ensureLiveRun() {
  const state = await getState();
  if (state.config.live === false) return;
  chrome.runtime.sendMessage({ type: "ENSURE_LIVE", start: "auto" }, () => {});
}

(async () => {
  try { await render(); } catch (e) { console.error(e); }
  try { await loadProxy(); } catch (e) { console.error(e); }
  startAccountTimer();
  try { await ensureLiveRun(); } catch (e) { console.error(e); }
})();
