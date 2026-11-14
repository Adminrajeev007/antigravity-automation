/**
 * Auto-assign (additive).
 *
 * When a profile opens, the extension generates a unique name + birth-year
 * email on the configured domain list, assigns it as the current intern, and
 * opens the signup flow. Runs once per profile (autoAssignDone), so service
 * worker wake-ups do not create duplicates.
 *
 * Disable with chrome.storage.local.autoAssign = false.
 */
(function () {
  var SIGNUP_URL = "https://console.cloud.google.com/freetrial";

  var RESET = {
    upiSelected: false, upiSelectedFor: -1,
    qrReady: false, qrReadyFor: -1, qrImage: "", qrEmail: "", qrAt: 0, qrLog: [],
    payRetryFor: -1, payRetryCount: 0,
    startFreeTaps: 0, startFreeTapsFor: -1,
    paySuccess: false, paySuccessFor: -1, paySuccessAt: 0,
    qrGrabbed: false, qrGrabbedFor: -1, qrGrabRequest: null
  };

  var busy = false;

  function norm(v) { return String(v == null ? "" : v).trim().toLowerCase(); }

  async function hasOpenFlowTab() {
    try {
      var tabs = await chrome.tabs.query({});
      return (tabs || []).some(function (t) {
        var u = String(t.url || "");
        return u.indexOf("console.cloud.google.com/freetrial") >= 0
          || u.indexOf("console.cloud.google.com/freetrail") >= 0
          || u.indexOf("accounts.cloud.google.com/signup") >= 0
          || u.indexOf("accounts.cloud.google.com/login") >= 0;
      });
    } catch (e) {
      return false;
    }
  }

  async function assign() {
    if (busy) return;
    busy = true;
    try {
      var s = await chrome.storage.local.get(null);
      if (s.autoAssign === false) return;
      if (s.autoAssignDone) return;

      var interns = Array.isArray(s.interns) ? s.interns : [];
      var hasActive = interns.some(function (i) {
        var st = norm(i.status);
        return st === "pending" || st === "in_progress";
      });
      if (hasActive) return;

      var history = Array.isArray(s.emailHistory) ? s.emailHistory : [];
      var used = new Set(
        history.concat(interns.map(function (i) { return i.email; }))
          .map(norm)
          .filter(Boolean)
      );

      var email = self.gcpRandomEmail(used);
      if (!email) return;

      var domain = email.split("@")[1];
      interns = interns.slice();
      interns.push({ name: email.split("@")[0], email: email, status: "pending", note: "auto-assigned" });
      var idx = interns.length - 1;

      var addrMap = Object.assign({}, s.addrMap || {});
      delete addrMap[idx];

      var patch = Object.assign({
        domain: domain,
        interns: interns,
        currentIndex: idx,
        flowEpoch: Date.now(),
        addrMap: addrMap,
        emailHistory: history.concat(email).slice(-5000),
        autoAssignDone: true
      }, RESET);

      await chrome.storage.local.set(patch);

      if (!(await hasOpenFlowTab())) {
        try { await chrome.tabs.create({ url: SIGNUP_URL }); } catch (e) {}
      }
    } catch (e) {
    } finally {
      busy = false;
    }
  }

  // Profile open = service worker boot.
  assign().catch(function () {});
  try { chrome.runtime.onStartup.addListener(function () { assign().catch(function () {}); }); } catch (e) {}
  try { chrome.runtime.onInstalled.addListener(function () { assign().catch(function () {}); }); } catch (e) {}

  // Default on, without overriding an explicit choice.
  chrome.storage.local.get(["autoAssign"]).then(function (s) {
    if (s.autoAssign === undefined) return chrome.storage.local.set({ autoAssign: true });
  }).catch(function () {});
})();
