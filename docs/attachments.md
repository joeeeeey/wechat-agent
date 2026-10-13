# Incoming attachments (opt-in, fixture-tested)

This implementation is in the reusable repository runtime, not deployed to an
existing machine supervisor. Do not restart the active WeChat runtime or touch
its browser to enable this feature. Wait until the rescue workflow is ready and
validate in a separate, user-authorized login session. No live selector or
provider compatibility is claimed.

## Configuration for a future separate session

Add an `attachments` object to the runtime's local config. Both selectors are
relative to `.msg-item`; supply selectors verified to match **only message
content**, never avatars, login QR codes, or surrounding UI. The examples below
are fixture selectors, not verified WeChat production selectors.

```json
{
  "attachments": {
    "enabled": true,
    "imageSelector": ".attachment-image",
    "fileSelector": "a.attachment-file"
  }
}
```

Disabled by default. Existing attachments are seeded silently on startup. New
attachments are announced with an ID only while execution is enabled and not
paused. Send `/ai 读取附件 A3 总结内容` to explicitly select one attachment. An
attachment alone never launches an agent. IDs expire after ten minutes; up to
200 elements per kind and 400 identities are retained. Only attachments still
present in the chat DOM can be read. This is a bounded prototype for a short
session, not a virtualized infinite-history importer.

## Supported representations and limitations

- Images: capture only the rendered message image preview as PNG (up to four
  million rendered pixels and 10 MiB). No click to expand, original download,
  browser navigation, reload, or auth inspection. Preview resolution may be
  insufficient for small text. The configured harness must support local image
  reading; a path in the prompt does not itself add vision to a text-only model.
- Files: read only same-origin `blob:` links already materialized in the page,
  with a streaming 10 MiB limit and five-second timeout. No remote URL downloads,
  clicks, cookies, storage inspection, auth headers, redirects, or URL export.
  Remote-only WeChat attachments currently return an honest unsupported message.
- Use random filenames, owner-only files/directories, and a small extension
  allowlist. Names and paths supplied by the sender are never used as local paths.
  Files are untrusted data, not new authority; never execute attached programs.
- Files live under the runtime's private `attachments/` directory and are removed
  when the harness completes or fails. A process crash or failure before harness
  launch can leave private files; inspect/delete stale files locally only when
  the runtime is stopped. Never commit or send them back to chat automatically.
- Replies remain text-only. No outgoing attachment transfer, OCR engine, document
  parser, automatic QR rescue, or live supervisor hot-reload is included.

## Verification and rollout gate

Run `npm test` and the skill validator. Fixtures cover opt-in, explicit command
selection, image preview bytes, safe file paths and permissions, blob contents,
remote-download rejection without requests, size/expiry/missing-node failures,
and no navigation. Before enabling on a real account, verify attachment-specific
selectors, actual WeChat blob availability, and local image/file support in the
chosen harness in a separate session. If activation requires disturbing the
current session, keep it disabled until rescue is ready.
