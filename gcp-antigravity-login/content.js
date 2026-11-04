/* GCP AG Login content script
 * Logs in to an existing Google account (email + OTP), then opens the
 * Antigravity OAuth consent, selects the logged-in account, and submits the code.
 */
(() => {
"use strict";

const IS_TOP = window.top === window.self;
const IS_OAUTH_HOST = location.hostname === "accounts.google.com";
const IS_ANTIGRAVITY = location.hostname === "antigravity.google" ||
  location.hostname === "www.antigravity.google";

// ==================== STORAGE ====================

function extAlive() {
  try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
  catch (e) { return false; }
}

let timers = [];
let stopped = false;

function stopAll() {
  if (stopped) return;
  stopped = true;
  timers.forEach((t) => { try { clearInterval(t); } catch (e) {} });
  timers = [];
}

let lastActivitySentAt = 0;

function sendActivity(reason) {
  if (!extAlive()) return;
  const now = Date.now();
  if (now - lastActivitySentAt < 1000) return;
  lastActivitySentAt = now;
  try {
    chrome.runtime.sendMessage({ type: "ACTIVITY", reason: reason || "ui" });
  } catch (e) {}
}

const DEFAULT_STATE = {
  config: { autoRun: true, fastMode: false, live: true },
  interns: [],
  currentIndex: 0
};

async function getState() {
  if (!extAlive()) { stopAll(); return { ...DEFAULT_STATE }; }
  try {
    const state = await chrome.storage.local.get(null);
    state.config = { autoRun: true, fastMode: false, live: true, ...(state.config || {}) };
    state.config.autoRun = state.config.live !== false;
    state.interns = Array.isArray(state.interns) ? state.interns : [];
    state.currentIndex = typeof state.currentIndex === "number" ? state.currentIndex : 0;
    return state;
  } catch (e) {
    stopAll();
    return { ...DEFAULT_STATE };
  }
}

function currentIntern(state) {
  return state.interns[state.currentIndex] || null;
}

async function safeSet(obj) {
  if (!extAlive()) { stopAll(); return; }
  try { await chrome.storage.local.set(obj); }
  catch (e) { stopAll(); }
}

async function updateIntern(idx, patch) {
  const state = await getState();
  if (!state.interns[idx]) return;
  state.interns[idx] = { ...state.interns[idx], ...patch };
  await safeSet({ interns: state.interns });
}

async function advance() {
  const state = await getState();
  const current = state.interns[state.currentIndex];
  if (current && current.status !== "failed") current.status = "done";
  await safeSet({
    interns: state.interns,
    currentIndex: Math.min(state.currentIndex + 1, state.interns.length)
  });
}

function sendMessageAsync(msg) {
  return new Promise((resolve) => {
    if (!extAlive()) { stopAll(); return resolve(null); }
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(res);
      });
    } catch (e) { resolve(null); }
  });
}

// ==================== DOM / INPUT ====================

function randDelay(min, max) {
  return new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));
}

function isVisible(el) {
  if (!el) return false;
  if (el.closest("#gcp-auto-panel")) return false;
  if (el.offsetWidth === 0 && el.offsetHeight === 0) {
    return !!el.closest(".cdk-overlay-pane, [role='dialog'], mat-dialog-container, .mat-mdc-dialog-container");
  }
  return true;
}

function waitFor(selectorOrFn, timeout) {
  timeout = timeout || 12000;
  return new Promise((resolve) => {
    const check = () => (typeof selectorOrFn === "function") ? selectorOrFn() : document.querySelector(selectorOrFn);
    const found = check();
    if (found) return resolve(found);
    const started = Date.now();
    const observer = new MutationObserver(() => {
      const el = check();
      if (el) { observer.disconnect(); resolve(el); }
      else if (Date.now() - started > timeout) { observer.disconnect(); resolve(null); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(check()); }, timeout);
  });
}

function findByText(text) {
  const wanted = text.trim().toLowerCase();
  const interactive = [...document.querySelectorAll(
    "button, a, [role='button'], [role='option'], mat-option, [role='menuitem'], li"
  )].filter(isVisible);
  let match = interactive.find((el) => (el.textContent || "").trim().toLowerCase() === wanted);
  if (match) return match;
  const contains = interactive
    .filter((el) => (el.textContent || "").trim().toLowerCase().includes(wanted))
    .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);
  if (contains.length) return contains[0];
  const others = [...document.querySelectorAll("span, div, td")]
    .filter(isVisible)
    .filter((el) => (el.textContent || "").trim().toLowerCase().includes(wanted))
    .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);
  for (const el of others) return el.closest("button, a, [role='button']") || el;
  return null;
}

