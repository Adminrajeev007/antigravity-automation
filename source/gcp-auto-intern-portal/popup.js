/* Popup logic (V1 basic): manage intern list, track progress */

const $ = (id) => document.getElementById(id);

async function getState() {
  const s = await chrome.storage.local.get(null);
  s.domain = s.domain || "fussion.studio";
  s.interns = Array.isArray(s.interns) ? s.interns : [];
  s.currentIndex = typeof s.currentIndex === "number" ? s.currentIndex : 0;
  s.config = { autoRun: true, ...(s.config || {}) };
  return s;
}

function localPart(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9.]+/g, "");
}

function lineToIntern(line, domain) {
  const raw = line.trim();
  if (!raw) return null;
  if (raw.includes("@")) {
    return { name: raw.split("@")[0], email: raw.toLowerCase(), status: "pending", note: "" };
  }
  const lp = localPart(raw);
  if (!lp) return null;
  return { name: raw, email: `${lp}@${domain}`, status: "pending", note: "" };
}

function parseLines(text, domain) {
  return text.split("\n").map((l) => lineToIntern(l, domain)).filter(Boolean);
}

async function saveList(mode) {
  const domain = ($("domain").value || "fussion.studio").trim().replace(/^@/, "");
  const fresh = parseLines($("names").value, domain);
  const state = await getState();

  let interns;
  if (mode === "append") {
    const existing = new Set(state.interns.map((i) => i.email));
    interns = state.interns.concat(fresh.filter((i) => !existing.has(i.email)));
  } else {
    interns = fresh;
  }

  await chrome.storage.local.set({
    domain,
    interns,
    currentIndex: mode === "append" ? state.currentIndex : 0,
    ...(mode === "append" ? {} : { flowEpoch: Date.now() }),
    // Fresh random addresses for a new list (append keeps existing locks)
    ...(mode === "append" ? {} : { addrMap: {} }),
    upiSelected: false, upiSelectedFor: -1,
    qrReady: false, qrReadyFor: -1, qrImage: "", qrEmail: "", qrAt: 0, qrLog: [],
    payRetryFor: -1, payRetryCount: 0, startFreeTaps: 0, startFreeTapsFor: -1, paySuccess: false, paySuccessFor: -1, paySuccessAt: 0, qrGrabbed: false, qrGrabbedFor: -1, qrGrabRequest: null
  });
  await render();
}

async function render() {
  const state = await getState();

  $("domain").value = state.domain;
  $("autoRun").checked = !!state.config.autoRun;

  const total = state.interns.length;
  const done = state.interns.filter((i) => i.status === "done").length;
  const failed = state.interns.filter((i) => i.status === "failed").length;
  $("stats").textContent = total
    ? `Total ${total} | Done ${done} | Failed ${failed} | Current #${Math.min(state.currentIndex + 1, total)}`
    : "No interns yet.";

  const list = $("list");
  list.innerHTML = "";
  state.interns.forEach((intern, idx) => {
    const li = document.createElement("li");
    li.className = "item " + (intern.status || "pending");
    if (idx === state.currentIndex) li.classList.add("current");
    li.innerHTML = `
      <span class="idx">${idx + 1}</span>
      <span class="mail">${intern.email}</span>
      <span class="badge">${intern.status || "pending"}</span>
      <button data-idx="${idx}" class="setcur" title="Set as current">&#9654;</button>
    `;
    list.appendChild(li);
  });

  list.querySelectorAll(".setcur").forEach((b) => {
    b.onclick = async () => {
      await chrome.storage.local.set({ currentIndex: Number(b.dataset.idx) });
      render();
    };
  });
}

