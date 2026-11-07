#!/usr/bin/env python3
"""Live terminal dashboard for the 2-profile signup runner."""
import collections
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.expanduser('~/Desktop/antig-logs')
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OCTO = 'http://127.0.0.1:58888'

C = {
    'reset': '\033[0m', 'dim': '\033[2m', 'bold': '\033[1m',
    'cyan': '\033[36m', 'green': '\033[32m', 'yellow': '\033[33m',
    'red': '\033[31m', 'blue': '\033[34m', 'magenta': '\033[35m',
    'white': '\033[97m', 'grey': '\033[90m',
}
ANSI_RE = re.compile(r'\x1b\[[0-9;]*m')


def color(code, text):
    return f'{code}{text}{C["reset"]}'


def visible_len(text):
    return len(ANSI_RE.sub('', str(text)))


def pad(text, width):
    text = str(text)
    if visible_len(text) > width:
        text = ANSI_RE.sub('', text)[:max(0, width - 1)] + '…'
    return text + ' ' * max(0, width - visible_len(text))


def fit(text, width):
    return pad(text, width)


def load_proxy_config():
    for name in ('proxy.local.json', os.path.join('antig-orchestrator-mac', 'proxy.local.json')):
        path = os.path.join(SCRIPT_DIR, name)
        try:
            with open(path, 'r', encoding='utf-8') as fh:
                return json.load(fh)
        except Exception:
            pass
    return {}


PROXY_CFG = load_proxy_config()
PROXY_URL = PROXY_CFG.get('url', '')
IP_API_BASE = str(PROXY_CFG.get('ipApiBase', '')).rstrip('/')
IP_API_KEY = PROXY_CFG.get('ipApiKey', '')

state = {
    'run': '',
    'batch': '—',
    'ip': '—',
    'last_rotate': '—',
    'emails': collections.OrderedDict(),
    'profiles': [],
    'events': collections.deque(maxlen=9),
    'raw': collections.deque(maxlen=7),
    'counts': {'assigned': 0, 'completed': 0, 'errors': 0},
    'phone': {'running': False, 'ip': '', 'message': '—'},
    'egress': '—',
}
positions = {'signup': 0}
egress_tick = 0


def clear():
    if sys.stdout.isatty():
        sys.stdout.write('\033[2J\033[H')


def terminal_width():
    try:
        width = shutil.get_terminal_size((110, 30)).columns
    except Exception:
        width = 110
    return max(88, min(130, width - 2))


def latest_run():
    try:
        dirs = [os.path.join(ROOT, d) for d in os.listdir(ROOT) if re.match(r'run-', d)]
        return max(dirs, key=os.path.getmtime) if dirs else ''
    except OSError:
        return ''


def reset_run():
    state['batch'] = '—'
    state['ip'] = '—'
    state['last_rotate'] = '—'
    state['emails'] = collections.OrderedDict()
    state['events'].clear()
    state['raw'].clear()
    state['counts'] = {'assigned': 0, 'completed': 0, 'errors': 0}
    positions['signup'] = 0


def add_event(ts, message, tone='grey'):
    state['events'].append((ts, message, tone))


def set_email(email, status, ts, note=''):
    email = str(email or '').strip()
    if not email:
        return
    row = state['emails'].get(email, {})
    row.update({'email': email, 'status': status, 'ts': ts, 'note': note or row.get('note', '')})
    state['emails'][email] = row
    if len(state['emails']) > 12:
        state['emails'].popitem(last=False)


def read_new(path):
    if not path:
        return []
    try:
        fh = open(path, 'r', errors='replace')
    except OSError:
        return []
    try:
        fh.seek(positions['signup'])
        data = fh.read()
        positions['signup'] = fh.tell()
    finally:
        fh.close()
    return data.splitlines()


