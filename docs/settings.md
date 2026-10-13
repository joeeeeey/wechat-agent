# Identity and conversational setup

The default assistant is 主咪. Machine display defaults to the operating system hostname plus OS type; no serial number, IP or hardware identifier is collected. A random device UUID is generated once and retained. Display renaming never changes that ID.

Identity is saved in private `settings.json` under `WECHAT_AGENT_HOME` (default `~/.local/share/wechat-agent`), alongside the existing private runtime files, outside the repository. Existing saved assistant names and execution permission are retained on upgrade. Setup progress survives restart.

## First conversation

The initial greeting displays the assistant, machine and device ID. Send `/ai 默认` to keep defaults, then `/ai 开启` to explicitly allow tasks; or `/ai 设置` for name → machine name → style → execution permission → optional rescue. Each answer uses `/ai`; `/ai 默认` skips a value, `/ai 取消设置` exits without revoking existing permission. Choosing rescue only records interest and explains local configuration; it never accepts cloud credentials or deploys infrastructure through chat.

Examples:

- `/ai 查看设置` — current non-secret settings and environment locks.
- `/ai 把你改名叫小咪` — rename with a receipt; `/ai` still works afterward.
- `/ai 设置 机器名称 工作 Mac`
- `/ai 设置 语言 English`
- `/ai 设置 时区 Asia/Shanghai`
- `/ai 设置 风格 详细` — 简短 or 详细.
- `/ai 设置 接收时长 8` — 1–24 hours, applies on next process start; does not extend the running authorization or WeChat login.
- `/ai 设置 救援` — instructions for private Cloudflare `.env` configuration.
- `/ai 暂停` and `/ai 继续` — task intake; configuration remains available while paused.

Only these explicit configuration forms are interpreted as settings. Arbitrary task text is not parsed into configuration mutations. Invalid values are rejected; successful values are saved before confirmation.

## Matching and multiple computers

`/ai ` is the permanent prefix, independent of names. An optional convenience form matches the current assistant name only at the beginning followed by `，`, `,`, `：` or `:`. References to the name elsewhere do not trigger tasks. Assistant replies always begin with `[AI]` and are excluded before matching.

A single-machine installation accepts unaddressed `/ai` commands by default. **Before monitoring the same File Helper on multiple machines, enable strict targeting on every machine** using `WECHAT_AGENT_REQUIRE_TARGET=true` or `/ai 设置 设备定向 true`. Then use `/ai [DEVICE_UUID] command`, including settings commands. Only an exact device UUID matches; mutable or duplicate display names are deliberately not routing identifiers. The greeting always prints the UUID. There is no cross-device election or implicit active-device synchronization.

## Configuration precedence

Environment > private saved settings > defaults. Supported environment overrides:
`WECHAT_AGENT_NAME`, `WECHAT_AGENT_DEVICE_NAME`, `WECHAT_AGENT_LANGUAGE`, `WECHAT_AGENT_TIMEZONE`, `WECHAT_AGENT_STYLE`, `WECHAT_AGENT_MONITORING_HOURS`, `WECHAT_AGENT_REQUIRE_TARGET`.

An overridden field is reported as locked during conversation; the agent does not claim an ineffective change succeeded. Node runtime reads process environment (for example `node --env-file=/private/agent.env src/cli.js`), not an automatically sourced shell file. Keep the file private and out of Git.

Workspace, executable/backend, model and reasoning effort remain controlled locally through `config.json` and the agent wrapper. Chat cannot replace the executable or bypass its permissions. Notification policy/progress cadence are not yet configurable in this public runtime (it currently sends start/final notices). Cloudflare settings use the separate rescue configuration described in [rescue](rescue.md). Never send tokens or private credentials via chat.

Monitoring expiry stops new intake after the configured duration; accepted work may finish. It does not promise a 24-hour WeChat login or keep login alive. No automatic browser refresh, restart or relogin is introduced.
