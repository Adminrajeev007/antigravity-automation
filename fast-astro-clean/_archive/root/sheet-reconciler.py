#!/usr/bin/env python3
import glob
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.expanduser('~/Desktop/antig-logs')
LOG = os.path.join(ROOT, 'sheet-reconciler.log')
URL = 'https://script.google.com/macros/s/AKfycbzoCHT0aGmxBzTD_j9gEU1JFxBW52_NUj7x-NHW_D_W_PmIZ4YIWWCOWtIcR2fojkfs/exec'
TOKEN = 'change-this-sheet-token'
ONCE = '--once' in sys.argv


def log(msg):
    os.makedirs(ROOT, exist_ok=True)
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    print(line, flush=True)
    try:
        with open(LOG, 'a') as fh:
            fh.write(line + '\n')
    except Exception:
        pass


def get(params, timeout=35):
    url = URL + '?' + urllib.parse.urlencode(params)
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as res:
                return json.loads(res.read().decode())
        except Exception as exc:
            last = exc
            if attempt < 2:
                time.sleep(4)
    raise last


def sheet_emails():
    data = get({'token': TOKEN, 'action': 'list'})
    if not data.get('ok') or not isinstance(data.get('rows'), list):
        raise RuntimeError(str(data)[:300])
    return {str(row.get('email', '')).strip().lower() for row in data['rows'] if row.get('email')}


def log_billing_emails():
    found = set()
    for path in glob.glob(os.path.join(ROOT, 'run-*', 'orchestrator.log')):
        try:
            with open(path, errors='replace') as fh:
                for line in fh:
                    match = re.search(r'billing page detected for (\S+);', line)
                    if match:
                        found.add(match.group(1).strip().lower())
        except Exception:
            pass
    return found


def add_email(email):
    data = get({
        'token': TOKEN, 'action': 'qr', 'tab': 'QR',
        'email': email, 'notes': 'billing reached'
    })
    if not data.get('ok'):
        raise RuntimeError(str(data)[:250])
    return data


def reconcile():
    try:
        in_sheet = sheet_emails()
    except Exception as exc:
        log(f'sheet list failed: {exc}')
        return
    billing = log_billing_emails()
    missing = sorted(billing - in_sheet)
    if not missing:
        log(f'no missing billing emails (sheet={len(in_sheet)}, logs={len(billing)})')
        return
    log(f'missing {len(missing)} billing email(s); adding...')
    for email in missing:
        try:
            result = add_email(email)
            log(f"added {email} row={result.get('row')} status={result.get('status')}")
        except Exception as exc:
            log(f'failed {email}: {exc}')


while True:
    reconcile()
    if ONCE:
        break
    time.sleep(300)
