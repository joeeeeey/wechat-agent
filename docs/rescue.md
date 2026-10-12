# Authenticated rescue status channel

The optional Cloudflare Worker + D1 + Access stack and independent macOS heartbeat are managed in this repository. See [deployment and operations](runbook/wechat-rescue.md).

The current deployment is https://wechat-rescue.critdeck.com. It shows device freshness, observed WeChat state, and recovery confirmation after manual login. Remote QR rescue is implemented as a disabled prototype; see [prototype and acceptance](runbook/remote-qr-rescue.md). Production still has no remote login or QR display. No browser navigation or automatic recovery is implemented.

The heartbeat currently reads the existing Zhumi `state.json` on work-mac-joey; it is not an adapter for this repository runtime’s `health.json`. Other installations must supply a compatible observation source before claiming live monitoring.

## Migration provenance

Migrated from joeeeeey/ai-relays PR #30, commits `f25a6234723f513f55300e281cc90143f5636612` and `e3e939c0ee81c2ebcfe56d3d229eb81a15cafc53`. This repository is now the source of truth for rescue code and IaC. Cloud resource names and runtime script contents are preserved; no resource recreation or browser operation is needed.

Credentials remain external. Always pass `--credentials /stable/private/path/to/cloudflare.env.sops`; do not copy credentials into this repository. The existing independent heartbeat may continue using its original stable encrypted credential path until credentials are relocated separately.

Run `npm test`, `python3 -m unittest discover -s scripts -p 'test_wechat_rescue*.py'`, and the skill validator. Owner email OTP login and real manual WeChat logout/login remain live acceptance checks.
