/* GCP Intern Signup - V1 BASIC (standalone extension)
 * - Same stable flow as old content-v1.js, no version loader.
 * - Address form lives inside the payments.google.com iframe: filled by the
 *   content script running INSIDE that frame (hit-and-trial by field type).
 * - Pincode always matches the state.
 * - Human-speed typing + clicks. OTP & payment (UPI/card) stay manual.
 */
(() => {
"use strict";
// Single-instance guard: if this version was already injected into this frame
// (e.g. dynamic import + eval fallback, or an all_frames re-inject), bail out.
// Two live instances would each run their own typing loop and interleave the
// characters into one field (that's what produced the scrambled, doubled email).
if (window.__gcpInternV1Loaded) return;
window.__gcpInternV1Loaded = true;

const IS_TOP = window.top === window.self;

// ---- States with matching city + valid PIN prefix (first 4 digits) ----
const STATES = [
  { state:"Delhi",            city:"New Delhi",     pin:"1100" },
  { state:"Haryana",          city:"Gurugram",      pin:"1220" },
  { state:"Punjab",           city:"Ludhiana",      pin:"1410" },
  { state:"Himachal Pradesh", city:"Shimla",        pin:"1710" },
  { state:"Uttar Pradesh",    city:"Lucknow",       pin:"2260" },
  { state:"Uttarakhand",      city:"Dehradun",      pin:"2480" },
  { state:"Rajasthan",        city:"Jaipur",        pin:"3020" },
  { state:"Gujarat",          city:"Ahmedabad",     pin:"3800" },
  { state:"Maharashtra",      city:"Pune",          pin:"4110" },
  { state:"Madhya Pradesh",   city:"Bhopal",        pin:"4620" },
  { state:"Chhattisgarh",     city:"Raipur",        pin:"4920" },
  { state:"Telangana",        city:"Hyderabad",     pin:"5000" },
  { state:"Andhra Pradesh",   city:"Visakhapatnam", pin:"5300" },
  { state:"Karnataka",        city:"Bengaluru",     pin:"5600" },
  { state:"Tamil Nadu",       city:"Chennai",       pin:"6000" },
  { state:"Kerala",           city:"Kochi",         pin:"6820" },
  { state:"West Bengal",      city:"Kolkata",       pin:"7000" },
  { state:"Odisha",           city:"Bhubaneswar",   pin:"7510" },
  { state:"Assam",            city:"Guwahati",      pin:"7810" },
  { state:"Bihar",            city:"Patna",         pin:"8000" },
  { state:"Jharkhand",        city:"Ranchi",        pin:"8340" }
];

const STREET_NAMES = [
  "MG Road", "Park Street", "Ring Road", "Station Road",
  "Mall Road", "Gandhi Nagar", "Nehru Street", "Link Road",
  "Church Street", "Main Bazaar", "Shastri Nagar", "Rajaji Street",
  "Kamaraj Avenue", "Vivekanand Marg", "Subhash Chowk", "Lake View Road",
  "Temple Street", "Kabir Nagar", "Ashok Vihar", "Shanti Colony"
];
const LOCALITIES = [
  "Sector 7", "Green Park", "City Center", "Civil Lines", "Model Town",
  "New Colony", "Industrial Area", "Lake View", "Hill Road", "Market Yard",
  "Sector 21", "Old Town", "Station Area", "University Road", "Court Road",
  "Sadar Bazaar", "Nehru Nagar", "Gandhi Chowk", "River Front", "Garden Colony"
];
const APT_PREFIX = ["Flat", "House No", "Plot No", "Apartment", "Villa"];

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function rPick(a) { return a[Math.floor(Math.random() * a.length)]; }

// Fully random address every time; pincode suffix is random but the prefix
// always matches the randomly-picked state.
function randomAddr() {
  const st = rPick(STATES);
  const house = randInt(1, 199);
  const street = rPick(STREET_NAMES);
  const loc = rPick(LOCALITIES);
  const apt = rPick(APT_PREFIX) + " " + randInt(101, 999) + (Math.random() < 0.3 ? ", Floor " + randInt(1, 5) : "");
  const pin = st.pin + String(randInt(10, 99)); // 4 + 2 = 6 digits
  return { line: house + ", " + street + ", " + loc, apt, city: st.city, state: st.state, pincode: pin };
}

// Per-account lock: all frames/ticks within one signup (same index) must use
// the SAME address, but a reset / new list / next intern gets a FRESH random one.
// Memory cache + chrome.storage (shared across frames).
let addrMemCache = {};
async function getAddrForIndex(i) {
  try {
    if (extAlive()) {
      const s = await chrome.storage.local.get("addrMap");
      const map = (s && s.addrMap) || {};
      // Storage is source of truth (survives across frames; cleared on Reset).
      // If Reset emptied the map, any memory entry is stale -> regenerate.
      if (map[i]) { addrMemCache[i] = map[i]; return map[i]; }
      const fresh = randomAddr();
      addrMemCache[i] = fresh;
      map[i] = fresh;
      try { await chrome.storage.local.set({ addrMap: map }); } catch (e) {}
      return fresh;
    }
  } catch (e) {}
  if (addrMemCache[i]) return addrMemCache[i];
  const fresh = randomAddr();
  addrMemCache[i] = fresh;
  return fresh;
}
// Force a brand-new random address for this index (shuffle button).
async function reshuffleAddr(i) {
  const fresh = randomAddr();
  addrMemCache[i] = fresh;
  try {
    if (extAlive()) {
      const s = await chrome.storage.local.get("addrMap");
      const map = (s && s.addrMap) || {};
      map[i] = fresh;
      await chrome.storage.local.set({ addrMap: map });
    }
  } catch (e) {}
  return fresh;
}
// Sync compat (uses locked value if present, else one-off random).
function getAddr(i) {
  if (addrMemCache[i]) return addrMemCache[i];
  return randomAddr();
}

// ==================== HELPERS ====================

function randDelay(min, max) { return new Promise(r => setTimeout(r, min + Math.random() * (max - min))); }

function isVisible(el) {
  if (!el) return false;
  if (el.closest("#gcp-auto-panel")) return false;
  if (el.offsetWidth === 0 && el.offsetHeight === 0) {
    return !!el.closest(".cdk-overlay-pane, [role='dialog'], mat-dialog-container, .mat-mdc-dialog-container");
  }
  return true;
}

// Serializes typing so two passes can never interleave into one field.
let typingLock = false;

// Native value setter for the element's own type (input vs textarea live on
// different prototypes — using the wrong one throws Illegal invocation).
function nativeValueSetter(el) {
  try {
    const proto = (window.HTMLTextAreaElement && el instanceof window.HTMLTextAreaElement)
      ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    return Object.getOwnPropertyDescriptor(proto, "value").set;
  } catch (e) {
    return (o, v) => { o.value = v; };
  }
}

async function humanType(el, text) {
  // Wait for any in-flight typing to finish before starting a new field.
  const wait0 = Date.now();
  while (typingLock && Date.now() - wait0 < 15000) { await randDelay(60, 140); }
  typingLock = true;
  try {
    el.focus();
    el.dispatchEvent(new Event("focus", {bubbles:true}));
    await randDelay(200, 450);
    const setter = nativeValueSetter(el);
    setter.call(el, "");
    el.dispatchEvent(new Event("input", {bubbles:true}));
    // Set the EXACT known prefix each keystroke. Never read el.value back —
    // reading it lets the page's own handlers (or a stray second typer) scramble
    // or duplicate the text, which is what produced "a@b" typed twice.
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      setter.call(el, text.slice(0, i + 1));
      el.dispatchEvent(new KeyboardEvent("keydown", {key:c, bubbles:true}));
      el.dispatchEvent(new Event("input", {bubbles:true}));
      el.dispatchEvent(new KeyboardEvent("keyup", {key:c, bubbles:true}));
      await randDelay(45, 160);
      if (Math.random() < 0.06) await randDelay(180, 400);
    }
    await randDelay(80, 220);
    // Hard-correct if the page mangled the value while we typed.
    if ((el.value || "") !== text) {
      setter.call(el, text);
      el.dispatchEvent(new Event("input", {bubbles:true}));
    }
    el.dispatchEvent(new Event("change", {bubbles:true}));
    el.dispatchEvent(new Event("blur", {bubbles:true}));
  } finally {
    typingLock = false;
  }
}

async function humanClick(el) {
  await randDelay(300, 800);
  try { el.scrollIntoView({behavior:"smooth", block:"center"}); } catch(e){}
  await randDelay(150, 350);
  el.dispatchEvent(new MouseEvent("mousedown", {bubbles:true}));
  el.dispatchEvent(new MouseEvent("mouseup", {bubbles:true}));
  el.click();
}

// Mimics a real person: scrolls the element into view, moves the pointer to a
// jittered spot near the visual centre and fires the full pointer/mouse
// sequence at those coordinates before clicking the topmost element there.
async function humanClickAt(el) {
  if (!el) return false;
  try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
  await randDelay(450, 1000);
  let r = null;
  try { r = el.getBoundingClientRect(); } catch (e) { r = null; }
  if (!r || r.width < 2 || r.height < 2) {
    try { el.click(); return true; } catch (e) { return false; }
  }
  const x = Math.round(r.left + r.width * (0.35 + Math.random() * 0.3));
  const y = Math.round(r.top + r.height * (0.35 + Math.random() * 0.3));
  let target = el;
  try { target = document.elementFromPoint(x, y) || el; } catch (e) {}
  const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0 };
  const fire = (name, Ctor) => { try { target.dispatchEvent(new Ctor(name, o)); } catch (e) {} };
  fire("pointerover", window.PointerEvent || MouseEvent);
  fire("mouseover", MouseEvent);
  fire("pointermove", window.PointerEvent || MouseEvent);
  fire("mousemove", MouseEvent);
  await randDelay(60, 170);
  fire("pointerdown", window.PointerEvent || MouseEvent);
  fire("mousedown", MouseEvent);
  await randDelay(70, 180);
  fire("pointerup", window.PointerEvent || MouseEvent);
  fire("mouseup", MouseEvent);
  await randDelay(30, 90);
  try { target.click(); } catch (e) {}
  await randDelay(120, 300);
  return true;
}