function setInputInstant(el, value) {
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  try {
    el.dispatchEvent(new InputEvent("input", {
      bubbles: true, inputType: "insertFromPaste", data: value
    }));
  } catch (e) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function clickNow(el) {
  if (!el) return;
  try { el.scrollIntoView({ block: "center" }); } catch (e) {}
  try { el.click(); } catch (e) {}
}

async function clickButtonFast(labels, timeout) {
  const started = Date.now();
  const limit = timeout || 2500;
  while (Date.now() - started < limit) {
    for (const label of labels) {
      const el = findByText(label);
      if (el) {
        const button = el.closest("button, [role='button'], a") || el;
        if (!button.disabled && button.getAttribute("aria-disabled") !== "true") {
          clickNow(button);
          return true;
        }
      }
    }
    await randDelay(40, 80);
  }
  return false;
}

// ==================== PAGE DETECTION ====================

function isOauthUrl() {
  if (location.hostname !== "accounts.google.com") return false;
  const href = location.href;
  const path = location.pathname;
  return href.includes("client_id=") || path.includes("/o/oauth2") || path.includes("/signin/oauth");
}

function hasOtpInput() {
  return !!document.querySelector('input[name="pinInput"], input[inputmode="numeric"], input[autocomplete="one-time-code"], input[type="tel"], input[aria-label*="code" i], input[aria-label*="verification" i]');
}

function detectPage() {
  const host = location.hostname;
  const path = location.pathname;
  const href = location.href;

  if (IS_ANTIGRAVITY && (path.includes("oauth-callback") || document.querySelector("[data-code-box]"))) return "authcode";
  if (isOauthUrl()) return "oauth";
  if ((host === "accounts.google.com" || host === "accounts.cloud.google.com") &&
      hasOtpInput() && /verify-oob-code|accountverification|challenge|ootp/i.test(path + href)) return "login-otp";
  if (host === "accounts.cloud.google.com" &&
      (path.includes("/signup/email") || path.includes("/login/email"))) return "email";
  if (host === "accounts.google.com") return "google-signin";
  if (host === "accounts.cloud.google.com" &&
      (path.includes("/signin") || path.includes("/challenge") || path.includes("verify-oob-code"))) return "email";
  if (host === "console.cloud.google.com" || host === "cloud.google.com") return "console";
  return "other";
}

function accountDisabled() {
  const text = (document.body.innerText || "").toLowerCase();
  return text.includes("your account has been disabled");
}

function googleUnknownError() {
  const path = (location.pathname || "").toLowerCase();
  if (path.includes("unknownerror")) return true;
  const heading = (document.querySelector("#headingText")?.textContent || "").trim().toLowerCase();
  const sub = (document.querySelector("#headingSubtext")?.textContent || "").trim().toLowerCase();
  return heading.includes("something went wrong") && sub.includes("try again");
}

let loginFailHandledFor = null;
let unknownErrorHandledFor = null;

async function handleGoogleUnknownError(state) {
  const intern = currentIntern(state);
  if (!intern) return;
  if (unknownErrorHandledFor === location.href) return;
  unknownErrorHandledFor = location.href;

  setStatus("Google temporary error for " + intern.email + ". Retrying same account...");
  const res = await sendMessageAsync({ type: "LOGIN_BLOCKED", email: intern.email });
  if (!res || !res.ok) {
    setStatus("Could not retry " + intern.email + ": " + String((res && res.error) || "unknown"));
    return;
  }
  if (res.retry) {
    setStatus("Retrying " + intern.email + " (" + res.attempts + "/2)...");
  } else {
    setStatus("Temporary Google error for " + intern.email + " (not disabled). Kept aside; moving to next.");
  }
}

async function failCurrentAndNext(state, reason) {
  const intern = currentIntern(state);
  if (!intern) return;
  if (loginFailHandledFor === intern.email) return;
  loginFailHandledFor = intern.email;

  setStatus((reason || "Account failed") + ": " + intern.email + ". Moving to next...");
  await updateIntern(state.currentIndex, { status: "failed", note: reason || "failed" });
  await advance();
  await randDelay(600, 1200);
  const res = await sendMessageAsync({
    type: "LOGIN_FAILED",
    email: intern.email,
    reason: reason || "failed"
  });
  if (!res || !res.ok) {
    setStatus("Could not start next login: " + String((res && res.error) || "unknown"));
  }
}

// ==================== LOGIN FLOW ====================

let running = false;
let loginEmailSubmittedFor = null;
let loginOtpFilledFor = null;
let loginOauthRequestedFor = null;

function findLoginAccountRow(email) {
  const target = String(email || "").toLowerCase();
  if (!target) return null;
  const nodes = [...document.querySelectorAll("[data-identifier], [data-email]")].filter(isVisible);
  for (const node of nodes) {
    const value = (node.getAttribute("data-identifier") || node.getAttribute("data-email") || "").toLowerCase();
    if (value === target) return node.closest("[role='link'], li") || node;
  }
  return null;
}

async function handleSpeedbump() {
  if (running) return;
  running = true;
  try {
    const button = findByText("I understand");
    if (button) await clickNow(button);
  } finally { running = false; }
}

// ==================== LOGIN FLOW (ported from GCP Account Prepayment) ====================
const LOGIN_CODE_SELECTOR = 'input[name="pinInput"], input[autocomplete="one-time-code"], input[type="tel"], input[inputmode="numeric"]';
let loginTypingLock = false;

function loginParseTs(ts) {
  if (ts == null) return 0;
  if (typeof ts === "number") return ts < 1e12 ? ts * 1000 : ts;
  const n = Number(ts);
  if (!isNaN(n) && String(ts).trim() !== "") return n < 1e12 ? n * 1000 : n;
  const p = Date.parse(ts);
  return isNaN(p) ? 0 : p;
}

async function loginFetchCode(email) {
  const resp = await sendMessageAsync({ type: "FETCH_OTP", email });
  if (!resp || !resp.ok || !resp.code) return null;
  return { code: String(resp.code).trim(), timestamp: resp.timestamp };
}

async function loginFreshCode(email, requestedAt, avoid) {
  let delay = 2500;
  for (let i = 0; i < 15; i++) {
    const resp = await loginFetchCode(email);
    if (resp) {
      const code = resp.code;
      const ts = loginParseTs(resp.timestamp);
      const fresh = ts ? ts >= requestedAt - 30000 : true;
      if (code.length >= 4 && code !== avoid && fresh) return code;
    }
    setStatus("Waiting for the latest login code... (" + (i + 1) + "/15)");
    await randDelay(delay, delay + 1200);
    delay = Math.min(delay * 1.3, 12000);
  }
  return null;
}

async function loginHumanType(el, text) {
  const wait0 = Date.now();
  while (loginTypingLock && Date.now() - wait0 < 15000) await randDelay(60, 140);
  loginTypingLock = true;
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
    loginTypingLock = false;
  }
}

