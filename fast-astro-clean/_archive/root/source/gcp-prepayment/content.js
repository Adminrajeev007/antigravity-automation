/* GCP Account Prepayment v1 - Content Script
 * Drives the passwordless email + OTP sign-in:
 *   1. Types the email on the "Create account or sign in" page and clicks Next.
 *   2. On the verification page, fetches the OTP from the code service (with
 *      retries), types it, and clicks Verify.
 * After sign-in, instead of opening Cloud Shell it taps the console's
 * "Make a payment" button and completes the fixed Rs.1000 prepayment.
 * All state lives in chrome.storage.local so it survives page navigations:
 *   loginEmail, loginActive, loginStatus, otpFilled, prepayDone
 */
(() => {
"use strict";
const IS_TOP = window.top === window.self;
const HOST = location.hostname;
// The prepayment form is rendered by Google Payments inside a cross-origin
// iframe (payments.google.com). We run a dedicated handler there; the login
// flow and floating panel run only in the top frame. Any other sub-frame
// (stripe, ogs, gapi, ...) is ignored.
const IS_PAY_FRAME = /(^|\.)payments\.google\.com$/.test(HOST);
if (!IS_TOP && !IS_PAY_FRAME) return;

// ==================== HELPERS ====================
function extAlive() {
  try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
}

async function safeGet(keys) {
  if (!extAlive()) return {};
  try { return await chrome.storage.local.get(keys); } catch (e) { return {}; }
}
async function safeSet(obj) {
  if (!extAlive()) return;
  try { await chrome.storage.local.set(obj); } catch (e) {}
}
async function setStatus(txt) { await safeSet({ loginStatus: txt }); }

// ==================== BACKGROUND KEEP-ALIVE ====================
// Chrome heavily throttles timers in hidden/occluded tabs (switching macOS
// Spaces makes the tab hidden), and macOS App Nap can pause the whole app.
// An active RTCPeerConnection is exempt from Chrome's intensive timer
// throttling, so a loopback data-channel session keeps the automation loops
// running while the Chrome window is on another desktop.
let kaPc1 = null, kaPc2 = null, kaDc = null;

function startKeepAlive() {
  if (kaPc1 || typeof RTCPeerConnection === "undefined") return;
  try {
    const pc1 = new RTCPeerConnection({ iceServers: [] });
    const pc2 = new RTCPeerConnection({ iceServers: [] });
    kaPc1 = pc1; kaPc2 = pc2;

    pc1.onicecandidate = (e) => {
      if (e.candidate) { try { pc2.addIceCandidate(e.candidate).catch(() => {}); } catch (err) {} }
    };
    pc2.onicecandidate = (e) => {
      if (e.candidate) { try { pc1.addIceCandidate(e.candidate).catch(() => {}); } catch (err) {} }
    };
    pc2.ondatachannel = (e) => {
      const ch = e.channel;
      ch.onmessage = () => {};
    };

    kaDc = pc1.createDataChannel("gcpp-keepalive");
    kaDc.onopen = () => {};
    kaDc.onmessage = () => {};

    pc1.createOffer()
      .then(o => pc1.setLocalDescription(o))
      .then(() => pc2.setRemoteDescription(pc1.localDescription))
      .then(() => pc2.createAnswer())
      .then(a => pc2.setLocalDescription(a))
      .then(() => pc1.setRemoteDescription(pc2.localDescription))
      .catch(() => {});
  } catch (e) {
    stopKeepAlive();
  }
}

function stopKeepAlive() {
  try { if (kaDc) kaDc.close(); } catch (e) {}
  try { if (kaPc1) kaPc1.close(); } catch (e) {}
  try { if (kaPc2) kaPc2.close(); } catch (e) {}
  kaDc = kaPc1 = kaPc2 = null;
}

// Start when a login/automation run begins; stop when it finishes/logs out.
if (extAlive() && chrome.storage && chrome.storage.onChanged) {
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.loginActive) return;
      if (changes.loginActive.newValue) startKeepAlive();
      else stopKeepAlive();
    });
  } catch (e) {}
}

// ==================== PAUSE / RESUME ====================
// When paused, every automation loop (login flow + prepayment) stops acting.
// On resume we don't restart from scratch: tick()/handlePaymentFrame() run again,
// detectPage() figures out exactly which page we're on, and the normal step for
// that page continues automatically. PAUSED is a cached mirror of the
// `loginPaused` storage flag so the long inner loops can bail out synchronously.
let PAUSED = false;
async function initPaused() {
  const s = await safeGet(["loginPaused"]);
  PAUSED = !!s.loginPaused;
}

// React the instant the popup flips the flag: on resume, kick an immediate
// re-detect so the user doesn't wait for the next interval tick.
if (extAlive() && chrome.storage && chrome.storage.onChanged) {
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.loginPaused) return;
      PAUSED = !!changes.loginPaused.newValue;
      if (PAUSED) return;
      // Resumed → detect the current page and pick the flow back up.
      if (IS_PAY_FRAME) {
        setTimeout(() => { if (extAlive()) handlePaymentFrame(); }, 300);
      } else {
        setTimeout(() => { if (extAlive() && !running) tick(); }, 300);
      }
    });
  } catch (e) {}
}

function randDelay(min, max) {
  return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

// Serializes typing so two passes can never interleave into one field.
let typingLock = false;

// Type at human speed. We set the EXACT known prefix each keystroke (never read
// el.value back), because Google's handlers mutate the field and racing with
// them — or a stray second typer — scrambles/duplicates the input.
async function humanType(el, text) {
  const wait0 = Date.now();
  while (typingLock && Date.now() - wait0 < 15000) { await randDelay(60, 140); }
  typingLock = true;
  try {
    el.focus();
    el.dispatchEvent(new Event("focus", { bubbles: true }));
    await randDelay(200, 450);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      setter.call(el, text.slice(0, i + 1));
      el.dispatchEvent(new KeyboardEvent("keydown", { key: c, bubbles: true }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key: c, bubbles: true }));
      await randDelay(45, 150);
      if (Math.random() < 0.06) await randDelay(150, 350);
    }
    await randDelay(80, 200);
    if ((el.value || "") !== text) {
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  } finally {
    typingLock = false;
  }
}

async function humanClick(el) {
  await randDelay(300, 700);
  try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
  await randDelay(150, 350);
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  el.click();
}

function waitFor(selectorOrFn, timeout) {
  timeout = timeout || 12000;
  return new Promise(resolve => {
    const check = () => (typeof selectorOrFn === "function") ? selectorOrFn() : document.querySelector(selectorOrFn);
    const found = check();
    if (found) return resolve(found);
    const t0 = Date.now();
    const obs = new MutationObserver(() => {
      const el = check();
      if (el) { obs.disconnect(); resolve(el); }
      else if (Date.now() - t0 > timeout) { obs.disconnect(); resolve(null); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(check()); }, timeout);
  });
}

function findByText(text) {
  const w = text.trim().toLowerCase();
  const nodes = [...document.querySelectorAll("button, a, [role='button'], span, div")]
    .filter(el => (el.offsetWidth > 0 || el.offsetHeight > 0) && !(el.closest && el.closest("#gcpp-panel")));
  const exact = nodes
    .filter(n => (n.textContent || "").trim().toLowerCase() === w)
    .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);
  if (exact.length) return exact[0].closest("button, a, [role='button']") || exact[0];
  const inc = nodes
    .filter(n => (n.textContent || "").trim().toLowerCase().includes(w))
    .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);
  if (inc.length) return inc[0].closest("button, a, [role='button']") || inc[0];
  return null;
}