function waitFor(selectorOrFn, timeout) {
  timeout = timeout || 12000;
  return new Promise(resolve => {
    const check = () => (typeof selectorOrFn === "function") ? selectorOrFn() : document.querySelector(selectorOrFn);
    const f = check(); if (f) return resolve(f);
    const t0 = Date.now();
    const obs = new MutationObserver(() => {
      const el = check();
      if (el) { obs.disconnect(); resolve(el); }
      else if (Date.now() - t0 > timeout) { obs.disconnect(); resolve(null); }
    });
    obs.observe(document.documentElement, {childList:true, subtree:true});
    setTimeout(() => { obs.disconnect(); resolve(check()); }, timeout);
  });
}

// Best clickable element for a piece of text (exact match first, shortest text wins)
function findByText(text) {
  const w = text.trim().toLowerCase();
  const interactive = [...document.querySelectorAll(
    "button, a, [role='button'], [role='option'], mat-option, [role='menuitem'], li"
  )].filter(isVisible);
  let m = interactive.find(n => (n.textContent||"").trim().toLowerCase() === w);
  if (m) return m;
  const inc = interactive
    .filter(n => (n.textContent||"").trim().toLowerCase().includes(w))
    .sort((a,b) => (a.textContent||"").length - (b.textContent||"").length);
  if (inc.length) return inc[0];
  const others = [...document.querySelectorAll("span, div, td")]
    .filter(isVisible)
    .filter(n => (n.textContent||"").trim().toLowerCase().includes(w))
    .sort((a,b) => (a.textContent||"").length - (b.textContent||"").length);
  for (const n of others) return n.closest("button, a, [role='button']") || n;
  return null;
}

// Combined label text for a combobox (ancestors + aria-labelledby targets)
function comboLabel(el) {
  let t = "";
  let node = el;
  for (let i = 0; i < 5 && node; i++) { t += " " + (node.textContent || ""); node = node.parentElement; }
  const lb = el.getAttribute && el.getAttribute("aria-labelledby");
  if (lb) lb.split(/\s+/).forEach(id => { const e = document.getElementById(id); if (e) t += " " + e.textContent; });
  const al = el.getAttribute && el.getAttribute("aria-label");
  if (al) t += " " + al;
  return t.toLowerCase();
}

// The label text associated with a specific input. To avoid picking up sibling
// fields' labels, we climb ONLY while the wrapper still contains this one input,
// then read the label text from that tight wrapper. This makes each field's
// label unambiguous (Street address vs Apt vs City vs Pin code).
function fieldLabelText(input) {
  let t = " " + (input.getAttribute("aria-label") || "") + " " + (input.placeholder || "");
  const lb = input.getAttribute("aria-labelledby");
  if (lb) lb.split(/\s+/).forEach(id => { const e = document.getElementById(id); if (e) t += " " + e.textContent; });

  // Find the tightest wrapper that contains exactly one input (this one)
  let wrapper = input.parentElement;
  let node = input.parentElement;
  for (let i = 0; i < 6 && node; i++) {
    if (node.querySelectorAll("input, textarea").length <= 1) { wrapper = node; node = node.parentElement; }
    else break;
  }
  if (wrapper) {
    wrapper.querySelectorAll("label, span, .VfPpkd-MPu53c, .VfPpkd-rymPhb-fpDzbe-fmcmS").forEach(s => {
      if (!s.querySelector("input, textarea")) t += " " + (s.textContent || "");
    });
  }
  return t.toLowerCase();
}

// Find a visible input whose label matches any of the given needles.
// Skips the address-autocomplete search box (type=search / role=combobox) so
// we always type into the manual text fields.
function findInputByLabelText(needles) {
  const arr = Array.isArray(needles) ? needles : [needles];
  const inputs = [...document.querySelectorAll("input, textarea")].filter(el => {
    if (el.closest("#gcp-auto-panel")) return false;
    if (el.type === "checkbox" || el.type === "radio" || el.type === "hidden") return false;
    if (el.type === "search" || el.getAttribute("role") === "combobox") return false;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    return true;
  });
  for (const needle of arr) {
    const n = needle.toLowerCase();
    for (const input of inputs) {
      if (fieldLabelText(input).includes(n)) return input;
    }
  }
  return null;
}

// ==================== STORAGE ====================

// True only while this content script's extension context is still valid. After
// the extension is reloaded/updated, old content scripts lose their context and
// any chrome.* call throws "Extension context invalidated".
function extAlive() {
  try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
  catch (e) { return false; }
}

// Stop all timers and detach; used when the context is gone.
let timers = [];
let stopped = false;
// Epoch + account tracking: popup Reset/Clear/new-list bumps flowEpoch in
// storage; a changed index/account drops per-account frame memory. Without
// this, savedOnce/accountDone/otpFilled/tap budgets leak across accounts and
// across resets (next run silently does nothing).
let epochSeen = 0;
let frameAccountIdx = -1;
let otpFilledFor = -1;
function stopAll() {
  if (stopped) return;
  stopped = true;
  timers.forEach(t => { try { clearInterval(t); } catch (e) {} });
  timers = [];
}

const DEFAULT_STATE = { config: { autoRun: false }, interns: [], currentIndex: 0 };

async function getState() {
  if (!extAlive()) { stopAll(); return { ...DEFAULT_STATE }; }
  try {
    const s = await chrome.storage.local.get(null);
    s.config = { autoRun: true, ...(s.config || {}) };
    s.interns = Array.isArray(s.interns) ? s.interns : [];
    s.currentIndex = typeof s.currentIndex === "number" ? s.currentIndex : 0;
    // Fresh run (Reset/Clear/new list) or new account in this frame ->
    // drop ALL local memory so the next account/run starts truly fresh.
    const ep = (s && typeof s.flowEpoch === "number") ? s.flowEpoch : 0;
    if (ep !== epochSeen) {
      epochSeen = ep;
      frameAccountIdx = s.currentIndex;
      otpFilled = false; otpFilledFor = -1;
      resetFrameFlags();
    } else if (frameAccountIdx !== s.currentIndex) {
      frameAccountIdx = s.currentIndex;
      resetFrameFlags();
    }
    return s;
  } catch (e) {
    stopAll();
    return { ...DEFAULT_STATE };
  }
}
function currentIntern(s) { return s.interns[s.currentIndex] || null; }
async function safeSet(obj) {
  if (!extAlive()) { stopAll(); return; }
  try { await chrome.storage.local.set(obj); }
  catch (e) { stopAll(); }
}
async function updateIntern(idx, patch) {
  const s = await getState();
  if (!s.interns[idx]) return;
  s.interns[idx] = {...s.interns[idx], ...patch};
  await safeSet({interns:s.interns});
}
async function advance() {
  const s = await getState();
  if (s.interns[s.currentIndex]) s.interns[s.currentIndex].status = "done";
  // NOTE: qr trail (qrReady/qrImage/qrReadyFor) is deliberately KEPT so a later
  // billing failure can revert to this exact account for a same-account retry.
  // All gates are index-scoped, so a kept trail never affects the next account.
  // Tap proof resets for the next account (fresh 2-tap requirement).
  await safeSet({interns:s.interns, currentIndex: Math.min(s.currentIndex+1, s.interns.length), upiSelected: false, upiSelectedFor: -1, payRetryFor: -1, payRetryCount: 0, startFreeTaps: 0, startFreeTapsFor: -1});
}

// ==================== PAGE DETECT ====================

function detectPage() {
  const h = location.hostname, p = location.pathname;
  if (h === "accounts.cloud.google.com" && (p.includes("/signup/email") || p.includes("/login/email"))) return "email";
  if (h === "accounts.cloud.google.com" && p.includes("verify-oob-code")) return "otp";
  if (h === "accounts.cloud.google.com" && p.includes("/signup/tos")) return "tos";
  if (h === "console.cloud.google.com" && p.includes("/freetrial/signup/tos")) return "tos";
  if (h === "console.cloud.google.com" && p.includes("/freetrial")) return "billing";
  if (h === "payments.google.com") return "payment";
  if (h === "console.cloud.google.com") return "console";
  return "other";
}

// ==================== HANDLERS ====================

let running = false;

async function handleEmail(state) {
  if (running) return; running = true;
  try {
    const intern = currentIntern(state);
    if (!intern) { setStatus("No intern selected. Add interns in the popup."); return; }
    // Fresh account: clear the UPI/Start-free + QR + retry flags from any previous run
    await safeSet({ upiSelected: false, upiSelectedFor: -1, qrReady: false, qrReadyFor: -1, qrImage: "", qrEmail: "", qrAt: 0, qrLog: [], payRetryFor: -1, payRetryCount: 0, startFreeTaps: 0, startFreeTapsFor: -1, paySuccess: false, paySuccessFor: -1, paySuccessAt: 0, qrGrabbed: false, qrGrabbedFor: -1, qrGrabRequest: null });
    const input = await waitFor('#i3, input[name="login_hint"]');
    if (!input) { setStatus("Email field not found."); return; }
    await randDelay(1500, 3000);
    // Skip retyping if the field already holds exactly the right email.
    if ((input.value || "").trim() !== intern.email) {
      await humanType(input, intern.email);
    }
    if (intern.status === "pending") await updateIntern(state.currentIndex, {status:"in_progress"});
    setStatus("Typed email, clicking Next...");
    await randDelay(800, 1600);
    const btn = findByText("Next");
    if (btn) { await humanClick(btn); }
    else {
      input.dispatchEvent(new KeyboardEvent("keydown", {key:"Enter", keyCode:13, which:13, bubbles:true}));
      if (input.form && input.form.requestSubmit) input.form.requestSubmit();
    }
  } finally { running = false; }
}

let otpFilled = false;

// Ask the background worker to fetch the OTP for an email from the API.
function fetchOtpCode(email) {
  return new Promise((resolve) => {
    if (!extAlive()) { stopAll(); return resolve(null); }
    try {
      chrome.runtime.sendMessage({ type: "FETCH_OTP", email }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.ok) return resolve(null);
        resolve(resp);
      });
    } catch (e) { resolve(null); }
  });
}

// API timestamp -> ms. Handles seconds, ms, or ISO strings. Returns 0 if unknown.
function otpTimestampMs(ts) {
  if (ts == null) return 0;
  if (typeof ts === "number") {
    if (ts < 1e12) return ts * 1000; // seconds -> ms
    return ts;
  }
  if (typeof ts === "string") {
    const n = Number(ts);
    if (!isNaN(n) && ts.trim() !== "") {
      if (n < 1e12) return n * 1000;
      return n;
    }
    const p = Date.parse(ts);
    return isNaN(p) ? 0 : p;
  }
  return 0;
}

