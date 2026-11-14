/**
 * Auto email loop (additive).
 *
 * Watches the run state and, when the active account finishes (success or
 * failure), generates a brand-new unique email, makes it current, and opens a
 * fresh signup tab. Disabled when chrome.storage.local.autoEmail === false.
 *
 * Loaded from background.js via importScripts("email-gen.js", "auto-email.js").
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

  function handledList(s) {
    return Array.isArray(s.autoHandledEmails) ? s.autoHandledEmails : [];
  }

  async function generateNext(s) {
    var interns = Array.isArray(s.interns) ? s.interns.slice() : [];
    var history = Array.isArray(s.emailHistory) ? s.emailHistory : [];
    var used = new Set(
      history.concat(interns.map(function (i) { return i.email; }))
        .map(norm)
        .filter(Boolean)
    );

    var email = self.gcpRandomEmail(used);
    if (!email) return null;

    var domain = email.split("@")[1];
    interns.push({ name: email.split("@")[0], email: email, status: "pending", note: "auto-generated" });
    var idx = interns.length - 1;

    var addrMap = Object.assign({}, s.addrMap || {});
    delete addrMap[idx];

    var patch = Object.assign({
      domain: domain,
      interns: interns,
      currentIndex: idx,
      flowEpoch: Date.now(),
      addrMap: addrMap,
      emailHistory: history.concat(email).slice(-5000)
    }, RESET);

    await chrome.storage.local.set(patch);
    await new Promise(function (r) { setTimeout(r, 1800); });
    try { await chrome.tabs.create({ url: SIGNUP_URL }); } catch (e) {}
    return email;
  }

  async function maybeRun() {
    if (busy) return;
    busy = true;
    try {
      var s = await chrome.storage.local.get(null);
      if (s.autoEmail === false) return;

      var interns = Array.isArray(s.interns) ? s.interns : [];
      if (!interns.length) return;

      var idx = typeof s.currentIndex === "number" ? s.currentIndex : 0;
      var last = interns.length - 1;
      var cur = interns[idx];
      var finished = null;

      // Failure: content stops on the failed account (currentIndex stays there).
      if (cur && idx === last && norm(cur.status) === "failed") {
        finished = cur;
      // Success: content marks done then advances currentIndex past the list.
      } else if (idx >= interns.length && interns[last] && norm(interns[last].status) === "done") {
        finished = interns[last];
      }

      if (!finished) return;

      var email = norm(finished.email);
      if (!email) return;

      var handled = handledList(s);
      if (handled.map(norm).indexOf(email) !== -1) return;

      // Mark before generating so concurrent change events cannot duplicate.
      handled.push(email);
      await chrome.storage.local.set({ autoHandledEmails: handled.slice(-5000) });

      await generateNext(s);
    } catch (e) {
    } finally {
      busy = false;
    }
  }

  try {
    chrome.storage.onChanged.addListener(function (changes) {
      if (!changes) return;
      if (!("interns" in changes) && !("currentIndex" in changes)) return;
      maybeRun();
    });
  } catch (e) {}

  try { chrome.runtime.onStartup.addListener(function () { maybeRun(); }); } catch (e) {}

  try {
    chrome.runtime.onInstalled.addListener(function () {
      chrome.storage.local.get(["autoEmail"]).then(function (s) {
        if (s.autoEmail === undefined) return chrome.storage.local.set({ autoEmail: true });
      }).catch(function () {});
      maybeRun();
    });
  } catch (e) {}

  // Default on, without overriding an explicit user choice.
  chrome.storage.local.get(["autoEmail"]).then(function (s) {
    if (s.autoEmail === undefined) return chrome.storage.local.set({ autoEmail: true });
  }).catch(function () {});
})();
