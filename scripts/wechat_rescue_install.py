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
from wechat_rescue_apply import Cloudflare, ROOT

from wechat_rescue_config import load_env, enabled, spec, cloudflare_credentials

LABEL = 'com.wechat-agent.rescue-heartbeat'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--credentials', type=Path)
    parser.add_argument('--env-file', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    values = load_env(args.env_file)
    if not enabled(values):
        print('Cloudflare rescue disabled; no installation changes (existing jobs are not removed).')
        return
    config = spec(values)
    encrypted = args.credentials or values.get('WECHAT_RESCUE_CREDENTIALS_FILE')
    credential_path = Path(encrypted).expanduser().resolve(strict=True) if encrypted else None
    cf = Cloudflare(cloudflare_credentials(values, credential_path))
    dbs = cf.account_call('GET', '/d1/database?per_page=100')
    database = next(d['uuid'] for d in dbs if d['name'] == config['database'])
    target = Path.home()/'.local/share/wechat-rescue'
    plist = Path.home()/'Library/LaunchAgents'/f'{LABEL}.plist'
    print(json.dumps({'mode': 'apply' if args.apply else 'plan', 'job': LABEL,
                      'interval_seconds': 30, 'runtime': str(target), 'database': database}))
    if not args.apply:
        return
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name in ('wechat_rescue_heartbeat.py', 'wechat_rescue_apply.py', 'wechat_rescue_config.py'):
        shutil.copy2(ROOT/'scripts'/name, target/name)
    # Private stable config outside Git. Never embed tokens in process args or plist.
    env_path = target/'rescue.env'
    keys = ('WECHAT_RESCUE_ENABLED', 'WECHAT_RESCUE_ALLOWED_EMAILS',
            'WECHAT_RESCUE_HOSTNAME', 'WECHAT_RESCUE_ZONE', 'WECHAT_RESCUE_ACCESS_TEAM',
            'WECHAT_RESCUE_DEVICE_ID', 'WECHAT_RESCUE_WORKER_NAME',
            'WECHAT_RESCUE_DATABASE_NAME', 'WECHAT_RESCUE_DATABASE_ID',
            'WECHAT_RESCUE_STATE_PATH', 'WECHAT_RESCUE_CREDENTIALS_FILE',
            'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ZONE_ID')
    keep = {k: values[k] for k in keys if k in values}
    if credential_path:
        keep = {k:v for k,v in keep.items() if not k.startswith('CLOUDFLARE_')}
    if any('\n' in v or '\r' in v or '"' in v for v in keep.values()):
        raise ValueError('Unsupported multiline/quoted configuration')
    fd = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as out:
        os.fchmod(out.fileno(), 0o600)
        out.write(''.join(f'{k}="{v}"\n' for k,v in keep.items()))
    arguments = [sys.executable, str(target/'wechat_rescue_heartbeat.py'),
                 '--env-file', str(env_path), '--database', database]
    if credential_path:
        arguments += ['--credentials', str(credential_path)]
    body = {'Label': LABEL, 'ProgramArguments': arguments,
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
    try:
        main()
    except Exception:
        raise SystemExit('Rescue installation failed; check local configuration and permissions.')