async function handleOtp(state) {
  if (running || (otpFilled && otpFilledFor === state.currentIndex)) return; running = true;
  try {
    const intern = currentIntern(state);
    if (!intern) { setStatus("No intern selected."); return; }

    const pin = await waitFor('input[name="pinInput"], input[aria-label*="code" i], input[type="text"]', 10000);
    if (!pin) { setStatus("OTP field not found."); return; }

    // Don't clobber a code the user already typed manually.
    if ((pin.value || "").trim().length >= 4) {
      setStatus("OTP already entered manually — skipping auto-fill.");
      otpFilled = true; otpFilledFor = state.currentIndex;
      return;
    }

    const arrivedAt = Date.now();
    // Mandatory settle wait: the API initially returns the PREVIOUS (stale)
    // code; the fresh one for this signup lands a few seconds later.
    setStatus("OTP page opened — waiting 5s for the FRESH code (ignoring stale)...");
    await randDelay(5000, 6500);

    // Poll until a code with a fresh timestamp arrives.
    let code = null;
    let staleCode = null;
    for (let attempt = 0; attempt < 24 && !code; attempt++) {
      const resp = await fetchOtpCode(intern.email);
      if (resp && resp.code && String(resp.code).trim().length >= 4) {
        const c = String(resp.code).trim();
        const tsMs = otpTimestampMs(resp.timestamp);
        if (tsMs > 0) {
          // Fresh = sent at/after we landed on the OTP page (10s leeway for clock skew).
          if (tsMs >= arrivedAt - 10000) {
            code = c;
            break;
          }
          staleCode = c;
          setStatus("Ignoring stale OTP " + c + " — waiting for fresh... (" + (attempt + 1) + ")");
        } else {
          // No timestamp from API: change-detection fallback.
          // First code seen might be stale; wait for it to change.
          if (staleCode === null) {
            staleCode = c;
            setStatus("Got OTP " + c + " — confirming it's fresh... (" + (attempt + 1) + ")");
          } else if (c !== staleCode) {
            code = c; // changed -> this is the new arrival
            break;
          } else {
            setStatus("OTP " + c + " unchanged — waiting for new arrival... (" + (attempt + 1) + ")");
            // After 3 consistent polls with no change, accept it (no newer one coming).
            if (attempt >= 3) { code = c; break; }
          }
        }
      } else {
        setStatus("OTP not ready yet, retrying... (" + (attempt + 1) + ")");
      }
      await randDelay(4500, 6000);
    }

    if (!code) {
      setStatus("Could not fetch OTP from API. Enter it manually and click Verify.");
      return;
    }

    setStatus("Got OTP " + code + " — entering...");
    await randDelay(500, 1000);
    await humanType(pin, code);
    otpFilled = true; otpFilledFor = state.currentIndex;
    await randDelay(700, 1400);
    const verify = findByText("Verify") || findByText("Next") || findByText("Continue");
    if (verify) await humanClick(verify);
    else if (pin.form && pin.form.requestSubmit) pin.form.requestSubmit();
    setStatus("Submitted OTP for " + intern.email + ".");
  } finally { running = false; }
}

async function handleTos(state) {
  // TOS clicking is driven from the orchestrator with trusted CDP input
  // (real user-activation events). Here we only surface status.
  setStatus("TOS: accepting terms via trusted input...");
}

// Billing page (console top frame). The address form is in the payments iframe,
// which is filled by the payment-frame content script. Here we just guide.
async function handleBilling(state) {
  const intern = currentIntern(state);
  if (!intern && state.interns.length > 0) {
    if (state.paySuccess && state.interns[state.paySuccessFor]) {
      setStatus("✅ " + ((state.interns[state.paySuccessFor] || {}).email || "Account") + " COMPLETED — prepayment pending.");
    } else if (state.qrReady && state.interns[state.qrReadyFor]) {
      setStatus("QR showing for " + ((state.interns[state.qrReadyFor] || {}).email || "account") + " — scan it, do NOT press Start free.");
    } else {
      setStatus("All interns done (" + state.interns.length + "/" + state.interns.length + ") — add more or Reset.");
    }
    return;
  }
  const addr = await getAddrForIndex(state.currentIndex);
  // Reset tap counter when moving to a new account
  if (startFreeForIndex !== -1 && startFreeForIndex !== state.currentIndex) {
    startFreeClicks = 0; startFreeAt = 0; startFreeForIndex = state.currentIndex;
  }
  setStatus("Billing page. Address (" + addr.state + ") auto-fills in the payment box. Selecting UPI, then Start free (2 taps).");
}

// Console top frame: click "Start free" ONLY after the payment frame verified
// data-is-selected="true" on the "Pay by UPI QR code" row (storage flag).
// Flow needs 2 taps: tap-1 after UPI selected, tap-2 after the
// confirmation window reloads. The flag is STICKY once confirmed so the
// transient spinner/iframe reload between tap-1 and tap-2 can't cancel tap-2.
async function maybeClickStartFree() {
  if (!extAlive()) { stopAll(); return; }
  if (!IS_TOP) return;
  const page = detectPage();
  if (page !== "billing" && page !== "console") return;
  const state = await getState();
  if (!state.config.autoRun) return;
  // New account -> reset tap budget
  if (startFreeForIndex !== state.currentIndex) {
    startFreeClicks = 0; startFreeAt = 0; startFreeForIndex = state.currentIndex;
  }
  if (Date.now() - startFreeAt < 4000) return;
  if (startFreeClicks >= 4) return;

  // HARD GATE: UPI verified selected in the payment frame — OR the top billing
  // page itself shows "Payment method … UPI … QR code" (covers the post-Ok
  // transition where the iframe flag flaps but the summary proves selection).
  let topUpi = false;
  try { topUpi = topUpiConfirmed(); } catch (e) {}
  if (!state.upiSelected && !topUpi) return;

  // Terminals first (order matters): SUCCESS > grabbed > QR-showing.
  // SUCCESS TERMINAL: scan worked, prepayment dialog pending — hands off.
  // Ghost-aware: after the QR advance the pointer may sit past the paid account.
  const _effSuccIdx = (!currentIntern(state) && state.interns.length > 0 &&
    typeof state.qrReadyFor === "number" && state.interns[state.qrReadyFor])
    ? state.qrReadyFor : state.currentIndex;
  if (state.paySuccess && state.paySuccessFor === _effSuccIdx) {
    setStatus("✅ Scan successful — COMPLETED, prepayment pending. NOT pressing Start free.");
    return;
  }
  // Phantom-heal: qrReady claims a QR but NO image was ever captured, and the
  // live payment frame (fresh heartbeat) confirms nothing QR-like in its DOM.
  // That's the "QR never appeared" case — drop the claim so Start free fires.
  // Needs 2 consecutive confirmations so flapping frames can't kill a real QR.
  try {
    const beatFresh = state.payBeatAt && (Date.now() - state.payBeatAt < 15000);
    if (state.qrReady && !state.qrImage && state.paySawQr === false && beatFresh) {
      phantomStrikes++;
      if (phantomStrikes >= 2) {
        phantomStrikes = 0;
        await safeSet({ qrReady: false, qrReadyFor: -1 });
        state.qrReady = false; state.qrReadyFor = -1;
        setStatus("No QR in payment frame — phantom flag cleared, pressing Start free...");
      }
    } else {
      phantomStrikes = 0;
    }
  } catch (e) {}
  // STOP GATE: QR popup is already showing -> NEVER touch Start free again
  // (extra clicks refresh/dismiss the QR). Requires the 2-tap proof too, so a
  // STALE stored QR can never freeze Start free.
  if (state.qrReady && state.qrReadyFor === state.currentIndex && startFreeTappedTwice(state, state.currentIndex)) {
    setStatus("QR is showing — NOT pressing Start free. Scan it to pay.");
    return;
  }
  // Manually grabbed QR is up too — hands off Start free.
  if (state.qrGrabbed && state.qrGrabbedFor === state.currentIndex) {
    setStatus("QR grabbed — NOT pressing Start free. Scan it to pay.");
    return;
  }
  // Failure dialog open ("Billing setup can't be completed" + Ok)? Never press
  // Start free while it is up — the failure handler dismisses it, then waits
  // for the USER to tap Retry (which re-arms the tap budget).
  try { if (billingFailurePresent()) return; } catch (e) {}
  // Same-DOM fallback (in case the QR renders in this frame).
  try { if (upiQrPresent()) { await signalQrReady(); return; } } catch (e) {}

  // Click ONE real button whose own label is exactly "Start free"
  // (ignore inner spans to avoid double-submit).
  const btns = [...document.querySelectorAll("button")].filter(el => {
    if (!isVisible(el) || el.disabled) return false;
    const t = (el.textContent || "").trim().toLowerCase();
    return t === "start free";
  });
  const target = btns[0];
  if (!target) return;

  startFreeAt = Date.now();
  startFreeClicks++;
  // Persist tap count so the payment frame (separate memory) can gate QR trust.
  // Monotonic per account: a retry's fresh budget must never lower the proof.
  try {
    const prevTaps = (state.startFreeTapsFor === state.currentIndex) ? (state.startFreeTaps || 0) : 0;
    await safeSet({ startFreeTaps: Math.max(prevTaps, startFreeClicks), startFreeTapsFor: state.currentIndex });
  } catch (e) {}
  const tapLabel = startFreeClicks === 1 ? "tap 1/2" : startFreeClicks === 2 ? "tap 2/2 (confirm)" : "retry " + startFreeClicks;
  setStatus("UPI confirmed — clicking Start free (" + tapLabel + ")...");
  try {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    target.click();
  } catch (e) {}
}

// ==================== PAYMENT FRAME (address form) ====================
// The address form lives inside payments.google.com iframes. Field IDs are
// dynamic and the layout varies (2-3 text fields), so we work by TYPE + ORDER
// (hit and trial). We run this repeatedly because the modal renders async.

let addAddrClickedAt = 0;
let stateSelected = false;
let savedOnce = false;
let accountDone = false;
let payMethodClickedAt = 0;
let lastUpiClickAt = 0;
let profileDone = false;      // true once profile is Individual (or no profile control)
let profileAttempts = 0;
let startFreeClicks = 0;      // console frame: taps of "Start free" (needs 2: select + confirm)
let startFreeAt = 0;
let startFreeForIndex = -1;   // which intern the tap budget belongs to
let phantomStrikes = 0;       // consecutive "no QR in DOM" beats for phantom-heal
let lastFleetBeat = 0;        // last FLEET_BEAT sent from this frame

