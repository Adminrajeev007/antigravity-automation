// Combo step flow: track every step, retry on stall, report to orchestrator.
const COMBO_STEPS = [
  ["profile_created", "profile"],
  ["email_submitted", "email"],
  ["otp_submitted", "otp"],
  ["tos_accepted", "tos"],
  ["billing_reached", "billing"],
  ["oauth_started", "oauth"],
  ["account_selected", "account"],
  ["terms_accepted", "terms"],
  ["consent_approved", "consent"],
  ["callback_code", "code"],
  ["api_callback", "api"],
  ["sheet_completed", "sheet"],
  ["profile_closed", "close"],
];

const COMBO_STEP_TIMEOUTS = {
  profile_created: 60000,
  email_submitted: 30000,
  otp_submitted: 90000,
  tos_accepted: 45000,
  billing_reached: 60000,
  oauth_started: 30000,
  account_selected: 25000,
  terms_accepted: 20000,
  consent_approved: 20000,
  callback_code: 20000,
  api_callback: 160000,
  sheet_completed: 60000,
  profile_closed: 20000,
};

const COMBO_STEP_LABELS = {
  profile_created: "profile",
  email_submitted: "email",
  otp_submitted: "otp",
  tos_accepted: "tos",
  billing_reached: "billing",
  oauth_started: "oauth",
  account_selected: "account",
  terms_accepted: "terms",
  consent_approved: "consent",
  callback_code: "code",
  api_callback: "api",
  sheet_completed: "sheet",
  profile_closed: "close",
};

let comboWatchdogStarted = false;

function comboStepIndex(key) {
  return COMBO_STEPS.findIndex(function (s) { return s[0] === key; });
}

async function comboFlowGet() {
  const st = await chrome.storage.local.get(["comboFlow"]);
  return st.comboFlow || null;
}

async function comboFlowInit(email, uuid) {
  const flow = { email: String(email || "").toLowerCase(), uuid: String(uuid || ""), startedAt: Date.now(), currentStep: "profile_created", status: "running", steps: {} };
  COMBO_STEPS.forEach(function (s) {
    flow.steps[s[0]] = { status: "pending", attempts: 0, at: 0, ms: 0, error: "" };
  });
  flow.steps.profile_created = { status: "running", attempts: 1, at: Date.now(), ms: 0, error: "" };
  await chrome.storage.local.set({ comboFlow: flow });
  comboFlowNotify(flow, "profile_created", "running");
  comboStartWatchdog();
  return flow;
}

async function comboFlowEnsure(email, uuid) {
  const st = await chrome.storage.local.get(["comboFlow", "interns", "currentIndex", "profileUuid"]);
  const cur = (Array.isArray(st.interns) ? st.interns : [])[Number(st.currentIndex) || 0] || {};
  const e = String(email || (st.comboFlow && st.comboFlow.email) || cur.email || "").trim().toLowerCase();
  if (!e) return null;
  if (st.comboFlow && st.comboFlow.email === e && st.comboFlow.status === "running") return st.comboFlow;
  return await comboFlowInit(e, uuid || st.profileUuid || "");
}

function comboFlowNotify(flow, step, status, error) {
  try {
    if (typeof comboNotify !== "function") return;
    const st = (flow.steps && flow.steps[step]) || {};
    comboNotify("/combo-step", {
      uuid: flow.uuid || "",
      email: flow.email || "",
      step: step,
      status: status,
      attempt: st.attempts || 1,
      error: error || st.error || "",
    }).catch(function () {});
  } catch (e) {}
}

async function comboFlowAdvance(key) {
  let flow = await comboFlowGet();
  if (!flow || flow.status !== "running") flow = await comboFlowEnsure();
  if (!flow) return;
  const idx = comboStepIndex(key);
  if (idx < 0) return;
  const now = Date.now();
  COMBO_STEPS.forEach(function (s, i) {
    const st = flow.steps[s[0]];
    if (!st) return;
    if (i < idx && st.status !== "done" && st.status !== "failed") {
      st.status = "done";
      st.at = st.at || now;
      st.ms = st.at ? now - st.at : 0;
      st.error = "";
    }
  });
  const st = flow.steps[key];
  if (st && st.status !== "done" && st.status !== "failed") {
    st.status = "running";
    st.at = now;
    st.attempts = st.attempts || 1;
    st.error = "";
    flow.currentStep = key;
    flow.status = "running";
    await chrome.storage.local.set({ comboFlow: flow });
    comboFlowNotify(flow, key, "running");
  }
}