// A "move forward" button on a Google interstitial: Continue / Next / Confirm /
// Allow / Continue as <name> / I agree. Deliberately excludes "use another
// account", "cancel", "back", "deny", etc.
const CONTINUE_LABELS = [
  "continue as", "continue", "next", "confirm", "allow", "proceed",
  "yes, continue", "i agree", "agree", "accept", "done", "sign in", "verify"
];
function findContinueButton() {
  const cands = [...document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], a[role="button"]')]
    .filter(el => (el.offsetWidth > 0 || el.offsetHeight > 0) && !el.disabled);
  const labelOf = (el) =>
    ((el.getAttribute("aria-label") || "") + " " + (el.value || "") + " " + (el.textContent || ""))
      .replace(/\s+/g, " ").trim().toLowerCase();
  for (const want of CONTINUE_LABELS) {
    const m = cands.find(el => {
      const t = labelOf(el);
      return t === want || t.startsWith(want + " ") || t === want + "\u2026";
    });
    if (m) return m;
  }
  return null;
}

// On an account chooser, the tile for our target email.
function findAccountTile(email) {
  const e = (email || "").trim().toLowerCase();
  if (!e) return null;
  const tiles = [...document.querySelectorAll('[data-identifier], [data-email], li[jsaction], div[role="link"], [role="button"]')]
    .filter(el => el.offsetWidth > 0 || el.offsetHeight > 0);
  // Prefer an exact identifier attribute match.
  let m = tiles.find(el =>
    (el.getAttribute("data-identifier") || el.getAttribute("data-email") || "").trim().toLowerCase() === e);
  if (m) return m.closest('li, [role="link"], [role="button"], div[jsaction]') || m;
  // Otherwise a visible tile whose text contains the exact email.
  m = tiles.find(el => (el.textContent || "").toLowerCase().includes(e));
  if (m) return m.closest('li, [role="link"], [role="button"], div[jsaction]') || m;
  return null;
}

// Fire the full pointer+mouse+click sequence. Google's Material (VfPpkd)
// buttons sometimes ignore a bare .click(), so we dispatch everything.
async function forceClick(el) {
  if (!el) return false;
  try { el.scrollIntoView({ block: "center" }); } catch (e) {}
  await randDelay(120, 280);
  const o = { bubbles: true, cancelable: true, view: window };
  try { el.dispatchEvent(new PointerEvent("pointerdown", o)); } catch (e) {}
  try { el.dispatchEvent(new MouseEvent("mousedown", o)); } catch (e) {}
  try { el.dispatchEvent(new PointerEvent("pointerup", o)); } catch (e) {}
  try { el.dispatchEvent(new MouseEvent("mouseup", o)); } catch (e) {}
  try { el.dispatchEvent(new MouseEvent("click", o)); } catch (e) {}
  try { el.click(); } catch (e) {}
  return true;
}

// Single-click helper for navigation / dialog actions. Deliberately uses ONE
// native click: synthetic pointer/mouse events plus el.click() (or two click
// dispatches) can activate Angular/Google Payments twice, starting two payment
// sessions and leaving a second dialog stuck on its loading spinner.
async function clickOnce(el) {
  if (!el) return false;
  try { el.scrollIntoView({ block: "center" }); } catch (e) {}
  try { if (el.focus) el.focus(); } catch (e) {}
  await randDelay(120, 260);
  try { el.click(); } catch (e) {}
  return true;
}

// Find a Google primary-action button by its label. Handles the three ways
// Google renders these: (1) known container ids, (2) a Material label span
// (<span jsname="V67aGc" class="VfPpkd-vQzf8d"|"YUhpIc-vQzf8d">Label</span> —
// the span is often aria-hidden, so match by text and click its button), and
// (3) plain visible text.
function findLabeledButton(labels) {
  const wants = labels.map(l => l.trim().toLowerCase());
  // 1) Known primary-action containers.
  for (const id of ["identifierNext", "passwordNext", "idvPreregisteredPhoneNext",
                    "next", "submit", "verifyButton", "confirm", "yesButton"]) {
    const wrap = document.getElementById(id);
    if (wrap && (wrap.offsetWidth > 0 || wrap.offsetHeight > 0)) {
      const b = wrap.tagName === "BUTTON" ? wrap : wrap.querySelector("button");
      if (b) return b;
    }
  }
  // 2) Material label span (match by text even if the span is aria-hidden;
  //    require the resolved BUTTON to be visible).
  const span = [...document.querySelectorAll('span[jsname="V67aGc"], span.VfPpkd-vQzf8d, span.YUhpIc-vQzf8d')]
    .find(sp => wants.includes((sp.textContent || "").trim().toLowerCase()));
  if (span) {
    const b = span.closest("button, [role='button']");
    if (b && (b.offsetWidth > 0 || b.offsetHeight > 0)) return b;
  }
  // 3) Plain visible text.
  for (const l of labels) { const b = findByText(l); if (b) return b; }
  return null;
}

// The primary "Next" button on Google sign-in pages.
function findGoogleNextButton() {
  return findLabeledButton(["Next"]) || findContinueButton();
}

// A verification-code entry field (accounts.cloud.google.com uses pinInput;
// accounts.google.com challenges use one-time-code / tel / a code-labelled box).
function codeFieldPresent() {
  if (document.querySelector('input[name="pinInput"], input[autocomplete="one-time-code"]')) return true;
  const tel = document.querySelector('input[type="tel"]');
  if (tel && (tel.offsetWidth > 0 || tel.offsetHeight > 0)) return true;
  const labeled = [...document.querySelectorAll("input[aria-label]")]
    .find(i => /code|otp|verification|passcode/i.test(i.getAttribute("aria-label") || ""));
  return !!labeled;
}

function fetchOtpCode(email) {
  return new Promise(resolve => {
    if (!extAlive()) return resolve(null);
    try {
      chrome.runtime.sendMessage({ type: "FETCH_OTP", email }, resp => {
        if (chrome.runtime.lastError || !resp || !resp.ok) return resolve(null);
        resolve(resp);
      });
    } catch (e) { resolve(null); }
  });
}

// ==================== PAGE DETECTION ====================
function detectPage() {
  const h = location.hostname, p = location.pathname;
  if (h === "accounts.cloud.google.com" && (p.includes("/signup/email") || p.includes("/login/email"))) return "email";
  if (h === "accounts.cloud.google.com" && p.includes("verify-oob-code")) return "otp";
  // Any accounts.google.com page after email is an interstitial we must drive
  // (account chooser, "Continue", consent, etc.). A code field there is still
  // routed to the OTP handler by tick() before this ever matters.
  if (h === "accounts.google.com") return "google-signin";
  if (h === "payments.google.com") return "payment";
  if (h === "console.cloud.google.com" && /\/billing\/[^/]+\/payment/.test(p)) return "billing-payment";
  if (h === "console.cloud.google.com" && p.includes("/billing")) return "billing";
  if (h === "console.cloud.google.com" || h === "cloud.google.com") return "signed-in";
  return "other";
}

