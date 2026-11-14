/**
 * Billing watcher (additive).
 *
 * As soon as the signup flow reaches the GCP billing page:
 *   1. turn off content auto-fill (config.autoRun = false), so the address /
 *      payment automation stops here,
 *   2. upsert the current email into the Sheet,
 *   3. the extension then closes/deletes the profile.
 */
(function () {
  if (window.top !== window) return;

  var firedFor = "";

  function isBilling() {
    var u = String(location.href || "");
    return /\/freetrial/i.test(u) && /billing/i.test(u);
  }

  function isUnavailable() {
    var u = String(location.href || "");
    var t = String(document.body ? document.body.innerText || "" : "").toLowerCase();
    return /\/freetrial\/signup\/unavailable/i.test(u) ||
      t.indexOf("free trial signup is temporarily down") !== -1 ||
      t.indexOf("we're working to restore signup") !== -1 ||
      t.indexOf("we\u2019re working to restore signup") !== -1;
  }

  async function maybe() {
    var kind = "";
    if (isBilling()) kind = "billing";
    else if (isUnavailable()) kind = "unavailable";
    if (!kind) return;
    var u = String(location.href || "") + "|" + kind;
    if (firedFor === u) return;
    firedFor = u;

    try {
      var s = await chrome.storage.local.get(["interns", "currentIndex", "config"]);
      var cur = (s.interns || [])[s.currentIndex];
      if (!cur || !cur.email) return;

      // Stop the content automation (address form / UPI / Start free) right away.
      var cfg = Object.assign({ autoRun: true }, s.config || {});
      if (cfg.autoRun !== false) {
        cfg.autoRun = false;
        try { await chrome.storage.local.set({ config: cfg }); } catch (e) {}
      }

      try {
        chrome.runtime.sendMessage(
          { type: "FLEET_EVENT", kind: kind, email: cur.email, at: Date.now() },
          function () { try { void chrome.runtime.lastError; } catch (e) {} }
        );
      } catch (e) {}
    } catch (e) {
      firedFor = "";
    }
  }

  maybe().catch(function () {});
  setInterval(function () { maybe().catch(function () {}); }, 500);
})();
