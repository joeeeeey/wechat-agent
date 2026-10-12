#!/usr/bin/env python3
"""Install an independent launchd heartbeat job; never touch WeChat services."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
from wechat_rescue_apply import Cloudflare, credentials, ROOT

LABEL = 'com.critdeck.wechat-rescue-heartbeat'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--credentials', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    credential_path = args.credentials.resolve(strict=True)
    cf = Cloudflare(credentials(credential_path))
    dbs = cf.account_call('GET', '/d1/database?per_page=100')
    database = next(d['uuid'] for d in dbs if d['name'] == 'wechat-rescue')
    target = Path.home()/'.local/share/wechat-rescue'
    plist = Path.home()/'Library/LaunchAgents'/f'{LABEL}.plist'
    print(json.dumps({'mode': 'apply' if args.apply else 'plan', 'job': LABEL,
                      'interval_seconds': 30, 'runtime': str(target), 'database': database}))
    if not args.apply:
        return
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name in ('wechat_rescue_heartbeat.py', 'wechat_rescue_apply.py'):
        shutil.copy2(ROOT/'scripts'/name, target/name)
    body = {'Label': LABEL, 'ProgramArguments': [sys.executable, str(target/'wechat_rescue_heartbeat.py'),
                '--credentials', str(credential_path), '--database', database],
            'RunAtLoad': True, 'StartInterval': 30, 'ProcessType': 'Background',
            'EnvironmentVariables': {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'HOME': str(Path.home())},
            'StandardOutPath': '/dev/null', 'StandardErrorPath': '/dev/null'}
    plist.parent.mkdir(parents=True, exist_ok=True)
    domain = f'gui/{os.getuid()}'
    loaded = subprocess.run(['launchctl', 'print', domain+'/'+LABEL], capture_output=True).returncode == 0
    if loaded:
        subprocess.run(['launchctl', 'bootout', domain+'/'+LABEL], check=True)
    plist.write_bytes(plistlib.dumps(body))
    plist.chmod(0o600)
    subprocess.run(['launchctl', 'bootstrap', domain, str(plist)], check=True)
    print('Installed independent heartbeat job.')


if __name__ == '__main__':
    main()