// ==================== HANDLERS ====================
let running = false;

// Detect the "I understand" / "I understand to continue" interstitial that
// Google shows after OTP verification on some flows. It can appear on
// accounts.google.com, accounts.cloud.google.com, or cloud.google.com.
// NOTE: Only uses the exact Material span selector — never a loose text search
// that could accidentally match body copy on other pages.
function iUnderstandPagePresent() {
  // Match by the exact Material label span Google renders on this button.
  // The span has jsname="V67aGc" and its text is precisely "I understand"
  // or "I understand to continue" — nothing else on any login page matches this.
  const spans = document.querySelectorAll('span[jsname="V67aGc"], span.VfPpkd-vQzf8d');
  for (const sp of spans) {
    const t = (sp.textContent || "").trim();
    if (/^i understand(\s+to continue)?$/i.test(t)) {
      const btn = sp.closest("button, [role='button']");
      if (btn && (btn.offsetWidth > 0 || btn.offsetHeight > 0)) return btn;
    }
  }
  return null;
}

async function handleIUnderstandPage() {
  if (PAUSED || running) return; running = true;
  try {
    await randDelay(700, 1400);
    const btn = iUnderstandPagePresent();
    if (!btn) return;
    await setStatus("Clicking 'I understand'...");
    await forceClick(btn);
    await randDelay(1000, 1800);
  } finally { running = false; }
}

async function handleEmailPage() {
  if (PAUSED || running) return; running = true;
  try {
    const s = await safeGet(["loginEmail", "loginActive"]);
    if (!s.loginActive || !s.loginEmail) return;

    const input = await waitFor('#i3, input[name="login_hint"], input[type="email"]', 12000);
    if (!input) { await setStatus("Email field not found."); return; }
    if ((input.value || "").includes("@")) {
      await setStatus("Email already filled — clicking Next...");
    } else {
      await setStatus("Typing email: " + s.loginEmail);
      await randDelay(1200, 2200);
      await humanType(input, s.loginEmail);
    }
    await randDelay(800, 1500);
    const btn = findByText("Next");
    if (btn) await humanClick(btn);
    else if (input.form && input.form.requestSubmit) input.form.requestSubmit();
    else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true }));
    // Mark WHEN we asked Google to send a code. Any code with an older
    // timestamp than this is a stale leftover and must be ignored.
    await safeSet({ otpRequestedAt: Date.now(), lastTriedCode: "", otpFilled: false });
    await setStatus("Email submitted. Waiting for the code page...");
  } finally { running = false; }
}

// Drives every accounts.google.com interstitial so the user never has to click
// a button by hand: email entry, the account chooser, "Use another account",
// and the generic Continue / Confirm / Allow / consent screens.
async function handleGoogleSignin() {
  if (PAUSED || running) return; running = true;
  try {
    const s = await safeGet(["loginEmail", "loginActive"]);
    if (!s.loginActive || !s.loginEmail) return;

    // Let the interstitial finish rendering before we decide what to click.
    await randDelay(900, 1600);

    // A verification-code field can appear on accounts.google.com too — leave
    // it to the OTP handler (tick routes to it), don't touch it here.
    if (document.querySelector('input[name="pinInput"], input[autocomplete="one-time-code"]')) return;

    // 1) Standard email field (e.g. /v3/signin/identifier) → make sure it holds
    //    our address, then click Next. This is the page the user reported having
    //    to click by hand.
    const input = document.querySelector('#identifierId, input[name="identifier"], input[type="email"]');
    if (input && (input.offsetWidth > 0 || input.offsetHeight > 0)) {
      if (!(input.value || "").includes("@")) {
        await setStatus("Signing in as " + s.loginEmail);
        await humanType(input, s.loginEmail);
      } else {
        // Prefilled by Google via the Email= URL param. Fire input/change so
        // Google's validation enables the (otherwise greyed-out) Next button.
        try {
          input.focus();
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        } catch (e) {}
      }
      await randDelay(500, 1000);
      // Click Next, retrying a few times — the button can enable a moment late,
      // and we stop as soon as the identifier field goes away (page advanced).
      for (let i = 0; i < 5; i++) {
        await setStatus("Continuing as " + s.loginEmail + "...");
        const btn = findGoogleNextButton();
        if (btn) await forceClick(btn);
        else if (input.form && input.form.requestSubmit) input.form.requestSubmit();
        else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true }));
        await randDelay(1300, 1900);
        if (!document.querySelector('#identifierId, input[name="identifier"]')) break;
      }
      return;
    }

    // 2) Account chooser → pick the tile for our email.
    const tile = findAccountTile(s.loginEmail);
    if (tile) {
      await setStatus("Choosing account " + s.loginEmail + "...");
      await humanClick(tile);
      return;
    }

    // 3) Chooser without our account → "Use another account" (leads to email).
    const another = findByText("Use another account") || findByText("Add account");
    if (another) {
      await setStatus("Opening another-account entry...");
      await humanClick(another);
      return;
    }

    // 4) Interstitial / consent / "I understand" → Continue / Confirm / Allow.
    const iUnderstand = findLabeledButton(["I understand", "I understand to continue"]);
    if (iUnderstand) {
      await setStatus("Clicking 'I understand'...");
      await humanClick(iUnderstand);
      return;
    }

    const cont = findContinueButton();
    if (cont) {
      await setStatus("Confirming sign-in...");
      await humanClick(cont);
      return;
    }
  } finally { running = false; }
}

const PIN_SELECTOR = 'input[name="pinInput"], input[aria-label*="code" i], input[type="text"], input[type="tel"]';
const MIN_CODE_WAIT_MS = 5000;   // never enter a code within 5s of requesting it
const STALE_TOLERANCE_MS = 30000; // clock-skew allowance when judging freshness

// Normalize the API timestamp (ISO string, epoch seconds, or epoch millis) to ms.
function parseTs(ts) {
  if (ts == null) return 0;
  if (typeof ts === "number") return ts < 1e12 ? ts * 1000 : ts;
  const n = Number(ts);
  if (!isNaN(n) && String(ts).trim() !== "") return n < 1e12 ? n * 1000 : n;
  const p = Date.parse(ts);
  return isNaN(p) ? 0 : p;
}

// Poll the code service until we get a code that is BOTH:
//   - not the one we already tried (avoidCode), and
//   - fresh: its timestamp is at/after when we requested login (when a
//     timestamp is available). Codes older than that are stale leftovers.
async function getFreshCode(email, requestedAt, avoidCode) {
  let delay = 2500;
  for (let i = 0; i < 15; i++) {
    if (PAUSED) return null;
    const resp = await fetchOtpCode(email);
    if (resp && resp.code) {
      const code = String(resp.code).trim();
      const ts = parseTs(resp.timestamp);
      const notReused = code && code !== avoidCode;
      const fresh = ts ? (ts >= requestedAt - STALE_TOLERANCE_MS) : true;
      if (code.length >= 4 && notReused && fresh) return code;
    }
    await setStatus("Waiting for the latest code... (" + (i + 1) + "/15)");
    await randDelay(delay, delay + 1200);
    delay = Math.min(delay * 1.3, 12000);
  }
  return null;
}

