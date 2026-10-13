# Optional rescue configuration

## Local only (default)

Use the ordinary setup in the README. No `.env` or Cloudflare credentials are required. The rescue scripts exit without network calls or changes when `WECHAT_RESCUE_ENABLED` is absent or `false`, including with `--apply`.

## Enable authenticated status monitoring

```bash
cp .env.example .env
chmod 600 .env
# Edit .env locally; never commit or share it.
python3 scripts/wechat_rescue_apply.py --env-file .env
python3 scripts/wechat_rescue_apply.py --env-file .env --apply
```

Set `WECHAT_RESCUE_ENABLED=true`, explicit comma-separated `WECHAT_RESCUE_ALLOWED_EMAILS`, `WECHAT_RESCUE_HOSTNAME`, `WECHAT_RESCUE_ZONE`, `WECHAT_RESCUE_ACCESS_TEAM` and `WECHAT_RESCUE_DEVICE_ID`. The hostname must be a subdomain of the configured zone. Worker and D1 names default to `wechat-rescue` and can be overridden. Only exact owner email addresses are accepted; no wildcard access.

Supply `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID` in private `.env` or process environment. Alternatively set `WECHAT_RESCUE_CREDENTIALS_FILE=/stable/private/cloudflare.env.sops` or use `--credentials /stable/private/cloudflare.env.sops` for the existing encrypted credential workflow; this requires SOPS locally. Environment variables override the selected dotenv file. Without `--env-file`, scripts optionally read `.env` from the current directory. Dotenv is parsed as literal data; no shell interpolation, command execution or multiline values.

Use a token scoped to the intended account/zone with permissions needed for Workers scripts/domains, D1, Access organization/apps/policies/identity providers and DNS inspection. Credentials are consumed locally by deployment/heartbeat scripts, never embedded in frontend code or committed. Worker receives only its D1 binding, Access verification settings, configured device ID and email allowlist.

Deploy first configures Access, then D1 schema, authenticated Worker and domain. workers.dev/preview access stays disabled. Plans perform reads only. Missing/invalid enabled configuration fails before network calls; foreign resource ownership is refused. Neither the local agent nor browser is started or restarted by these commands.

## Heartbeat (optional macOS install)

```bash
python3 scripts/wechat_rescue_install.py --env-file .env
python3 scripts/wechat_rescue_install.py --env-file .env --apply
```

The installer discovers D1 by configured name, copies helper code and a private mode-0600 `rescue.env` under `~/.local/share/wechat-rescue/`, and creates `com.wechat-agent.rescue-heartbeat`. Credentials are not passed in process arguments or the plist. The private snapshot includes plaintext credentials only when using dotenv/env authentication; prefer SOPS when available. It is a snapshot: edit that private config or rerun installation to propagate later `.env` changes.

Default observation source: `~/.local/share/wechat-agent/health.json`. Override `WECHAT_RESCUE_STATE_PATH` for another compatible source. External `deviceId` must match `WECHAT_RESCUE_DEVICE_ID`. The source contains state/time only; chats, browser auth and QR images are not read for heartbeat.

```bash
# Standalone: set WECHAT_RESCUE_DATABASE_ID in private .env first.
python3 scripts/wechat_rescue_heartbeat.py --env-file .env --dry-run
python3 scripts/wechat_rescue_heartbeat.py --env-file .env
```

Verify Access rejects unauthenticated page/API requests, allowlist is correct, and D1 `received_at` advances. Owner login and actual reconnect are manual acceptance steps. A monitored device can be online while its WeChat observation is stale; the UI must show unknown then.

## Existing installations and rollback

Preserve original Worker/database names, domain, Access tenant and device ID in private config before applying an upgrade. Existing D1 tables are not recreated: older single-device CHECK constraints remain, so keep the original ID or plan an explicit separately reviewed migration. New databases allow configured IDs; this script does not rename historical data.

A prior owner-specific launchd label is not silently replaced: stop that exact old job explicitly before installing a new generic label to avoid duplicate heartbeat publishers. Updating source alone does not alter an installed job or the live browser.

To stop a job installed by this version: `launchctl bootout gui/$(id -u)/com.wechat-agent.rescue-heartbeat`, then remove that job's plist if desired. Keep D1/Access data. Setting the flag false is a no-op, not an uninstall or cloud delete operation. Remote QR stays disabled pending its separate live acceptance requirements.
