// Additive approach B: when signup completes (billing / unavailable / early
// OAuth), switch the whole browser to the device's direct internet instead of
// the proxy. Restore the normal proxy once OAuth finishes, so the next signup
// is proxied again. Does not edit combo-oauth.js; wraps comboApplyProxy.
(function () {
  if (typeof comboApplyProxy !== "function" || typeof comboProxyConfig !== "function") return;

  var FLAG = "comboDirectMode";
  var FLAG_AT = "comboDirectModeAt";
  var FLAG_WHY = "comboDirectModeWhy";
  var TTL_MS = 15 * 60 * 1000;
  var directMode = false;

  function setProxy(value) {
    return new Promise(function (resolve) {
      try {
        if (!chrome.proxy || !chrome.proxy.settings) return resolve(false);
        chrome.proxy.settings.set({ value: value, scope: "regular" }, function () {
          try { void chrome.runtime.lastError; } catch (e) {}
          resolve(true);
        });
      } catch (e) { resolve(false); }
    });
  }

  async function applyDirect() {
    directMode = true;
    await setProxy({ mode: "direct" });
  }

  async function applyNormal() {
    directMode = false;
    try {
      await setProxy(await comboProxyConfig());
    } catch (e) {}
  }

  async function enable(why) {
    try {
      var patch = {};
      patch[FLAG] = true;
      patch[FLAG_AT] = Date.now();
      patch[FLAG_WHY] = String(why || "");
      await chrome.storage.local.set(patch);
    } catch (e) {}
    await applyDirect();
  }

  async function disable(why) {
    try {
      var patch = {};
      patch[FLAG] = false;
      patch[FLAG_AT] = Date.now();
      patch[FLAG_WHY] = String(why || "");
      await chrome.storage.local.set(patch);
    } catch (e) {}
    await applyNormal();
  }

  function activeFromOauth(o) {
    if (!o) return false;
    if (o.status === "completed" || o.status === "failed" || o.status === "start-failed") return false;
    if (!o.startedAt || Date.now() - o.startedAt > TTL_MS) return false;
    return true;
  }

  // While direct mode is on, every proxy (re)apply from combo-oauth.js becomes
  // a no-op that keeps the browser on direct internet.
  var origApplyProxy = comboApplyProxy;
  comboApplyProxy = async function () {
    if (directMode) {
      await setProxy({ mode: "direct" });
      return;
    }
    return origApplyProxy();
  };

  // Signup completed: billing page reached, or the "temporarily down" page.
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === "FLEET_EVENT" && (msg.kind === "billing" || msg.kind === "unavailable")) {
      enable("signup:" + msg.kind).catch(function () {});
    }
  });

  // OAuth phase enters -> direct; terminal -> restore proxy.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local" || !changes.comboOauth) return;
    var o = changes.comboOauth.newValue;
    if (!o) return;
    var on = activeFromOauth(o);
    chrome.storage.local.get([FLAG]).then(function (st) {
      if (!!(st && st[FLAG]) === on) return;
      if (on) enable("status:" + String(o.status || "")).catch(function () {});
      else disable("status:" + String(o.status || "")).catch(function () {});
    }).catch(function () {});
  });

  // Service-worker boot: resume direct if an OAuth is still active, otherwise
  // clear a leftover direct mode.
  chrome.storage.local.get(["comboOauth", FLAG]).then(function (st) {
    var on = activeFromOauth(st && st.comboOauth);
    var was = !!(st && st[FLAG]);
    if (on) enable("boot").catch(function () {});
    else if (was) disable("boot").catch(function () {});
  }).catch(function () {});
})();