// Ask Google to send a new code (used after a code is rejected).
async function requestNewCode() {
  const btn = findByText("Resend code") || findByText("Resend") ||
              findByText("Send again") || findByText("Get a new code") ||
              findByText("Send a new code") || findByText("Try again");
  if (btn) { await humanClick(btn); return true; }
  return false;
}

// After submitting a code, watch for success (left the code page) or an
// explicit error message. Returns true = accepted, false = rejected.
async function watchOtpResult(timeout) {
  timeout = timeout || 12000;
  const t0 = Date.now();
  const ERR = /(wrong code|incorrect|invalid|expired|didn.?t work|did not work|doesn.?t match|does not match|check the code|enter a valid|try again)/;
  while (Date.now() - t0 < timeout) {
    if (!extAlive()) return true; // context torn down by navigation = success
    if (detectPage() !== "otp" && !document.querySelector('input[name="pinInput"]')) return true;
    const txt = (document.body ? document.body.innerText || "" : "").toLowerCase();
    if (ERR.test(txt)) return false;
    const invalid = document.querySelector('input[aria-invalid="true"]');
    if (invalid) return false;
    await randDelay(600, 900);
  }
  return detectPage() !== "otp";
}

async function handleOtpPage() {
  if (PAUSED || running) return; running = true;
  try {
    const s = await safeGet(["loginEmail", "loginActive", "otpFilled", "otpRequestedAt", "lastTriedCode"]);
    if (!s.loginActive || !s.loginEmail || s.otpFilled) return;

    const pin = await waitFor(PIN_SELECTOR, 12000);
    if (!pin) return;

    // 1) Mandatory minimum wait: gives the freshly-sent code time to arrive
    //    and lets any stale code from a previous attempt be superseded.
    let requestedAt = s.otpRequestedAt;
    if (!requestedAt) { requestedAt = Date.now(); await safeSet({ otpRequestedAt: requestedAt }); }
    const sinceRequest = Date.now() - requestedAt;
    if (sinceRequest < MIN_CODE_WAIT_MS) {
      await setStatus("Waiting a few seconds for a fresh code...");
      await randDelay(MIN_CODE_WAIT_MS - sinceRequest, MIN_CODE_WAIT_MS - sinceRequest + 800);
    }

    let avoid = s.lastTriedCode || "";

    // 2) Try up to 4 codes: on each rejection, request+fetch an updated code.
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (PAUSED) { await setStatus("Paused."); return; }
      const code = await getFreshCode(s.loginEmail, requestedAt, avoid);
      if (!code) { await setStatus("Couldn't get a fresh code. Enter it manually or press Login again."); return; }

      const pinNow = document.querySelector(PIN_SELECTOR) || pin;
      await setStatus("Entering code " + code + " (attempt " + attempt + "/4)...");
      await humanType(pinNow, code);
      avoid = code;
      await safeSet({ lastTriedCode: code });
      await randDelay(900, 1600);

      // Click Verify/Next reliably (Material buttons ignore a bare click, and
      // the label span is aria-hidden). Retry until the code field goes away.
      for (let c = 0; c < 3; c++) {
        const verify = findLabeledButton(["Verify", "Next", "Continue", "Submit", "Done"]);
        if (verify) await forceClick(verify);
        else if (pinNow.form && pinNow.form.requestSubmit) pinNow.form.requestSubmit();
        else pinNow.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true }));
        await randDelay(1000, 1600);
        if (!document.querySelector(PIN_SELECTOR)) break; // advanced past the code page
      }

      const accepted = await watchOtpResult(12000);
      if (accepted) {
        await safeSet({ otpFilled: true, loginStatus: "Code accepted. Finishing sign-in..." });
        return;
      }

      // Rejected: request a new code and loop with a fresh requestedAt.
      await setStatus("Code was rejected — requesting an updated code...");
      requestedAt = Date.now();
      await safeSet({ otpRequestedAt: requestedAt });
      await requestNewCode();
      await randDelay(3000, 4500);
    }
    await setStatus("Login code kept getting rejected. Please check the account manually.");
  } finally { running = false; }
}

// ==================== FLOATING PREPAYMENT PANEL ====================
// Shows the fixed prepayment amount and a manual "Make a payment" trigger.
// The automation taps the console's own "Make a payment" button; this panel is
// the visible status + fallback if the user wants to trigger it by hand.
const PREPAY_AMOUNT = "1000";

let panelEl = null;
function panelStatusText() {
  return panelEl ? panelEl.querySelector("#gcpp-status") : null;
}
function setPanelStatus(txt) {
  const el = panelStatusText();
  if (el) el.textContent = txt;
}
async function refreshPanelStatus() {
  const s = await safeGet(["loginStatus", "prepayDone"]);
  let txt = s.loginStatus || "Waiting for sign-in...";
  if (s.prepayDone) txt = "₹1,000 prepayment completed.";
  setPanelStatus(txt);
}