async function loginHumanClick(el) {
  await randDelay(300, 700);
  try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
  await randDelay(150, 350);
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  el.click();
}

async function loginForceClick(el) {
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

const LOGIN_CONTINUE_LABELS = [
  "continue as", "continue", "next", "confirm", "allow", "proceed",
  "yes, continue", "i agree", "agree", "accept", "done", "sign in", "verify"
];

function loginFindContinue() {
  const cands = [...document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], a[role="button"]')]
    .filter(el => (el.offsetWidth > 0 || el.offsetHeight > 0) && !el.disabled);
  const labelOf = (el) =>
    ((el.getAttribute("aria-label") || "") + " " + (el.value || "") + " " + (el.textContent || ""))
      .replace(/\s+/g, " ").trim().toLowerCase();
  for (const want of LOGIN_CONTINUE_LABELS) {
    const m = cands.find(el => {
      const t = labelOf(el);
      return t === want || t.startsWith(want + " ") || t === want + "\u2026";
    });
    if (m) return m;
  }
  return null;
}

function loginFindAccountTile(email) {
  const e = (email || "").trim().toLowerCase();
  if (!e) return null;
  const tiles = [...document.querySelectorAll('[data-identifier], [data-email], li[jsaction], div[role="link"], [role="button"]')]
    .filter(el => el.offsetWidth > 0 || el.offsetHeight > 0);
  let m = tiles.find(el =>
    (el.getAttribute("data-identifier") || el.getAttribute("data-email") || "").trim().toLowerCase() === e);
  if (m) return m.closest('li, [role="link"], [role="button"], div[jsaction]') || m;
  m = tiles.find(el => (el.textContent || "").toLowerCase().includes(e));
  if (m) return m.closest('li, [role="link"], [role="button"], div[jsaction]') || m;
  return null;
}

function loginFindLabeled(labels) {
  const wants = labels.map(l => l.trim().toLowerCase());
  for (const id of ["identifierNext", "passwordNext", "idvPreregisteredPhoneNext",
                    "next", "submit", "verifyButton", "confirm", "yesButton"]) {
    const wrap = document.getElementById(id);
    if (wrap && (wrap.offsetWidth > 0 || wrap.offsetHeight > 0)) {
      const b = wrap.tagName === "BUTTON" ? wrap : wrap.querySelector("button");
      if (b) return b;
    }
  }
  const span = [...document.querySelectorAll('span[jsname="V67aGc"], span.VfPpkd-vQzf8d, span.YUhpIc-vQzf8d')]
    .find(sp => wants.includes((sp.textContent || "").trim().toLowerCase()));
  if (span) {
    const b = span.closest("button, [role='button']");
    if (b && (b.offsetWidth > 0 || b.offsetHeight > 0)) return b;
  }
  for (const l of labels) { const b = findByText(l); if (b) return b; }
  return null;
}

function loginFindNext() {
  return loginFindLabeled(["Next"]);
}

async function loginClickNext(input) {
  const btn = loginFindNext();
  if (btn) {
    await loginForceClick(btn);
    return true;
  }
  if (input && input.form && input.form.requestSubmit) {
    input.form.requestSubmit();
    return true;
  }
  if (input) {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true }));
    return true;
  }
  return false;
}

function loginIUnderstand() {
  return loginFindLabeled(["I understand", "I understand to continue"]);
}

async function loginWatchResult(timeout) {
  const t0 = Date.now();
  const ERR = /(wrong code|incorrect|invalid|expired|didn.?t work|did not work|doesn.?t match|does not match|check the code|enter a valid|try again)/;
  while (Date.now() - t0 < timeout) {
    if (!extAlive()) return true;
    if (detectPage() !== "login-otp" && !document.querySelector(LOGIN_CODE_SELECTOR)) return true;
    const txt = (document.body ? document.body.innerText || "" : "").toLowerCase();
    if (ERR.test(txt)) return false;
    if (document.querySelector('input[aria-invalid="true"]')) return false;
    await randDelay(600, 900);
  }
  return detectPage() !== "login-otp";
}

async function loginHandleEmail(state) {
  if (running) return;
  running = true;
  try {
    const intern = currentIntern(state);
    if (!intern) return;
    const input = await waitFor('#i3, input[name="login_hint"], input[type="email"]', 12000);
    if (!input) { setStatus("Email field not found."); return; }
    if ((input.value || "").includes("@")) {
      setStatus("Email already filled — clicking Next...");
    } else {
      setStatus("Typing email: " + intern.email);
      await randDelay(1200, 2200);
      await loginHumanType(input, intern.email);
    }
    await randDelay(800, 1500);
    await loginSubmitEmail(input);
    await safeSet({ otpRequestedAt: Date.now(), lastTriedCode: "", otpFilled: false });
    await updateIntern(state.currentIndex, { status: "in_progress", note: "Email submitted" });
    setStatus("Email submitted. Waiting for the code page...");
  } finally { running = false; }
}

