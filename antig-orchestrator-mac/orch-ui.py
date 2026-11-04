#!/usr/bin/env python3
import os
import re
import sys
import time

LOG = sys.argv[1] if len(sys.argv) > 1 else '/tmp/orch-usb.log'
USE_COLOR = sys.stdout.isatty() and os.environ.get('NO_COLOR') is None


def paint(code, text):
    return f'\033[{code}m{text}\033[0m' if USE_COLOR else text


def stamp(raw, fallback='--:--:--'):
    m = re.match(r'^(\d\d:\d\d:\d\d)\s+', raw)
    return m.group(1) if m else fallback


def show(label, text, color='0', label_color='36'):
    print(f'{paint("2", stamp(text))} {paint(label_color, label.ljust(7))} {text}', flush=True)


def short_email(email):
    return email


def batch_header(n):
    print(flush=True)
    print(paint('36;1', f'BATCH {n}') + paint('2', '  ' + '─' * 58), flush=True)


def summary(batch, started, failed, results, before, after, ts='--:--:--'):
    reasons = {}
    for reason in results.values():
        reasons[reason] = reasons.get(reason, 0) + 1
    total = len(batch.get('emails', []))
    bits = [f'started {len(started)}/{total or "?"}']
    for reason in sorted(reasons):
        bits.append(f'{reason} {reasons[reason]}')
    if failed:
        bits.append(f'failed {failed}')
    if before or after:
        bits.append(f'IP {before or "?"} -> {after or "?"}')
    print(f'{paint("2", ts)} {paint("36", "SUMMARY".ljust(7))} ' + '  ·  '.join(bits), flush=True)


batch = None
started = set()
failed = 0
results = {}
last_before = None
last_after = None
last_ts = '--:--:--'

while True:
    try:
        fh = open(LOG, 'r', errors='replace')
        break
    except FileNotFoundError:
        time.sleep(0.5)

pos = 0
while True:
    line = fh.readline()
    if not line:
        time.sleep(0.35)
        try:
            if os.path.getsize(LOG) < pos:
                fh.seek(0)
                pos = 0
            else:
                pos = fh.tell()
        except OSError:
            pass
        continue
    pos = fh.tell()
    raw = line.rstrip('\n')
    ts = stamp(raw)
    last_ts = ts

    m = re.search(r'===== batch (\d+)(?:/\d+)? \((\d+) profiles?\) =====', raw)
    if m:
        n = int(m.group(1))
        if batch is not None and batch.get('n') != n:
            pass
        batch = {'n': n, 'emails': []}
        started = set()
        failed = 0
        results = {}
        last_before = None
        last_after = None
        batch_header(n)
        continue

    m = re.search(r'batch emails: (.+)$', raw)
    if m and batch is not None:
        batch['emails'] = [x.strip() for x in m.group(1).split(',') if x.strip()]
        print(f'{paint("2", ts)} {paint("35", "EMAILS ".ljust(7))} {len(batch["emails"])}  ' + ', '.join(batch['emails']), flush=True)
        continue

    m = re.search(r'IP (\S+) -> (\S+) \(USB tether\)', raw)
    if m:
        before, after = m.group(1), m.group(2)
        last_before, last_after = before, after
        state = 'rotated' if before != after else 'same'
        color = '32' if before != after else '33'
        print(f'{paint("2", ts)} {paint(color, "IP".ljust(7))} {before} -> {after}  ({state})', flush=True)
        continue

    m = re.search(r'started .* uuid=([0-9a-f]+) .* email=(\S+)', raw)
    if m:
        uuid, email = m.group(1), m.group(2)
        started.add(email)
        print(f'{paint("2", ts)} {paint("32", "ASSIGN".ljust(7))} {email}  {paint("2", uuid[:8])}', flush=True)
        continue

    m = re.search(r'start failed for (\S+) \(attempt 2/2\): (.+)$', raw)
    if m:
        email, reason = m.group(1), m.group(2)
        failed += 1
        print(f'{paint("2", ts)} {paint("31", "FAIL".ljust(7))} {email}  {reason}', flush=True)
        continue

    m = re.search(r'session ended \(([^)]+)\) for (\S+)', raw)
    if m:
        reason, email = m.group(1), m.group(2)
        results[email] = reason
        color = '32' if reason == 'success' else ('31' if 'error' in reason or 'fail' in reason else '33')
        print(f'{paint("2", ts)} {paint(color, "RESULT".ljust(7))} {email}  {reason}', flush=True)
        continue

    m = re.search(r'batch (\d+) complete', raw)
    if m and batch is not None:
        summary(batch, started, failed, results, last_before, last_after, last_ts)
        continue

    m = re.search(r'extension ([\w.]+) ready', raw)
    if m:
        print(f'{paint("2", ts)} {paint("32", "READY".ljust(7))} extension {m.group(1)}', flush=True)
        continue

    m = re.search(r'android ready; .*egress (\S+)', raw)
    if m:
        print(f'{paint("2", ts)} {paint("32", "READY".ljust(7))} network egress {m.group(1)}', flush=True)
        continue

    m = re.search(r'waiting for (\d+) profile\(s\): (.+)$', raw)
    if m and batch is not None:
        emails = [x.strip() for x in m.group(2).split(',') if x.strip()]
        print(f'{paint("2", ts)} {paint("33", "RUNNING".ljust(7))} {m.group(1)} profiles  ' + ', '.join(emails), flush=True)
        continue
