#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.expanduser('~/Desktop/antig-logs')
C = {
    'reset': '\033[0m', 'dim': '\033[2m', 'bold': '\033[1m',
    'cyan': '\033[36m', 'green': '\033[32m', 'yellow': '\033[33m',
    'red': '\033[31m', 'blue': '\033[34m', 'magenta': '\033[35m',
}
W = 84

def color(code, text):
    return f'{code}{text}{C["reset"]}'

ANSI_RE = re.compile(r'\x1b\[[0-9;]*m')

def clear():
    if sys.stdout.isatty():
        sys.stdout.write('\033[2J\033[H')

def pad(text, width):
    text = str(text)
    visible = len(ANSI_RE.sub('', text))
    if visible > width:
        text = ANSI_RE.sub('', text)[:width]
        visible = len(text)
    return text + ' ' * max(0, width - visible)

def box(text):
    return color(C['cyan'], '│') + pad(text, W) + color(C['cyan'], '│')

def line(ch='─'):
    return color(C['dim'], ch * W)

def latest(pattern):
    try:
        files = [os.path.join(ROOT, f) for f in os.listdir(ROOT) if re.match(pattern, f)]
        return max(files, key=os.path.getmtime) if files else ''
    except OSError:
        return ''

RUN = ''
LOGIN = ''

signup = {'batch': 0, 'ip': '—', 'emails': [], 'rows': {}, 'by_uuid': {}, 'assigned': 0, 'failed': 0, 'results': {}, 'reset': 0}
login = {'version': '—', 'profile': '—', 'error': '', 'last': ''}
health = {'proxy': '', 'host': '', 'active': 0, 'headless': '', 'profiles': []}
positions = {}

def refresh_paths():
    global RUN, LOGIN
    nr = latest(r'run-.*')
    nl = latest(r'login-.*\.log')
    if nr != RUN or nl != LOGIN:
        RUN, LOGIN = nr, nl
        positions.clear()
        signup.update({'batch': 0, 'ip': '—', 'emails': [], 'rows': {}, 'by_uuid': {}, 'assigned': 0, 'failed': 0, 'results': {}, 'reset': 0})
        login.update({'version': '—', 'profile': '—', 'error': '', 'last': ''})

def read_new(path, key):
    if not path:
        return []
    try:
        fh = open(path, 'r', errors='replace')
    except OSError:
        return []
    pos = positions.get(key, 0)
    try:
        fh.seek(pos)
        data = fh.read()
        positions[key] = fh.tell()
    finally:
        fh.close()
    return data.splitlines()

def short(v, n=30):
    v = str(v)
    return v if len(v) <= n else v[:n-1] + '…'

def parse_signup(lines):
    for raw in lines:
        ts = raw[:8]
        if 'batch emails:' in raw:
            signup['emails'] = [x.strip() for x in raw.split('batch emails:',1)[1].split(',') if x.strip()]
            signup['rows'] = {e: ('PENDING', ts) for e in signup['emails']}
            signup['assigned'] = 0; signup['failed'] = 0; signup['results'] = {}
        m = re.search(r'===== batch (\d+)', raw)
        if m:
            signup['batch'] = int(m.group(1)); signup['ip'] = '—'; signup['emails'] = []; signup['rows'] = {}
        m = re.search(r'IP (\S+) -> (\S+)', raw)
        if m:
            signup['ip'] = m.group(2)
        m = re.search(r'started .* uuid=([0-9a-fA-F]+) .* email=(\S+)', raw)
        if m:
            uid, e = m.group(1), m.group(2)
            signup['by_uuid'][uid] = e
            signup['rows'][e] = ('ASSIGNED', ts); signup['assigned'] += 1
        m = re.search(r'start failed for (\S+) \(attempt 2/2\): (.*)', raw)
        if m:
            e = m.group(1); signup['rows'][e] = ('FAILED', ts); signup['failed'] += 1
        m = re.search(r'billing page detected for (\S+);', raw)
        if m:
            e = m.group(1); signup['rows'][e] = ('BILLING', ts); signup['results'][e] = 'billing'
        m = re.search(r'signup error page detected for (\S+)', raw)
        if m:
            e = m.group(1); signup['rows'][e] = ('SIGNUP-ERROR', ts); signup['results'][e] = 'signup-error'
        m = re.search(r'session ended \(([^)]+)\) for (\S+)', raw)
        if m:
            reason, e = m.group(1), m.group(2); signup['rows'][e] = (reason.upper(), ts); signup['results'][e] = reason