async function loginSubmitEmail(input) {
  input.focus();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true }));
  await randDelay(900, 1400);
  // Only click Next if Enter did not advance.
  if (document.querySelector('#identifierId, input[name="identifier"], input[type="email"], #i3, input[name="login_hint"]')) {
    const btn = loginFindNext();
    if (btn) await loginForceClick(btn);
    else if (input.form && input.form.requestSubmit) input.form.requestSubmit();
  }
}

async function loginHandleGoogleSignin(state) {
  if (running) return;
  running = true;
  try {
    const intern = currentIntern(state);
    if (!intern) return;
    const email = intern.email;
    await randDelay(600, 1100);
    if (document.querySelector(LOGIN_CODE_SELECTOR)) return; // OTP handler
    const input = document.querySelector('#identifierId, input[name="identifier"], input[type="email"]');
    if (input && (input.offsetWidth > 0 || input.offsetHeight > 0)) {
      if ((input.value || "").trim().toLowerCase() !== email.toLowerCase()) {
        setStatus("Typing email: " + email);
        await loginHumanType(input, email);
      }
      await randDelay(400, 800);
      setStatus("Pressing Enter...");
      await loginSubmitEmail(input);
      await safeSet({ otpRequestedAt: Date.now(), lastTriedCode: "", otpFilled: false });
      await updateIntern(state.currentIndex, { status: "in_progress", note: "Email submitted" });
      setStatus("Email submitted. Waiting for OTP...");
      return;
    }
    const tile = loginFindAccountTile(email);
    if (tile) {
      setStatus("Choosing account " + email + "...");
      await loginHumanClick(tile);
      return;
    }
    const another = findByText("Use another account") || findByText("Add account");
    if (another) {
      setStatus("Opening another-account entry...");
      await loginHumanClick(another);
      return;
    }
    const understand = loginIUnderstand();
    if (understand) {
      setStatus("Clicking 'I understand'...");
      await loginHumanClick(understand);
      return;
    }
    const cont = loginFindContinue();
    if (cont) {
      setStatus("Confirming sign-in...");
      await loginHumanClick(cont);
      return;
    }
  } finally { running = false; }
}

function loginPageEmail() {
  const text = document.body ? String(document.body.innerText || "") : "";
  const m = text.match(/(?:code to|sent to|verification code to|email)\s*:?\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i) ||
    text.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  return m ? m[1].toLowerCase() : "";
}

async function loginHandleOtp(state) {
  if (running) return;
  const intern = currentIntern(state);
  if (!intern) return;
  const email = intern.email;
  if (loginOtpFilledFor === email) return;

  // This tab may belong to a different account (stale/parallel login tab).
  // Never fetch or enter the current account's OTP on another account's page.
  const shownEmail = loginPageEmail();
  if (shownEmail && shownEmail !== email.toLowerCase()) {
    setStatus("Stale OTP page for " + shownEmail + " — restarting login for " + email + "...");
    await randDelay(800, 1200);
    location.href = "https://console.cloud.google.com/AddSession";
    return;
  }

  running = true;
  try {
    const pin = await waitFor(LOGIN_CODE_SELECTOR, 12000);
    if (!pin) { setStatus("OTP field not found."); return; }
    const st = await chrome.storage.local.get(["otpRequestedAt", "lastTriedCode"]);
    let requestedAt = Number(st.otpRequestedAt) || Date.now();
    if (!st.otpRequestedAt) await safeSet({ otpRequestedAt: requestedAt });
    const since = Date.now() - requestedAt;
    if (since < 5000) {
      setStatus("Waiting for a fresh login code...");
      await randDelay(5000 - since, 5000 - since + 800);
    }
    let avoid = String(st.lastTriedCode || "");
    for (let attempt = 1; attempt <= 4; attempt++) {
      const code = await loginFreshCode(email, requestedAt, avoid);
      if (!code) break;
      const pinNow = document.querySelector(LOGIN_CODE_SELECTOR) || pin;
      setStatus("Entering login code " + code + " (" + attempt + "/4)...");
      await loginHumanType(pinNow, code);
      avoid = code;
      await safeSet({ lastTriedCode: code });
      await randDelay(900, 1500);
      for (let c = 0; c < 3; c++) {
        const verify = loginFindLabeled(["Verify", "Next", "Continue", "Submit", "Done"]);
        if (verify) await loginForceClick(verify);
        else if (pinNow.form && pinNow.form.requestSubmit) pinNow.form.requestSubmit();
        else pinNow.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true }));
        await randDelay(1000, 1500);
        if (!document.querySelector(LOGIN_CODE_SELECTOR)) break;
      }
      const accepted = await loginWatchResult(12000);
      if (accepted) {
        loginOtpFilledFor = email;
        await safeSet({ otpFilled: true, loginReadyEmail: email, lastTriedCode: code });
        await updateIntern(state.currentIndex, { status: "in_progress", note: "Logged in" });
        setStatus("Code accepted. Logged in as " + email + ".");
        return;
      }
      requestedAt = Date.now();
      await safeSet({ otpRequestedAt: requestedAt });
      const resend = findByText("Resend code") || findByText("Resend") || findByText("Send again") ||
        findByText("Get a new code") || findByText("Try again");
      if (resend) await loginHumanClick(resend);
      await randDelay(3000, 4500);
    }
    return failCurrentAndNext(state, "login code not received");
  } finally { running = false; }
}

