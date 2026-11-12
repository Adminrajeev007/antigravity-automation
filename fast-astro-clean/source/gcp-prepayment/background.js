/* GCP Account Prepayment v1 - Background Service Worker
 * - Fetches the login OTP from the dispose.lol code service.
 * - Opens the Google Cloud login page for a given email.
 * - After sign-in, opens the billing page to make the fixed Rs.1000 prepayment.
 * - Logs out by clearing all Google session cookies/storage.
 */

const OTP_API_BASE = "https://dispose.lol/api/google-code";
const OTP_API_KEY = "gclvcodekeyq82nfhs7dkap01mzx";

// Fixed prepayment amount (INR).
const PREPAY_AMOUNT = "1000";

// Entry point for the email + OTP sign-in ("Create account or sign in").
// After login the console landing page shows the free-trial card with the
// "Make a payment" button; the content script taps it.
const CONSOLE_URL = "https://console.cloud.google.com/";
const BILLING_URL = "https://console.cloud.google.com/billing";
const LOGIN_URL =
  "https://accounts.cloud.google.com/signup/email?continueUrl=" +
  encodeURIComponent(CONSOLE_URL);

// Domains we clear on logout.
const GOOGLE_DOMAINS = [
  "google.com",
  "accounts.google.com",
  "cloud.google.com",
  "accounts.cloud.google.com",
  "console.cloud.google.com",
  "payments.google.com",
  "myaccount.google.com"
];
const GOOGLE_ORIGINS = GOOGLE_DOMAINS.map(d => "https://" + d);

// ==================== MESSAGE HANDLER ====================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg && msg.type) {
    case "FETCH_OTP":
      fetchOtp(msg.email).then(sendResponse);
      return true; // async response

    case "LOGIN":
      startLogin(msg.email).then(sendResponse);
      return true;

    case "LOGOUT":
      logout().then(sendResponse);
      return true;

    case "OPEN_BILLING":
      openBilling().then(sendResponse);
      return true;

    case "ALLOW_POPUPS":
      allowPopupsForBilling().then(() => sendResponse({ ok: true }));
      return true;
  }
  return false;
});

// ==================== POPUP PERMISSION ====================
// Google Payments may open its flow with window.open(). A synthetic
// (extension) click isn't a trusted user gesture, so Chrome's popup blocker
// blocks it and the page can sit on a spinner forever. Allowing popups for
// the Google/Cloud origins lets that window.open succeed.
async function allowPopupsForBilling() {
  if (!chrome.contentSettings || !chrome.contentSettings.popups) return;
  const patterns = [
    "https://console.cloud.google.com/*",
    "https://payments.google.com/*",
    "https://accounts.google.com/*",
    "https://*.cloud.google.com/*"
  ];
  for (const primaryPattern of patterns) {
    try { await chrome.contentSettings.popups.set({ primaryPattern, setting: "allow" }); } catch (e) {}
    try { await chrome.contentSettings.popups.set({ primaryPattern, setting: "allow", scope: "incognito_session_only" }); } catch (e) {}
  }
}

