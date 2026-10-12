import importlib.util
import unittest
from pathlib import Path

module_spec = importlib.util.spec_from_file_location('rescue', Path(__file__).with_name('wechat_rescue_apply.py'))
m = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(m)
SPEC = {'name': 'wechat-rescue', 'hostname': 'wechat-rescue.critdeck.com', 'zone': 'critdeck.com',
        'database': 'wechat-rescue', 'access_team': 'critdeck-rescue', 'session_duration': '1h',
        'allowed_emails': ['owner@example.com']}


class FakeCF:
    zone, account = 'zone', 'account'
    def __init__(self, wrong_account=False, occupied=False):
        self.calls = []
        self.wrong_account, self.occupied = wrong_account, occupied
    def call(self, method, path, data=None):
        self.calls.append((method, path))
        if path == '/zones/zone':
            return {'name': 'critdeck.com', 'account': {'id': 'wrong' if self.wrong_account else self.account}}
        return []
    def account_call(self, method, path, data=None):
        self.calls.append((method, path))
        if path == '/access/organizations':
            raise m.APIError(403, [{'message': 'access.api.error.not_enabled'}])
        if path == '/workers/domains' and self.occupied:
            return [{'hostname': SPEC['hostname'], 'service': 'unrelated'}]
        return []


class SafetyTests(unittest.TestCase):
    def test_plan_is_read_only(self):
        cf = FakeCF()
        m.reconcile(cf, SPEC)
        self.assertTrue(all(method == 'GET' for method, _ in cf.calls))

    def test_access_failure_prevents_public_resource_creation(self):
        cf = FakeCF()
        with self.assertRaises(m.APIError):
            m.reconcile(cf, SPEC, apply=True)
        self.assertEqual([(method, path) for method, path in cf.calls if method != 'GET'],
                         [('POST', '/access/organizations')])

    def test_wrong_account_stops_before_mutation(self):
        cf = FakeCF(wrong_account=True)
        with self.assertRaisesRegex(RuntimeError, 'mismatch'):
            m.reconcile(cf, SPEC, apply=True)
        self.assertEqual(len(cf.calls), 1)

    def test_existing_domain_cannot_be_taken_over(self):
        cf = FakeCF(occupied=True)
        with self.assertRaisesRegex(RuntimeError, 'takeover'):
            m.reconcile(cf, SPEC, apply=True)
        self.assertTrue(all(method == 'GET' for method, _ in cf.calls))


if __name__ == '__main__':
    unittest.main()
