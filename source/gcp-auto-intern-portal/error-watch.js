// Detects Google's "Something went wrong — invalid request" rejection page.
// Report-only watcher: it never touches the signup automation or the page.
(() => {
  let sent = false;
  let timer = 0;
  let obs = null;

  function currentEmail(cb) {
    try {
      chrome.storage.local.get(["interns", "currentIndex", "qrEmail", "payEmail"], (s) => {
        const interns = Array.isArray(s.interns) ? s.interns : [];
        const cur = interns[s.currentIndex] || null;
        cb(String(s.qrEmail || s.payEmail || (cur && cur.email) || "").trim().toLowerCase());
      });
    } catch (e) { cb(""); }
  }

  function check() {
    if (sent) return true;
    const text = ((document.body && document.body.innerText) || "").toLowerCase();
    if (!text) return false;
    const invalid = text.includes("the information sent resulted in an invalid request")
      || (text.includes("something went wrong") && text.includes("go back and start the process again"));
    const blocked = invalid
      || text.includes("this account is not eligible")
      || text.includes("account has been disabled")
      || text.includes("unusual activity");
    if (!blocked) return false;
    sent = true;
    currentEmail((email) => {
      try {
        chrome.runtime.sendMessage({
          type: "FLEET_EVENT",
          kind: "failed",
          email,
          text: "BLOCKED: Google rejected the signup — invalid request / domain or IP blocked. Go back and retry with a new browser or IP."
        }, () => { try { void chrome.runtime.lastError; } catch (e) {} });
      } catch (e) {}
    });
    try { if (obs) obs.disconnect(); } catch (e) {}
    return true;
  }

  try {
    obs = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(check, 350);
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  } catch (e) {}
  setTimeout(check, 800);
  setTimeout(() => { check(); try { if (obs) obs.disconnect(); } catch (e) {} }, 7000);
})();