def parse_login(lines):
    for raw in lines:
        if not raw.strip():
            continue
        if 'extension ready:' in raw:
            m = re.search(r'extension ready: (.*) \((.*)\)', raw)
            login['version'] = (m.group(2) if m else raw.split('extension ready:',1)[1]).strip()
        if 'extension configured:' in raw:
            try:
                d = json.loads(raw.split('extension configured:',1)[1].strip())
                if isinstance(d, dict) and 'version' in d: login['version'] = d['version']
            except Exception:
                pass
        if '"debugPort"' in raw:
            login['profile'] = 'login profile started'
        if '[login-setup]' in raw:
            login['error'] = raw.split('[login-setup]',1)[1].strip()
        text = raw.strip()
        if text not in ('{', '}', '},') and not text.startswith('"') and not text.startswith('}'):
            login['last'] = text

def get_health():
    try:
        out = subprocess.run(['curl','-4','-s','-m','5','https://api.ipify.org'], capture_output=True, text=True, timeout=7).stdout.strip()
        health['host'] = out or 'offline'
    except Exception:
        health['host'] = 'offline'
    try:
        out = subprocess.run(['curl','-4','-s','-m','5','--socks5-hostname','127.0.0.1:1080','https://api.ipify.org'], capture_output=True, text=True, timeout=7).stdout.strip()
        health['proxy'] = out or 'offline'
    except Exception:
        health['proxy'] = 'offline'
    try:
        req = urllib.request.Request('http://127.0.0.1:58888/api/profiles/active')
        with urllib.request.urlopen(req, timeout=3) as r:
            rows = json.loads(r.read().decode())
        health['active'] = len(rows)
        health['headless'] = 'headless' if rows and all(p.get('headless') for p in rows) else ('headed' if rows else 'none')
        profiles = []
        for p in rows:
            uuid = p.get('uuid')
            label = signup['by_uuid'].get(uuid)
            if not label:
                try:
                    req2 = urllib.request.Request(f'http://127.0.0.1:58888/api/v2/profiles/{uuid}')
                    with urllib.request.urlopen(req2, timeout=2) as r2:
                        d2 = json.loads(r2.read().decode()).get('data') or {}
                        label = d2.get('title') or uuid
                except Exception:
                    label = uuid
            profiles.append({'label': label, 'state': p.get('state') or '—'})
        health['profiles'] = profiles
    except Exception:
        health['active'] = 0; health['headless'] = '?'

def render():
    clear()
    ip = signup['ip']
    print(color(C['cyan'], '╭' + '─'*W + '╮'))
    print(box(color(C['bold'], ' ANTIG · live control ') + color(C['dim'], f'batch {signup["batch"] or "—"} · {len(signup["emails"])} profiles · {health["headless"]}')))
    print(color(C['cyan'], '├' + '─'*W + '┤'))
    print(box(f' USB IP   {color(C["green"], ip):<24}  proxy {health["proxy"]:<18}  host {health["host"]:<18}'))
    print(box(f' active   {health["active"]:<24}  login {login["version"]:<18}  {login["error"][:24]:<24}'))
    print(color(C['cyan'], '├' + '─'*W + '┤'))
    if health['profiles']:
        for p in health['profiles'][:3]:
            print(box(' ' + color(C['blue'], 'ACTIVE').ljust(20) + ' ' + str(p['label']).ljust(44) + ' ' + str(p['state'])))
    else:
        print(box(color(C['dim'], ' no active profiles')))
    if signup['emails']:
        for e in signup['emails']:
            st, ts = signup['rows'].get(e, ('—', ''))
            c = C['green'] if st in ('ASSIGNED','BILLING','QR-SAVED') else (C['red'] if 'ERROR' in st or st == 'FAILED' else C['yellow'])
            print(box(' ' + color(c, st).ljust(20) + ' ' + e.ljust(44) + ' ' + ts.ljust(8)))
    else:
        print(box(color(C['dim'], ' Waiting for batch...')))
    print(color(C['cyan'], '├' + '─'*W + '┤'))
    print(box(color(C['bold'], ' LOGIN ') + color(C['dim'], (login['profile'] or 'waiting for login profile'))))
    print(box(color(C['dim'], ' ' + (login['last'] or '—')[:W-2])))
    print(color(C['cyan'], '├' + '─'*W + '┤'))
    results = {}
    for r in signup['results'].values():
        results[r] = results.get(r, 0) + 1
    summary = f' assigned {signup["assigned"]}  ·  failed {signup["failed"]}  ·  ' + '  ·  '.join(f'{k} {v}' for k, v in sorted(results.items()))
    print(box(color(C['dim'], summary)))
    print(color(C['cyan'], '╰' + '─'*W + '╯'))
    print(color(C['dim'], f' logs: {RUN or "—"}'))
    sys.stdout.flush()

while True:
    refresh_paths()
    parse_signup(read_new(RUN and os.path.join(RUN, 'orchestrator.log'), 'signup'))
    parse_login(read_new(LOGIN, 'login'))
    get_health()
    render()
    time.sleep(2)