function visibleInputs(sel) {
  return [...document.querySelectorAll(sel)].filter(el => {
    if (el.closest("#gcp-auto-panel")) return false;
    if (el.disabled) return false;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    return true;
  });
}

// ---- UPI row helpers (payments frame) ----
// The payment-method list has rows like:
//   <div role="button" data-is-selected="true">Add payment method</div>
//   <div role="button" data-is-selected="false">Pay by UPI QR code</div>
// "Start free" must ONLY be clicked when the UPI row is data-is-selected=true.
function findUpiRow() {
  const rows = [...document.querySelectorAll('[role="button"], [role="option"], [role="radio"]')];
  let r = rows.find(el => (el.textContent || "").toLowerCase().includes("pay by upi qr code"));
  if (r) return r;
  r = rows.find(el => (el.textContent || "").toLowerCase().includes("upi qr code"));
  if (r) return r;
  r = rows.find(el => (el.textContent || "").toLowerCase().includes("pay by upi"));
  if (r) return r;
  // Fallback: any clickable whose text mentions UPI
  return findByText("Pay by UPI QR code") || findByText("UPI QR code") || findByText("Pay by UPI");
}

function isRowSelected(row) {
  if (!row) return false;
  if (row.getAttribute("data-is-selected") === "true") return true;
  if (row.getAttribute("aria-selected") === "true") return true;
  if (row.getAttribute("aria-checked") === "true") return true;
  // Some variants put the flag on a child
  const inner = row.querySelector('[data-is-selected="true"], [aria-selected="true"], [aria-checked="true"]');
  return !!inner;
}

// Top-frame backup: the billing page's own "Payment method" summary shows the
// chosen method (e.g. "UPI: QR code" + Change). Independent of iframe state.
function topUpiConfirmed() {
  try {
    const t = (document.body.innerText || "").toLowerCase();
    const i = t.indexOf("payment method");
    if (i < 0) return false;
    const slice = t.slice(i, i + 600);
    return slice.includes("upi") && slice.includes("qr code");
  } catch (e) { return false; }
}

// A positively-selected NON-UPI method row (genuine switch away from UPI).
function selectedNonUpiRow() {
  try {
    const rows = [...document.querySelectorAll('[role="button"], [role="option"], [role="radio"]')];
    return rows.find(el => {
      const t = (el.textContent || "").toLowerCase();
      if (t.includes("upi")) return false;
      return el.getAttribute("data-is-selected") === "true" ||
             el.getAttribute("aria-selected") === "true" ||
             el.getAttribute("aria-checked") === "true";
    }) || null;
  } catch (e) { return null; }
}

function isUpiSelectedNow() {
  return isRowSelected(findUpiRow());
}

// Start free must be tapped TWICE (select + confirm) before any QR is trusted.
// Tap counts live in storage (top frame clicks, payment frame verifies).
function startFreeTappedTwice(s, idx) {
  try {
    const i = (typeof idx === "number") ? idx : (s ? s.currentIndex : -1);
    return !!s && s.startFreeTapsFor === i && (s.startFreeTaps || 0) >= 2;
  } catch (e) { return false; }
}

// Type into a field only if it doesn't already hold the target value.
async function setField(input, value) {
  if (!input) return false;
  if ((input.value || "").trim() === value.trim()) return true; // already correct
  await humanType(input, value);
  return true;
}

// The value currently shown INSIDE a combobox (its own text only, so we don't
// pick up the surrounding descriptive paragraph).
function comboValueText(el) {
  const valNode = el.querySelector("[class*='fmcmS'], .VfPpkd-uusGie-fmcmS, span");
  const t = (valNode && valNode.textContent) ? valNode.textContent : (el.textContent || "");
  return t.toLowerCase();
}

// Pick an option (li / [role=option]) whose EXACT text matches.
async function pickExactOption(text) {
  const w = text.trim().toLowerCase();
  await waitFor(() => {
    const o = document.querySelector("li[role='option'], [role='option'], li.VfPpkd-StrnGf-rymPhb-ibnC6b");
    return (o && isVisible(o)) ? o : null;
  }, 3500);
  await randDelay(250, 600);
  const opts = [...document.querySelectorAll("li[role='option'], [role='option'], li.VfPpkd-StrnGf-rymPhb-ibnC6b")].filter(isVisible);
  let opt = opts.find(o => (o.textContent || "").trim().toLowerCase() === w);
  if (!opt) opt = opts.find(o => (o.textContent || "").trim().toLowerCase().startsWith(w));
  if (opt) { await humanClick(opt); return true; }
  return false;
}

// Precise accessible name of a control: ONLY aria-label / aria-labelledby
// (never ancestor text), so the descriptive paragraph can't fool us.
function accName(el) {
  const al = el.getAttribute("aria-label");
  if (al) return al.toLowerCase();
  const lb = el.getAttribute("aria-labelledby");
  if (lb) {
    let t = "";
    lb.split(/\s+/).forEach(id => { const e = document.getElementById(id); if (e) t += " " + e.textContent; });
    return t.toLowerCase();
  }
  return "";
}

// Click the "Individual" option inside an open Profile-type listbox.
async function clickIndividualOption() {
  await waitFor(() =>
    document.querySelector("[aria-label='Profile type'] li[role='option'], ul[aria-label='Profile type'] li"),
  3000);
  const lb = document.querySelector("ul[aria-label='Profile type'], [role='listbox'][aria-label='Profile type']");
  if (!lb) return false;
  const opts = [...lb.querySelectorAll("li[role='option'], li")];
  let opt = opts.find(li => (li.querySelector("[jsname='K4r5Ff']") || li).textContent.trim().toLowerCase().startsWith("individual"));
  if (!opt) opt = opts.find(li => li.getAttribute("data-value") === "21");
  if (opt) { await humanClick(opt); return true; }
  return false;
}

// Force an INDIVIDUAL profile and confirm it. Sets profileDone=true only when
// Individual is actually selected (or there is genuinely no profile control).
// Returns true if it just changed something (caller should let the DOM settle).
async function ensureIndividualProfile() {
  // (a) checkbox variant: "This is for an organization" -> uncheck
  const orgCb = [...document.querySelectorAll('input[type="checkbox"]')].find(cb => {
    if (cb.closest("#gcp-auto-panel")) return false;
    return fieldLabelText(cb).includes("organization");
  });
  if (orgCb && orgCb.checked) {
    await humanClick(orgCb);
    await randDelay(700, 1200);
    profileDone = true;
    return true;
  }

  if (profileDone) return false;

  // (b) dropdown variant. Find the Profile-type combobox precisely by acc name.
  const combos = [...document.querySelectorAll("[role='combobox'], [aria-haspopup='listbox'], .VfPpkd-aPP78e")]
    .filter(el => isVisible(el) && !el.closest("[role='listbox']"));

  let profile = combos.find(c => accName(c).includes("profile"));

  // Already Individual? (read the control's own value text only)
  if (profile) {
    const v = (profile.textContent || "").toLowerCase();
    if (v.includes("individual") && !v.includes("organization")) { profileDone = true; return false; }
  }

  // Open the profile dropdown and select Individual
  if (profile) {
    setStatus("Setting Profile type to Individual...");
    const anchor = profile.querySelector(".VfPpkd-aPP78e") || profile;
    await humanClick(anchor);
    if (await clickIndividualOption()) { profileDone = true; await randDelay(800, 1300); return true; }
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  } else {
    // Fallback: open each dropdown, check if it's the Profile-type listbox
    for (const c of combos) {
      await humanClick(c.querySelector(".VfPpkd-aPP78e") || c);
      await randDelay(500, 900);
      if (document.querySelector("[aria-label='Profile type']")) {
        if (await clickIndividualOption()) { profileDone = true; await randDelay(800, 1300); return true; }
      }
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await randDelay(250, 500);
    }
  }

  // Give up after several tries (assume no profile control in this variant)
  profileAttempts++;
  if (profileAttempts >= 5) profileDone = true;
  return false;
}

// Fill the address. Once the profile is Individual there is no "Organization
// name" field, so the empty text boxes (excluding the address-autocomplete
// search box and the pre-filled Legal name) are, in order: Street, Apt, City.
// Pin is the tel input. This positional mapping matches the recorded flow and
// adapts to the 1-3 text-field variants.
// Find a field by its label. includeCombo=true also considers the
// search/combobox autocomplete input (the "Street address" field is one).
function findFieldByLabel(needles, includeCombo) {
  const arr = Array.isArray(needles) ? needles : [needles];
  const inputs = [...document.querySelectorAll("input, textarea")].filter(el => {
    if (el.closest("#gcp-auto-panel")) return false;
    if (el.type === "checkbox" || el.type === "radio" || el.type === "hidden") return false;
    if (!includeCombo && (el.type === "search" || el.getAttribute("role") === "combobox")) return false;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    return true;
  });
  for (const needle of arr) {
    const n = needle.toLowerCase();
    for (const input of inputs) {
      if (fieldLabelText(input).includes(n)) return input;
    }
  }
  return null;
}

// Type into the Street address autocomplete (a search/combobox). Type the text,
// then move focus away WITHOUT selecting a suggestion so our value is kept.
async function typeAddressSearch(el, text) {
  const wait0 = Date.now();
  while (typingLock && Date.now() - wait0 < 15000) { await randDelay(60, 140); }
  typingLock = true;
  try {
    el.focus();
    el.dispatchEvent(new Event("focus", { bubbles: true }));
    await randDelay(200, 450);
    const setter = nativeValueSetter(el);
    setter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    // Same rule as humanType: set the exact prefix, never read el.value back.
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      setter.call(el, text.slice(0, i + 1));
      el.dispatchEvent(new KeyboardEvent("keydown", { key: c, bubbles: true }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key: c, bubbles: true }));
      await randDelay(45, 150);
    }
    await randDelay(300, 600);
    if ((el.value || "") !== text) {
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } finally {
    typingLock = false;
  }
}