async function handleConsole(state) {
  if (running) return;
  if (accountDisabled()) return failCurrentAndNext(state, "account disabled");
  const intern = currentIntern(state);
  if (!intern) return;
  const email = intern.email;

  const onWelcome = /console\.cloud\.google\.com\/welcome/i.test(location.href);
  if (state.loginReadyEmail !== email && !onWelcome) {
    setStatus("Console page. Login is still in progress...");
    return;
  }
  if (state.loginReadyEmail !== email && onWelcome) {
    await safeSet({ loginReadyEmail: email, accountStartedAt: Date.now() });
    state.loginReadyEmail = email;
    setStatus("Welcome page reached — login successful, starting OAuth...");
  }
  if (state.oauthStartEmail === email) {
    setStatus("OAuth already started for " + email + ".");
    return;
  }
  if (loginOauthRequestedFor === email) {
    setStatus("Starting OAuth for " + email + "...");
    return;
  }

  running = true;
  try {
    loginOauthRequestedFor = email;
    setStatus("Logged in. Opening OAuth for " + email + "...");
    const res = await sendMessageAsync({ type: "START_OAUTH", email });
    if (!res || !res.ok) {
      loginOauthRequestedFor = null;
      setStatus("OAuth start failed: " + String((res && res.error) || "unknown"));
    }
  } finally { running = false; }
}

// ==================== OAUTH ====================

function findOauthAccount(email) {
  const target = String(email || "").toLowerCase();
  if (!target) return null;
  const nodes = [...document.querySelectorAll("[data-identifier], [data-email]")].filter(isVisible);
  for (const node of nodes) {
    const value = (node.getAttribute("data-identifier") || node.getAttribute("data-email") || "").toLowerCase();
    if (value === target) return node.closest("[role='link'], li") || node;
  }
  return null;
}

function findUnderstandButton() {
  const container = document.querySelector("#gaplustosNext");
  if (container) {
    const btn = container.querySelector("button, [role='button']");
    if (btn && isVisible(btn)) return btn;
  }
  return findByText("I understand");
}

function findApproveButton() {
  const container = document.querySelector("#submit_approve_access");
  if (!container) return null;
  const button = container.querySelector("button, [role='button']");
  if (!button || !isVisible(button)) return null;
  if (button.disabled || button.getAttribute("aria-disabled") === "true") return null;
  return button;
}

let oauthPickedFor = null;
let oauthConsentFor = null;
let oauthApprovedFor = null;

async function handleOauthChooser(state) {
  const intern = currentIntern(state);
  const email = String(state.agOauthEmail || (intern && intern.email) || "").trim().toLowerCase();
  if (!email) return;
  if (state.oauthPickedEmail === email || oauthPickedFor === email) return;
  const row = findOauthAccount(email);
  if (!row) return;
  oauthPickedFor = email;
  await safeSet({ oauthPickedEmail: email });
  setStatus("Selecting OAuth account " + email + "...");
  await randDelay(400, 800);
  clickNow(row);
}

async function handleOauthConsent(state) {
  const intern = currentIntern(state);
  const email = String(state.agOauthEmail || (intern && intern.email) || "accepted").trim().toLowerCase();
  if (state.oauthConsentEmail === email || oauthConsentFor === email) return;
  const button = findUnderstandButton();
  if (!button) return;
  oauthConsentFor = email;
  await safeSet({ oauthConsentEmail: email });
  setStatus("Accepting Antigravity terms...");
  await randDelay(400, 800);
  clickNow(button);
}

async function handleOauthApprove(state) {
  const intern = currentIntern(state);
  const email = String(state.agOauthEmail || (intern && intern.email) || "accepted").trim().toLowerCase();
  if (state.oauthApprovedEmail === email || oauthApprovedFor === email) return;
  const button = findApproveButton();
  if (!button) return;
  oauthApprovedFor = email;
  await safeSet({ oauthApprovedEmail: email });
  setStatus("Approving OAuth access...");
  await randDelay(400, 800);
  clickNow(button);
}

async function handleOauthPage(state) {
  if (state.proxyHold) return;
  const intern = currentIntern(state);
  const email = String(state.agOauthEmail || (intern && intern.email) || "").trim().toLowerCase();

  if (email && state.oauthPickedEmail !== email) {
    if (findOauthAccount(email)) return handleOauthChooser(state);
  }
  if (findUnderstandButton() && state.oauthConsentEmail !== email) {
    return handleOauthConsent(state);
  }
  if (findApproveButton()) return handleOauthApprove(state);
}

// ==================== CALLBACK CODE ====================

let lastCopiedCode = null;

function copyToClipboard(text) {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch (e) { return false; }
}

let autoResendTimer = null;
let autoResendCode = null;
let autoResendCount = 0;

function clearAutoResend() {
  if (autoResendTimer) {
    clearTimeout(autoResendTimer);
    autoResendTimer = null;
  }
  autoResendCode = null;
  autoResendCount = 0;
}

