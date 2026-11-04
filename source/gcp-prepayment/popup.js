/* GCP Account Prepayment v1 - Popup */

const emailInput = document.getElementById("email");
const loginBtn = document.getElementById("btn-login");
const logoutBtn = document.getElementById("btn-logout");
const pauseBtn = document.getElementById("btn-pause");
const payBtn = document.getElementById("btn-pay");
const statusEl = document.getElementById("status");
const autoPrepayBox = document.getElementById("auto-prepay");

function setStatus(msg) { statusEl.textContent = msg; }

// Reflect the paused state on the button. When paused it becomes a green
// "Resume" button; otherwise an amber "Pause automation" button.
function renderPaused(paused) {
  if (paused) {
    pauseBtn.textContent = "Resume automation";
    pauseBtn.classList.remove("warn");
    pauseBtn.classList.add("resume");
  } else {
    pauseBtn.textContent = "Pause automation";
    pauseBtn.classList.remove("resume");
    pauseBtn.classList.add("warn");
  }
}

// Restore the last email + status + auto-prepay preference + pause state.
async function restore() {
  const s = await chrome.storage.local.get(["loginEmail", "loginStatus", "autoPrepay", "loginPaused"]);
  if (s.loginEmail) emailInput.value = s.loginEmail;
  if (s.loginStatus) setStatus(s.loginStatus);
  autoPrepayBox.checked = s.autoPrepay !== false; // default ON
  renderPaused(!!s.loginPaused);
}

// Pause/Resume: just flips the `loginPaused` flag. The content script watches
// this flag — pausing stops all automation, and resuming makes it re-detect the
// current page and continue the normal steps from wherever the flow is.
pauseBtn.addEventListener("click", async () => {
  const s = await chrome.storage.local.get("loginPaused");
  const next = !s.loginPaused;
  await chrome.storage.local.set({ loginPaused: next });
  renderPaused(next);
  setStatus(next
    ? "Automation paused. Press Resume to continue from the current page."
    : "Resumed — detecting the current page and continuing...");
});

// Persist the toggle so both frames of the content script can read it.
autoPrepayBox.addEventListener("change", async () => {
  await chrome.storage.local.set({ autoPrepay: autoPrepayBox.checked });
});

// Request the optional contentSettings permission (needed so Google Payments'
// window.open isn't blocked). Must run inside a user gesture, so it's called
// first thing in the button handlers. Safe to ignore if denied.
async function ensurePopupPermission() {
  try { return await chrome.permissions.request({ permissions: ["contentSettings"] }); }
  catch (e) { return false; }
}

// Manual trigger: go to the billing page and make the ₹1,000 prepayment.
payBtn.addEventListener("click", async () => {
  await ensurePopupPermission();
  await chrome.storage.local.set({ autoPrepay: true });
  autoPrepayBox.checked = true;
  setStatus("Opening the billing page...");
  const resp = await chrome.runtime.sendMessage({ type: "OPEN_BILLING" });
  if (resp && resp.ok) setStatus(resp.message || "Opening the billing page...");
  else setStatus((resp && resp.error) || "Could not open the billing page.");
});

loginBtn.addEventListener("click", async () => {
  const email = (emailInput.value || "").trim();
  if (!email || !email.includes("@")) { setStatus("Enter a valid email first."); return; }
  await ensurePopupPermission();
  await chrome.storage.local.set({ loginEmail: email });
  const resp = await chrome.runtime.sendMessage({ type: "LOGIN", email });
  if (resp && resp.ok) setStatus("Logging in as " + email + "...");
  else setStatus((resp && resp.error) || "Could not start login.");
});

logoutBtn.addEventListener("click", async () => {
  setStatus("Logging out...");
  const resp = await chrome.runtime.sendMessage({ type: "LOGOUT" });
  if (resp && resp.ok) setStatus("Logged out. Session cleared.");
  else setStatus("Logout failed.");
});

emailInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});

// Keep the status line live while the popup is open.
chrome.storage.onChanged.addListener((changes) => {
  if (changes.loginStatus && changes.loginStatus.newValue) {
    setStatus(changes.loginStatus.newValue);
  }
  if (changes.loginPaused) {
    renderPaused(!!changes.loginPaused.newValue);
  }
});

restore();