function buildPrepayPanel() {
  if (!IS_TOP || !document.body) return;
  if (panelEl && document.documentElement.contains(panelEl)) { refreshPanelStatus(); return; }

  const panel = document.createElement("div");
  panel.id = "gcpp-panel";
  panel.style.cssText = [
    "position:fixed", "z-index:2147483647", "top:16px", "left:16px",
    "width:340px", "max-width:90vw",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    "font-size:12px", "color:#e6e6e6", "background:#0f1424",
    "border:1px solid #26314f", "border-radius:10px",
    "box-shadow:0 8px 30px rgba(0,0,0,0.5)", "overflow:hidden"
  ].join(";");

  panel.innerHTML =
    '<div id="gcpp-head" style="display:flex;align-items:center;justify-content:space-between;' +
      'cursor:move;padding:8px 10px;background:linear-gradient(135deg,#1a73e8,#764ba2);">' +
      '<span style="font-weight:600;color:#fff;">Prepayment</span>' +
      '<button id="gcpp-collapse" title="Collapse" style="background:transparent;border:none;' +
        'color:#fff;font-size:16px;line-height:1;cursor:pointer;padding:0 4px;">&ndash;</button>' +
    '</div>' +
    '<div id="gcpp-body" style="padding:10px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<span style="color:#8899aa;">Amount</span>' +
        '<strong style="font-size:16px;color:#a9e34b;">₹1,000</strong>' +
      '</div>' +
      '<div id="gcpp-status" style="margin-bottom:8px;padding:8px;background:#060913;border:1px solid #26314f;' +
        'border-radius:6px;font-size:11px;line-height:1.5;color:#bcd;min-height:30px;">Waiting for sign-in...</div>' +
      '<button id="gcpp-pay" style="width:100%;padding:9px;border:none;border-radius:6px;' +
        'background:#1a73e8;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Make a payment (₹1,000)</button>' +
    '</div>';

  document.documentElement.appendChild(panel);
  panelEl = panel;

  panel.querySelector("#gcpp-pay").addEventListener("click", async () => {
    const s = await safeGet(["loginEmail"]);
    if (!s.loginEmail) {
      try { chrome.runtime.sendMessage({ type: "OPEN_BILLING" }); } catch (e) {}
      return;
    }

    if (paymentQrPresent()) {
      setPanelStatus("Scan the UPI QR code to complete the ₹1,000 prepayment.");
      return;
    }

    // If the dialog is already open, drive its action instead of the CTA.
    const action = findLabeledButtonInOrder(["Continue", "Pay now"]);
    if (action) {
      const label = buttonLabelText(action).toLowerCase();
      const st = await safeGet(["prepayEntered", "prepayDocId", "prepayPayClicked", "prepayPayDocId"]);
      const alreadyContinue = /continue/.test(label) && st.prepayEntered && st.prepayDocId === DOC_ID;
      const alreadyPay = /pay/.test(label) && st.prepayPayClicked && st.prepayPayDocId === DOC_ID;
      if (alreadyContinue || alreadyPay || loadingPresent()) {
        setPanelStatus("Payment is loading — waiting for the UPI QR...");
        return;
      }
      setPanelStatus("Tapping '" + buttonLabelText(action) + "'...");
      await clickOnce(action);
      return;
    }
    if (prepayDialogOpen() || paymentsFrameOpen()) {
      setPanelStatus("Payment dialog open — waiting for Continue...");
      return;
    }

    setPanelStatus("Looking for the 'Make a payment' button...");
    const tapped = await tapMakePaymentButton();
    if (!tapped) {
      setPanelStatus("Button not found here. Opening the billing page...");
      try { chrome.runtime.sendMessage({ type: "OPEN_BILLING" }); } catch (e) {}
    }
  });

  const body = panel.querySelector("#gcpp-body");
  const collapseBtn = panel.querySelector("#gcpp-collapse");
  collapseBtn.addEventListener("click", () => {
    const collapsed = body.style.display === "none";
    body.style.display = collapsed ? "block" : "none";
    collapseBtn.innerHTML = collapsed ? "&ndash;" : "+";
  });

  makePanelDraggable(panel, panel.querySelector("#gcpp-head"));
  refreshPanelStatus();
}

function makePanelDraggable(panel, handle) {
  let startX = 0, startY = 0, originLeft = 0, originTop = 0, dragging = false;
  handle.addEventListener("mousedown", (e) => {
    if (e.target && e.target.id === "gcpp-collapse") return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    originLeft = rect.left; originTop = rect.top;
    startX = e.clientX; startY = e.clientY;
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    let nx = originLeft + (e.clientX - startX);
    let ny = originTop + (e.clientY - startY);
    nx = Math.max(0, Math.min(window.innerWidth - 60, nx));
    ny = Math.max(0, Math.min(window.innerHeight - 30, ny));
    panel.style.left = nx + "px";
    panel.style.top = ny + "px";
    panel.style.right = "auto";
  });
  document.addEventListener("mouseup", () => { dragging = false; });
}

// ==================== PREPAYMENT AUTOMATION ====================
// Flow after sign-in:
//   1. On the console landing page, tap the free-trial card's "Make a payment"
//      anchor (href="/billing/<billingAccountId>/payment?project=...").
//   2. On the payments page, tap the balance card's "Make a payment" button.
//   3. Enter the fixed Rs.1000 amount and confirm the payment.
// State (chrome.storage.local):
//   prepayAmount      fixed amount ("1000")
//   prepayDone        payment confirmed for this login
//   prepayStarted     console "Make a payment" already tapped
//   prepayFormOpened  payments "Make a payment" already tapped
//   prepayEntered     amount already filled

const PREPAY_DEFAULT = "1000";

// Unique per document instance. Used to distinguish "I already clicked
// Continue/Pay now on THIS page" from stale flags left by a previous page or
// reload. Prevents clicking Continue a second time while the payment session
// is loading (which produced a second dialog and a stuck center spinner).
const DOC_ID = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);

function isExtensionNode(el) {
  return !!(el && el.closest && el.closest("#gcpp-panel"));
}

function visibleEl(el) {
  if (!el || el.disabled) return false;
  try {
    if (el.closest && el.closest('[aria-hidden="true"], [inert]')) return false;
  } catch (e) {}
  if (!(el.offsetWidth > 0 || el.offsetHeight > 0)) return false;
  try {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
  } catch (e) {}
  return true;
}

// A payment session is loading (the center spinner). Used only to avoid
// re-clicking while Google is creating the QR/session.
function loadingPresent() {
  const spinners = [...document.querySelectorAll(
    '[role="progressbar"], mat-progress-spinner, .mat-mdc-progress-spinner, ' +
    '.mdc-circular-progress, [class*="spinner" i]'
  )];
  if (spinners.some(visibleEl)) return true;
  const txt = (document.body ? document.body.innerText || "" : "").toLowerCase();
  return /loading|please wait|processing|do not close|creating payment|starting payment/.test(txt);
}

// Read the visible button label first, then aria-label, then the subtree text.
// Icon ligature text (e.g. "payments") must not pollute the match.
function buttonLabelText(el) {
  if (!el) return "";
  const lbl = el.querySelector && el.querySelector(
    '.mdc-button__label, span[jsname="V67aGc"], .VfPpkd-vQzf8d, .b3id-info-message-html span, .b3id-widget-link span'
  );
  if (lbl && (lbl.textContent || "").trim()) {
    return (lbl.textContent || "").replace(/\s+/g, " ").trim();
  }
  const aria = el.getAttribute && el.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.replace(/\s+/g, " ").trim();
  const t = (el.textContent || "");
  return t.replace(/\s+/g, " ").trim();
}

// Exact-label button finder for payment actions. Unlike the loose text search,
// this can't pick a paragraph or the page-level CTA behind the dialog.
function findExactButton(labels) {
  const wants = labels.map(l => l.trim().toLowerCase());
  const els = [...document.querySelectorAll(
    'button, a[role="button"], [role="button"], a[mat-flat-button], a.mdc-button, ' +
    'a.b3-primary-button, a.b3-flat-button, .VfPpkd-LgbsSe'
  )].filter(el => visibleEl(el) && !isExtensionNode(el));

  for (const el of els) {
    if (wants.includes(buttonLabelText(el).toLowerCase())) return el;
  }
  // Tolerate extra icon text (e.g. "Continue arrow_forward").
  for (const el of els) {
    const label = buttonLabelText(el).toLowerCase();
    if (wants.some(w => label.startsWith(w + " ") || label.endsWith(" " + w))) return el;
  }
  return null;
}

// Tries the labels in priority order so the dialog's Continue/Pay now wins
// over a page-level "Make a payment" button still in the DOM behind it.
function findLabeledButtonInOrder(labels) {
  for (const label of labels) {
    const btn = findExactButton([label]);
    if (btn) return btn;
  }
  return null;
}

// Ask the background to allow popups for the billing/payments origins (once).
let popupsRequested = false;
function requestPopupAllow() {
  if (popupsRequested || !extAlive()) return;
  popupsRequested = true;
  try { chrome.runtime.sendMessage({ type: "ALLOW_POPUPS" }); } catch (e) {}
}