def parse_line(raw):
    line = raw.rstrip('\n')
    if not line.strip():
        return
    ts = line[:8] if re.match(r'^\d\d:\d\d:\d\d', line) else ''
    body = line[9:] if ts else line
    state['raw'].append((ts, body))

    m = re.search(r'===== batch (\d+)', body)
    if m:
        state['batch'] = m.group(1)
        state['emails'] = collections.OrderedDict()
        state['ip'] = '—'
        add_event(ts, f'batch {m.group(1)} started', 'cyan')

    m = re.search(r'proxy ready .*egress (\S+)', body)
    if m:
        state['ip'] = m.group(1)
        add_event(ts, f'proxy ready · egress {m.group(1)}', 'green')

    rotated = re.search(r'proxy IP changed: (\S+) -> (\S+)', body)
    if rotated:
        state['ip'] = rotated.group(2)
        state['last_rotate'] = f'{rotated.group(1)} → {rotated.group(2)}'
        add_event(ts, f'IP rotated {rotated.group(1)} → {rotated.group(2)}', 'magenta')
    else:
        rotated = re.search(r'IP (\S+) -> (\S+) \(proxy\)', body)
        if rotated:
            state['ip'] = rotated.group(2)
            state['last_rotate'] = f'{rotated.group(1)} → {rotated.group(2)}'

    m = re.search(r'batch emails: (.*)', body)
    if m:
        for email in [x.strip() for x in m.group(1).split(',') if x.strip()]:
            set_email(email, 'PENDING', ts)

    m = re.search(r'started .*uuid=([0-9a-fA-F]+).*email=(\S+)', body)
    if m:
        state['counts']['assigned'] += 1
        set_email(m.group(2), 'ASSIGNED', ts, m.group(1))
        add_event(ts, f'profile started · {m.group(2)}', 'green')

    m = re.search(r'start failed for (\S+) \(attempt (\d+)/\d+\)', body)
    if m:
        set_email(m.group(1), 'RETRY', ts)
        add_event(ts, f'start retry {m.group(2)} · {m.group(1)}', 'yellow')
        if m.group(2) == '2':
            state['counts']['errors'] += 1

    m = re.search(r'billing page detected for (\S+);', body) or re.search(r'billing reached for (\S+)', body)
    if m:
        set_email(m.group(1), 'BILLING', ts)
        add_event(ts, f'billing reached · {m.group(1)}', 'cyan')

    m = re.search(r'billing sheet (\S+): (.*)', body)
    if m:
        set_email(m.group(1), 'COMPLETED', ts, 'sheet saved')
        state['counts']['completed'] += 1
        add_event(ts, f'sheet completed · {m.group(1)}', 'green')

    m = re.search(r'signup error page detected for (\S+)', body)
    if m:
        set_email(m.group(1), 'ERROR', ts, 'signup error page')
        state['counts']['errors'] += 1
        add_event(ts, f'signup error · {m.group(1)}', 'red')

    m = re.search(r'session ended \(([^)]+)\) for (\S+)', body)
    if m:
        reason, email = m.group(1), m.group(2)
        if reason in ('billing', 'qr-saved'):
            set_email(email, 'COMPLETED', ts, reason)
            state['counts']['completed'] += 1
            add_event(ts, f'completed ({reason}) · {email}', 'green')
        elif reason == 'signup-error':
            set_email(email, 'ERROR', ts, reason)
            add_event(ts, f'failed ({reason}) · {email}', 'red')
        else:
            set_email(email, reason.upper(), ts)
            add_event(ts, f'{reason} · {email}', 'yellow')


def http_json(url, timeout=2.5):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as res:
            return json.loads(res.read().decode() or '{}')
    except Exception:
        return None


def curl_text(args, timeout=5):
    try:
        out = subprocess.run(['curl', '-4', '-sS', '-m', str(timeout)] + args,
                             capture_output=True, text=True, timeout=timeout + 1)
        return out.stdout.strip()
    except Exception:
        return ''


def refresh_health():
    global egress_tick

    active = http_json(f'{OCTO}/api/profiles/active') or []
    rows = active if isinstance(active, list) else (active.get('data') or [])
    profiles = []
    for row in rows:
        uuid = row.get('uuid', '')
        email = ''
        for item in state['emails'].values():
            if item.get('note') == uuid:
                email = item.get('email', '')
                break
        profiles.append({
            'uuid': uuid,
            'email': email or uuid[:12],
            'state': str(row.get('state') or '—'),
            'ip': str((row.get('connection_data') or {}).get('ip') or '—'),
            'port': str(row.get('debug_port') or '—'),
        })
    state['profiles'] = profiles

    if IP_API_BASE and IP_API_KEY:
        info = http_json(f'{IP_API_BASE}/api/ip?key={IP_API_KEY}') or {}
        if info.get('ip'):
            state['phone']['ip'] = info['ip']
        state['phone']['running'] = bool(info.get('running'))
        phone = http_json(f'{IP_API_BASE}/phone/status') or {}
        if phone.get('message'):
            state['phone']['message'] = phone['message']
        if phone.get('running'):
            state['phone']['running'] = True
        if phone.get('ip'):
            state['phone']['ip'] = phone['ip']

    egress_tick += 1
    if PROXY_URL and egress_tick % 2 == 0:
        ip = curl_text(['--proxy', PROXY_URL, 'https://api.ipify.org'], timeout=5)
        if re.match(r'^\d{1,3}(\.\d{1,3}){3}$', ip or ''):
            state['egress'] = ip


