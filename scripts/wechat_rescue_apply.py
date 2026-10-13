#!/usr/bin/env python3
"""Reconcile the narrowly scoped rescue stack. Default is a read-only plan."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import uuid
from wechat_rescue_config import load_env, enabled, spec, cloudflare_credentials, ConfigError

ROOT = Path(__file__).resolve().parents[1]
STACK = ROOT / 'infra/cloudflare/wechat-rescue'


class APIError(RuntimeError):
    def __init__(self, status, errors):
        self.status, self.errors = status, errors
        super().__init__(f'Cloudflare HTTP {status}: {json.dumps(errors)}')


class Cloudflare:
    def __init__(self, credentials):
        self.token = credentials['CLOUDFLARE_API_TOKEN']
        self.account = credentials['CLOUDFLARE_ACCOUNT_ID']
        self.zone = credentials['CLOUDFLARE_ZONE_ID']

    def call(self, method, path, data=None, content_type=None):
        headers = {'Authorization': 'Bearer ' + self.token}
        if data is not None and not isinstance(data, bytes):
            data = json.dumps(data).encode()
            content_type = 'application/json'
        if content_type:
            headers['Content-Type'] = content_type
        req = urllib.request.Request('https://api.cloudflare.com/client/v4' + path,
                                     data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            try:
                errors = json.load(error).get('errors', [])
            except (ValueError, AttributeError):
                errors = [{'message': 'Non-JSON error body omitted'}]
            raise APIError(error.code, errors) from None
        if not result.get('success'):
            raise APIError(200, result.get('errors', []))
        return result.get('result')

    def account_call(self, method, path, data=None, content_type=None):
        return self.call(method, '/accounts/' + self.account + path, data, content_type)


def credentials(path):
    env = dict(os.environ)
    env.setdefault('SOPS_AGE_KEY_FILE', str(Path.home() / '.config/sops/age/keys.txt'))
    result = subprocess.run(['sops', '--decrypt', '--input-type', 'dotenv', '--output-type',
                             'dotenv', str(path)], capture_output=True, text=True, env=env)
    if result.returncode:
        raise RuntimeError('SOPS decryption failed; credential output suppressed')
    return dict(line.split('=', 1) for line in result.stdout.splitlines()
                if '=' in line and not line.startswith('#'))


def access_uninitialized(error):
    return any('not_enabled' in e.get('message', '') for e in error.errors)


def multipart(metadata, source, modules=None):
    boundary = 'rescue-' + uuid.uuid4().hex
    body = bytearray()
    parts = [
        ('metadata', None, 'application/json', json.dumps(metadata)),
        ('worker.mjs', 'worker.mjs', 'application/javascript+module', source),
    ]
    parts.extend((name, name, 'application/javascript+module', text) for name, text in (modules or {}).items())
    for name, filename, kind, value in parts:
        body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"'.encode())
        if filename:
            body.extend(f'; filename="{filename}"'.encode())
        body.extend(f'\r\nContent-Type: {kind}\r\n\r\n{value}\r\n'.encode())
    body.extend(f'--{boundary}--\r\n'.encode())
    return bytes(body), 'multipart/form-data; boundary=' + boundary


def reconcile(cf, spec, apply=False):
    zone = cf.call('GET', '/zones/' + cf.zone)
    if zone['name'] != spec['zone'] or zone['account']['id'] != cf.account:
        raise RuntimeError('Account/zone mismatch; refusing mutation')
    try:
        org = cf.account_call('GET', '/access/organizations')
    except APIError as error:
        if not access_uninitialized(error):
            raise
        org = None
    databases = cf.account_call('GET', '/d1/database?per_page=100')
    database = next((d for d in databases if d['name'] == spec['database']), None)
    domains = cf.account_call('GET', '/workers/domains')
    domain = next((d for d in domains if d['hostname'] == spec['hostname']), None)
    if domain and domain['service'] != spec['name']:
        raise RuntimeError('Hostname belongs to a different Worker; refusing takeover')
    records = cf.call('GET', '/zones/' + cf.zone + '/dns_records?name=' + spec['hostname'])
    if records and not domain:
        raise RuntimeError('Existing DNS record without matching Worker domain; refusing takeover')
    print(json.dumps({'mode': 'apply' if apply else 'plan', 'hostname': spec['hostname'],
                      'access': 'reuse' if org else 'create organization (may require free-plan activation)',
                      'database': 'reuse' if database else 'create',
                      'worker': 'publish authenticated status page',
                      'domain': 'reconcile' if domain else 'create after Access protection',
                      'allowed_email_count': len(spec['allowed_emails'])}, ensure_ascii=False))
    if not apply:
        return
    # Access comes FIRST: do not provision a public application if authentication is blocked.
    if not org:
        org = cf.account_call('POST', '/access/organizations', {
            'name': 'WeChat Rescue', 'auth_domain': spec['access_team'] + '.cloudflareaccess.com',
            'session_duration': spec['session_duration']})
    providers = cf.account_call('GET', '/access/identity_providers')
    otp = next((p for p in providers if p['type'] == 'onetimepin'), None)
    if not otp:
        otp = cf.account_call('POST', '/access/identity_providers',
                              {'name': 'Rescue email code', 'type': 'onetimepin', 'config': {}})
    apps = cf.account_call('GET', '/access/apps?per_page=100')
    app = next((a for a in apps if a.get('domain') == spec['hostname']), None)
    if app and app['name'] != 'WeChat Rescue (IaC)':
        raise RuntimeError('Existing Access app is not owned by this stack')
    app_body = {'name': 'WeChat Rescue (IaC)', 'domain': spec['hostname'], 'type': 'self_hosted',
                'session_duration': spec['session_duration'], 'allowed_idps': [otp['id']],
                'auto_redirect_to_identity': False, 'http_only_cookie_attribute': True,
                'same_site_cookie_attribute': 'lax'}
    app_path = '/access/apps' + ('/' + app['id'] if app else '')
    app = cf.account_call('PUT' if app else 'POST', app_path, app_body)
    policies_path = '/access/apps/' + app['id'] + '/policies'
    policies = cf.account_call('GET', policies_path)
    if any(p['name'] != 'rescue-owner-emails' for p in policies):
        raise RuntimeError('Unexpected Access policies; refusing to publish')
    policy = next(iter(policies), None)
    cf.account_call('PUT' if policy else 'POST',
                    policies_path + ('/' + policy['id'] if policy else ''),
                    {'name': 'rescue-owner-emails', 'decision': 'allow', 'precedence': 1,
                     'include': [{'email': {'email': e}} for e in spec['allowed_emails']],
                     'exclude': [], 'require': []})
    if not database:
        database = cf.account_call('POST', '/d1/database', {'name': spec['database']})
    schema = (STACK / 'schema.sql').read_text()
    result = cf.account_call('POST', '/d1/database/' + database['uuid'] + '/query', {'sql': schema})
    if any(not r.get('success') for r in result):
        raise RuntimeError('D1 schema migration failed')
    metadata = {'main_module': 'worker.mjs', 'compatibility_date': '2026-10-01',
                'bindings': [
                    {'type': 'd1', 'name': 'DB', 'id': database['uuid']},
                    {'type': 'plain_text', 'name': 'DEVICE_ID', 'text': spec['device_id']},
                    {'type': 'plain_text', 'name': 'ACCESS_DOMAIN', 'text': org['auth_domain']},
                    {'type': 'plain_text', 'name': 'ACCESS_AUD', 'text': app['aud']},
                    {'type': 'plain_text', 'name': 'ALLOWED_EMAILS', 'text': json.dumps(spec['allowed_emails'])},
                ]}
    # Remote QR remains disabled until live adapter/intake acceptance is complete.
    metadata['bindings'].append({'type': 'plain_text', 'name': 'RESCUE_QR_ENABLED', 'text': 'false'})
    body, kind = multipart(metadata, (STACK / 'worker.mjs').read_text(),
                           {name: (STACK / name).read_text() for name in ('rescue.mjs', 'rescue-ui.mjs')})
    cf.account_call('PUT', '/workers/scripts/' + spec['name'], body, kind)
    cf.account_call('POST', '/workers/scripts/' + spec['name'] + '/subdomain',
                    {'enabled': False, 'previews_enabled': False})
    cf.account_call('PUT', '/workers/domains', {'hostname': spec['hostname'],
                    'service': spec['name'], 'environment': 'production', 'zone_id': cf.zone})
    print('Applied. Verify HTTPS, Access allowlist, workers.dev disabled, and D1 before completion.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--credentials', type=Path, help='Optional encrypted SOPS credential file')
    parser.add_argument('--env-file', type=Path)
    args = parser.parse_args()
    try:
        values = load_env(args.env_file)
        if not enabled(values):
            print('Cloudflare rescue disabled; no network or deployment changes.')
            return
        config = spec(values)
        reconcile(Cloudflare(cloudflare_credentials(values, args.credentials)), config, args.apply)
    except ConfigError as error:
        parser.exit(1, str(error) + '\n')
    except Exception:
        parser.exit(1, 'Rescue deployment failed; details suppressed to protect credentials.\n')


if __name__ == '__main__':
    main()