// True when the Google Payments modal/iframe is mounted in this document.
// Its own content-script instance drives Continue/Pay now, so the top frame
// must NOT keep re-clicking the page-level "Make a payment" CTA behind it.
function paymentsFrameOpen() {
  return [...document.querySelectorAll("iframe")].some(f => {
    const src = (f.getAttribute("src") || "") + " " + (f.getAttribute("data-src") || "");
    return /payments\.google\.com|buyflow|modaliframe|bscframe|paymentsFrame/i.test(src);
  });
}

// Text that only appears once the Make a payment dialog is actually open.
function prepayDialogOpen() {
  const txt = (document.body ? document.body.innerText || "" : "").toLowerCase();
  return /payment amount|review your payment|minimum prepayment|one-time prepayment/.test(txt);
}

// The console free-trial card renders:
//   <a mat-flat-button href="/billing/<id>/payment?project=...">
//     <span class="mdc-button__label"> Make a payment </span></a>
// The payments balance card renders:
//   <a class="b3-primary-button" role="button" data-primary-button="true">
//     <span>Make a payment</span></a>
// The billing overview also shows a top-right CTA and an in-card text link.
//
// Collect every visible "Make a payment" candidate, de-duplicated. Retries
// rotate between them in case one is a dud that only reloads the page.
function findMakePaymentButtons() {
  const out = [];
  const push = (el) => { if (el && !out.includes(el)) out.push(el); };
  const match = (el) => visibleEl(el) && !isExtensionNode(el) &&
    /^make a payment(\s|$)/i.test(buttonLabelText(el));

  document.querySelectorAll(
    'a[href*="/billing/"][href*="/payment"], a[mat-flat-button], a.mdc-button, ' +
    'a.b3-primary-button, a.b3-flat-button, [data-primary-button="true"]'
  ).forEach(el => { if (match(el)) push(el); });

  document.querySelectorAll('button, a[role="button"], [role="button"]')
    .forEach(el => { if (match(el)) push(el); });

  // Plain anchors (the balance-card link often has no special class/role).
  document.querySelectorAll('a').forEach(el => { if (match(el)) push(el); });

  return out;
}

function findMakePaymentButton() {
  return findMakePaymentButtons()[0] || null;
}

// Tap "Make a payment" on the current screen. Uses a SINGLE click: the old
// double click + forced location.assign made Angular start the payments route
// twice, which left the page showing a spinner forever.
async function tapMakePaymentButton() {
  const btns = findMakePaymentButtons();
  if (!btns.length) return false;
  const st = await safeGet(["prepayCtaAttempts"]);
  const attempts = st.prepayCtaAttempts || 0;
  const btn = btns[attempts % btns.length];
  requestPopupAllow();
  await setStatus("Tapping 'Make a payment'...");
  await safeSet({
    prepayCtaAttempts: attempts + 1,
    prepayCtaDocId: DOC_ID,
    prepayStarted: true,
    prepayLastTapAt: Date.now(),
    prepayLastTapUrl: location.href
  });
  await clickOnce(btn);
  return true;
}

// Top frame: on the console landing page, tap the free-trial card button.
async function handleConsolePrepay() {
  if (PAUSED || running) return; running = true;
  try {
    const s = await safeGet(["autoPrepay", "prepayDone", "loginActive", "prepayStarted", "prepayLastTapAt"]);
    if (!s.loginActive || s.prepayDone) return;
    if (s.autoPrepay === false) return;

    // Already on the payment page — let that handler take over.
    if (/\/billing\/[^/]+\/payment/.test(location.pathname)) return;

    // Don't hammer the button if a previous tap didn't navigate.
    if (s.prepayStarted && s.prepayLastTapAt && Date.now() - s.prepayLastTapAt < 20000) return;

    const btn = await waitFor(findMakePaymentButton, 15000);
    if (!btn) {
      await setStatus("Waiting for the 'Make a payment' button...");
      return;
    }
    await tapMakePaymentButton();
    await setStatus("Opening the payment page...");
  } finally { running = false; }
}

// On the balance card, tap "Make a payment" once. Runs in the top frame and in
// the payments.google.com iframe (each instance owns its own `running` flag).
async function handlePaymentsLanding() {
  if (PAUSED || running) return; running = true;
  try {
    const s = await safeGet(["autoPrepay", "prepayDone", "loginActive", "prepayLastTapAt", "prepayLastTapUrl", "prepayCtaDocId"]);
    if (!s.loginActive || s.prepayDone) return;
    if (s.autoPrepay === false) return;

    // Tap the CTA at most once per document. A second tap while the first
    // dialog is loading opens a duplicate dialog over the QR.
    if (s.prepayCtaDocId === DOC_ID) return;

    // A dialog is already open (Continue/Pay now visible) — never re-tap the
    // page-level "Make a payment" CTA behind it.
    if (findLabeledButtonInOrder(["Continue", "Pay now"])) return;
    if (prepayDialogOpen()) return;
    if (paymentsFrameOpen()) return;

    // Debounce repeated taps on the SAME page while the dialog is loading.
    // A tap from a previous page (e.g. the free-trial card) must not block us.
    if (s.prepayLastTapUrl === location.href &&
        s.prepayLastTapAt && Date.now() - s.prepayLastTapAt < 8000) return;

    const btn = await waitFor(findMakePaymentButton, 12000);
    if (!btn) return;
    await tapMakePaymentButton();
    await safeSet({ prepayFormOpened: true });
    await setStatus("Opening the prepayment form...");
  } finally { running = false; }
}

// ==================== PAYMENT AMOUNT FORM ====================
// The amount screen is Google Payments (b3 UI), usually inside a
// payments.google.com iframe. Enter the fixed Rs.1000 and continue.
const AMOUNT_SELECTORS = [
  'input[aria-label*="amount" i]',
  'input[placeholder*="amount" i]',
  'input[name*="amount" i]',
  'input[id*="amount" i]',
  'input[inputmode="decimal"]',
  'input[inputmode="numeric"]',
  'input[type="number"]'
];

function findAmountInput() {
  for (const sel of AMOUNT_SELECTORS) {
    const el = [...document.querySelectorAll(sel)]
      .find(i => (i.offsetWidth > 0 || i.offsetHeight > 0) && !i.disabled && !i.readOnly);
    if (el) return el;
  }
  return null;
}

function setInputValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function findPayActionButton() {
  // Do NOT include "Make a payment" here: that label is also used by the
  // page-level CTA behind the dialog, and re-tapping it reopens the modal.
  return findLabeledButtonInOrder(["Continue", "Pay now", "Pay", "Confirm", "Submit"]) || findContinueButton();
}