// Fill the address by matching each field's label. Street address is the
// search/combobox (type=search role=combobox); Apt/City are plain text; Pin is
// the tel input; State is handled separately.
async function fillAddressFields(addr, intern) {
  // Legal name (usually pre-filled)
  const nameField = findFieldByLabel(["legal name"]);
  if (nameField && !(nameField.value || "").trim() && intern && intern.name) {
    await setField(nameField, intern.name);
    await randDelay(300, 700);
  }

  // Street address — this is the autocomplete search/combobox, so includeCombo
  const street = findFieldByLabel(["street address", "address line 1", "address line", "street"], true);
  let streetOk = false;
  if (street) {
    if ((street.value || "").trim() !== addr.line) await typeAddressSearch(street, addr.line);
    streetOk = !!(street.value || "").trim();
    await randDelay(300, 700);
  }

  // Apt / suite (plain text)
  const apt = findFieldByLabel(["apt", "suite", "address line 2", "unit", "floor"]);
  if (apt) { await setField(apt, addr.apt); await randDelay(300, 700); }

  // City (plain text)
  const city = findFieldByLabel(["city", "town", "district"]);
  if (city) { await setField(city, addr.city); await randDelay(300, 700); }

  // Pin code — labelled field, else the tel input
  let pin = findFieldByLabel(["pin code", "pincode", "postal", "zip"]);
  if (!pin) pin = visibleInputs('input[type="tel"]')[0];
  if (pin) { await setField(pin, addr.pincode); await randDelay(300, 700); }

  return streetOk;
}

// Select the State value. The state control is a Google closure combobox whose
// clickable anchor is an inner div (.VfPpkd-aPP78e); options render as
// li[role=option]. We open it, wait for options, then click the matching one.
async function selectStateCombo(stateName) {
  if (stateSelected) return true;
  const needle = stateName.toLowerCase();

  // Locate the State field precisely by accessible name (aria-label / -labelledby)
  let combo = [...document.querySelectorAll("[role='combobox'], [aria-haspopup='listbox']")]
    .filter(isVisible).find(c => { const l = accName(c); return l.includes("state") || l.includes("province"); });

  // Fallback: any combobox whose surrounding text mentions state
  if (!combo) {
    combo = [...document.querySelectorAll("[role='combobox'], .VfPpkd-aPP78e, [aria-haspopup='listbox']")]
      .filter(isVisible).find(a => comboLabel(a).includes("state"));
  }
  if (!combo) return false;
  // Already chosen? (its own value shows the state)
  if ((combo.textContent || "").toLowerCase().includes(needle)) { stateSelected = true; return true; }

  // Click the inner anchor if present, else the combobox itself
  const anchor = combo.querySelector(".VfPpkd-aPP78e") || combo;
  await humanClick(anchor);

  // Wait for the options list to render
  await waitFor(() => {
    const o = document.querySelector("li[role='option'], [role='option']");
    return (o && isVisible(o)) ? o : null;
  }, 4000);
  await randDelay(300, 700);

  let opts = [...document.querySelectorAll("li[role='option'], [role='option']")].filter(isVisible);
  let opt = opts.find(o => (o.textContent||"").trim().toLowerCase() === needle) ||
            opts.find(o => (o.textContent||"").trim().toLowerCase().includes(needle));
  if (opt) { await humanClick(opt); stateSelected = true; return true; }

  // Retry once by clicking the combobox directly
  await humanClick(combo);
  await waitFor(() => document.querySelector("li[role='option']"), 3000);
  opts = [...document.querySelectorAll("li[role='option'], [role='option']")].filter(isVisible);
  opt = opts.find(o => (o.textContent||"").trim().toLowerCase() === needle) ||
        opts.find(o => (o.textContent||"").trim().toLowerCase().includes(needle));
  if (opt) { await humanClick(opt); stateSelected = true; return true; }
  return false;
}

// Detect that a UPI QR code popup is showing (payment step complete —
// Start free must NOT be pressed anymore).
// Actual popup structure seen in the wild:
//   <img alt="QR code" src="data:image/png;base64,...">
//   <div>Complete this action within</div><span role="timer">3:51</span>
function findQrImage() {
  try {
    // Prefer a VISIBLE match: after a retry the dead QR can linger hidden
    // in the DOM while the fresh one renders beside it.
    const alts = [...document.querySelectorAll("img[alt*='QR' i]")].filter(el => !el.closest("#gcp-auto-panel"));
    const vis = alts.find(el => { try { return el.offsetWidth > 0 && el.offsetHeight > 0; } catch (e) { return false; } });
    const direct = vis || alts[0];
    if (direct && (direct.src || direct.getAttribute("src"))) return direct;
    const t = (document.body.innerText || "").toLowerCase();
    if (t.includes("complete this action within")) {
      const imgs = [...document.querySelectorAll("img")].filter(el => !el.closest("#gcp-auto-panel"));
      const visData = imgs.find(el => ((el.src || "")).startsWith("data:image") && el.offsetWidth > 0);
      if (visData) return visData;
      const dataImg = imgs.find(el => ((el.src || "")).startsWith("data:image"));
      if (dataImg) return dataImg;
      if (imgs.length) return imgs[0];
    }
  } catch (e) {}
  return null;
}

function upiQrPresent() {
  try {
    if (findQrImage()) return true;
    const t = (document.body.innerText || "").toLowerCase();
    if (t.includes("complete this action within")) return true;
    // Exact markers from the real "Scan QR code to use UPI" dialog
    if (t.includes("scan qr code to use upi")) return true;
    if (t.includes("scan this qr code")) return true;
    if (t.includes("approve upi autopay")) return true;
    if (t.includes("scan") && (t.includes("qr") || t.includes("upi"))) return true;
    if (t.includes("scan the qr") || t.includes("scan this qr")) return true;
    // Canvas-rendered QR + countdown timer variant
    if (document.querySelector('[role="timer"]') && document.querySelector("canvas")) return true;
  } catch (e) {}
  return false;
}

function qrImageSrc() {
  try {
    const img = findQrImage();
    if (img && img.src) return img.src;
    const c = document.querySelector("canvas");
    if (c && c.toDataURL) {
      try { return c.toDataURL("image/png"); } catch (e) {}
    }
  } catch (e) {}
  return "";
}

// Capture + persist the live QR as ONE record: image link + email + time.
// Shows in the panel instantly; best-effort auto-copy of the image link
// (the panel Copy button is the fallback). Returns true when stored anew.
// manual=true (user pressed Grab QR): skips nothing, flags for display.
async function storeQrImage(src, manual) {
  try {
    if (!src) return false;
    failureReportedFor = "";   // fresh QR → allow reporting a future failure again
    const st = await getState();
    if (!manual && src === st.qrImage && st.qrReady && st.qrReadyFor === st.currentIndex) return false;
    const intern0 = currentIntern(st);
    const email0 = (intern0 && intern0.email) || st.qrEmail || "";
    const now = Date.now();
    const log = Array.isArray(st.qrLog) ? st.qrLog.slice(0, 9) : [];
    log.unshift({ email: email0, at: now, len: src.length });
    const patch = { qrReady: true, qrReadyFor: st.currentIndex, qrEmail: email0, qrAt: now, qrImage: src, qrLog: log };
    if (manual) { patch.qrGrabbed = true; patch.qrGrabbedFor = st.currentIndex; patch.qrGrabRequest = null; }
    await safeSet(patch);
    try { await navigator.clipboard.writeText(src); } catch (e) {}
    // Fleet: report QR to dashboard (background uploads via WS/REST).
    try {
      if (extAlive()) chrome.runtime.sendMessage({ type: "FLEET_EVENT", kind: "qr", email: email0, image: src, at: now }, () => { try { void chrome.runtime.lastError; } catch (e) {} });
    } catch (e) {}
    return true;
  } catch (e) { return false; }
}

// Signal the top frame (cross-origin iframe can't be seen from console page):
// QR is up -> NEVER click Start free again for this account.
async function signalQrReady() {
  try {
    const state = await getState();
    // Never trust a QR before Start free was tapped twice for this account
    // (kills stale-QR confusion while the address form is still being filled).
    if (!startFreeTappedTwice(state, state.currentIndex)) return;
    if (state.qrReady && state.qrReadyFor === state.currentIndex) return; // already signalled
    const src = qrImageSrc();
    if (src) { await storeQrImage(src); return; }
    const intern = currentIntern(state);
    await safeSet({
      qrReady: true,
      qrReadyFor: state.currentIndex,
      qrEmail: intern ? intern.email : "",
      qrAt: Date.now()
    });
  } catch (e) {}
}

// Mark QR shown. The pointer STAYS on this account through scan / pay /
// failure-retry; advance happens only on prepayment SUCCESS (or manual
// "Mark done → next"). Auto-advancing on QR sighting orphaned every gate.
async function markDoneIfQr() {
  if (!upiQrPresent()) return false;
  // 2-tap proof required: a QR-looking DOM before Start free ×2 is stale/trash.
  try {
    const st0 = await getState();
    if (!startFreeTappedTwice(st0, st0.currentIndex)) {
      setStatus("Waiting for 2 Start-free taps before trusting any QR...");
      return false;
    }
  } catch (e) {}
  await signalQrReady(); // stop Start-free clicks while QR is up
  if (accountDone) return true;
  accountDone = true;
  const state = await getState();
  const intern = currentIntern(state);
  if (intern && intern.status !== "done") {
    if (!(intern.note || "").includes("QR shown")) {
      await updateIntern(state.currentIndex, { note: ((intern.note || "") + " — QR shown, waiting scan").trim() });
    }
    setStatus("UPI QR showing for " + intern.email + " — scan it, do NOT press Start free.");
  } else {
    setStatus("UPI QR is showing — do NOT press Start free. Scan it to pay.");
  }
  if (IS_TOP) renderPanel();
  return true;
}

// ---- Billing-failure retry (same account) ----
// After a failed UPI scan Google shows:
//   "Billing setup can't be completed"
//   "This action couldn't be completed. Try again with a different,
//    supported payment method. [OR_BACR2_46]" + an "Ok" button.
// Retry is USER-GATED: the extension never auto-retries a failed scan. It
// reports the failure and waits. The user taps "Generate new QR" in their
// portal, which taps Ok (dismiss) + Start free (fresh QR) on the same account.
let lastFailureAt = 0;
let failureReportedFor = "";

function findBillingOkButton() {
  // Dismiss button of a billing-failure dialog: exact "Ok" (OR_BACR2 case) or
  // exact "Try again" (OR_MIVEM "Transaction wasn't completed" case).
  // Exact-text match only — never the "Start free" button.
  // Pierces open shadow roots: Google renders these buttons under jsshadow.
  try {
    const btns = [];
    const walk = (root) => {
      try {
        root.querySelectorAll("button").forEach(b => btns.push(b));
        root.querySelectorAll("*").forEach(el => { if (el.shadowRoot) walk(el.shadowRoot); });
      } catch (e) {}
    };
    walk(document);
    const hit = btns.filter(el => {
      if (el.closest("#gcp-auto-panel")) return false;
      if (!isVisible(el) || el.disabled) return false;
      const t = (el.textContent || "").trim().toLowerCase();
      return t === "ok" || t === "try again";
    });
    return hit[0] || null;
  } catch (e) { return null; }
}