function scheduleAutoResend(code, delay) {
  if (!code) return;
  if (autoResendTimer) clearTimeout(autoResendTimer);
  autoResendCode = code;
  autoResendTimer = setTimeout(async () => {
    autoResendTimer = null;
    if (autoResendCode !== code) return;
    const state = await getState();
    if (state.config.live === false) return;
    if (state.oauthApiResult === "accepted") return;
    if (String(state.lastOauthCode || "").trim() !== code) return;

    autoResendCount++;
    showApiStatus("pending", "Auto-resending code (" + autoResendCount + ")...");
    const res = await sendMessageAsync({ type: "SUBMIT_OAUTH_CODE", code });
    if (res && res.ok) {
      showApiStatus("accepted", res.already ? "Code already accepted" : "Code accepted");
      clearAutoResend();
      return;
    }
    if (res && res.retryable) {
      showApiStatus("pending", "Code not accepted — auto-retrying...");
      scheduleAutoResend(code, 5000);
    } else {
      showApiStatus("rejected", "Resend failed: " + String((res && res.error) || "unknown"));
    }
  }, delay || 5000);
}

async function resendLastOauthCode() {
  const state = await getState();
  const code = String(state.lastOauthCode || "").trim();
  if (!code) {
    showApiStatus("rejected", "No code to resend.");
    return;
  }
  clearAutoResend();
  showApiStatus("pending", "Resending code...");
  const res = await sendMessageAsync({ type: "SUBMIT_OAUTH_CODE", code });
  if (res && res.ok) {
    showApiStatus("accepted", res.already ? "Code already accepted" : "Code accepted");
  } else {
    showApiStatus("rejected", "Resend failed: " + String((res && res.error) || "unknown"));
  }
}

function showApiStatus(result, message) {
  if (!IS_TOP) return;
  let card = document.getElementById("gcp-ag-api-status");
  if (!card) {
    card = document.createElement("div");
    card.id = "gcp-ag-api-status";
    card.innerHTML = `
      <div class="gcp-ag-api-head">
        <span class="gcp-ag-api-dot"></span>
        <span class="gcp-ag-api-title">OAuth API</span>
        <button id="gcp-ag-api-close" type="button" title="Close">&times;</button>
      </div>
      <div class="gcp-ag-api-msg"></div>
      <div class="gcp-ag-api-actions"><button id="gcp-ag-api-retry" type="button">Resend code</button></div>`;
    document.documentElement.appendChild(card);
    card.querySelector("#gcp-ag-api-close").onclick = () => card.remove();
    card.querySelector("#gcp-ag-api-retry").onclick = () => resendLastOauthCode();
  }
  card.className = "gcp-ag-api-status " + (result || "");
  const ipBadge = document.getElementById("gcp-ag-ip-badge");
  if (ipBadge) ipBadge.style.bottom = "150px";
  const actions = card.querySelector(".gcp-ag-api-actions");
  if (actions) actions.style.display = result === "rejected" ? "block" : "none";
  card.querySelector(".gcp-ag-api-msg").textContent = message || (
    result === "pending" ? "Sending code..." :
    result === "accepted" ? "Code accepted" :
    result === "rejected" ? "Code rejected" : ""
  );
}

async function refreshApiStatus() {
  if (!IS_ANTIGRAVITY) return;
  const state = await getState();
  if (state.oauthApiResult === "pending" ||
      state.oauthApiResult === "accepted" ||
      state.oauthApiResult === "rejected") {
    showApiStatus(state.oauthApiResult, state.oauthApiMessage || "");
  }
}

async function handleAuthCodePage(state) {
  if (state.proxyHold) return;
  const box = document.querySelector("[data-code-box]");
  if (!box) return;
  const code = (box.textContent || "").trim();
  if (!code || code === lastCopiedCode) return;
  lastCopiedCode = code;

  const intern = currentIntern(state);
  const email = String(state.agOauthEmail || (intern && intern.email) || "").trim().toLowerCase();
  await safeSet({
    lastOauthCode: code,
    lastOauthCodeEmail: email,
    lastOauthCodeAt: Date.now()
  });
  try {
    chrome.runtime.sendMessage({ type: "RECORD_OAUTH_CODE", code, email });
  } catch (e) {}

  if (state.oauthCallbackCode === code) {
    copyToClipboard(code);
    showApiStatus(state.oauthApiResult || "accepted", state.oauthApiMessage || "Code already submitted");
    return;
  }

  clearAutoResend();
  showApiStatus("pending", "Sending code to API...");
  const res = await sendMessageAsync({ type: "SUBMIT_OAUTH_CODE", code });
  const copied = copyToClipboard(code);

  if (res && res.ok) {
    showApiStatus("accepted", res.already ? "Code already accepted" : "Code accepted" + (copied ? " — copied" : ""));
  } else {
    showApiStatus("rejected", "Code rejected: " + String((res && res.error) || "unknown"));
  }
}

// ==================== PANEL ====================

let panelEl = null;
let statusText = "Ready.";
let proxyIpLabel = "";
let proxyIpFetching = false;
let accountTimerStart = 0;
let accountTimerEnd = 0;
let accountTimerLive = false;

function updatePanelAccountTimer() {
  const el = document.getElementById("gcp-auto-timer");
  if (!el) return;
  if (!accountTimerLive || !accountTimerStart) {
    el.textContent = "Stuck timer: stopped";
    el.className = "gcp-auto-timer off";
    return;
  }
  const left = Math.max(0, accountTimerEnd - Date.now());
  const minutes = Math.floor(left / 60000);
  const seconds = Math.floor((left % 60000) / 1000);
  el.textContent = "Stuck timer: " + minutes + ":" + String(seconds).padStart(2, "0");
  el.className = "gcp-auto-timer" + (left <= 30000 ? " danger" : "");
}
function setStatus(t) {
  statusText = t;
  const el = document.getElementById("gcp-auto-status");
  if (el) el.textContent = t;
}

