"""Opt-in rescue configuration. Dotenv is data: never source or execute it."""
import os
import re
from pathlib import Path


class ConfigError(ValueError):
    pass


def load_env(file=None, environ=None):
    values = {}
    target = Path(file) if file else Path.cwd() / '.env'
    if file or target.exists():
        for number, raw in enumerate(target.read_text().splitlines(), 1):
            line = raw.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith('export '):
                line = line[7:]
            key, sep, value = line.partition('=')
            if not sep or not re.fullmatch(r'[A-Z_][A-Z0-9_]*', key.strip()):
                raise ConfigError(f'Invalid dotenv syntax at line {number}')
            value = value.strip()
            if value.startswith(('"', "'")):
                if len(value) < 2 or value[-1] != value[0]:
                    raise ConfigError(f'Invalid dotenv quote at line {number}')
                value = value[1:-1]
            else:
                value = value.split(' #', 1)[0].rstrip()
            values[key.strip()] = value
    values.update(dict(os.environ if environ is None else environ))
    return values


def enabled(values):
    value = values.get('WECHAT_RESCUE_ENABLED', 'false').lower()
    if value not in ('true', 'false'):
        raise ConfigError('WECHAT_RESCUE_ENABLED must be true or false')
    return value == 'true'


def required(values, key):
    value = values.get(key, '').strip()
    if not value:
        raise ConfigError(f'Missing {key}')
    return value


def device_id(values):
    value = required(values, 'WECHAT_RESCUE_DEVICE_ID')
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', value):
        raise ConfigError('Invalid WECHAT_RESCUE_DEVICE_ID')
    return value


def spec(values):
    hostname = required(values, 'WECHAT_RESCUE_HOSTNAME').lower()
    zone = required(values, 'WECHAT_RESCUE_ZONE').lower()
    for key, value in [('WECHAT_RESCUE_HOSTNAME', hostname), ('WECHAT_RESCUE_ZONE', zone)]:
        if not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', value):
            raise ConfigError(f'Invalid {key}')
    if not hostname.endswith('.' + zone):
        raise ConfigError('WECHAT_RESCUE_HOSTNAME must be a subdomain of WECHAT_RESCUE_ZONE')
    emails = [e.strip().lower() for e in required(values, 'WECHAT_RESCUE_ALLOWED_EMAILS').split(',')]
    if not emails or any(not re.fullmatch(r'[^\s@,]+@[^\s@,]+\.[^\s@,]+', e) or '*' in e for e in emails):
        raise ConfigError('Invalid WECHAT_RESCUE_ALLOWED_EMAILS; use explicit comma-separated email addresses')
    team = required(values, 'WECHAT_RESCUE_ACCESS_TEAM')
    name = values.get('WECHAT_RESCUE_WORKER_NAME', 'wechat-rescue')
    database = values.get('WECHAT_RESCUE_DATABASE_NAME', 'wechat-rescue')
    if any(not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,62}', v) for v in [team, name, database]):
        raise ConfigError('Invalid rescue Worker, database or Access team name')
    return dict(name=name, hostname=hostname, zone=zone, database=database,
                access_team=team, session_duration='1h', allowed_emails=list(dict.fromkeys(emails)),
                device_id=device_id(values))


def cloudflare_credentials(values, encrypted=None):
    encrypted = encrypted or values.get('WECHAT_RESCUE_CREDENTIALS_FILE')
    if encrypted:
        from wechat_rescue_apply import credentials
        return credentials(encrypted)
    return {key: required(values, key) for key in
            ('CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ZONE_ID')}
