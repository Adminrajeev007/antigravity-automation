/**
 * Sheet sync (additive module).
 *
 * Scope: when a QR is generated, add/upsert that email into the Google Sheet.
 * Nothing else is written from this extension. Status updates (reserve /
 * successful / rejected) are left to consumers calling the same web app.
 *
 * Loaded from background.js via importScripts("sheet-sync.js").
 */
(function () {
  var DEFAULTS = {
    sheetOn: true,
    sheetUrl: "https://script.google.com/macros/s/AKfycbzoCHT0aGmxBzTD_j9gEU1JFxBW52_NUj7x-NHW_D_W_PmIZ4YIWWCOWtIcR2fojkfs/exec",
    sheetToken: "change-this-sheet-token",
    sheetTab: "QR",
    deleteAfterQr: true
  };
  var OUTBOX_KEY = "sheetOutbox";
  var MAX_OUTBOX = 50;
  var OCTO_PORT = 58888;
  var REAPER_URL = "http://127.0.0.1:8791/delete";

  function cfg_() {
    return chrome.storage.local.get(["sheetOn", "sheetUrl", "sheetToken", "sheetTab"]).then(function (s) {
      return {
        on: s.sheetOn !== false,
        url: String(s.sheetUrl || DEFAULTS.sheetUrl || "").replace(/\/+$/, ""),
        token: String(s.sheetToken || DEFAULTS.sheetToken || ""),
        tab: String(s.sheetTab || DEFAULTS.sheetTab)
      };
    });
  }

  function iso_(v) {
    var d = v === undefined || v === null || v === "" ? new Date() : new Date(v);
    if (isNaN(d.getTime())) d = new Date();
    return d.toISOString();
  }

  function parse_(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return { raw: text };
    }
  }

  // text/plain avoids a CORS preflight, which Apps Script web apps cannot answer.
  function postJson_(payload) {
    return cfg_().then(function (c) {
      if (!c.on) throw new Error("sheet sync off");
      if (!c.url) throw new Error("sheet url not set");
      var body = { token: c.token, tab: c.tab };
      Object.keys(payload).forEach(function (k) { body[k] = payload[k]; });
      return fetch(c.url, {
        method: "POST",
        headers: { "content-type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
        redirect: "follow"
      });
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = parse_(text);
        if (!res.ok || (data && data.ok === false)) {
          throw new Error((data && (data.error || data.raw)) || ("HTTP " + res.status));
        }
        return data;
      });
    });
  }

  function enqueue_(payload) {
    return chrome.storage.local.get([OUTBOX_KEY]).then(function (s) {
      var box = Array.isArray(s[OUTBOX_KEY]) ? s[OUTBOX_KEY] : [];
      box.push({ payload: payload, ts: Date.now() });
      var patch = {};
      patch[OUTBOX_KEY] = box.slice(-MAX_OUTBOX);
      return chrome.storage.local.set(patch);
    });
  }

  function flush_() {
    return chrome.storage.local.get([OUTBOX_KEY]).then(function (s) {
      var box = Array.isArray(s[OUTBOX_KEY]) ? s[OUTBOX_KEY] : [];
      if (!box.length) return { ok: true, flushed: 0 };
      var kept = [];
      var chain = Promise.resolve();
      var flushed = 0;
      box.forEach(function (item) {
        chain = chain.then(function () {
          return postJson_(item.payload).then(function () {
            flushed += 1;
            if (item.payload && item.payload.kind === "unavailable") {
              requestProfileDelete_(0, "signup-unavailable").catch(function () {});
            } else if (item.payload && item.payload.action === "qr") {
              var d = item.payload.kind === "billing" ? 0 : undefined;
              requestProfileDelete_(d).catch(function () {});
            }
          }, function () { kept.push(item); });
        });
      });
      return chain.then(function () {
        var patch = {};
        patch[OUTBOX_KEY] = kept;
        return chrome.storage.local.set(patch).then(function () {
          return { ok: true, flushed: flushed, pending: kept.length };
        });
      });
    });
  }

  // Add the email only when its QR is generated. Upsert (dedupe) is done server-side.
  function pushQr_(msg) {
    return chrome.storage.local.get(["portalToken"]).then(function (s) {
      var payload = {
        action: "qr",
        email: String(msg.email || "").trim().toLowerCase(),
        at: iso_(msg.at),
        userToken: String(s.portalToken || "").trim(),
        notes: String(msg.notes || "")
      };
      if (!payload.email || payload.email.indexOf("@") < 0) return { ok: false, error: "no email" };
      return postJson_(payload).then(function (r) {
        requestProfileDelete_().catch(function () {});
        return r;
      }, function (err) {
        return enqueue_(payload).then(function () {
          return { ok: false, queued: true, error: String((err && err.message) || err) };
        });
      });
    });
  }

  // Tell the local orchestrator that the Google account was created before
  // the profile is deleted. This makes billing a first-class success state
  // instead of relying on a late /delete callback.
  function notifyBilling_(msg) {
    try {
      chrome.storage.local.get(["profileUuid"], function (s) {
        try {
          fetch("http://127.0.0.1:8791/billing", {
            method: "POST",
            headers: { "content-type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
              uuid: String(s.profileUuid || ""),
              email: String((msg && msg.email) || "").trim().toLowerCase(),
              extId: chrome.runtime.id
            })
          }).catch(function () {});
        } catch (e) {}
      });
    } catch (e) {}
  }

  // Reached the billing page: record the email, then this profile is done.
  function pushBilling_(msg) {
    return chrome.storage.local.get(["portalToken"]).then(function (s) {
      var payload = {
        action: "qr",
        kind: "billing",
        email: String(msg.email || "").trim().toLowerCase(),
        at: iso_(msg.at),
        userToken: String(s.portalToken || "").trim(),
        notes: "billing reached"
      };
      if (!payload.email || payload.email.indexOf("@") < 0) return { ok: false, error: "no email" };
      function startCombo() {
        try {
          if (typeof comboStartOauth === "function") comboStartOauth(payload.email).catch(function () {});
        } catch (e) {}
      }
      return postJson_(payload).then(function (r) {
        startCombo();
        return r;
      }, function (err) {
        startCombo();
        return enqueue_(payload).then(function () {
          return { ok: false, queued: true, error: String((err && err.message) || err) };
        });
      });
    });
  }

  // Octo refuses to delete an active profile, so a local helper does stop+delete.
  // The helper resolves the profile; the extension only sends its extension id.
  // Signup page says "Free Trial signup is temporarily down": save the email
  // as rejected (so the login extension won't pick it), then close the profile.
  function pushUnavailable_(msg) {
    return chrome.storage.local.get(["portalToken"]).then(function (s) {
      var payload = {
        action: "qr",
        kind: "unavailable",
        email: String(msg.email || "").trim().toLowerCase(),
        at: iso_(msg.at),
        userToken: String(s.portalToken || "").trim(),
        notes: "signup unavailable"
      };
      if (!payload.email || payload.email.indexOf("@") < 0) return { ok: false, error: "no email" };
      return postJson_(payload).then(function (r) {
        requestProfileDelete_(0, "signup-unavailable").catch(function () {});
        return r;
      }, function (err) {
        return enqueue_(payload).then(function () {
          return { ok: false, queued: true, error: String((err && err.message) || err) };
        });
      });
    });
  }

  async function requestProfileDelete_(delayMs, reason) {
    var s = await chrome.storage.local.get(["deleteAfterQr", "profileUuid"]);
    if (s.deleteAfterQr === false) return { ok: false, skipped: true };
    try {
      var body = { uuid: String(s.profileUuid || ""), extId: chrome.runtime.id };
      if (delayMs !== undefined) body.delayMs = Number(delayMs);
      if (reason) body.reason = String(reason);
      var res = await fetch(REAPER_URL, {
        method: "POST",
        headers: { "content-type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body)
      });
      return await res.json();
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || !msg.type) return;

      // Observe QR events. The existing background listener still sends its own
      // response, so this listener deliberately does not call sendResponse here.
      if (msg.type === "FLEET_EVENT" && msg.kind === "qr") {
        pushQr_(msg).catch(function () {});
        return;
      }

      // A failed signup/payment means this profile is done: let the local
      // helper close+delete it so the orchestrator can start the next one.
      if (msg.type === "FLEET_EVENT" && msg.kind === "failed") {
        setTimeout(function () { requestProfileDelete_().catch(function () {}); }, 1200);
        return;
      }

      // Reached the billing page: add the email to the Sheet (keep profile).
      if (msg.type === "FLEET_EVENT" && msg.kind === "billing") {
        pushBilling_(msg).catch(function () {});
        return;
      }

      if (msg.type === "FLEET_EVENT" && msg.kind === "unavailable") {
        pushUnavailable_(msg).catch(function () {});
        return;
      }

      if (msg.type.indexOf("SHEET_") !== 0) return;

      var run;
      if (msg.type === "SHEET_CONFIG") {
        run = chrome.storage.local.set({
          sheetOn: msg.on !== false,
          sheetUrl: String(msg.url || "").trim().replace(/\/+$/, ""),
          sheetToken: String(msg.token || "").trim(),
          sheetTab: String(msg.tab || DEFAULTS.sheetTab)
        }).then(function () { return { ok: true }; });
      } else if (msg.type === "SHEET_TEST") {
        run = postJson_({ action: "health" });
      } else if (msg.type === "SHEET_FLUSH") {
        run = flush_();
      } else {
        return;
      }

      run.then(function (r) { sendResponse(r || { ok: true }); },
        function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); });
      return true;
    });
  } catch (e) {}

  // Retry queue whenever the existing fleet alarm fires, and on worker boot.
  try {
    chrome.alarms.onAlarm.addListener(function (a) {
      if (a && a.name === "fleet-poll") flush_().catch(function () {});
    });
  } catch (e) {}
  try { chrome.runtime.onStartup.addListener(function () { flush_().catch(function () {}); }); } catch (e) {}
  try { chrome.runtime.onInstalled.addListener(function () { flush_().catch(function () {}); }); } catch (e) {}

  // Seed keys once so the popup always has something to edit.
  chrome.storage.local.get(["sheetOn", "sheetUrl", "sheetToken", "sheetTab", "deleteAfterQr"]).then(function (s) {
    var patch = {};
    if (s.sheetOn === undefined) patch.sheetOn = DEFAULTS.sheetOn;
    if (!s.sheetUrl) patch.sheetUrl = DEFAULTS.sheetUrl;
    if (!s.sheetToken) patch.sheetToken = DEFAULTS.sheetToken;
    if (!s.sheetTab) patch.sheetTab = DEFAULTS.sheetTab;
    if (s.deleteAfterQr === undefined) patch.deleteAfterQr = DEFAULTS.deleteAfterQr;
    if (Object.keys(patch).length) chrome.storage.local.set(patch);
  }).catch(function () {});

  flush_().catch(function () {});
})();