// Returns the dismiss button when a billing-failure dialog is visible in THIS frame.
function billingFailurePresent() {
  try {
    const t = (document.body.innerText || "").toLowerCase();
    const marker = t.includes("billing setup can't be completed") ||
      t.includes("billing setup cant be completed") ||
      t.includes("billing setup can’t be completed") ||
      t.includes("or_bacr2") ||
      t.includes("transaction wasn't completed") ||
      t.includes("transaction wasnt completed") ||
      t.includes("transaction wasn’t completed") ||
      t.includes("something went wrong with this payment") ||
      t.includes("or_mivem") ||
      (t.includes("this action couldn't be completed") && t.includes("payment method")) ||
      (t.includes("this action couldn’t be completed") && t.includes("payment method"));
    if (!marker) return null;
    return findBillingOkButton();
  } catch (e) { return null; }
}

async function handleBillingFailure(manual) {
  if (!extAlive()) return "gone";
  const okBtn = billingFailurePresent();
  // Auto path: only act when the failure dialog is actually on screen.
  // Manual path (user tapped Retry in the portal): allowed to run without it.
  if (!manual && !okBtn) return null;

  const state = await getState();
  // Which account failed? Normally the pointer never left it (no auto-advance
  // mid-flow), so currentIndex IS the failed account. Only when the pointer is
  // off any live account (ghost past-the-end, or sitting on a done one) do we
  // fall back to the QR'd account. A live pointer is never yanked elsewhere.
  const curLive = state.interns[state.currentIndex] &&
    (state.interns[state.currentIndex].status === "in_progress" || state.interns[state.currentIndex].status === "failed");
  let failedIdx = state.currentIndex;
  if (!curLive && typeof state.qrReadyFor === "number" && state.qrReadyFor >= 0 &&
      state.interns[state.qrReadyFor]) {
    failedIdx = state.qrReadyFor;
  }
  const failedEmail = (state.interns[failedIdx] && state.interns[failedIdx].email) || ("account #" + (failedIdx + 1));
  // Grab the Google error code for the note (e.g. OR_BACR2_46)
  let orCode = "";
  try {
    const m = (document.body.innerText || "").match(/OR_[A-Z0-9_]+/i);
    if (m) orCode = m[0].toUpperCase();
  } catch (e) {}

  if (!manual) {
    // AUTO: dismiss the failure dialog so the page never gets stuck, report the
    // failure ONCE, and STOP — never tap Start free on our own. The user taps
    // "Generate new QR" in their portal, which runs the manual path below.
    if (failureReportedFor === failedEmail) return "already";
    if (Date.now() - lastFailureAt < 8000) return "throttled";
    lastFailureAt = Date.now();
    failureReportedFor = failedEmail;
    if (okBtn) {
      let btnLabel = "Ok";
      try { btnLabel = (okBtn.textContent || "Ok").trim() || "Ok"; } catch (e) {}
      setStatus("Payment failed" + (orCode ? " [" + orCode + "]" : "") + " — dismissing \"" + btnLabel + "\"...");
      if (IS_TOP) renderPanel();
      await randDelay(1500, 2600);
      try { await humanClick(okBtn); }
      catch (e) { try { okBtn.click(); } catch (_) {} }
      await randDelay(1000, 1600);
    }
    const interns = Array.isArray(state.interns) ? state.interns.slice() : [];
    if (interns[failedIdx]) {
      interns[failedIdx] = { ...interns[failedIdx], status: "failed", note: "payment failed" + (orCode ? " [" + orCode + "]" : "") + " — waiting for user" };
    }
    await safeSet({ interns, currentIndex: failedIdx, payRetryFor: failedIdx, payRetryCount: 1 });
    setStatus("Payment failed" + (orCode ? " [" + orCode + "]" : "") + " — tap \u201cGenerate new QR\u201d in your portal.");
    try {
      if (extAlive()) chrome.runtime.sendMessage({ type: "FLEET_EVENT", kind: "failed", email: failedEmail, text: "payment failed" + (orCode ? " [" + orCode + "]" : "") }, () => { try { void chrome.runtime.lastError; } catch (e) {} });
    } catch (e) {}
    if (IS_TOP) renderPanel();
    return "failed-waiting";
  }

  // MANUAL (user tapped Generate new QR in the portal): dismiss any lingering
  // dialog, then Start free to mint a fresh QR on the same account.
  failureReportedFor = "";
  if (okBtn) {
    let btnLabel = "Ok";
    try { btnLabel = (okBtn.textContent || "Ok").trim() || "Ok"; } catch (e) {}
    setStatus("Generating new QR — tapping \"" + btnLabel + "\", then Start free...");
    if (IS_TOP) renderPanel();
    await randDelay(1200, 2000);
    try { await humanClick(okBtn); }
    catch (e) { try { okBtn.click(); } catch (_) {} }
    await randDelay(800, 1400);
  }
  const interns2 = Array.isArray(state.interns) ? state.interns.slice() : [];
  if (interns2[failedIdx]) {
    interns2[failedIdx] = { ...interns2[failedIdx], status: "in_progress", note: "retry — generating fresh QR" };
  }
  await safeSet({
    qrReady: false, qrReadyFor: -1, qrImage: "", qrEmail: "", qrAt: 0, qrLog: [],
    qrGrabbed: false, qrGrabbedFor: -1,
    payRetryFor: failedIdx, payRetryCount: 0, upiSelectedFor: failedIdx,
    interns: interns2, currentIndex: failedIdx
  });
  accountDone = false;
  startFreeClicks = 0; startFreeAt = 0; startFreeForIndex = failedIdx;
  lastUpiClickAt = 0;
  setStatus("Retry — pressing Start free for a fresh QR...");
  try {
    if (extAlive()) chrome.runtime.sendMessage({ type: "FLEET_EVENT", kind: "retrying", email: failedEmail, text: "user retry" }, () => { try { void chrome.runtime.lastError; } catch (e) {} });
  } catch (e) {}
  if (IS_TOP) renderPanel();
  return "retried";
}

async function maybeHandleBillingFailure() {
  if (!extAlive() || stopped) return;
  if (!IS_TOP) return;
  const page = detectPage();
  if (page !== "billing" && page !== "console") return;
  try {
    // Success terminal first: ₹1,000 prepayment dialog means the scan worked.
    if (prepaymentSuccessPresent()) { await handlePrepaymentSuccess(); renderPanel(); return; }
    if (!billingFailurePresent()) return;
    const st = await getState();
    if (!st.config.autoRun) { setStatus("Payment failed — click Ok, then ↻ Retry."); return; }
    await handleBillingFailure(false);
    renderPanel();
  } catch (e) {}
}

// ---- Scan-success terminal ----
// After Start free → QR → user scans & pays, Google shows:
//   "One-time prepayment required"
//   "Your payment method requires you to make a one-time, ₹1,000.00
//    prepayment... This prepayment is refundable..."
// That dialog MEANS THE SCAN SUCCEEDED. Message it, mark done, touch nothing.
function prepaymentSuccessPresent() {
  try {
    const t = (document.body.innerText || "").toLowerCase();
    if (t.includes("one-time prepayment required")) return true;
    if (t.includes("one time prepayment required")) return true;
    if (t.includes("prepayment") && t.includes("refundable")) return true;
    if (t.includes("prepayment") && t.includes("free trial credits")) return true;
  } catch (e) {}
  return false;
}

async function handlePrepaymentSuccess() {
  if (!extAlive()) return "gone";
  const state = await getState();
  const interns = Array.isArray(state.interns) ? state.interns.slice() : [];
  // Attribute to the QR'd account: payment always follows ITS scan, even
  // though the pointer already advanced (mid-list next account, or ghost 2/1).
  let idx = state.currentIndex;
  if (typeof state.qrReadyFor === "number" && state.qrReadyFor >= 0 && interns[state.qrReadyFor]) {
    idx = state.qrReadyFor;
  }
  if (state.paySuccess && state.paySuccessFor === idx) return "already";
  const intern = interns[idx];
  const email = (intern && intern.email) || ("account #" + (idx + 1));
  const patch = { paySuccess: true, paySuccessFor: idx, paySuccessAt: Date.now(), payEmail: email };
  if (intern && (intern.status === "in_progress" || intern.status === "failed")) {
    interns[idx] = { ...intern, status: "done", note: ((intern.note || "") + " — scan successful").trim() };
    patch.interns = interns;
  } else if (intern) {
    interns[idx] = { ...intern, note: ((intern.note || "") + " — scan successful").trim() };
    patch.interns = interns;
  }
  await safeSet(patch);
  accountDone = true; // stop touching the payment form; prepayment is manual
  setStatus("✅ Scan successful — " + email + " COMPLETED. ₹1,000 prepayment dialog showing; complete it manually.");
  // Fleet: report success to dashboard.
  try {
    if (extAlive()) chrome.runtime.sendMessage({ type: "FLEET_EVENT", kind: "success", email, text: "scan successful — prepayment dialog" }, () => { try { void chrome.runtime.lastError; } catch (e) {} });
  } catch (e) {}
  // Advance to the next account (batch flow). QR/success trails are kept and
  // index-scoped, so the ghost end-view still shows this account's cards.
  try { await advance(); } catch (e) {}
  if (IS_TOP) renderPanel();
  return "recorded";
}