// ==================== OTP FETCH ====================
async function fetchOtp(email) {
  try {
    const store = await chrome.storage.local.get("otpApiKey");
    const key = (store && store.otpApiKey) || OTP_API_KEY;
    const url = `${OTP_API_BASE}?key=${encodeURIComponent(key)}&to=${encodeURIComponent(email)}`;
    const resp = await fetch(url, { method: "GET", cache: "no-store" });
    if (!resp.ok) return { ok: false, error: "HTTP " + resp.status };
    const data = await resp.json();
    if (data && data.code) {
      return { ok: true, code: String(data.code).trim(), timestamp: data.timestamp };
    }
    return { ok: false, error: "No code in response yet" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ==================== LOGIN ====================
async function startLogin(email) {
  const clean = (email || "").trim();
  if (!clean || !clean.includes("@")) {
    return { ok: false, error: "Enter a valid email" };
  }

  await allowPopupsForBilling();

  await chrome.storage.local.set({
    loginEmail: clean,
    loginActive: true,
    loginStatus: "Opening login page for " + clean + "...",
    otpFilled: false,
    lastTriedCode: "",
    otpRequestedAt: 0,
    // Fresh login -> clear any lingering pause and restart the prepayment.
    loginPaused: false,
    prepayAmount: PREPAY_AMOUNT,
    prepayDone: false,
    prepayStarted: false,
    prepayFormOpened: false,
    prepayEntered: false,
    prepayPayClicked: false,
    prepayPayUrl: "",
    prepayDocId: "",
    prepayPayDocId: "",
    prepayCtaDocId: "",
    prepayPayAttempts: 0,
    prepayCtaAttempts: 0,
    prepayFrameSeen: false,
    prepayLastTapAt: 0,
    prepayLastConfirmAt: 0
  });

  // Reuse an existing Google login tab if one is open, else make a new tab.
  const tabs = await chrome.tabs.query({ url: "https://accounts.cloud.google.com/*" });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { url: LOGIN_URL, active: true });
  } else {
    await chrome.tabs.create({ url: LOGIN_URL, active: true });
  }
  return { ok: true };
}

// ==================== OPEN BILLING / PREPAYMENT ====================
// Opens (or focuses) the billing page. The content script picks it up from
// there: it clicks "Make a payment" and fills the fixed Rs.1000 amount.
async function openBilling() {
  const s = await chrome.storage.local.get(["loginEmail"]);
  await allowPopupsForBilling();
  await chrome.storage.local.set({
    loginPaused: false,
    prepayAmount: PREPAY_AMOUNT,
    prepayDone: false,
    prepayStarted: false,
    prepayFormOpened: false,
    prepayEntered: false,
    prepayPayClicked: false,
    prepayPayUrl: "",
    prepayDocId: "",
    prepayPayDocId: "",
    prepayCtaDocId: "",
    prepayPayAttempts: 0,
    prepayCtaAttempts: 0,
    prepayFrameSeen: false,
    prepayLastTapAt: 0,
    prepayLastConfirmAt: 0,
    loginActive: true,
    loginStatus: "Opening the billing page for the Rs.1000 prepayment..."
  });

  try {
    const tabs = await chrome.tabs.query({ url: "https://console.cloud.google.com/*" });
    if (tabs.length > 0) {
      await chrome.tabs.update(tabs[0].id, { url: BILLING_URL, active: true });
      try { await chrome.windows.update(tabs[0].windowId, { focused: true }); } catch (e) {}
      return { ok: true, message: "Opening the billing page..." };
    }
    await chrome.tabs.create({ url: s.loginEmail ? BILLING_URL : LOGIN_URL, active: true });
    return { ok: true, message: "Opened the billing page..." };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ==================== LOGOUT ====================
async function logout() {
  await chrome.storage.local.set({
    loginActive: false,
    loginStatus: "Logging out — clearing session..."
  });

  // 1) Close open Google tabs FIRST, so no live page re-writes the session
  //    cookies while we're clearing them.
  try {
    const tabs = await chrome.tabs.query({
      url: ["https://*.google.com/*", "https://*.cloud.google.com/*", "https://*.cloudshell.dev/*"]
    });
    for (const tab of tabs) {
      try { await chrome.tabs.remove(tab.id); } catch (e) {}
    }
  } catch (e) {}

  // 2) Sign out server-side + wipe cookies and site storage.
  await clearGoogleData();

  await chrome.storage.local.set({
    loginEmail: "",
    otpFilled: false,
    lastTriedCode: "",
    otpRequestedAt: 0,
    prepayDone: false,
    prepayStarted: false,
    prepayFormOpened: false,
    prepayEntered: false,
    prepayPayClicked: false,
    prepayPayUrl: "",
    prepayDocId: "",
    prepayPayDocId: "",
    prepayCtaDocId: "",
    prepayPayAttempts: 0,
    prepayCtaAttempts: 0,
    prepayFrameSeen: false,
    prepayLastTapAt: 0,
    prepayLastConfirmAt: 0,
    loginStatus: "Logged out. Session cleared."
  });

  // 3) Open a fresh, signed-out login page.
  await chrome.tabs.create({ url: LOGIN_URL, active: true });
  return { ok: true };
}

// Thorough logout: server-side sign-out, then remove every Google cookie we can
// see, then clear cache / localStorage / serviceWorkers / indexedDB.
async function clearGoogleData() {
  // (a) Best-effort server-side sign out. The Set-Cookie headers on the
  //     response clear the session cookies even though the response is opaque.
  try {
    await fetch("https://accounts.google.com/Logout", {
      method: "GET", credentials: "include", cache: "no-store", mode: "no-cors"
    });
  } catch (e) {}

  // (b) Remove every google-owned cookie.
  const seen = new Set();
  const removeCookie = async (c) => {
    const host = c.domain.replace(/^\./, "");
    const url = (c.secure ? "https://" : "http://") + host + (c.path || "/");
    const key = url + "|" + c.name + "|" + (c.storeId || "");
    if (seen.has(key)) return;
    seen.add(key);
    try { await chrome.cookies.remove({ url, name: c.name, storeId: c.storeId }); } catch (e) {}
  };
  try {
    const all = await chrome.cookies.getAll({});
    for (const c of all) {
      const d = c.domain.replace(/^\./, "");
      if (d === "google.com" || d.endsWith(".google.com") || d.includes("google")) await removeCookie(c);
    }
  } catch (e) {}
  // Also sweep specific domains explicitly (catches anything getAll missed).
  for (const domain of GOOGLE_DOMAINS) {
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      for (const c of cookies) await removeCookie(c);
    } catch (e) {}
  }

  // (c) Clear cache + site storage for the Google origins.
  try {
    await chrome.browsingData.remove(
      { origins: GOOGLE_ORIGINS },
      { cookies: true, cacheStorage: true, localStorage: true, serviceWorkers: true, indexedDB: true }
    );
  } catch (e) {}
}