def status_style(status):
    if status in ('COMPLETED', 'BILLING', 'ASSIGNED'):
        return 'green'
    if status in ('ERROR', 'FAILED'):
        return 'red'
    if status in ('RETRY', 'PENDING', 'STOPPED'):
        return 'yellow'
    return 'grey'


def status_glyph(status):
    return {
        'COMPLETED': '✔', 'BILLING': '◆', 'ASSIGNED': '●', 'PENDING': '○',
        'RETRY': '↻', 'ERROR': '✖', 'FAILED': '✖', 'STOPPED': '■',
    }.get(status, '·')


def render():
    w = terminal_width()
    inner = w - 4

    def row(text):
        return color(C['cyan'], '│') + ' ' + fit(text, inner) + ' ' + color(C['cyan'], '│')

    def sep(ch='─'):
        return color(C['cyan'], '├' + ch * (w - 2) + '┤')

    clear()
    phone = state['phone']
    phone_state = 'rotating…' if phone['running'] else (phone.get('ip') or 'idle')
    phone_tone = 'yellow' if phone['running'] else 'green'
    header = (color(C['bold'] + C['white'], ' ✦ ANTIG SIGNUP · LIVE') +
              color(C['dim'], f'   batch {state["batch"]}'))
    print(color(C['cyan'], '╭' + '─' * (w - 2) + '╮'))
    print(row(header))
    print(row(
        color(C['bold'], ' PROXY ') + color(C['green'], state['egress']) +
        color(C['dim'], '   phone ') + color(C[phone_tone], phone_state) +
        color(C['dim'], '   active ') + color(C['cyan'], str(len(state['profiles']))) +
        color(C['dim'], '   rotated ') + color(C['magenta'], state['last_rotate'])
    ))
    print(row(color(C['grey'], ' phone: ' + str(phone.get('message', '—'))[:inner - 10])))
    print(sep())

    print(row(color(C['bold'], ' PROFILES')))
    if state['profiles']:
        for p in state['profiles']:
            tone = 'green' if p['state'] in ('STARTED', 'RUNNING') else ('yellow' if p['state'] == 'PREPARING' else 'red')
            print(row(
                '  ' + color(C[tone], '●') + ' ' + fit(color(C[tone], p['state']), 12) +
                color(C['dim'], 'ip ') + fit(color(C['white'], p['ip']), 16) +
                fit(p['email'], inner - 38)
            ))
    else:
        print(row(color(C['dim'], '  waiting for profiles…')))
    print(sep())

    print(row(color(C['bold'], ' EMAILS')))
    if state['emails']:
        for item in list(state['emails'].values())[-8:]:
            status = item['status']
            tone = status_style(status)
            note = item.get('note', '')
            note_txt = f'  {color(C["grey"], note[:20])}' if note and len(note) == 12 else ''
            print(row(
                '  ' + color(C[tone], status_glyph(status)) + ' ' +
                fit(color(C[tone], status), 12) +
                fit(item['email'], inner - 34) +
                color(C['dim'], item.get('ts', ''))
            ))
    else:
        print(row(color(C['dim'], '  waiting for batch emails…')))
    print(sep())

    print(row(color(C['bold'], ' EVENTS')))
    if state['events']:
        for ts, message, tone in list(state['events'])[-6:]:
            print(row('  ' + color(C['dim'], ts) + '  ' + fit(color(C[tone], message), inner - 11)))
    else:
        print(row(color(C['dim'], '  waiting for events…')))
    print(sep())

    counts = state['counts']
    summary = (color(C['green'], f' assigned {counts["assigned"]}') +
               color(C['dim'], '  ·  ') + color(C['green'], f'completed {counts["completed"]}') +
               color(C['dim'], '  ·  ') + color(C['red'], f'errors {counts["errors"]}'))
    print(row(' ' + summary))
    print(color(C['cyan'], '╰' + '─' * (w - 2) + '╯'))
    print(color(C['dim'], f' log: {state["run"] or "waiting…"}'))
    print(color(C['grey'], ' Ctrl+C detaches this viewer; the signup runner keeps running.'))
    sys.stdout.flush()


print(color(C['dim'], 'Loading dashboard…'))
try:
    while True:
        run = latest_run()
        if run != state['run']:
            state['run'] = run
            reset_run()
        if run:
            for line in read_new(os.path.join(run, 'orchestrator.log')):
                parse_line(line)
        refresh_health()
        render()
        time.sleep(2)
except KeyboardInterrupt:
    clear()
    print(color(C['dim'], 'Dashboard detached. The signup runner is still running.'))