async function saveConfig() {
  const state = await getState();
  const newDomain = ($("domain").value || "fussion.studio").trim().replace(/^@/, "");
  const domainChanged = newDomain !== state.domain;
  state.config.autoRun = $("autoRun").checked;
  const updates = { config: state.config, domain: newDomain };
  if (domainChanged) {
    updates.interns = [];
    updates.currentIndex = 0;
    updates.addrMap = {};
    updates.flowEpoch = Date.now();
    updates.upiSelected = false; updates.upiSelectedFor = -1;
    updates.qrReady = false; updates.qrReadyFor = -1; updates.qrImage = ""; updates.qrEmail = ""; updates.qrAt = 0;
    updates.qrLog = [];
    updates.payRetryFor = -1; updates.payRetryCount = 0;
    updates.startFreeTaps = 0; updates.startFreeTapsFor = -1;
    updates.paySuccess = false; updates.paySuccessFor = -1; updates.paySuccessAt = 0;
    updates.qrGrabbed = false; updates.qrGrabbedFor = -1; updates.qrGrabRequest = null;
  }
  await chrome.storage.local.set(updates);
  render();
}

function exportCSV() {
  chrome.storage.local.get("interns", (data) => {
    const interns = data.interns || [];
    let csv = "email,status,note\n";
    interns.forEach(i => {
      csv += `"${i.email}","${i.status}","${(i.note||"").replace(/"/g,'""')}"\n`;
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gcp-accounts-" + new Date().toISOString().slice(0,10) + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  });
}

$("loadBtn").onclick = () => saveList("replace");
$("appendBtn").onclick = () => saveList("append");
$("clearBtn").onclick = async () => {
  await chrome.storage.local.set({ flowEpoch: Date.now(), interns: [], currentIndex: 0, addrMap: {}, upiSelected: false, upiSelectedFor: -1, qrReady: false, qrReadyFor: -1, qrImage: "", qrEmail: "", qrAt: 0, qrLog: [], payRetryFor: -1, payRetryCount: 0, startFreeTaps: 0, startFreeTapsFor: -1, paySuccess: false, paySuccessFor: -1, paySuccessAt: 0, qrGrabbed: false, qrGrabbedFor: -1, qrGrabRequest: null });
  $("names").value = "";
  render();
};
$("resetBtn").onclick = async () => {
  const state = await getState();
  const interns = state.interns.map((i) => ({ ...i, status: "pending", note: "" }));
  // Clear locked addresses too so Reset gives completely fresh random addresses
  await chrome.storage.local.set({ flowEpoch: Date.now(), interns, currentIndex: 0, addrMap: {}, upiSelected: false, upiSelectedFor: -1, qrReady: false, qrReadyFor: -1, qrImage: "", qrEmail: "", qrAt: 0, qrLog: [], payRetryFor: -1, payRetryCount: 0, startFreeTaps: 0, startFreeTapsFor: -1, paySuccess: false, paySuccessFor: -1, paySuccessAt: 0, qrGrabbed: false, qrGrabbedFor: -1, qrGrabRequest: null });
  render();
};
$("signupBtn").onclick = () => chrome.runtime.sendMessage({ type: "OPEN_SIGNUP" });
$("signoutBtn").onclick = () => chrome.runtime.sendMessage({ type: "SIGN_OUT" });
$("saveCfgBtn").onclick = saveConfig;
$("exportBtn").onclick = exportCSV;

// ---- Fleet ----
async function renderFleet() {
  const s = await chrome.storage.local.get(["fleetOn", "fleetUrl", "fleetToken", "portalToken", "fleetDeviceId", "fleetOutbox", "fleetLastBeat", "profileName", "profileUuid"]);
  $("fleetOn").checked = !!s.fleetOn;
  $("fleetUrl").value = s.fleetUrl || "";
  $("fleetToken").value = s.fleetToken || "";
  if ($("portalToken")) $("portalToken").value = s.portalToken || "";
  if ($("profileName")) $("profileName").value = s.profileName || "";
  const box = Array.isArray(s.fleetOutbox) ? s.fleetOutbox.length : 0;
  const ago = s.fleetLastBeat ? Math.max(0, Math.round((Date.now() - s.fleetLastBeat) / 1000)) : -1;
  const prof = s.profileName ? `Profile ${s.profileName} · ` : "";
  $("fleetInfo").textContent = s.fleetOn
    ? `${prof}Device ${(s.fleetDeviceId || "?")} → ${(s.fleetUrl || "no URL")} · beat ${ago < 0 ? "never" : ago + "s ago"} · outbox ${box}${s.portalToken ? " · routed to user portal" : ""}`
    : "Fleet off.";
}
$("fleetSaveBtn").onclick = async () => {
  const prev = await chrome.storage.local.get(["profileName", "profileUuid"]);
  const name = ($("profileName") ? $("profileName").value || "" : "").trim();
  await chrome.storage.local.set({
    fleetOn: $("fleetOn").checked,
    fleetUrl: ($("fleetUrl").value || "").trim().replace(/\/+$/, ""),
    fleetToken: ($("fleetToken").value || "").trim(),
    portalToken: ($("portalToken") ? $("portalToken").value || "" : "").trim(),
    profileName: name,
    profileUuid: name === (prev.profileName || "") ? (prev.profileUuid || "") : ""
  });
  renderFleet();
};
if ($("fleetDetectBtn")) $("fleetDetectBtn").onclick = async () => {
  $("fleetInfo").textContent = "Detecting Octo profile…";
  try {
    const r = await chrome.runtime.sendMessage({ type: "FLEET_DETECT_PROFILE" });
    $("fleetInfo").textContent = r && r.ok
      ? `Detected ${r.profileName || r.profileUuid || "profile"}`
      : "No running Octo profile found.";
    renderFleet();
  } catch (e) {
    $("fleetInfo").textContent = "Detection failed.";
  }
};
$("fleetTestBtn").onclick = async () => {
  const s = await chrome.storage.local.get(["fleetUrl", "fleetToken", "fleetDeviceId", "profileName", "profileUuid"]);
  if (!s.fleetUrl || !s.fleetToken) { $("fleetInfo").textContent = "Set URL + token first."; return; }
  $("fleetInfo").textContent = "Testing...";
  try {
    const res = await fetch(s.fleetUrl.replace(/\/+$/, "") + "/api/fleet/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": s.fleetToken },
      body: JSON.stringify({
        deviceId: s.fleetDeviceId || "test",
        version: "test",
        profileName: s.profileName || "",
        profileUuid: s.profileUuid || ""
      })
    });
    $("fleetInfo").textContent = res.ok ? "Connected ✓ (heartbeat accepted)" : "HTTP " + res.status + " — check token";
  } catch (e) {
    $("fleetInfo").textContent = "Unreachable — check URL (server running?)";
  }
};

// ---- Auto email generator ----
const GEN_RESET = {
  upiSelected: false, upiSelectedFor: -1,
  qrReady: false, qrReadyFor: -1, qrImage: "", qrEmail: "", qrAt: 0, qrLog: [],
  payRetryFor: -1, payRetryCount: 0,
  startFreeTaps: 0, startFreeTapsFor: -1,
  paySuccess: false, paySuccessFor: -1, paySuccessAt: 0,
  qrGrabbed: false, qrGrabbedFor: -1, qrGrabRequest: null
};

async function makeEmail() {
  const state = await getState();
  const history = Array.isArray(state.emailHistory) ? state.emailHistory : [];
  const used = new Set(
    history.concat(state.interns.map((i) => i.email))
      .map((e) => String(e || "").toLowerCase())
      .filter(Boolean)
  );
  return { state, email: window.gcpRandomEmail(used) };
}

async function generateOnly() {
  const { email } = await makeEmail();
  const domain = email.split("@")[1];
  $("domain").value = domain;
  const existing = $("names").value.trim();
  $("names").value = (existing ? existing + "\n" : "") + email;
  $("genInfo").textContent = email;
}

async function generateStart() {
  const { state, email } = await makeEmail();
  const domain = email.split("@")[1];
  const interns = state.interns.slice();
  interns.push({ name: email.split("@")[0], email, status: "pending", note: "generated" });
  const idx = interns.length - 1;
  const addrMap = { ...(state.addrMap || {}) };
  delete addrMap[idx];
  const history = (Array.isArray(state.emailHistory) ? state.emailHistory : []).concat(email).slice(-5000);

  await chrome.storage.local.set({
    domain,
    interns,
    currentIndex: idx,
    flowEpoch: Date.now(),
    addrMap,
    emailHistory: history,
    ...GEN_RESET
  });

  $("domain").value = domain;
  $("names").value = email;
  $("genInfo").textContent = "Started: " + email;
  try { await chrome.runtime.sendMessage({ type: "OPEN_SIGNUP" }); } catch (e) {}
  render();
}

if ($("genOnlyBtn")) $("genOnlyBtn").onclick = () => { generateOnly().catch(() => {}); };
if ($("genStartBtn")) $("genStartBtn").onclick = () => { generateStart().catch(() => {}); };

async function renderAuto() {
  if (!$("autoEmail")) return;
  const s = await chrome.storage.local.get(["autoEmail", "autoAssign"]);
  $("autoEmail").checked = s.autoEmail !== false;
  if ($("autoAssign")) $("autoAssign").checked = s.autoAssign !== false;
}
if ($("autoEmail")) {
  $("autoEmail").onchange = () => chrome.storage.local.set({ autoEmail: $("autoEmail").checked });
}
if ($("autoAssign")) {
  $("autoAssign").onchange = () => chrome.storage.local.set({ autoAssign: $("autoAssign").checked });
}

// ---- Sheet (QR email log) ----
async function renderSheet() {
  const s = await chrome.storage.local.get(["sheetOn", "sheetUrl", "sheetToken", "sheetTab", "deleteAfterQr"]);
  $("sheetOn").checked = s.sheetOn !== false;
  $("sheetUrl").value = s.sheetUrl || "";
  $("sheetToken").value = s.sheetToken || "";
  if ($("deleteAfterQr")) $("deleteAfterQr").checked = s.deleteAfterQr !== false;
  $("sheetInfo").textContent = s.sheetUrl
    ? `${s.sheetOn === false ? "Off" : "On"} · tab ${s.sheetTab || "QR"}${s.deleteAfterQr === false ? "" : " · delete profile after QR"} → ${s.sheetUrl}`
    : "Set the web app URL to start syncing QR emails.";
}
if ($("deleteAfterQr")) {
  $("deleteAfterQr").onchange = () => chrome.storage.local.set({ deleteAfterQr: $("deleteAfterQr").checked });
}
$("sheetSaveBtn").onclick = async () => {
  try {
    await chrome.runtime.sendMessage({
      type: "SHEET_CONFIG",
      on: $("sheetOn").checked,
      url: $("sheetUrl").value || "",
      token: $("sheetToken").value || "",
      tab: "QR"
    });
    await renderSheet();
  } catch (e) {
    $("sheetInfo").textContent = "Save failed.";
  }
};
$("sheetTestBtn").onclick = async () => {
  $("sheetInfo").textContent = "Testing...";
  try {
    const r = await chrome.runtime.sendMessage({ type: "SHEET_TEST" });
    $("sheetInfo").textContent = r && r.ok
      ? `Connected ✓ (sheet time ${r.time || "ok"})`
      : `Failed: ${(r && (r.error || r.raw)) || "check URL/token"}`;
  } catch (e) {
    $("sheetInfo").textContent = "Unreachable — check URL/token.";
  }
};

document.addEventListener("DOMContentLoaded", () => { render(); renderFleet(); renderSheet(); renderAuto(); });
render();
renderFleet();
renderSheet();
renderAuto();