async function handlePaymentAmountForm() {
  if (PAUSED || running) return; running = true;
  try {
    const s = await safeGet(["autoPrepay", "prepayDone", "loginActive", "prepayAmount", "prepayEntered", "prepayDocId", "prepayLastTapAt", "prepayLastTapUrl"]);
    if (!s.loginActive || s.prepayDone) return;
    if (s.autoPrepay === false) return;

    // Continue is strictly one-shot per document. After the first click Google
    // shows a loading spinner and keeps the old dialog in the DOM; clicking
    // again creates a second payment session and leaves a stuck spinner.
    if (s.prepayEntered) {
      if (!s.prepayDocId || s.prepayDocId !== DOC_ID) {
        // New document (reload/navigation) — this is a fresh dialog.
        await safeSet({ prepayEntered: false });
      } else {
        await setStatus(loadingPresent()
          ? "Payment is loading — waiting for the UPI QR..."
          : "Continue already tapped — waiting for the UPI QR...");
        return;
      }
    }

    const amount = String(s.prepayAmount || PREPAY_DEFAULT);

    // If Continue is already on screen (the ₹1,000 radio dialog), don't wait
    // for a non-existent amount input. Otherwise give an input a short window.
    const contBtn = findLabeledButtonInOrder(["Continue"]);
    const input = contBtn ? findAmountInput() : await waitFor(findAmountInput, 3000);
    if (input) {
      const current = (input.value || "").replace(/[^\d.]/g, "");
      if (current !== amount) {
        await setStatus("Entering the ₹" + amount + " prepayment amount...");
        try { input.focus(); } catch (e) {}
        setInputValue(input, "");
        await randDelay(250, 500);
        setInputValue(input, amount);
        await randDelay(600, 1000);
      }
    }

    // Tap Continue on the payments dialog (the Material span is
    // <span jsname="V67aGc" class="VfPpkd-vQzf8d">Continue</span>).
    const btn = contBtn || findPayActionButton();
    if (btn) {
      await setStatus("Tapping Continue...");
      // Let the dialog finish rendering before clicking (clicking during its
      // opening animation can leave the payment session loader running).
      await randDelay(800, 1400);
      // Mark one-shot BEFORE clicking so no concurrent frame/tick can click it
      // a second time while Google is creating the payment session.
      await safeSet({
        prepayEntered: true,
        prepayDocId: DOC_ID,
        prepayLastTapAt: Date.now(),
        prepayLastTapUrl: location.href
      });
      await clickOnce(btn);
      await setStatus("Continue tapped — waiting for the UPI QR...");
    } else if (!input) {
      await setStatus("Waiting for the prepayment form...");
    } else {
      await setStatus("Amount ₹" + amount + " entered — waiting for Continue...");
    }
  } finally { running = false; }
}

function prepaySuccessPresent() {
  const txt = (document.body ? document.body.innerText || "" : "").toLowerCase();
  return /payment (was )?(successful|complete|completed)|payment (done|received)|prepayment (received|complete|completed)|thank you for your payment|you.?ve paid|paid ₹/.test(txt);
}

async function markPrepayDone() {
  await safeSet({
    prepayDone: true,
    loginActive: false,
    otpFilled: false,
    loginStatus: "₹1,000 prepayment completed."
  });
  await setStatus("₹1,000 prepayment completed.");
}

// UPI flow: after "Pay now" the review dialog is replaced by a QR code.
// Text-only detection: the review card already says "UPI: QR code", so image
// matching would falsely think the QR is up before "Pay now" is tapped.
function paymentQrPresent() {
  const txt = (document.body ? document.body.innerText || "" : "").toLowerCase();
  return /scan (this|the) qr|scan (it )?to pay|scan the code|show this qr|waiting for (you to )?pay|waiting for payment|qr code (has been|is) generated/.test(txt);
}

// Confirm the final payment if a review/confirm step appears.
async function handlePaymentConfirm() {
  if (PAUSED || running) return; running = true;
  try {
    const s = await safeGet(["autoPrepay", "prepayDone", "loginActive", "prepayEntered",
      "prepayLastConfirmAt", "prepayPayClicked", "prepayPayDocId", "prepayPayUrl"]);
    if (!s.loginActive || s.prepayDone) return;
    if (s.autoPrepay === false) return;

    if (prepaySuccessPresent()) { await markPrepayDone(); return; }

    if (paymentQrPresent()) {
      if (!s.prepayPayClicked) {
        await safeSet({ prepayPayClicked: true, prepayPayDocId: DOC_ID, prepayPayUrl: location.href });
      }
      await setStatus("Scan the UPI QR code to complete the ₹1,000 prepayment.");
      return;
    }

    // Pay now is one-shot per document. The old review dialog can stay in the
    // DOM behind the QR code; clicking again starts another payment session
    // and leaves the center loading spinner stuck.
    if (s.prepayPayClicked) {
      if (!s.prepayPayDocId || s.prepayPayDocId !== DOC_ID) {
        // New document (reload/navigation) — fresh review screen.
        await safeSet({ prepayPayClicked: false });
      } else {
        await setStatus(loadingPresent()
          ? "Payment is loading — waiting for the UPI QR..."
          : "Pay now already tapped — complete the UPI payment.");
        return;
      }
    }

    // Avoid clicking Pay while the request is processing.
    if (s.prepayLastConfirmAt && Date.now() - s.prepayLastConfirmAt < 12000) return;
    const txt = (document.body ? document.body.innerText || "" : "").toLowerCase();
    if (/processing|please wait|do not close/.test(txt)) return;

    const btn = findLabeledButtonInOrder(["Pay now", "Pay", "Confirm", "Submit", "Continue"]);
    if (btn) {
      const label = buttonLabelText(btn).toLowerCase();
      const isPay = /\bpay\b/.test(label) || /make a payment|make payment/.test(label);
      await setStatus("Tapping '" + (label || "pay now") + "'...");
      await randDelay(800, 1400);
      await safeSet({ prepayLastConfirmAt: Date.now() });
      if (isPay) {
        // One-shot before the click (see Continue above).
        await safeSet({ prepayPayClicked: true, prepayPayDocId: DOC_ID, prepayPayUrl: location.href });
      }
      await clickOnce(btn);
      await setStatus(isPay ? "Pay now tapped — scan the UPI QR code." : "Continue tapped — waiting...");
      await randDelay(2000, 3000);
      if (prepaySuccessPresent()) await markPrepayDone();
      else if (paymentQrPresent()) await setStatus("Scan the UPI QR code to complete the ₹1,000 prepayment.");
    }
  } finally { running = false; }
}

