// Fleet keepalive ticker (runs inside the offscreen document).
// Two jobs:
//  1. Play inaudible audio so Chrome never suspends this document.
//  2. Wake the service worker every 2s for a fleet heartbeat (email claim,
//     commands, QR/status upload), and every 30s nudge a WebSocket reconnect.
// Works with zero tabs open, so the extension stays connected to the dashboard
// for as long as the browser has internet.
let actx = null;
try {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    actx = new AC();
    if (actx.state === "suspended") actx.resume().catch(() => {});
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    gain.gain.value = 0.0001; // inaudible, but counts as playing
    osc.connect(gain);
    gain.connect(actx.destination);
    osc.start();
  }
} catch (e) {}

let ticks = 0;
setInterval(() => {
  try {
    if (actx && actx.state === "suspended") actx.resume().catch(() => {});
    ticks++;
    // Every 15th tick (~30s) ask the worker to force a WS reconnect attempt.
    const reconnect = (ticks % 15) === 0;
    chrome.runtime.sendMessage({ type: "FLEET_TICK", reconnect }, () => {
      try { void chrome.runtime.lastError; } catch (e) {}
    });
  } catch (e) {}
}, 2000);
