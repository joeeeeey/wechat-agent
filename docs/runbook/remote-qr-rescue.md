# Remote QR rescue prototype — not activated

R039 explicitly authorizes development and verification. The current remote session also forbids operating the existing WeChat browser, reading/exporting its QR, or changing the supervisor without a specific integration request. This implementation therefore runs only against isolated fixtures. It is not a claim that real WeChat remote login works.

## Implemented path

1. Access authenticates the owner before serving any rescue HTML, script or API. `RESCUE_QR_ENABLED` defaults off; the deployment script explicitly sets it to `false`.
2. The owner clicks start. The page creates an RSA-2048 key pair in memory and sends only its public key. POSTs require exact same Origin, JSON and a custom intent header. Request bodies are limited to 2 KiB.
3. An atomic D1 statement admits a single request only when both device heartbeat and confirmed `login_required` observation are fresh (90 seconds), with a five-minute device-wide cooldown. Online, unknown, stale and merely disconnected states cannot trigger rescue.
4. An explicitly integrated device caller invokes `RescueDevice.tick()`. It atomically claims the attempt, verifies the existing screen is a login screen, pauses intake and checks acknowledgement. It rechecks cancellation, expiry and the screen before reading just the verified square QR element. No navigation, reload, click, browser discovery or browser attach exists in this module.
5. A PNG of at most 64 KiB is encrypted with AES-GCM, bound to the attempt ID; its AES key is wrapped with the initiating page's RSA public key. Only the encrypted envelope enters D1. No private browser key, plaintext QR, cookies, session storage or chat transcript is sent to D1.
6. Only the initiating owner can fetch the envelope; only that page's in-memory private key can decrypt it. The image uses a Blob URL, never HTML injection, localStorage or an external image host. Leaving the page loses the key. A second allowlisted owner cannot access or cancel the first owner's attempt.
7. Attempts last at most two minutes. The UI clears its image on cancel, expiry, page exit, backgrounding or a failed API call. On returning to the page it checks server state before displaying again. Server reads suppress expired payloads. Device/API activity marks expired rows and clears encrypted payloads; this is lazy cleanup, not a promise of physical deletion at the exact expiry time. Database history may retain ciphertext, never the private key.
8. Only observation of the chat editor marks completion; QR disappearance is not success. Terminal states clear the encrypted envelope and public key. Late writes are fenced by attempt ID, prior state and expiry. Intake stays paused until a human confirms resume; no interrupted task is replayed.

## Modules and integration contract

- `infra/cloudflare/wechat-rescue/rescue.mjs`: authenticated API handler, D1 state transitions and envelope cryptography. Call through the Worker, never directly as an unauthenticated HTTP handler.
- `rescue-ui.mjs`: owner controls, in-memory key and display lifecycle.
- `src/rescue-device.js`: one tick at a time; `ExistingLoginScreen` requires an already-supplied page and verified `online`, `login`, `qr` selectors. It screenshots only the bounded element. It is a library, not an installed service.
- `src/rescue-d1.js`: device-side D1 management API client with explicit externally supplied account, database and credential. No new public device write endpoint. Existing Cloudflare credentials are broad account-level credentials; least-privilege device provisioning is a remaining deployment concern.
- The caller must supply an intake adapter implementing `pause(attemptId)` and `isPaused(attemptId)`. It must durably prevent new task dispatch across reconnects/restarts. A no-op or in-memory stub is acceptable only in fixtures.
- Production currently has no installed caller, verified WeChat login selectors, or supervisor pause adapter. Nothing in this PR changes the running supervisor or heartbeat. Worker deployment includes imported modules, but keeps this feature off.

## Verified locally

`npm test` runs real in-memory SQLite state transitions plus new isolated Chromium instances. Fixtures contain a plain colored square and a one-pixel test image, not a real login QR. Tests cover authorization, feature disablement, origin checks, invalid bodies, fresh-state gating, competing requests, cooldown, owner-scoped cancellation, encryption key/attempt binding, expiry, late writes, pause acknowledgement, login confirmation and UI decryption/cancellation. Python tests check deployment multipart module packaging and existing status/heartbeat behavior.

## Live acceptance still required

Use a separately authorized local integration session; do not weaken the current File Helper browser restrictions or restart a healthy session to test this prototype.

1. Supply and verify a durable supervisor intake pause/resume adapter. Verify no task can begin during rescue and no previous task is replayed afterward.
2. Use a deliberately designated test WeChat session, never the healthy work session. Verify actual login selectors and that the QR is rendered in a bounded screenshot-compatible element. Missing/expired QR means stop; this prototype cannot click refresh or navigate to obtain one.
3. Check real API access with the selected device credential and deploy initially with rescue off. Confirm Access email OTP for the owner, all endpoints protected, and existing status monitoring unchanged.
4. Explicitly activate the flag only with the adapter ready. Observe confirmed logout, request rescue from a second display, scan with phone WeChat and confirm login on the phone. Verify the actual account supports this login path; a QR on the same phone may require another screen.
5. Verify server expiry, cancellation, stale heartbeat, device loss and Access expiry clear usable rescue display. Verify actual login marks completion, then manually resume intake after confirming session identity.
6. Record live evidence without QR pixels, credentials or transcripts. Only after those checks can remote recovery be called accepted.

Rollback: turn off `RESCUE_QR_ENABLED`, stop only the new device caller and clear active attempts. Keep Access and existing heartbeat intact. No existing browser should be restarted as part of rollback.
