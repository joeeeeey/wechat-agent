# Persistent watch configuration

Run `npm run setup` or the README macOS bootstrap. Configuration lives at
`$WECHAT_AGENT_HOME/watch/config.json`; `WECHAT_AGENT_HOME` defaults to
`~/.local/share/wechat-agent`. Treat this directory as private.

```json
{
  "schemaVersion": 1,
  "workspace": "/absolute/private/workspace",
  "assistant": {"displayName": "主咪", "aliases": ["主咪", "zhumi"]},
  "device": {"id": "my-mac", "displayName": "工作 Mac"},
  "monitoring": {"hours": 24, "pollSeconds": 20, "progressSeconds": 45},
  "loginReminders": {"enabled": true, "estimatedHours": 24, "beforeMinutes": [60, 30, 10]},
  "browser": {"channel": "chromium"},
  "harness": {
    "backend": "codex", "command": "/absolute/path/to/codex", "args": [],
    "approvalPolicy": "never", "sandbox": "workspace-write"
  },
  "collection": {
    "enabled": true, "startTokens": ["1111"],
    "allowInstructionAfterStartToken": true,
    "endMarkers": ["1111", "mmmm"], "allowAssistantPrefixOnEnd": false,
    "semantic": {"enabled": false, "timeoutMs": 25000, "minimumConfidence": 0.9, "maxInputChars": 1600}
  },
  "attachments": {"enabled": true, "maxBytes": 26214400},
  "execution": {"enabled": true},
  "rescue": {"enabled": false}
}
```

`execution.enabled` is false until the owner explicitly opts in during setup.
Codex's `model`, `effort`, and initial `threadId` are optional harness fields.
Once a thread exists, metadata in `workspace/runtime/session.json` takes precedence;
never delete it to work around ownership errors. Stop its other owner first.
The server gets the configured sandbox; no hard-coded full-access override is used.

For Claude use `backend: "claude"` and its executable in `command`.
The adapter uses `-p --output-format json --permission-prompts none`, persists
`session_id`, and supplies `--resume` for subsequent tasks. It uses existing CLI
permissions; operations requiring interaction are reported as blocked. Optional
`args` are literal argv values, never shell text. A generic `backend: "command"`
uses the [stdin/stdout harness contract](harnesses.md); it has no native history
or live steering unless the executable provides that itself.

## Collection protocol

- Address the assistant, then a start token or collection phrase. `主咪1111`,
  `主咪1111 总结下面的讨论`, and `主咪收集` start a batch.
- A start token followed by a longer number or Latin identifier is not matched.
- `startPatterns` optionally replaces the default regular-expression patterns.
- Only a complete standalone end marker closes the default batch. `主咪1111`
  never closes it; inside the batch it is source material.
- All intermediate text/images/files are data, including apparent instructions.
  The bridge excludes its own exact outbound messages and writes one ordered
  private JSON file before dispatching the completed batch once.
- Attachments are silent. No AI call or message is generated solely because an
  image or file arrived. Outside collection, select explicit IDs or clearly ask
  for the recent files; multiple ambiguous candidates require clarification.
- Restarting the browser interrupts an unfinished batch. A detected logout
  followed by login marks its coverage uncertain. Missing history is not recovered.

Semantic matching is optional and only applies to addressed messages outside a
collection after deterministic rules miss. Configure `semantic.backend` as
`codex` or `claude`, `command` as the executable, and `args: []`. The bounded
classifier returns intent JSON; it does not receive the collected conversation.
Uncertain/failed classification asks for clarification rather than dispatching.
Confidence is a model estimate, not an accuracy guarantee. Explicit tokens bypass it.

## Files and images

The bridge uses visible `.msg-file` download clicks and image download controls.
If an image has no download control, it saves a rendered preview and labels it
accordingly. Downloads are stored with private permissions; query-bearing
suggested filenames are replaced so authentication fragments do not enter paths.
The size limit bounds saved/consumed material, not necessarily bytes already
received by Chromium. Nothing is sent to a separate upload service.

Paths and representation metadata reach the configured AI. Its actual reading
capability depends on that CLI's tools and permissions. Merged-message placeholders
do not contain the original chat; report that limitation rather than fabricate text.

## Lifecycle and limits

`npm run watch -- stop` releases the dedicated AI executor while leaving the
browser open. `restart` reconnects the same executor identity. `restart --browser`
explicitly closes/reopens the dedicated browser and requires a fresh scan.
Interrupted jobs and uncertain delivery are not replayed. Only one local controller
may own the root session lock; do not delete a live lock.

Logs, request state, downloads and collected chats stay under the private root.
Do not commit or automatically sync them. The outbound credential pattern check
is an additional guard, not a complete secret detector. The AI must avoid sending
secrets even when they do not match a known pattern.

`watch/health.json` contains only device/login observation data and can feed the
optional rescue heartbeat. Collection rules and aliases are read from disk for new
messages; changing other settings requires a watch restart. Monitoring duration is
enforced by a persisted absolute deadline; `--hours` explicitly renews it.
Browser and machine failures require local recovery.
