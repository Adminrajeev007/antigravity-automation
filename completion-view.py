#!/usr/bin/env python3
"""Clean per-account completion view for the combo orchestrator log."""
import os, re, sys, time, glob

STEPS = ["profile_created","email_submitted","otp_submitted","tos_accepted","billing_reached",
         "oauth_started","account_selected","terms_accepted","consent_approved","callback_code",
         "api_callback","sheet_completed","profile_closed"]
TOTAL = len(STEPS)
SHORT = {"profile_created":"prof","email_submitted":"mail","otp_submitted":"otp","tos_accepted":"tos",
         "billing_reached":"bill","oauth_started":"oauth","account_selected":"acct","terms_accepted":"terms",
         "consent_approved":"consent","callback_code":"code","api_callback":"api","sheet_completed":"sheet",
         "profile_closed":"close"}
C = {"g":"\033[32m","y":"\033[33m","r":"\033[31m","d":"\033[2m","b":"\033[1m","x":"\033[0m"}
ROOTS = [os.path.expanduser("~/antig-logs"), os.path.expanduser("~/Desktop/antig-logs")]

def newest_log():
    runs = []
    for root in ROOTS:
        runs += glob.glob(os.path.join(root, "run-*", "orchestrator.log"))
    return max(runs, key=os.path.getmtime) if runs else None

def parse(path):
    accounts, batch_emails, batch = {}, [], 0
    if not path or not os.path.exists(path):
        return accounts, batch_emails, batch
    with open(path, "r", errors="ignore") as f:
        for line in f:
            m = re.search(r"batch emails:\s*(.+)$", line)
            if m:
                batch_emails = [e.strip() for e in m.group(1).split(",") if e.strip()]
                for e in batch_emails:
                    accounts.setdefault(e, {"done": set(), "cur": "", "err": "", "state": "queued"})
            m = re.search(r"\[step\]\s+(\S+@\S+)\s+(\w+)\s+(\w+)(?:.*?attempt=(\d+))?(?:.*?error=([^\n]+))?", line)
            if m:
                email, step, status, attempt, err = m.group(1).lower(), m.group(2), m.group(3), m.group(4), m.group(5)
                a = accounts.setdefault(email, {"done": set(), "cur": "", "err": "", "state": "active"})
                if status == "done":
                    a["done"].add(step)
                elif status == "running":
                    a["cur"] = step
                elif status == "retrying":
                    a["cur"] = step
                    a["err"] = (err or "retry").strip()
                elif status == "failed":
                    a["cur"] = step
                    a["state"] = "failed"
                    a["err"] = (err or "").strip()
            m = re.search(r"started .*email=(\S+@\S+)", line)
            if m:
                accounts.setdefault(m.group(1).lower(), {"done": set(), "cur": "", "err": "", "state": "active"})["state"] = "active"
            m = re.search(r"combo complete for (\S+@\S+)", line)
            if m:
                accounts.setdefault(m.group(1).lower(), {"done": set(), "cur": "", "err": "", "state": "done"})["state"] = "done"
            m = re.search(r"signup error page detected for (\S+@\S+)", line)
            if m:
                a = accounts.setdefault(m.group(1).lower(), {"done": set(), "cur": "", "err": "", "state": "active"})
                a["err"] = "signup error"
            m = re.search(r"session ended \((\w+)\) for (\S+@\S+)", line)
            if m:
                reason, email = m.group(1), m.group(2).lower()
                a = accounts.setdefault(email, {"done": set(), "cur": "", "err": "", "state": "active"})
                if reason in ("combo-complete", "qr-saved"):
                    a["state"] = "done" if reason == "combo-complete" else "closed"
                else:
                    a["state"] = "stopped"
    return accounts, batch_emails, batch

def bar(pct, w=18):
    n = int(round(pct / 100 * w))
    return "█" * n + "░" * (w - n)

def color(pct):
    return C["g"] if pct >= 100 else (C["y"] if pct >= 50 else C["r"])

def render(accounts, batch_emails, path):
    rows = [e for e in batch_emails] or sorted(accounts)
    done_n = sum(1 for e in rows if (progress(accounts.get(e, {})) >= 100))
    live = sum(1 for e in rows if accounts.get(e, {}).get("state") in ("active", "queued"))
    out = []
    out.append(f"{C['b']}GCP combo — per-account completion{C['x']}  {C['d']}{time.strftime('%H:%M:%S')}{C['x']}")
    out.append(f"{C['d']}{path or 'no log found'}{C['x']}")
    out.append("")
    out.append(f"{'ACCOUNT':42} {'PROGRESS':20} {'%':>4}  {'STEP':8} STATUS")
    out.append("-" * 92)
    for e in rows:
        a = accounts.get(e, {})
        pct = progress(a)
        col = color(pct)
        st = a.get("state", "queued")
        stc = C["g"] if pct >= 100 else (C["y"] if st == "active" else C["r"])
        cur = SHORT.get(a.get("cur", ""), a.get("cur", "") or "—")
        extra = f" {C['r']}{a.get('err','')[:22]}{C['x']}" if a.get("err") and pct < 100 else ""
        out.append(f"{e[:42]:42} {col}{bar(pct)}{C['x']} {pct:3.0f}%  {cur:8} {stc}{st}{C['x']}{extra}")
    out.append("-" * 92)
    out.append(f"{C['d']}accounts {len(rows)} | completed {done_n} | live {live} | "
               f"step {TOTAL}{C['x']}")
    return "\n".join(out)

def progress(a):
    done = a.get("done") or set()
    if a.get("state") == "done":
        return 100.0
    return min(100.0, len(done) / TOTAL * 100)

def main():
    if "--once" in sys.argv:
        log = newest_log()
        acc, emails, _ = parse(log)
        print(render(acc, emails, log))
        return
    try:
        while True:
            log = newest_log()
            acc, emails, _ = parse(log)
            sys.stdout.write("\033[H\033[2J")
            print(render(acc, emails, log))
            time.sleep(2)
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()
