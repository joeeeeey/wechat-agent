# Optional Cloudflare rescue/status service

The local File Helper agent has no Cloudflare dependency. Keep `WECHAT_RESCUE_ENABLED=false` (the default) to run locally without a Cloudflare account, domain, token or D1 database. A roughly 24-hour WeChat login lifetime is an observation, not a guaranteed TTL; users can manually log in again when needed.

For authenticated off-device status monitoring, opt in with a private `.env` file. Only then do deployment and heartbeat commands require Cloudflare Workers, D1, Access and a domain. See [configuration and deployment](runbook/wechat-rescue.md). Real owner emails, domains and device IDs belong in private configuration, not tracked source. `.env.example` contains only examples; `.env` is ignored by Git.

The heartbeat accepts this repository's `health.json` (`state`, `updatedAt`) and compatible external observations (`deviceId`, `connection`, `lastObservedAt`). A stale/missing source reports unknown. A generic disconnected observation is not proof of a login screen.

QR relay is optional. Set `WECHAT_RESCUE_QR_ENABLED=true` in the private environment and `rescue.qrEnabled: true` plus `rescue.envFile` in watch config. The installed browser adapter uses an existing logged-out page or stages a separate login page for an online connection, publishes encrypted QR updates only for an authenticated owner request, and resumes new-message intake after observing login. Status monitoring alone does not enable QR capture. See [integration and acceptance](runbook/remote-qr-rescue.md).

Turning the local flag off prevents subsequent deployment/heartbeat/install commands from using Cloudflare; it does not delete existing resources, remove an installed job or change an already-deployed Worker. Stop an existing heartbeat explicitly if needed. This configuration change does not remove data from previously published Git commits or PR history.
