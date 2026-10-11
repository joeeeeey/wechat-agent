# Future fixed-URL rescue channel

Not implemented or deployed in v0.1. The runtime only writes local `health.json` with connection state and timestamp; nobody is notified remotely when WeChat drops.

A future user-supplied domain can host an authenticated status/rescue page. Do not publish an unauthenticated QR code or browser debugging port. Require owner authentication, short-lived explicit login attempts, TLS, expiry, CSRF protection and rate limits. Show stale heartbeat distinctly from a confirmed logout. Keep recovery separate from the task executor and pause task intake during reauthentication.

A QR displayed on the same phone cannot necessarily be scanned with that phone; test the exact WeChat flow and provide a second-screen path. Do not promise login recovery until this has been verified. Recovery navigation must be explicit, never a periodic refresh of a healthy session.

Pending: domain, hosting/access choice, owner authentication, and verified account-compatible scan flow. This phase does not export QR codes from the current session.