async function refreshPanelProxyIp(force) {
  if (!IS_TOP || IS_OAUTH_HOST || IS_ANTIGRAVITY || proxyIpFetching) return;
  const state = await getState();
  const enabled = !!(state.proxy && state.proxy.enabled);
  if (!enabled) {
    if (proxyIpLabel) {
      proxyIpLabel = "";
      renderPanel();
    }
    return;
  }
  if (proxyIpLabel && !force) return;

  proxyIpFetching = true;
  try {
    const info = await sendMessageAsync({ type: "PROXY_INFO" });
    const latest = await getState();
    if (!(latest.proxy && latest.proxy.enabled)) {
      if (proxyIpLabel) {
        proxyIpLabel = "";
        renderPanel();
      }
      return;
    }
    const next = info && info.ok && info.ip ? "IP " + info.ip : "IP ?";
    if (next !== proxyIpLabel) {
      proxyIpLabel = next;
      renderPanel();
    }
  } finally {
    proxyIpFetching = false;
  }
}

async function renderPanel() {
  if (!IS_TOP || IS_OAUTH_HOST || IS_ANTIGRAVITY) return;
  const state = await getState();
  const intern = currentIntern(state);
  accountTimerStart = Number(state.accountStartedAt) || 0;
  accountTimerEnd = Number(state.accountTimeoutAt) || (accountTimerStart + Math.max(0.5, Math.min(60, Number(state.config.stuckMinutes) || 2.5)) * 60000);
  accountTimerLive = state.config.live !== false;
  const total = state.interns.length;
  const done = state.interns.filter((i) => i.status === "done").length;
  const active = state.interns.filter((i) => i.status === "in_progress").length;
  const failed = state.interns.filter((i) => i.status === "failed").length;

  if (!panelEl) {
    panelEl = document.createElement("div");
    panelEl.id = "gcp-auto-panel";
    document.documentElement.appendChild(panelEl);
  }

  const globalIpBadge = document.getElementById("gcp-ag-ip-badge");
  if (globalIpBadge) globalIpBadge.remove();

  panelEl.innerHTML = `
    <div class="gcp-auto-head">
      <span class="gcp-auto-title"><span class="gcp-auto-dot"></span>AG Login <span class="gcp-auto-ip">${proxyIpLabel}</span></span>
      <button id="gcp-auto-collapse" title="Collapse">-</button>
    </div>
    <div class="gcp-auto-body">
      <div class="gcp-auto-current">
        <div class="gcp-auto-label">CURRENT ACCOUNT (${total ? state.currentIndex + 1 : 0}/${total})</div>
        <div class="gcp-auto-email">${intern ? intern.email : "none"}</div>
      </div>
      <div class="gcp-auto-progress">
        <span class="badge-done">${done} done</span>
        <span class="badge-active">${active} active</span>
        <span class="badge-failed">${failed} failed</span>
        <span class="gcp-auto-total">/ ${total}</span>
      </div>
      <div id="gcp-auto-status" class="gcp-auto-statusline">${statusText}</div>
      <div id="gcp-auto-timer" class="gcp-auto-timer"></div>
      <div class="gcp-auto-btns">
        <button id="gcp-auto-fill">Fill page</button>
        <button id="gcp-auto-next">Done &rarr; Next</button>
      </div>
      <div class="gcp-auto-btns three">
        <button id="gcp-auto-oauth">Open OAuth</button>
        <button id="gcp-auto-skip">Skip</button>
        <button id="gcp-auto-signout">Sign out</button>
      </div>
      <div class="gcp-auto-btns">
        <label class="gcp-auto-auto"><input type="checkbox" id="gcp-auto-fast" ${state.config.fastMode ? "checked" : ""}/>Fast</label>
      </div>
    </div>`;

  panelEl.querySelector("#gcp-auto-fill").onclick = () => runForCurrentPage(true);
  panelEl.querySelector("#gcp-auto-next").onclick = async () => { await advance(); renderPanel(); };
  panelEl.querySelector("#gcp-auto-skip").onclick = async () => {
    const intern = currentIntern(state);
    if (!intern)	return;
    loginFailHandledFor = intern.email;
    setStatus("Skipping " + intern.email + "...");
    const res = await sendMessageAsync({
      type: "LOGIN_FAILED",
      email: intern.email,
      reason: "skipped"
    });
    if (!res || !res.ok) {
      await updateIntern(state.currentIndex, { status: "failed", note: "skipped" });
      await advance();
      renderPanel();
    }
  };
  panelEl.querySelector("#gcp-auto-oauth").onclick = () => {
    try { chrome.runtime.sendMessage({ type: "OPEN_OAUTH" }); } catch (e) {}
  };
  panelEl.querySelector("#gcp-auto-signout").onclick = () => {
    try { chrome.runtime.sendMessage({ type: "SIGN_OUT" }); } catch (e) {}
  };
  panelEl.querySelector("#gcp-auto-fast").onchange = async (event) => {
    const current = await getState();
    current.config.fastMode = event.target.checked;
    await safeSet({ config: current.config });
  };
  panelEl.querySelector("#gcp-auto-collapse").onclick = () => panelEl.classList.toggle("gcp-auto-collapsed");

  if (!proxyIpLabel) refreshPanelProxyIp(false).catch(() => {});
  updatePanelAccountTimer();
}