async function comboFlowDone(key) {
  let flow = await comboFlowGet();
  if (!flow) flow = await comboFlowEnsure();
  if (!flow) return;
  const st = flow.steps && flow.steps[key];
  if (!st) return;
  const now = Date.now();
  st.status = "done";
  st.ms = st.at ? now - st.at : 0;
  st.error = "";
  const idx = comboStepIndex(key);
  const next = COMBO_STEPS[idx + 1];
  if (next && flow.steps[next[0]]) {
    flow.steps[next[0]].status = "running";
    flow.steps[next[0]].at = now;
    flow.currentStep = next[0];
  }
  if (key === "profile_closed") flow.status = "completed";
  await chrome.storage.local.set({ comboFlow: flow });
  comboFlowNotify(flow, key, "done");
  if (next) comboFlowNotify(flow, next[0], "running");
}

async function comboFlowRetry(key, error) {
  const flow = await comboFlowGet();
  if (!flow) return false;
  const st = flow.steps && flow.steps[key];
  if (!st) return false;
  st.attempts = (st.attempts || 1) + 1;
  if (st.attempts > 4) {
    await comboFlowFail(key, error || "retry limit reached");
    return false;
  }
  st.status = "retrying";
  st.error = String(error || "");
  st.at = Date.now();
  flow.currentStep = key;
  await chrome.storage.local.set({ comboFlow: flow });
  comboFlowNotify(flow, key, "retrying", error);
  return true;
}

async function comboFlowFail(key, error) {
  const flow = await comboFlowGet();
  if (!flow) return;
  const st = flow.steps && flow.steps[key];
  if (st) {
    st.status = "failed";
    st.error = String(error || "");
    st.ms = st.at ? Date.now() - st.at : 0;
  }
  flow.status = "failed";
  flow.currentStep = key;
  await chrome.storage.local.set({ comboFlow: flow });
  comboFlowNotify(flow, key, "failed", error);
  try {
    if (typeof comboFail === "function") {
      await comboFail(flow.email, "failed at " + key + ": " + String(error || ""));
    }
  } catch (e) {}
}

function comboFlowMapUrl(url) {
  const u = String(url || "").toLowerCase();
  if (u.indexOf("/signup/email") >= 0) return "email_submitted";
  if (u.indexOf("verify-oob-code") >= 0 || u.indexOf("accountverification") >= 0) return "otp_submitted";
  if (u.indexOf("/signup/tos") >= 0) return "tos_accepted";
  if (u.indexOf("/freetrial") >= 0 && u.indexOf("billing") >= 0) return "billing_reached";
  if (u.indexOf("speedbump/workspacetermsofservice") >= 0) return "terms_accepted";
  if (u.indexOf("/signin/oauth/v3/consent") >= 0) return "consent_approved";
  if (u.indexOf("antigravity.google/oauth-callback") >= 0) return "callback_code";
  if (u.indexOf("/o/oauth2/auth") >= 0) return "oauth_started";
  return "";
}

async function comboFlowWatchdog() {
  const flow = await comboFlowGet();
  if (!flow || flow.status !== "running") return;
  const key = flow.currentStep;
  const st = flow.steps && flow.steps[key];
  if (!st || st.status === "done" || st.status === "failed") return;
  const timeout = COMBO_STEP_TIMEOUTS[key] || 30000;
  if (!st.at || Date.now() - st.at < timeout) return;
  const ok = await comboFlowRetry(key, "timeout");
  if (!ok) return;
  try {
    chrome.tabs.query({}, function (tabs) {
      for (let i = 0; i < tabs.length; i += 1) {
        const tab = tabs[i];
        if (!tab.id) continue;
        try {
          chrome.tabs.sendMessage(tab.id, { type: "COMBO_RETRY_STEP", step: key }, function () {
            try { void chrome.runtime.lastError; } catch (e) {}
          });
        } catch (e) {}
      }
    });
  } catch (e) {}
}

function comboStartWatchdog() {
  if (comboWatchdogStarted) return;
  comboWatchdogStarted = true;
  setInterval(function () { comboFlowWatchdog().catch(function () {}); }, 3000);
  try {
    chrome.tabs.onUpdated.addListener(function (tabId, info, tab) {
      const url = (info && info.url) || (tab && tab.url) || "";
      const step = comboFlowMapUrl(url);
      if (step) comboFlowAdvance(step).catch(function () {});
    });
  } catch (e) {}
}

try {
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    if (msg.type === "COMBO_PAGE" && msg.step) {
      comboFlowAdvance(msg.step).then(function () { sendResponse({ ok: true }); }).catch(function (e) { sendResponse({ ok: false, error: String(e) }); });
      return true;
    }
    if (msg.type === "COMBO_STEP_DONE" && msg.step) {
      comboFlowDone(msg.step).then(function () { sendResponse({ ok: true }); }).catch(function (e) { sendResponse({ ok: false, error: String(e) }); });
      return true;
    }
    if (msg.type === "COMBO_STEP_FAILED" && msg.step) {
      comboFlowFail(msg.step, msg.error || "step failed").then(function () { sendResponse({ ok: true }); }).catch(function (e) { sendResponse({ ok: false, error: String(e) }); });
      return true;
    }
    return undefined;
  });
} catch (e) {}
