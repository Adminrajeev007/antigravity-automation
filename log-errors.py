#!/usr/bin/env python3
import os
import re
import sys
import time

paths = sys.argv[1:]
handles = {}
pos = {}
pattern = re.compile(
    r'error|fail|timeout|limit|unavailable|bad_request|netfail|jserror|'
    r'socks|refused|not reachable|unchanged|crash|exception|unauthorized',
    re.I,
)

for path in paths:
    try:
        handles[path] = open(path, 'r', errors='replace')
        pos[path] = 0
    except FileNotFoundError:
        pass

while True:
    for path in paths:
        if path not in handles:
            if os.path.exists(path):
                handles[path] = open(path, 'r', errors='replace')
                pos[path] = 0
            else:
                continue
        fh = handles[path]
        line = fh.readline()
        if line:
            if pattern.search(line):
                stamp = time.strftime('%Y-%m-%d %H:%M:%S')
                sys.stdout.write(f'{stamp} [{os.path.basename(path)}] {line}')
                sys.stdout.flush()
        else:
            time.sleep(0.25)
