// Combo OAuth content: select the signup account, accept consent/speedbump,
// capture the OAuth code from the callback page, and show live status.
(function () {
  if (window.top !== window) return;

  var comboEmail = "";
  var sentCode = "";
  var lastClickAt = 0;
  var badge = null;

  function refreshEmail() {
    try {
      chrome.storage.local.get(["comboOauth"], function (st) {
        var o = st && st.comboOauth;
        if (o && o.email) comboEmail = String(o.email).toLowerCase();
      });
    } catch (e) {}
  }

  function ensureBadge() {
    if (badge) return badge;
    badge = document.createElement("div");
    badge.id = "combo-oauth-status";
    badge.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;" +
      "background:rgba(15,20,32,.96);color:#e6edf3;border:1px solid #2a3450;" +
      "border-radius:9px;padding:10px 14px;font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto;" +
      "max-width:420px;box-shadow:0 8px 30px rgba(0,0,0,.35);";
    document.documentElement.appendChild(badge);
    return badge;
  }

  function showStatus(text, tone) {
    var el = ensureBadge();
    var color = tone === "ok" ? "#4ade80" : tone === "err" ? "#fb7185" : "#f5b74e";
    el.innerHTML = '<span style="color:' + color + ';font-weight:600">COMBO</span> ' + String(text || "");
  }

  function refreshStatus() {
    try {
      chrome.storage.local.get(["comboOauth"], function (st) {
        var o = st && st.comboOauth;
        if (!o) return;
        var s = String(o.status || "");
        var m = String(o.message || "");
        if (s === "completed") showStatus("✅ completed — " + m, "ok");
        else if (s === "accepted") showStatus("✅ code accepted — updating sheet…", "ok");
        else if (s === "submitting") showStatus("⏳ " + (m || "sending code to API…"), "warn");
        else if (s === "failed" || s === "start-failed") showStatus("❌ " + (m || s), "err");
        else if (s === "pending") showStatus("waiting for OAuth consent…", "warn");
        else if (s === "starting") showStatus("starting OAuth…", "warn");
      });
    } catch (e) {}
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === "local" && changes.comboOauth) {
      refreshEmail();
      refreshStatus();
    }
  });

  function click(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center" }); } catch (e) {}
    try {
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(function (type) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
    } catch (e) {}
    try { el.click(); } catch (e) {}
    lastClickAt = Date.now();
    return true;
  }

  function clickable(el) {
    var node = el;
    for (var i = 0; i < 6 && node; i += 1) {
      var tag = String(node.tagName || "").toLowerCase();
      var role = String(node.getAttribute && node.getAttribute("role") || "").toLowerCase();
      if (tag === "a" || tag === "button" || tag === "li" || role === "button" || role === "link" ||
          (node.getAttribute && (node.getAttribute("data-identifier") || node.getAttribute("data-email")))) {
        return node;
      }
      node = node.parentElement;
    }
    return el;
  }

  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return !!(r.width > 2 && r.height > 2);
  }

  function selectAccount() {
    if (!comboEmail) return false;
    var pickers = ["data-identifier", "data-email"];
    for (var i = 0; i < pickers.length; i += 1) {
      var attr = pickers[i];
      var els = Array.prototype.slice.call(document.querySelectorAll("[" + attr + "]")).filter(function (el) {
        return visible(el) && String(el.getAttribute(attr) || "").toLowerCase().indexOf(comboEmail) >= 0;
      });
      if (els.length) return click(clickable(els[0]));
    }
    var nodes = Array.prototype.slice.call(document.querySelectorAll("li,a,button"))
      .filter(function (el) {
        if (!visible(el)) return false;
        if (el.closest && el.closest("#gcp-auto-panel")) return false;
        var text = String(el.textContent || "").trim().toLowerCase();
        return text.indexOf(comboEmail) >= 0;
      })
      .sort(function (a, b) { return (a.textContent || "").length - (b.textContent || "").length; });
    if (!nodes.length) return false;
    return click(clickable(nodes[0]));
  }

  function clickConsent() {
    var approve = document.getElementById("submit_approve_access");
    if (approve && visible(approve)) return click(approve);
    var allowed = ["allow", "continue", "i understand", "accept", "next", "agree", "confirm", "sign in"];
    var blocked = ["deny", "cancel", "back", "reject", "not now", "use another account"];
    var nodes = Array.prototype.slice.call(document.querySelectorAll("button,[role=button],a,div[role=button]"));
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var text = String(el.textContent || "").trim().toLowerCase();
      if (!text || text.length > 40) continue;
      if (blocked.some(function (b) { return text.indexOf(b) >= 0; })) continue;
      if (allowed.some(function (a) { return text === a || text.indexOf(a) === 0; })) {
        return click(el);
      }
    }
    return false;
  }

  function fillEmailIfSignIn() {
    if (!comboEmail) return false;
    var input = document.querySelector('input[type="email"]');
    if (!input || !visible(input)) return false;
    if (String(input.value || "").trim()) return false;
    input.focus();
    input.value = comboEmail;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    lastClickAt = Date.now();
    return true;
  }

  function extractCode() {
    var box = document.querySelector("[data-code-box]");
    if (box && String(box.textContent || "").trim()) return String(box.textContent).trim();
    var text = document.body ? document.body.innerText : "";
    var m = text.match(/4\/[A-Za-z0-9._\-]{20,}/);
    return m ? m[0] : "";
  }

  function sendCode(code) {
    if (!code || sentCode === code) return;
    sentCode = code;
    showStatus("code captured — sending to API…", "warn");
    try {
      chrome.runtime.sendMessage({ type: "COMBO_OAUTH_CODE", code: code }, function (resp) {
        try { void chrome.runtime.lastError; } catch (e) {}
        if (resp && resp.ok) showStatus("✅ " + (resp.already ? "already accepted" : "code accepted"), "ok");
        else if (resp && resp.error) showStatus("❌ " + resp.error, "err");
        refreshStatus();
      });
    } catch (e) {}
  }

  function tick() {
    var href = String(location.href || "");
    if (href.indexOf("antigravity.google/oauth-callback") >= 0) {
      ensureBadge();
      var code = extractCode();
      if (code) sendCode(code);
      else refreshStatus();
      return;
    }
    if (!comboEmail) return;
    if (Date.now() - lastClickAt < 900) return;
    if (href.indexOf("accounts.google.com") < 0) return;
    var text = String(document.body ? document.body.innerText || "" : "").toLowerCase();
    if (clickConsent()) return;
    if (selectAccount()) return;
    if (text.indexOf(comboEmail) < 0 && document.querySelector('input[type="email"]')) {
      if (fillEmailIfSignIn()) return;
    }
  }

  refreshEmail();
  refreshStatus();
  setInterval(tick, 700);
  setInterval(refreshStatus, 1500);
})();