// Dedicated handler inside the payments.google.com frame.
let payFrameBusy = false;
async function handlePaymentFrame() {
  if (PAUSED || payFrameBusy) return; payFrameBusy = true;
  try {
    if (!extAlive()) return;
    const s = await safeGet(["autoPrepay", "prepayDone", "loginActive", "prepayPayClicked", "prepayPayUrl"]);
    if (!s.loginActive || s.prepayDone) return;
    if (s.autoPrepay === false) return;

    if (prepaySuccessPresent()) { await markPrepayDone(); return; }

    // QR is up — never click anything else.
    if (paymentQrPresent()) {
      await setStatus("Scan the UPI QR code to complete the ₹1,000 prepayment.");
      return;
    }

    // If the Make a payment dialog is already open, its Continue/Pay now action
    // must win — otherwise we'd keep re-clicking the page-level CTA.
    const dialogAction = findLabeledButtonInOrder(["Continue", "Pay now"]);
    if (dialogAction) {
      const label = buttonLabelText(dialogAction).toLowerCase();
      if (/continue/.test(label)) await handlePaymentAmountForm();
      else await handlePaymentConfirm();
      return;
    }

    // Dialog is mounted but its button isn't ready — wait for it.
    if (prepayDialogOpen()) {
      await setStatus("Payment dialog open — waiting for Continue...");
      return;
    }

    // 4) Payment already started on this page: only wait while it's actually
    //    processing. Otherwise the flag is stale and must not block the CTA.
    if (s.prepayPayClicked && s.prepayPayUrl === location.href &&
        /processing|please wait|do not close|waiting for/.test(
          (document.body ? document.body.innerText || "" : "").toLowerCase())) {
      await setStatus("Payment in progress — waiting...");
      return;
    }

    // No dialog: tap the landing "Make a payment" CTA, clearing stale flags.
    if (findMakePaymentButton()) {
      await safeSet({ prepayFormOpened: false, prepayEntered: false, prepayPayClicked: false });
      await handlePaymentsLanding();
      return;
    }
  } finally { payFrameBusy = false; }
}

// ==================== MAIN LOOP ====================
async function tick() {
  if (!extAlive()) return;
  if (PAUSED) return; // paused → do nothing until resumed
  const s = await safeGet(["loginActive", "loginEmail"]);
  if (!s.loginActive || !s.loginEmail) return;

  const page = detectPage();
  const h = location.hostname;
  const txt = (document.body ? document.body.innerText || "" : "").toLowerCase();

  if (codeFieldPresent() || txt.includes("enter verification code") || txt.includes("enter the code") || page === "otp") {
    return handleOtpPage();
  }
  // accounts.google.com is always the Google sign-in interstitial. Route it here
  // BEFORE the email fallback — that page can carry a hidden
  // input[name="login_hint"], which was wrongly triggering the email handler
  // (and holding the lock so Next never got clicked).
  if (h === "accounts.google.com" || page === "google-signin") {
    return handleGoogleSignin();
  }
  if ((h === "accounts.cloud.google.com" && document.querySelector('#i3, input[name="login_hint"]')) || page === "email") {
    return handleEmailPage();
  }
  if (document.querySelector('#identifierId, input[name="identifier"]')) {
    return handleGoogleSignin();
  }
  // "I understand" interstitial — checked after all login-flow pages so the
  // exact Material-span selector can't be confused with email/OTP pages.
  if (iUnderstandPagePresent()) {
    return handleIUnderstandPage();
  }

  // Billing / prepayment pages.
  if (page === "billing-payment" || page === "billing") {
    const ps = await safeGet(["autoPrepay", "prepayDone", "loginActive", "prepayPayClicked", "prepayPayUrl", "prepayCtaDocId"]);
    if (!ps.loginActive || ps.prepayDone) return;
    if (ps.autoPrepay === false) return;

    if (prepaySuccessPresent()) { await markPrepayDone(); return; }

    // QR is up — never click anything else.
    if (paymentQrPresent()) {
      await setStatus("Scan the UPI QR code to complete the ₹1,000 prepayment.");
      return;
    }

    // 1) A dialog action is on screen (Continue / Pay now). Drive it.
    const maybeDialog = page === "billing-payment" || prepayDialogOpen();
    const dialogAction = maybeDialog ? findLabeledButtonInOrder(["Continue", "Pay now"]) : null;
    if (dialogAction) {
      const label = buttonLabelText(dialogAction).toLowerCase();
      if (/continue/.test(label)) return handlePaymentAmountForm();
      return handlePaymentConfirm();
    }

    // 2) The dialog is open but its action button hasn't rendered yet.
    if (prepayDialogOpen()) {
      await setStatus("Payment dialog open — waiting for Continue...");
      return;
    }

    // 3) The dialog lives in a payments.google.com iframe: let that frame's
    //    handler drive it. Do not re-tap the page-level CTA.
    if (paymentsFrameOpen()) {
      await setStatus("Payment dialog open — waiting for Continue...");
      return;
    }

    // 4) Payment already started on this page: only wait while it's actually
    //    processing. Otherwise the flag is stale and must not block the CTA.
    if (ps.prepayPayClicked && ps.prepayPayUrl === location.href &&
        /processing|please wait|do not close|waiting for/.test(
          (document.body ? document.body.innerText || "" : "").toLowerCase())) {
      await setStatus("Payment in progress — waiting...");
      return;
    }

    // 5) No dialog is open — this is the billing overview/landing. Clear any
    //    stale flags from a previous attempt and tap "Make a payment".
    //    At most once per document, so a slow dialog can't be double-opened.
    if (findMakePaymentButton() && ps.prepayCtaDocId !== DOC_ID) {
      await safeSet({ prepayFormOpened: false, prepayEntered: false, prepayPayClicked: false });
      return handlePaymentsLanding();
    }
    if (ps.prepayCtaDocId === DOC_ID) {
      await setStatus("Waiting for the payment dialog...");
      return;
    }

    // 6) Payment landing still loading — retry on the next tick.
    await setStatus("Waiting for the 'Make a payment' button...");
    return;
  }

  if (page === "signed-in") {
    const ps = await safeGet(["autoPrepay", "prepayDone"]);
    if (ps.autoPrepay !== false && !ps.prepayDone) {
      // The free-trial card can open the payment dialog without changing the
      // URL. Drive its action before looking for the card button again.
      const dialogAction = findLabeledButtonInOrder(["Continue", "Pay now"]);
      if (dialogAction) {
        const label = buttonLabelText(dialogAction).toLowerCase();
        if (/continue/.test(label)) return handlePaymentAmountForm();
        return handlePaymentConfirm();
      }
      if (prepayDialogOpen()) {
        await setStatus("Payment dialog open — waiting for Continue...");
        return;
      }
      // Keep loginActive true so tick() keeps driving the prepayment.
      return handleConsolePrepay();
    }
    await safeSet({ loginActive: false, otpFilled: false });
    await setStatus("Signed in as " + s.loginEmail + ".");
  }
}

if (IS_PAY_FRAME) {
  // Payments iframe / page: tap "Make a payment", enter ₹1,000, confirm.
  setInterval(() => { if (extAlive()) handlePaymentFrame(); }, 2500);
  (async () => {
    await initPaused();
    const s = await safeGet(["loginActive"]);
    if (s.loginActive) startKeepAlive();
    await randDelay(1500, 2500);
    handlePaymentFrame();
  })();
} else {
  // Top frame: login flow + floating prepayment panel.
  // Re-run when the URL changes (SPA navigation) and on a steady interval.
  let lastUrl = location.href;
  setInterval(() => {
    if (!extAlive()) return;
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(tick, 2500);
    }
  }, 1500);

  setInterval(() => { if (!running) tick(); }, 5000);

  // Keep the floating prepayment panel present (SPA navigations can remove it).
  setInterval(() => { if (extAlive()) buildPrepayPanel(); }, 2000);

  (async () => {
    await initPaused();
    const s = await safeGet(["loginActive"]);
    if (s.loginActive) startKeepAlive();
    buildPrepayPanel();
    await randDelay(1500, 2500);
    await tick();
  })();
}

})();