// ==================== ROUTER / INIT ====================

async function runForCurrentPage(manual) {
  const page = detectPage();
  const state = await getState();

  if (state.proxyHold) {
    setStatus("Proxy changed - waiting for a healthy IP...");
    return;
  }

  if (googleUnknownError()) {
    if (state.config.autoRun || manual) return handleGoogleUnknownError(state);
    return;
  }

  if (accountDisabled()) {
    if (state.config.autoRun || manual) return failCurrentAndNext(state, "account disabled");
    return;
  }

  if (page === "oauth") return handleOauthPage(state);
  if (page === "authcode") return handleAuthCodePage(state);
  if (!state.config.autoRun && !manual) return;

  switch (page) {
    case "google-signin": return loginHandleGoogleSignin(state);
    case "email": return loginHandleEmail(state);
    case "login-otp": return loginHandleOtp(state);
    case "console": return handleConsole(state);
  }
}

let lastUrl = location.href;

timers.push(setInterval(() => {
  if (!extAlive()) { stopAll(); return; }
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    loginEmailSubmittedFor = null;
    loginOtpFilledFor = null;
    loginOauthRequestedFor = null;
    loginFailHandledFor = null;
    unknownErrorHandledFor = null;
    sendActivity("url");
    setTimeout(() => {
      runForCurrentPage(false);
      renderPanel();
    }, 400);
  }
}, 1000));

// Login pages can render late; keep retrying.
timers.push(setInterval(async () => {
  if (!extAlive() || stopped || running) return;
  const page = detectPage();
  if (page === "google-signin" || page === "email" || page === "login-otp") {
    const state = await getState();
    if (state.config.autoRun) runForCurrentPage(false);
  }
}, 1500));

// After login, the console page is the trigger to start OAuth.
timers.push(setInterval(async () => {
  if (!extAlive() || stopped || running) return;
  if (detectPage() !== "console") return;
  const state = await getState();
  if (state.config.autoRun) handleConsole(state);
}, 2000));

// OAuth/manual pages: automate even if Live is stopped.
timers.push(setInterval(async () => {
  if (!extAlive() || stopped) return;
  if (detectPage() !== "oauth") return;
  const state = await getState();
  handleOauthPage(state);
}, 1500));

timers.push(setInterval(async () => {
  if (!extAlive() || stopped) return;
  if (detectPage() !== "authcode") return;
  const state = await getState();
  handleAuthCodePage(state);
}, 1500));

timers.push(setInterval(async () => {
  if (!extAlive() || stopped) return;
  if (!googleUnknownError()) return;
  const state = await getState();
  if (!state.proxyHold && state.config.autoRun) handleGoogleUnknownError(state);
}, 1500));

timers.push(setInterval(async () => {
  if (!extAlive() || stopped || running) return;
  if (!accountDisabled()) return;
  const state = await getState();
  if (state.config.autoRun) failCurrentAndNext(state, "account disabled");
}, 1500));

timers.push(setInterval(() => {
  if (!extAlive() || stopped) return;
  refreshPanelProxyIp(true).catch(() => {});
}, 60000));

timers.push(setInterval(() => {
  if (!extAlive() || stopped) return;
  updatePanelAccountTimer();
}, 1000));

try {
  chrome.storage.onChanged.addListener((changes) => {
    if (!extAlive()) return;
    if (changes.proxy) proxyIpLabel = "";
    if (IS_TOP) {
      if (changes.accountStartedAt || changes.lastActivityAt || changes.accountTimeoutAt) {
        if (changes.accountStartedAt) {
          accountTimerStart = Number(changes.accountStartedAt.newValue) || 0;
        }
        if (changes.accountTimeoutAt) {
          accountTimerEnd = Number(changes.accountTimeoutAt.newValue) || 0;
        }
        updatePanelAccountTimer();
      }
      if (changes.interns || changes.currentIndex || changes.config ||
          changes.proxy || changes.accountStartedAt) {
        renderPanel();
      }
    }
    if (IS_ANTIGRAVITY && (changes.oauthApiResult || changes.oauthApiMessage)) {
      refreshApiStatus();
    }
  });
} catch (e) {}

let lastActivityPage = null;

timers.push(setInterval(() => {
  if (!extAlive() || stopped) return;
  const page = detectPage();
  if (page !== lastActivityPage) {
    lastActivityPage = page;
    sendActivity("page");
  }
}, 1500));

function activityNode(node) {
  if (!node || node.nodeType !== 1) return false;
  try {
    if (node.closest("#gcp-auto-panel, #gcp-ag-ip-badge")) return false;
    const selector = "input,button,form,select,textarea,[role='button']";
    return node.matches(selector) || !!node.querySelector(selector);
  } catch (e) {
    return false;
  }
}

try {
  const activityObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList") continue;
      for (const node of mutation.addedNodes) {
        if (activityNode(node)) { sendActivity("dom"); return; }
      }
      for (const node of mutation.removedNodes) {
        if (activityNode(node)) { sendActivity("dom"); return; }
      }
    }
  });
  activityObserver.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });
} catch (e) {}

document.addEventListener("click", () => sendActivity("click"), true);
document.addEventListener("input", () => sendActivity("input"), true);
document.addEventListener("change", () => sendActivity("change"), true);

(async () => {
  await randDelay(500, 800);
  if (IS_TOP && !IS_OAUTH_HOST && !IS_ANTIGRAVITY) await renderPanel();
  await runForCurrentPage(false);
})();

})();
