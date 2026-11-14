antig orchestrator (macOS) — 3 Octo profiles at a time
======================================================

WHAT IT DOES
- Toggles the Android phone's flight mode (new IP via USB tether)
- Opens N Octo profiles with the bundled extension
- Auto-assigns a unique name+year email from your domain list
- On reaching the billing page: saves the email to the Sheet and deletes that profile
- Waits for the whole batch to finish before toggling IP again

PREREQUISITES
- macOS on Apple Silicon (Rosetta will be installed if needed)
- Octo Browser installed and SIGNED IN
- Android phone with USB debugging enabled
- Internet during setup (for Rosetta if missing)

QUICK START (one command does everything)
  cd antig-orchestrator-mac
  chmod +x master.sh
  ./master.sh
  # enter your macOS admin password when asked
  # it checks Rosetta/Node, installs BetterTether + route watchdog,
  # verifies Octo + the phone, then starts the orchestrator

MANUAL STEPS (if you prefer)
  cd antig-orchestrator-mac
  chmod +x install.sh run.sh start.sh
  ./install.sh
  # enter your macOS admin password when asked

THEN
  1. Open Octo Browser and sign in.
  2. Plug in the Android phone; accept the "Allow USB debugging" prompt.
  3. Start:
       ./start.sh          # background, default 3 profiles per batch
     or
       ./run.sh            # foreground

MONITOR / STOP
  tail -f /tmp/orch.log
  curl -s http://127.0.0.1:8791/health
  pkill -f orchestrator.mjs

OPTIONS
  ORCH_BATCH=2 ./run.sh                 # 2 profiles per batch
  ORCH_SESSION_TIMEOUT_MS=900000 ./run.sh
  ORCH_AIRPLANE_SECONDS=8 ./run.sh

NOTES
- The extension zip in this folder is uploaded to Octo automatically on start.
- The extension stops auto-fill and deletes the profile once the billing page is
  reached; the email is written to the Google Sheet first.
- BetterTether (USB internet relay) and the USB route watchdog are installed as
  system LaunchDaemons by install.sh.
- Delete any other Octo profiles first: the plan allows 3 saved profiles total.
- The background process does not auto-start after a reboot; run ./start.sh again.

VM MODE (Tart / UTM / Parallels)
--------------------------------
If the phone appears in the VM as a TCP adb device (for example
192.168.64.1:5556) then the VM has no USB device, so BetterTether cannot run
inside the VM.

Do this instead:
  1. On the Mac mini HOST: copy this folder there, extract, and run
       sudo ./install.sh
     Connect the phone by USB to the host. Confirm on the host:
       curl -s http://127.0.0.1:9400/api/status
       curl -s https://api.ipify.org
  2. Inside the VM: run
       ORCH_REQUIRE_USB_TETHER=0 ./master.sh
  3. The VM's internet must go through the host (shared/NAT), so the host's
     USB tether IP is the VM's egress IP. Flight-mode toggles still run over
     adb (the TCP device) and change that IP.

Run with 2 profiles if needed:
  ORCH_REQUIRE_USB_TETHER=0 ORCH_BATCH=2 ./master.sh
