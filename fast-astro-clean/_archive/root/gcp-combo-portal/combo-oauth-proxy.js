// Additive: during inline OAuth, bypass the proxy for the Google OAuth hosts
// so the consent/callback run on the machine's direct IP. Signup keeps using
// the proxy. This file does not edit combo-oauth.js — it wraps its proxy/OAuth
// functions and toggles the bypass based on the current OAuth phase.
(function () {
  if (typeof comboProxyConfig !== "function") return;

  var OAUTH_BYPASS = [
    "accounts.google.com",
    "antigravity.google",
    "*.googleapis.com",
    "*.gstatic.com",
    "*.googleusercontent.com"
  ];
  var FLAG = "comboOauthProxyBypass";
  var FLAG_AT = "comboOauthProxyBypassAt";
  var FLAG_WHY = "comboOauthProxyBypassWhy";
  var TTL_MS = 15 * 60 * 1000;

  var origProxyConfig = comboProxyConfig;

  comboProxyConfig = async function () {
    var cfg = await origProxyConfig();
    try {
      var st = await chrome.storage.local.get([FLAG]);
      if (st && st[FLAG] && cfg && cfg.rules) {
        var list = Array.isArray(cfg.rules.bypassList) ? cfg.rules.bypassList.slice() : [];
        OAUTH_BYPASS.forEach(function (host) {
          if (list.indexOf(host) < 0) list.push(host);
        });
        cfg.rules.bypassList = list;
      }
    } catch (e) {}
    return cfg;
  };

  async function apply() {
    try {
      if (!chrome.proxy || !chrome.proxy.settings) return;
      await chrome.proxy.settings.set({ value: await comboProxyConfig(), scope: "regular" });
    } catch (e) {}
  }

  async function setBypass(on, why) {
    try {
      var patch = {};
      patch[FLAG] = !!on;
      patch[FLAG_AT] = Date.now();
      patch[FLAG_WHY] = String(why || "");
      await chrome.storage.local.set(patch);
    } catch (e) {}
    await apply();
  }

  function activeFromOauth(o) {
    if (!o) return false;
    if (o.status === "completed" || o.status === "failed" || o.status === "start-failed") return false;
    if (!o.startedAt || Date.now() - o.startedAt > TTL_MS) return false;
    return true;
  }

  // Cover every OAuth entry point (message listener in combo-oauth.js and the
  // direct calls from sheet-sync.js): enable the bypass before the proxy is
  // (re)applied, then open the auth URL on the direct connection.
  if (typeof comboStartOauth === "function") {
    var origStartOauth = comboStartOauth;
    comboStartOauth = async function (email) {
      await setBypass(true, "start");
      return origStartOauth(email);
    };
  }

  // When the OAuth reaches a terminal state (completed / failed), restore the
  // normal proxy config so the next signup keeps using the proxy.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local" || !changes.comboOauth) return;
    var o = changes.comboOauth.newValue;
    if (!o) return;
    var on = activeFromOauth(o);
    chrome.storage.local.get([FLAG]).then(function (st) {
      if (!!(st && st[FLAG]) === on) return;
      setBypass(on, "status:" + String(o.status || "")).catch(function () {});
    }).catch(function () {});
  });

  // On service-worker boot: only touch the proxy if an OAuth is (still) active
  // or a previous bypass is left set and needs to be cleared.
  chrome.storage.local.get(["comboOauth", FLAG]).then(function (st) {
    var on = activeFromOauth(st && st.comboOauth);
    var was = !!(st && st[FLAG]);
    if (on || was) setBypass(on, "boot").catch(function () {});
  }).catch(function () {});
})();
