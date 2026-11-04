(() => {
  const ID = "gcp-ag-ip-badge";
  let refreshing = false;

  function createBadge() {
    const el = document.createElement("div");
    el.id = ID;
    el.style.position = "fixed";
    el.style.right = "16px";
    el.style.bottom = "16px";
    el.style.zIndex = "2147483647";
    el.style.padding = "6px 9px";
    el.style.borderRadius = "999px";
    el.style.background = "rgba(18, 20, 30, 0.92)";
    el.style.border = "1px solid rgba(122, 140, 255, 0.55)";
    el.style.boxShadow = "0 6px 20px rgba(0, 0, 0, 0.35)";
    el.style.color = "#fff";
    el.style.font = "700 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
    el.style.letterSpacing = "0.02em";
    el.style.pointerEvents = "none";
    el.style.userSelect = "none";
    el.textContent = "IP: ...";
    document.documentElement.appendChild(el);
    return el;
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const stored = await chrome.storage.local.get("proxy");
      const enabled = !!(stored.proxy && stored.proxy.enabled);
      const existing = document.getElementById(ID);

      if (!enabled) {
        if (existing) existing.remove();
        return;
      }

      // The AG panel already shows the proxy IP in its header.
      if (document.getElementById("gcp-auto-panel")) {
        if (existing) existing.remove();
        return;
      }

      const badge = existing || createBadge();
      badge.style.bottom = document.getElementById("gcp-ag-api-status") ? "150px" : "16px";
      let label = "IP: ?";
      try {
        const info = await chrome.runtime.sendMessage({ type: "PROXY_INFO" });
        if (info && info.ok && info.ip) label = "IP: " + info.ip;
      } catch (e) {}
      badge.textContent = label;
    } finally {
      refreshing = false;
    }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.proxy) refresh();
    });
  } catch (e) {}

  setTimeout(refresh, 900);
  setInterval(refresh, 60000);
})();
