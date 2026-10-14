# Remote QR recovery

The persistent watch now supplies the real device caller, verified File Helper
login selectors, durable intake gate and automatic recovery after observed login.
Multi-device routing is not implemented; each deployed Worker targets its
configured DEVICE_ID.

## Configure

Keep credentials in a private .env or the existing encrypted SOPS file. Set:

```text
WECHAT_RESCUE_ENABLED=true
WECHAT_RESCUE_QR_ENABLED=true
WECHAT_RESCUE_DEVICE_ID=your-existing-device-id
WECHAT_RESCUE_DATABASE_ID=your-deployed-d1-uuid
```

Resolve the database ID after deployment with
`python3 scripts/wechat_rescue_runtime_config.py --env-file /private/rescue.env`.
Local watch configuration must contain:

```json
{"rescue":{"enabled":true,"qrEnabled":true,"envFile":"/private/rescue.env"}}
```

Use the guided setup or deploy with `scripts/wechat_rescue_apply.py --env-file
/private/rescue.env --apply`. QR is off by default. The Access-protected site and
all its APIs require the configured owner email; workers.dev remains disabled.
A local opt-in requires a deliberate browser-service start/upgrade to attach the
caller. Do not restart a healthy browser merely to inspect the status page.

## Owner flow

1. Open the rescue site and complete its email login.
2. Click “生成登录二维码”, including while WeChat is online. For an online
   session the Mac prepares a separate headless login page, preserving the current
   page until the new login succeeds. For an already-logged-out session it reads the existing
   `.qrcode img.qrcode-img` inside `.login-scan__panel`; a visible chat editor
   always means online and cannot trigger QR capture.
3. The browser process persists an intake pause; a running supervisor acknowledges
   it before pixels are read. Both bridge message processing and task dispatch
   honor the gate across process restarts. Existing tasks are not replayed.
4. The QR alone is encrypted to the requesting browser's temporary public key.
   Only ciphertext reaches D1. Changed QR pixels replace the image; unchanged
   pixels are not republished. A visible expired-QR refresh button may be clicked
   at most once per 30 seconds during this owner-requested attempt. No page reload,
   cookie export, direct login-protocol emulation or background login is used.
5. Scan from WeChat on a second screen and confirm on the phone. The live Mac's
   chat editor is the success signal. A staged login then replaces the old browser
   connection; the same AI thread/workspace and request IDs remain. Cancellation
   discards the staged page and retains the current connection. The QR is cleared; intake resumes after
   baselining messages visible during recovery. Collection gaps are marked.

The visible owner page renews its display lease every 30 seconds. QR changes
continue while it stays visible; leaving/backgrounding the page stops renewal
and the lease expires within two minutes. After expiry the owner can request a
new one. Only one attempt is active per device and requests have a five-second
cooldown. Cancel, expiration, page backgrounding or API failure hides the image.
Browser keys stay in memory and are lost on page exit. Authentication failure
never falls back to a public image URL. If the QR cannot be read, it is hidden.

## Operations and validation

`watch/rescue-health.json` records enabled/status/last-check/pause information
and the count of browser contexts pending cleanup. Closing a retired browser runs
in the background: a stalled Chromium shutdown cannot hold intake paused.
Recovery is marked completed only after intake has resumed successfully.
The browser caller runs every five seconds independently of the fixed task poll
interval. Health and credentials remain in the private runtime directory.
A malformed pause record fails closed. If cloud access is unavailable, the caller
reports unavailable; the logged-in page is retained. Manual login can clear an
existing rescue pause after the bridge has baselined the resumed page, even if
cloud reconciliation is temporarily unavailable. An expired monitoring deadline
still needs local explicit renewal; rescue does not extend it.

Isolated tests exercise encrypted updates, cancellation/expiry fencing, UI image
replacement, pause across startup, no paused-message replay, verified login and
QR-only refresh without navigation. Real login selectors and bounded PNG capture
were checked against File Helper on 2026-10-13. End-to-end owner scan acceptance
must be recorded separately from fixture tests.

Rollback: disable the Worker QR flag and local rescue.qrEnabled, stop the caller
on the next controlled browser-service change, and retain Access/heartbeat.
Never remove a pause gate blindly; first verify local login and baseline intake.
