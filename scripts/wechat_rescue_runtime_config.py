"""Resolve a deployed D1 identity into the private local runtime environment."""
import argparse
from pathlib import Path
from wechat_rescue_config import load_env, enabled, spec, cloudflare_credentials
from wechat_rescue_apply import Cloudflare

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', type=Path, required=True)
    args = parser.parse_args()
    values = load_env(args.env_file)
    if not enabled(values):
        return
    config = spec(values)
    cf = Cloudflare(cloudflare_credentials(values))
    databases = cf.account_call('GET', '/d1/database?per_page=100')
    matches = [d for d in databases if d['name'] == config['database']]
    if len(matches) != 1:
        raise RuntimeError('Expected one deployed rescue database')
    lines = [line for line in args.env_file.read_text().splitlines()
             if not line.startswith('WECHAT_RESCUE_DATABASE_ID=')]
    lines.append('WECHAT_RESCUE_DATABASE_ID=' + matches[0]['uuid'])
    args.env_file.write_text('\n'.join(lines) + '\n')
    args.env_file.chmod(0o600)
    print('Local rescue database identity saved.')

if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('Could not resolve rescue database; inspect local configuration.')
