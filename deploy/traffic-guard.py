#!/usr/bin/env python3
"""Stop this demo before exhausting the 200 GiB cloud traffic allowance."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--interface', default='eth0')
parser.add_argument('--limit-gib', type=int, default=150)
parser.add_argument('--check', action='store_true')
a = parser.parse_args()
if not 1 <= a.limit_gib <= 150:
    parser.error('Traffic protection limit must be between 1 and 150 GiB')
reason = None
try:
    raw = subprocess.check_output(['vnstat', '--json', 'm', '-i', a.interface], timeout=10, text=True)
    data = json.loads(raw)
    interface = next(x for x in data['interfaces'] if x['name'] == a.interface)
    stamp = interface['updated']
    updated = datetime(**stamp['date'], hour=stamp['time']['hour'], minute=stamp['time']['minute'])
    now = datetime.now()
    if not 0 <= (now-updated).total_seconds() <= 900:
        raise ValueError('Traffic database is stale')
    current = [x for x in interface['traffic']['month'] if x['date']['year'] == now.year and x['date']['month'] == now.month]
    # Count both inbound and outbound; cloud egress is a subset of this conservative total.
    total = sum(int(x['rx']) + int(x['tx']) for x in current)
    if total >= a.limit_gib * 1024**3:
        reason = 'Monthly traffic protection limit reached'
    print('Tracked monthly interface bytes:', total, 'limit GiB:', a.limit_gib)
except Exception:
    reason = 'Traffic accounting unavailable; pause demo to protect budget'
if reason:
    print(reason)
    if not a.check:
        folder = Path(__file__).resolve().parent
        subprocess.run(['docker', 'compose', '-f', str(folder/'compose-ip.yaml'), 'stop', 'web', 'app'], check=True, timeout=45)
    sys.exit(2)
print('Traffic guard passed')
