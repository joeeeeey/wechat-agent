from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import unittest
from wechat_rescue_heartbeat import telemetry, SQL


class HeartbeatTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 12, 16, tzinfo=timezone.utc)
        self.source = {'deviceId': 'work-mac-joey', 'connection': 'online',
                       'lastObservedAt': '2026-10-12T15:59:50Z', 'requests': ['PRIVATE'], 'token': 'SECRET'}

    def test_allowlist(self):
        result = telemetry(self.source, self.now)
        self.assertEqual(result['connection_state'], 'online')
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertNotIn('SECRET', json.dumps(result))
        self.assertEqual(len(result), 3)

    def test_stale_future_invalid_missing_wrong_device(self):
        for change in ({'lastObservedAt': '2026-10-12T15:58:00Z'},
                       {'lastObservedAt': '2026-10-12T16:01:00Z'},
                       {'lastObservedAt': 'bad'}, {'lastObservedAt': None},
                       {'lastObservedAt': '2026-10-12T15:59:50'}, {'deviceId': 'other'}):
            self.assertEqual(telemetry({**self.source, **change}, self.now)['connection_state'], 'unknown')
        self.assertEqual(telemetry({}, self.now)['connection_state'], 'unknown')

    def test_untrusted_state(self):
        self.assertEqual(telemetry({**self.source, 'connection': '<script>'}, self.now)['connection_state'], 'unknown')

    def test_recovery_only_after_transition(self):
        db = sqlite3.connect(':memory:')
        db.executescript((Path(__file__).resolve().parents[1]/'infra/cloudflare/wechat-rescue/schema.sql').read_text())
        def write(state):
            db.execute(SQL, ('work-mac-joey', state, '2026-10-12T15:59:50Z'))
            return db.execute('SELECT recovered_at FROM device_heartbeat').fetchone()[0]
        self.assertIsNone(write('online'))
        self.assertIsNone(write('disconnected'))
        recovery = write('online')
        self.assertIsNotNone(recovery)
        self.assertEqual(write('online'), recovery)
        db.execute("UPDATE device_heartbeat SET received_at='2000-01-01T00:00:00Z', recovered_at=NULL")
        self.assertIsNotNone(write('online'))


if __name__ == '__main__':
    unittest.main()
