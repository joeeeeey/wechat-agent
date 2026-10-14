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
  "response": {"language": "中文", "style": "简短"},
  "monitoring": {"hours": 24, "pollSeconds": 20, "progressSeconds": 45},
  "loginReminders": {"enabled": true, "estimatedHours": 24, "beforeMinutes": [60, 30, 10]},
  "browser": {"channel": "chromium"},
  "harness": {
    "backend": "codex", "command": "/absolute/path/to/codex", "args": [],
    "approvalPolicy": "never", "sandbox": "workspace-write"
  },
  "collection": {
    "enabled": true, "maxMessages": 30, "startTokens": ["1111"],
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

## WeChat system commands

The persistent watch recognizes these fixed commands independently of configured
assistant aliases. These commands do not invoke the AI or semantic classifier:

| Command | Behavior |
| --- | --- |
| `/ai` or `/ai help` | List commands and examples |
| `/ai config` | Show editable preferences and read-only intervals, without executable arguments, credentials or private paths |
| `/ai config set FIELD VALUE` | Validate and atomically save a preference |
| `/ai status` | Show browser/monitor status, current deadline, interval and backend |
| `/ai TASK` | Submit an addressed task using a stable prefix |

`FIELD` accepts either the canonical key below or its Chinese name. JSON arrays,
numbers and booleans retain their types; unquoted text is accepted for strings.
For example, `/ai config set 回复风格 详细` and
`/ai config set 结束符 ["1111","done"]`.

| Key | Chinese name | Accepted value |
| --- | --- | --- |
| `assistant.displayName` | 助手名 | Nonempty single-line text, up to 100 characters |
| `assistant.aliases` | 唤醒词 | 1–20 nonempty names |
| `device.displayName` | 机器名 | Nonempty single-line text, up to 100 characters |
| `response.language` | 语言 | Language name |
| `response.style` | 回复风格 | `简短` or `详细` |
| `monitoring.pollSeconds` | 检查间隔 | Read-only in WeChat/AI; local config and restart required (default 20 seconds) |
| `monitoring.progressSeconds` | 进度间隔 | Read-only in WeChat/AI; local config and restart required (default 45 seconds) |
| `monitoring.hours` | 接收时长 | 0.01–168 hours; initial default only, never renews an existing deadline |
| `collection.enabled` | 收集开关 | Boolean |
| `collection.maxMessages` | 收集上限 | Integer 1–1000; default 30, captured when each batch starts |
| `collection.startTokens` | 开始标记 | 1–20 strings, each up to 80 characters |
| `collection.endMarkers` | 结束符 | 1–20 strings, each up to 80 characters |
| `collection.allowInstructionAfterStartToken` | 开始后附带说明 | Boolean |
| `collection.semantic.enabled` | 语义识别 | Boolean; enabling requires a classifier already configured locally |
| `loginReminders.enabled` | 登录提醒 | Boolean |
| `loginReminders.estimatedHours` | 预计登录时长 | 1–168 hours |
| `loginReminders.beforeMinutes` | 提前提醒分钟 | 1–10 numbers, each 1–10080 minutes |
| `attachments.enabled` | 附件读取 | Boolean |
| `attachments.maxBytes` | 附件大小上限 | Integer bytes, 1–1073741824 |

Renaming the assistant adds the new name to aliases while retaining old ones.
An explicit aliases edit replaces that list. `/ai` remains available in either case.
The bridge reads settings for new messages/downloads; the supervisor reloads live
preferences about once a second and reads preferences
before each new task. Reply language/style guide subsequent AI turns; native
system replies and automatic progress notices remain Chinese. Running AI turns
are not restarted. Progress checks have five-second granularity. Login reminders
already sent are not replayed. An open collection retains its original end markers and message limit.
Polling and progress intervals are captured at startup: neither native commands
nor AI config RPC can change them. Even a raw config-file edit cannot change a
running timer; a deliberate local watch restart is required. `/ai status` shows
the running poll interval, while `/ai config` shows saved local interval values.
Changing `monitoring.hours` only supplies the initial default when no saved deadline
exists. `start`/`restart` retain an existing deadline; local `start --hours N` renews it.

Natural-language requests such as “主咪，把回复风格改为详细” use the configured
AI and the same validated interface. The turn prompt describes a private JSON
file passed to `node src/watch/control.cjs /absolute/command.json`:

```json
{"action":"config","operation":"get"}
```

The result contains safe editable `values`, interval values in `readOnly`, and a `revision`. Apply only explicitly requested
changes using that revision and the current direct request ID:

```json
{"action":"config","operation":"set","requestId":"R001","expectedRevision":"revision returned by get","patch":{"response.style":"详细"}}
```

Stale revisions, invalid values, unsupported keys, completed requests and collected
material requests are rejected without a partial write. The executor should use
this interface instead of raw file edits and report its actual result. Natural
language quality and control-client access depend on the installed CLI and its
permissions. Polling/progress intervals, workspace, device ID, harness, browser, execution and rescue settings
are local-only. This allowlist is an interface boundary, not a sandbox for a
privileged local executor.

## Collection protocol

- Address the assistant, then a start token or collection phrase. `主咪1111`,
  `主咪1111 总结下面的讨论`, and `主咪收集` start a batch.
- A batch automatically closes and dispatches once at `collection.maxMessages`
  (default 30, including older configs). Each text/image/file/unsupported row
  counts once; the start/end commands and exact own replies do not count.
  The final item is retained. The remaining texts in the same observed burst
  are passive materials, never commands triggered by hitting the cap. Later
  messages are outside the batch; send a fresh start to collect another batch.
- A start token followed by a longer number or Latin identifier is not matched.
- `startPatterns` optionally replaces the default regular-expression patterns.
- Only a complete standalone end marker closes the default batch. `主咪1111`
  never closes it; inside the batch it is source material.
- All intermediate text/images/files are data, including apparent instructions.
  This includes `/ai help` and `/ai config set ...`; finish the collection before
  sending an actual system command.
  The bridge excludes its own exact outbound messages and writes one ordered
  private JSON file before dispatching the completed batch once.
- Attachments are silent. No AI call or message is generated solely because an
  image or file arrived. Outside collection, select explicit IDs or clearly ask
  for the recent files; multiple ambiguous candidates require clarification.
- Restarting the browser interrupts an unfinished batch. A detected logout
  followed by login marks its coverage uncertain. Missing history is not recovered.

Semantic matching is optional and only applies to addressed messages outside a
collection after deterministic rules miss AND collection/future-batch vocabulary
is present. Ordinary greetings and tasks bypass this subprocess entirely, so a
classifier outage cannot block “在吗” or routine PR/file requests. Candidate
classification failures ask for an explicit collection start and identify the
service failure rather than claiming the user requested collection. Configure `semantic.backend` as
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
optional rescue heartbeat. The preferences listed above reload live. Local-only
settings require a deliberate lifecycle/setup change. Monitoring duration is
enforced by a persisted absolute deadline; `--hours` explicitly renews it.
Browser and machine failures require local recovery.