// Main repeating routine for payment frames
async function fillPaymentFrame() {
  if (running) return;
  // QR check FIRST (before the autoRun gate): once the QR popup is up we must
  // capture its image + stop everything, even if the user paused auto-fill.
  // 2-tap proof required — a QR-looking DOM before Start free ×2 is ignored.
  // Success terminal (prepayment dialog) also checked here — scan worked.
  try {
    if (prepaymentSuccessPresent()) {
      running = true;
      try { await handlePrepaymentSuccess(); }
      finally { running = false; }
      return;
    }
    if (upiQrPresent()) {
      const stPre = await getState();
      if (!startFreeTappedTwice(stPre, stPre.currentIndex)) {
        setStatus("Ignoring early QR-like content — Start free ×2 first...");
        return;
      }
      running = true;
      try {
        const src = qrImageSrc();
        // One record: image link + email + time → panel instantly (+auto-copy try)
        if (await storeQrImage(src)) {
          const em = (currentIntern(await getState()) || {}).email || "";
          setStatus("QR captured" + (em ? " for " + em : "") + " — shown in panel. Scan it, do NOT press Start free.");
        }
        await markDoneIfQr();
      } finally { running = false; }
      return;
    }
  } catch (e) {}
  // Billing-failure dialog? Click Ok + retry Start free on the SAME account
  // (before the autoRun gate — a dead QR/error must never block dismissal).
  try {
    if (billingFailurePresent()) {
      const st0 = await getState();
      if (!st0.config.autoRun) { setStatus("Payment failed — click Ok, then ↻ Retry."); return; }
      running = true;
      try { await handleBillingFailure(false); }
      finally { running = false; }
      return;
    }
  } catch (e) {}
  const state = await getState();
  if (!state.config.autoRun) return;
  const intern = currentIntern(state);
  // Ghost index (list done, pointer past the end): don't fill forms for nobody.
  if (!intern && state.interns.length > 0) {
    setStatus("All interns done (" + state.interns.length + "/" + state.interns.length + ") — add more or Reset.");
    return;
  }
  const addr = await getAddrForIndex(state.currentIndex);

  running = true;
  try {
    // Mark done as soon as the QR appears (checked every tick)
    await markDoneIfQr();
    if (accountDone) return; // stop touching the form once this account is done

    // 0) UPI payment-method row: ONLY mark upiSelected when the UPI row is
    //    actually data-is-selected="true". The flag is STICKY once set for this
    //    account: between Start-free tap-1 and tap-2 the iframe shows a spinner
    //    / reloads and the rows vanish briefly — that must NOT clear the flag
    //    or tap-2 will never fire.
    const upiRow = findUpiRow();
    if (upiRow) {
      if (isRowSelected(upiRow)) {
        const st0 = await getState();
        if (!st0.upiSelected) await safeSet({ upiSelected: true, upiSelectedFor: state.currentIndex });
        setStatus("UPI QR code selected — Start free will tap twice (select + confirm)...");
        return;
      }
      // UPI visible but NOT selected. During an ARMED retry (same account,
      // QR dead, no rival method positively selected) the post-Ok transition
      // flaps — HOLD the sticky flag so Start free taps resume, while still
      // clicking the row to genuinely (re)select it.
      const stX = await getState();
      const armedHold = stX.payRetryFor === state.currentIndex && !stX.qrReady && !selectedNonUpiRow();
      if (!armedHold) await safeSet({ upiSelected: false });
      if (Date.now() - lastUpiClickAt > 5000) {
        lastUpiClickAt = Date.now();
        setStatus(armedHold ? "Retry armed — re-selecting UPI, holding Start-free gate..." : "Selecting Pay by UPI QR code...");
        await humanClick(upiRow);
      } else {
        setStatus(armedHold ? "Retry armed — holding UPI confirmation for Start free..." : "Waiting for UPI QR code selection to register...");
      }
      return;
    }
    // No UPI row visible (spinner / iframe reload between tap-1 and tap-2,
    // or chooser not opened yet) -> KEEP the sticky flag, don't clear it.
    {
      const st0 = await getState();
      if (st0.upiSelected) {
        setStatus("UPI confirmed — waiting for Start free taps / QR...");
        return;
      }
    }

    const hasTextInputs = visibleInputs('input[type="text"], input[type="tel"], input:not([type])').length > 0;

    // A) buttons-only frame (buyflow2): open address form, then payment method
    if (!hasTextInputs) {
      // A1) open the address form (only before it has been saved)
      const addBtn = findByText("Add name and address");
      if (addBtn && !savedOnce && Date.now() - addAddrClickedAt > 8000) {
        addAddrClickedAt = Date.now();
        setStatus("Opening address form...");
        await humanClick(addBtn);
        return;
      }
      // A2) once address is done, open the payment method chooser
      const payBtn = findByText("Add payment method");
      if (payBtn && Date.now() - payMethodClickedAt > 6000) {
        payMethodClickedAt = Date.now();
        setStatus("Adding payment method...");
        await humanClick(payBtn);
        return;
      }
      return;
    }

    // B) modaliframe: the actual address form.
    // FIRST make the profile Individual and CONFIRM it. Never fill the address
    // until profileDone is true, or the address lands in "Organization name".
    const profileChanged = await ensureIndividualProfile();
    if (profileChanged) { await randDelay(900, 1500); return; } // let the form re-render
    if (!profileDone) {
      setStatus("Waiting to set Profile type to Individual...");
      await randDelay(500, 900);
      return;
    }
    await randDelay(400, 900);
    const streetOk = await fillAddressFields(addr, intern);
    await randDelay(500, 1000);
    await selectStateCombo(addr.state);
    await randDelay(500, 1000);

    // C) Save once — only when required fields (street, pin, state) are set
    const pinOk = (findInputByLabelText(["pin","postal","zip"]) || visibleInputs('input[type="tel"]')[0] || {}).value;
    if (streetOk && stateSelected && pinOk && String(pinOk).trim().length >= 5 && !savedOnce) {
      const saveBtn = findByText("Save");
      if (saveBtn) { savedOnce = true; setStatus("Saving address, then adding payment method..."); await humanClick(saveBtn); }
    }
  } finally { running = false; }
}

// Reaching the console does NOT mean done. We only report status here; the
// account is marked done when the UPI QR is generated (see markDoneIfQr).
async function handleConsole(state) {
  const intern = currentIntern(state);
  if (intern && intern.status === "in_progress") {
    setStatus("Signed in. Finish billing + generate the UPI QR to complete " + intern.email + ".");
  }
}

async function runForCurrentPage(manual) {
  const page = detectPage();
  const state = await getState();
  if (!state.config.autoRun && !manual) return;
  switch (page) {
    case "email":   return handleEmail(state);
    case "otp":     return handleOtp(state);
    case "tos":     return handleTos(state);
    case "billing": return handleBilling(state);
    case "payment": return fillPaymentFrame();
    case "console": return handleConsole(state);
  }
}

// ==================== PANEL ====================

let panelEl = null, statusText = "Ready.";
function setStatus(t) { statusText = t; const s = document.getElementById("gcp-auto-status"); if (s) s.textContent = t; }

