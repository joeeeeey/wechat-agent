import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import wechat_rescue_config as c
import wechat_rescue_apply as deploy
import wechat_rescue_heartbeat as heartbeat
import wechat_rescue_install as install

VALID = {
    'WECHAT_RESCUE_ENABLED': 'true',
    'WECHAT_RESCUE_ALLOWED_EMAILS': 'owner@example.com, backup@example.com',
    'WECHAT_RESCUE_HOSTNAME': 'rescue.example.com',
    'WECHAT_RESCUE_ZONE': 'example.com',
    'WECHAT_RESCUE_ACCESS_TEAM': 'example-team',
    'WECHAT_RESCUE_DEVICE_ID': 'custom-computer',
}


class ConfigurationTests(unittest.TestCase):
    def test_disabled_all_entrypoints_ignore_missing_credentials_and_make_no_calls(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = Path(tmp)/'.env'
            env.write_text('WECHAT_RESCUE_ENABLED=false\n')
            for module in (deploy, heartbeat, install):
                with self.subTest(module=module.__name__), patch.dict(os.environ, {}, clear=True), \
                        patch.object(module, 'Cloudflare') as api, \
                        patch.object(module, 'cloudflare_credentials') as credentials, \
                        patch('sys.argv', ['command', '--env-file', str(env)]), \
                        contextlib.redirect_stdout(io.StringIO()):
                    module.main()
                    api.assert_not_called()
                    credentials.assert_not_called()
            with patch.dict(os.environ, {}, clear=True), patch.object(deploy, 'Cloudflare') as api, \
                    patch('sys.argv', ['command', '--env-file', str(env), '--apply']), \
                    contextlib.redirect_stdout(io.StringIO()):
                deploy.main()
                api.assert_not_called()

    def test_dotenv_environment_precedence_quotes_and_no_shell_evaluation(self):
        with tempfile.TemporaryDirectory() as tmp:
            env=Path(tmp)/'.env'
            env.write_text('export WECHAT_RESCUE_ENABLED="false"\nVALUE=\'$(do-not-execute)\'\n')
            values=c.load_env(env, {'WECHAT_RESCUE_ENABLED':'true'})
            self.assertTrue(c.enabled(values))
            self.assertEqual(values['VALUE'], '$(do-not-execute)')

    def test_disabled_is_default_and_invalid_boolean_fails_closed(self):
        self.assertFalse(c.enabled({}))
        with self.assertRaises(c.ConfigError):
            c.enabled({'WECHAT_RESCUE_ENABLED':'yes'})

    def test_invalid_enabled_configuration_stops_before_credential_or_network_access(self):
        for emails in ('', '*@example.com', 'invalid', 'a@example.com,'):
            with self.subTest(emails=emails), patch.dict(os.environ, {**VALID, 'WECHAT_RESCUE_ALLOWED_EMAILS':emails}, clear=True), \
                    patch.object(deploy, 'Cloudflare') as api, \
                    patch.object(deploy, 'cloudflare_credentials') as credentials, \
                    patch('sys.argv', ['command']), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    deploy.main()
                api.assert_not_called()
                credentials.assert_not_called()

    def test_custom_owner_and_device_reach_deployment(self):
        with patch.dict(os.environ, VALID, clear=True), patch.object(deploy, 'reconcile') as reconcile, \
                patch.object(deploy, 'Cloudflare') as api, \
                patch.object(deploy, 'cloudflare_credentials', return_value={}), \
                patch('sys.argv', ['command']):
            deploy.main()
            args=reconcile.call_args.args
            self.assertEqual(args[1]['allowed_emails'], ['owner@example.com','backup@example.com'])
            self.assertEqual(args[1]['device_id'], 'custom-computer')
            self.assertFalse(args[2])

    def test_native_health_source_and_custom_device_heartbeat(self):
        from datetime import datetime, timezone
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'health.json'
            source.write_text(json.dumps({'state':'connected','updatedAt':datetime.now(timezone.utc).isoformat()}))
            out=io.StringIO()
            with patch.dict(os.environ, VALID, clear=True), patch.object(heartbeat, 'Cloudflare') as api, \
                    patch('sys.argv', ['command','--state',str(source),'--dry-run']), contextlib.redirect_stdout(out):
                heartbeat.main()
                api.assert_not_called()
            result=json.loads(out.getvalue())
            self.assertEqual(result['device_id'],'custom-computer')
            self.assertEqual(result['connection_state'],'online')

    def test_wrong_external_device_is_unknown(self):
        result=heartbeat.telemetry({'deviceId':'wrong','connection':'online','lastObservedAt':'2026-10-13T00:00:00Z'},device='custom-computer')
        self.assertEqual(result['device_id'],'custom-computer')
        self.assertEqual(result['connection_state'],'unknown')

    def test_install_keeps_token_out_of_plist_and_writes_private_stable_config(self):
        import plistlib
        with tempfile.TemporaryDirectory() as tmp:
            values={**VALID,'CLOUDFLARE_API_TOKEN':'synthetic-test-token',
                    'CLOUDFLARE_ACCOUNT_ID':'test-account','CLOUDFLARE_ZONE_ID':'test-zone',
                    'CLOUDFLARE_UNRELATED_SECRET':'must-not-copy'}
            with patch.dict(os.environ, values, clear=True), patch.object(Path,'home',return_value=Path(tmp)), \
                    patch.object(install, 'Cloudflare') as api, patch.object(install.subprocess,'run') as run, \
                    patch('sys.argv',['command','--apply']), contextlib.redirect_stdout(io.StringIO()):
                api.return_value.account_call.return_value=[{'name':'wechat-rescue','uuid':'test-database'}]
                run.return_value.returncode=1
                install.main()
            config=Path(tmp)/'.local/share/wechat-rescue/rescue.env'
            self.assertEqual(config.stat().st_mode & 0o777,0o600)
            self.assertNotIn('must-not-copy',config.read_text())
            self.assertEqual(c.load_env(config,{})['CLOUDFLARE_API_TOKEN'],'synthetic-test-token')
            plist=Path(tmp)/'Library/LaunchAgents/com.wechat-agent.rescue-heartbeat.plist'
            self.assertNotIn(b'synthetic-test-token',plist.read_bytes())
            args=plistlib.loads(plist.read_bytes())['ProgramArguments']
            self.assertIn(str(config),args)


if __name__ == '__main__':
    unittest.main()
