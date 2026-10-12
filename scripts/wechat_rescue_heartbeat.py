#!/usr/bin/env python3
"""Read existing local status; publish only allowlisted telemetry to rescue D1."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
from wechat_rescue_apply import Cloudflare, credentials

DEVICE = 'work-mac-joey'
STATES = {'online', 'offline', 'disconnected', 'login_required', 'unknown'}
SQL = """INSERT INTO device_heartbeat
(device_id, connection_state, observed_at, received_at, recovered_at)
VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL)
ON CONFLICT(device_id) DO UPDATE SET
recovered_at = CASE WHEN excluded.connection_state = 'online'
 AND (device_heartbeat.connection_state != 'online'
 OR julianday(excluded.received_at)-julianday(device_heartbeat.received_at) > 90.0/86400)
 THEN excluded.received_at ELSE device_heartbeat.recovered_at END,
connection_state=excluded.connection_state, observed_at=excluded.observed_at,
received_at=excluded.received_at"""


def telemetry(state, now=None):
    now = now or datetime.now(timezone.utc)
    if not isinstance(state, dict):
        state = {}
    connection = state.get('connection')
    observed = state.get('lastObservedAt')
    try:
        if state.get('deviceId') != DEVICE or not isinstance(observed, str):
            raise ValueError('Invalid source')
        instant = datetime.fromisoformat(observed.replace('Z', '+00:00'))
        age = (now - instant).total_seconds()
        if not 0 <= age <= 90:
            raise ValueError('Stale observation')
        observed = instant.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    except (ValueError, TypeError, OverflowError):
        return {'device_id': DEVICE, 'connection_state': 'unknown', 'observed_at': None}
    return {'device_id': DEVICE, 'connection_state': connection if isinstance(connection, str) and connection in STATES else 'unknown',
            'observed_at': observed}


def publish(cf, database, payload):
    result = cf.account_call('POST', '/d1/database/' + database + '/query',
                            {'sql': SQL, 'params': [payload['device_id'], payload['connection_state'], payload['observed_at']]})
    if not result or any(not row.get('success') for row in result):
        raise RuntimeError('Heartbeat write failed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, default=Path.home()/'.local/share/zhumi/work-mac-joey/state.json')
    parser.add_argument('--credentials', type=Path, required=True)
    parser.add_argument('--database', required=True)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    try:
        state = json.loads(args.state.read_text())
    except (OSError, ValueError):
        state = {}
    payload = telemetry(state)
    if not args.dry_run:
        publish(Cloudflare(credentials(args.credentials)), args.database, payload)
    print(json.dumps({'result': 'dry-run' if args.dry_run else 'published', **payload}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Never dump credential-bearing API responses or local source contents.
        raise SystemExit('Heartbeat failed; check connectivity, encrypted credential access and D1 permissions.')