async function renderPanel() {
  if (!IS_TOP) return;
  const state = await getState();
  const intern = currentIntern(state);
  const total = state.interns.length;
  const done = state.interns.filter(i => i.status === "done").length;
  const failed = state.interns.filter(i => i.status === "failed").length;
  const addr = await getAddrForIndex(state.currentIndex);

  if (!panelEl) { panelEl = document.createElement("div"); panelEl.id = "gcp-auto-panel"; document.documentElement.appendChild(panelEl); }

  const paySame = state.paySuccess && state.paySuccessFor === state.currentIndex;
  // Ghost view (list done, pointer past end): show the paid account's success.
  const ghostPay = !intern && state.interns.length > 0 && state.paySuccess &&
    state.paySuccessFor === state.qrReadyFor && !!state.interns[state.paySuccessFor];
  const payOk = paySame || ghostPay;
  // Manually grabbed QR also counts for display (user confirmed it on screen).
  const grabShow = state.qrGrabbed && (state.qrGrabbedFor === state.currentIndex ||
    (!intern && state.interns.length > 0 && state.qrGrabbedFor === state.qrReadyFor));
  // Ghost view (list done, pointer past end): still show the QR that the
  // finished account generated — otherwise a captured QR looks "missing".
  const ghostQr = !intern && state.interns.length > 0 && state.qrReady && !payOk &&
    !!state.interns[state.qrReadyFor] && startFreeTappedTwice(state, state.qrReadyFor);
  const qrShow = ((state.qrReady && state.qrReadyFor === state.currentIndex &&
    startFreeTappedTwice(state, state.currentIndex) && !paySame) || ghostQr || grabShow) && !!state.qrImage;
  // One-line diagnostics: proves which frames are alive + what capture sees.
  let dbgHtml = "";
  try {
    const ago = state.payBeatAt ? Math.max(0, Math.round((Date.now() - state.payBeatAt) / 1000)) : -1;
    let topUpiDbg = false;
    try { topUpiDbg = topUpiConfirmed(); } catch (e) {}
    dbgHtml = `<div class="gcp-auto-progress">payframe: ${ago < 0 ? "never ❌" : ago + "s ago"} | QRinDOM: ${state.paySawQr ? "yes" : "no"} | img: ${(state.payImgLen || 0)}b | taps: ${(state.startFreeTaps || 0)} | frUpi: ${state.upiSelected ? "y" : "n"} | topUpi: ${topUpiDbg ? "y" : "n"}</div>`;
  } catch (e) {}
  let qrTime = "";
  try { if (qrShow && state.qrAt) qrTime = " (updated " + new Date(state.qrAt).toLocaleTimeString() + ")"; } catch (e) {}
  const qrHtml = qrShow ? `
      <div class="gcp-auto-qr">
        ${state.qrImage ? `<img id="gcp-auto-qrimg" src="${state.qrImage}" alt="UPI QR" />` : ``}
        <div class="gcp-auto-qr-label">QR ready${qrTime}${state.qrEmail ? " — " + state.qrEmail : ""} — scan it. Do NOT press Start free.</div>
        <div class="gcp-auto-btns">
          <button id="gcp-auto-copyqr">Copy image URL</button>
          ${state.qrImage ? `<a id="gcp-auto-dlqr" href="${state.qrImage}" download="upi-qr-${(intern && intern.email) || "code"}.png">Save</a>` : ``}
        </div>
      </div>` : ``;
  let payTime = "";
  try { if (payOk && state.paySuccessAt) payTime = " (" + new Date(state.paySuccessAt).toLocaleTimeString() + ")"; } catch (e) {}
  const payWho = state.payEmail || ((state.interns[state.paySuccessFor] || {}).email) || "";
  const payHtml = payOk ? `
      <div class="gcp-auto-qr">
        <div class="gcp-auto-qr-label">✅ Scan successful${payTime}${payWho ? " — " + payWho : ""} — COMPLETED. Complete the ₹1,000 prepayment manually.</div>
      </div>` : ``;

  panelEl.innerHTML = `
    <div class="gcp-auto-head"><span>GCP Intern Signup</span><button id="gcp-auto-collapse">_</button></div>
    <div class="gcp-auto-body">
      <div class="gcp-auto-current">
        <div class="gcp-auto-label">CURRENT (${total?state.currentIndex+1:0}/${total})</div>
        <div class="gcp-auto-email">${intern?intern.email:"-- no intern --"}</div>
        <div class="gcp-auto-addr">${addr.line+", "+addr.city+", "+addr.state+" - "+addr.pincode}</div>
      </div>
      <div class="gcp-auto-progress">Done: ${done}/${total}${failed ? " | Failed: " + failed : ""}</div>
      ${state.payRetryFor === state.currentIndex && (state.payRetryCount || 0) > 0 ? `<div class="gcp-auto-progress">Payment failed ×${state.payRetryCount} — retrying same account</div>` : ``}
      <div id="gcp-auto-status" class="gcp-auto-statusline">${statusText}</div>
      ${qrHtml}
      ${payHtml}
      ${dbgHtml}
      <div class="gcp-auto-btns">
        <button id="gcp-auto-grab" title="Force-capture the visible QR now">📷 Grab QR</button>
        <button id="gcp-auto-fill">Fill this page</button>
      </div>
      <div class="gcp-auto-btns">
        <button id="gcp-auto-next">Mark done &rarr; next</button>
        <button id="gcp-auto-skip">Skip intern</button>
      </div>
      <div class="gcp-auto-btns">
        <button id="gcp-auto-newsignup">New signup tab</button>
        <button id="gcp-auto-signout">Sign out</button>
      </div>
      <div class="gcp-auto-btns">
        <button id="gcp-auto-shuffle" title="New random address for this intern">↻ Addr</button>
        <button id="gcp-auto-retry" title="Payment failed? Click Ok then retry Start free on this same account">↻ Retry</button>
      </div>
      <div class="gcp-auto-btns">
        <label class="gcp-auto-auto"><input type="checkbox" id="gcp-auto-toggle" ${state.config.autoRun?"checked":""}/>Auto-fill</label>
      </div>
    </div>`;

  panelEl.querySelector("#gcp-auto-fill").onclick = () => { otpFilled = false; runForCurrentPage(true); };
  const grabBtn = panelEl.querySelector("#gcp-auto-grab");
  if (grabBtn) grabBtn.onclick = async () => {
    // Top frame first (dialog sometimes lives here), else ask payment frames.
    try {
      if (upiQrPresent()) {
        const src = qrImageSrc();
        if (src && await storeQrImage(src, true)) {
          setStatus("QR grabbed manually — shown in panel with email + time.");
          renderPanel();
          return;
        }
      }
    } catch (e) {}
    const st = await getState();
    await safeSet({ qrGrabRequest: { at: Date.now(), for: st.currentIndex } });
    setStatus("Grab requested — capturing from payment frame...");
    renderPanel();
  };
  panelEl.querySelector("#gcp-auto-next").onclick = async () => { resetFrameFlags(); await advance(); renderPanel(); };
  panelEl.querySelector("#gcp-auto-skip").onclick = async () => { resetFrameFlags(); await updateIntern(state.currentIndex,{status:"failed",note:"skipped"}); await advance(); renderPanel(); };
  panelEl.querySelector("#gcp-auto-newsignup").onclick = () => { if (extAlive()) try { chrome.runtime.sendMessage({type:"OPEN_SIGNUP"}); } catch(e){} };
  panelEl.querySelector("#gcp-auto-signout").onclick = () => { if (extAlive()) try { chrome.runtime.sendMessage({type:"SIGN_OUT"}); } catch(e){} };
  panelEl.querySelector("#gcp-auto-shuffle").onclick = async () => { await reshuffleAddr(state.currentIndex); stateSelected = false; savedOnce = false; setStatus("Shuffled to a new random address."); renderPanel(); };
  const retryBtn = panelEl.querySelector("#gcp-auto-retry");
  if (retryBtn) retryBtn.onclick = async () => {
    setStatus("Manual retry: dismissing dialog, Start free again on same account...");
    await handleBillingFailure(true);
    renderPanel();
  };
  const copyBtn = panelEl.querySelector("#gcp-auto-copyqr");
  if (copyBtn) copyBtn.onclick = async () => {
    const st = await getState();
    const url = st.qrImage || "";
    if (!url) { setStatus("QR image not captured yet."); return; }
    try { await navigator.clipboard.writeText(url); setStatus("QR image URL copied (" + url.length + " chars)."); }
    catch (e) {
      try {
        const ta = document.createElement("textarea");
        ta.value = url; document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); ta.remove();
        setStatus("QR image URL copied (" + url.length + " chars).");
      } catch (e2) { setStatus("Copy failed — right-click the QR > Copy image address."); }
    }
  };
  panelEl.querySelector("#gcp-auto-toggle").onchange = async (e) => { const st = await getState(); st.config.autoRun = e.target.checked; await safeSet({config:st.config}); };
  panelEl.querySelector("#gcp-auto-collapse").onclick = () => panelEl.classList.toggle("gcp-auto-collapsed");
}

function resetFrameFlags() { stateSelected = false; savedOnce = false; addAddrClickedAt = 0; accountDone = false; otpFilled = false; otpFilledFor = -1; payMethodClickedAt = 0; lastUpiClickAt = 0; profileDone = false; profileAttempts = 0; startFreeClicks = 0; startFreeAt = 0; startFreeForIndex = -1; lastFailureAt = 0; phantomStrikes = 0; failureReportedFor = ""; }

// ==================== INIT ====================

let lastUrl = location.href;
timers.push(setInterval(() => {
  if (!extAlive()) { stopAll(); return; }
  if (location.href !== lastUrl) { lastUrl = location.href; setTimeout(() => { runForCurrentPage(false); renderPanel(); }, 2500); }
}, 1500));

// Payment frames: fast QR/failure watcher (1.2s) — independent of the slow
// address-fill loop, so a retried QR replaces the old one in the panel instantly.
let lastBeatAt = 0;
async function watchQrAndFailure() {
  if (!extAlive() || stopped) return;
  try {
    // Heartbeat FIRST (throttled): proves the payment frame is alive even when
    // a QR/failure branch below returns early.
    if (Date.now() - lastBeatAt > 5000) {
      lastBeatAt = Date.now();
      try {
        await safeSet({ payBeatAt: Date.now(), paySawQr: upiQrPresent(), payImgLen: (qrImageSrc() || "").length });
      } catch (e) {}
    }
    // Manual grab request from the panel (bypasses the 2-tap gate on purpose).
    try {
      const st0 = await getState();
      const req = st0.qrGrabRequest;
      if (req && req.for === st0.currentIndex && Date.now() - req.at < 60000) {
        const gsrc = qrImageSrc();
        if (gsrc && await storeQrImage(gsrc, true)) {
          setStatus("QR grabbed manually — shown in panel with email + time.");
          if (IS_TOP) renderPanel();
          return;
        }
      }
    } catch (e) {}
    if (upiQrPresent()) {
      const st = await getState();
      if (!startFreeTappedTwice(st, st.currentIndex)) return; // no trust before 2 taps
      const src = qrImageSrc();
      // One record: image link + email + time → panel instantly (+auto-copy try)
      if (await storeQrImage(src)) {
        const em = (currentIntern(await getState()) || {}).email || "";
        setStatus("QR captured" + (em ? " for " + em : "") + " — shown in panel. Scan it, do NOT press Start free.");
      }
      await markDoneIfQr();
      return;
    }
    // Success terminal: prepayment dialog = scan worked. Message + done.
    if (prepaymentSuccessPresent()) { await handlePrepaymentSuccess(); return; }
    if (billingFailurePresent()) {
      const st = await getState();
      if (st.config.autoRun) await handleBillingFailure(false);
      else setStatus("Payment failed — click Ok, then ↻ Retry.");
    }
  } catch (e) {}
}

// In payment frames, keep trying to fill (modal renders async, formats vary)
if (detectPage() === "payment") {
  timers.push(setInterval(() => { fillPaymentFrame(); }, 3500));
  timers.push(setInterval(() => { if (!running) watchQrAndFailure(); }, 1200));
}

// In the console top frame, click "Start free" once UPI has been selected.
// Runs every 2s and also on page init — catches both same-tab and new-tab flows.
if (IS_TOP) {
  timers.push(setInterval(() => { if (!stopped) maybeClickStartFree(); }, 2000));
  timers.push(setInterval(() => { if (!stopped) maybeHandleBillingFailure(); }, 2500));
  // Fleet heartbeat from the live page (every 3s): keeps the background worker
  // and its WebSocket warm (service workers sleep otherwise) and pulls queued mail.
  timers.push(setInterval(() => {
    if (stopped || !extAlive()) return;
    if (Date.now() - lastFleetBeat < 3000) return;
    lastFleetBeat = Date.now();
    try { chrome.runtime.sendMessage({ type: "FLEET_BEAT", page: detectPage() }, () => { try { void chrome.runtime.lastError; } catch (e) {} }); }
    catch (e) {}
  }, 5000));
}

try {
  chrome.storage.onChanged.addListener((changes) => {
    if (!extAlive()) return;
    renderPanel();
    // User tapped Retry in their portal/dashboard → re-run the failure flow as
    // a manual retry (dismiss + re-tap Start free for a fresh QR).
    try {
      if (changes.retryRequest && changes.retryRequest.newValue) {
        const rr = changes.retryRequest.newValue;
        setTimeout(async () => {
          if (stopped || !extAlive()) return;
          const st = await getState();
          if (rr.for === undefined || rr.for === st.currentIndex) {
            await handleBillingFailure(true);
          }
          await safeSet({ retryRequest: null });
        }, 600);
        return;
      }
    } catch (e) {}
    // New email assigned / account switched / toggled / grab requested:
    // (re)run this page's logic so an idle page picks it up immediately.
    // Beat noise (payBeatAt/taps/etc.) is ignored — only these keys trigger.
    try {
      if (changes.interns || changes.currentIndex || changes.config || changes.qrGrabRequest) {
        setTimeout(() => { if (!stopped && extAlive()) runForCurrentPage(false); }, 1200);
      }
    } catch (e) {}
  });
} catch (e) {}

(async () => {
  await randDelay(2500, 4000);
  if (IS_TOP) await renderPanel();
  await runForCurrentPage(false);
  // Immediately try Start free on load (for second window / redirect scenario)
  if (IS_TOP) await maybeClickStartFree();
})();

})();
