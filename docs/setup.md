# Install and run

## Current macOS guided setup

Use the one-command installer in [README](../README.md), or run `npm ci` and
`npm run setup` from a checkout. It selects an installed/authenticated Codex or
Claude CLI, saves private watch configuration, optionally installs the skill and
prepares rescue configuration, then opens a dedicated browser for a local scan.
See [watch configuration](watch.md) for markers, file handling, permissions and
`npm run watch -- start|status|stop|restart`.

For existing installations, stop the old controller and close its dedicated
browser before rerunning the bootstrap. It refuses to replace running code.
Back up private state locally, never in Git. Legacy `npm start` state is not
automatically migrated. To reuse an existing Codex native thread, first stop its
current owner, use the same workspace, and set `harness.threadId` before the first
watch start. Once watch records a native session, that metadata takes precedence.
Never concurrently `codex resume` a thread owned by the watch app-server.

## Legacy serial prototype

The instructions below describe `npm start`, kept for compatibility. They do not
describe the new persistent watch, attachments, or collection mode.

Prerequisites: Node.js 22+, a desktop session, and a WeChat account permitted to use File Helper web. The machine must remain awake. This is an unofficial prototype and depends on Tencent's page structure/account availability.

```sh
git clone https://github.com/joeeeeey/wechat-agent-skill.git
cd wechat-agent-skill
npm ci
npx playwright install chromium
npm start -- init
```

Edit the generated local config as described in [harnesses](harnesses.md), then `npm start`. Scan in the newly opened browser with your phone. This runtime must not share a browser profile or a WeChat account session with another controller during testing. It does not touch an existing browser/controller.

After login, answer in File Helper:

```text
/ai 工作咪
/ai 简洁中文，先说明实际进度
/ai 开启
/ai 检查当前项目测试结果
```

Only text beginning with `/ai ` is executed. Ordinary File Helper messages are ignored. AI messages begin `[AI]`, avoiding feedback loops. `/ai 暂停` pauses new tasks; `/ai 继续` resumes. Tasks are serial; pause is processed after a running task finishes, not an emergency kill switch. Use the local terminal to stop the process if necessary.

The skill is at `skills/wechat-agent/SKILL.md`. Register that directory with your harness; for Codex-style discovery, symlink the directory into its skill folder. Keep the repository available because documentation/runtime are referenced relatively.

## Operational behavior and limits

- Initial visible messages are baselined, never executed. Send new tasks after the connected greeting.
- One process owns one profile using an exclusive lock. After stopping, confirm the recorded PID is gone before manually removing `session.lock` and starting a new session. Never remove a live session lock.
- No automatic reload, re-login, page navigation or retry after disconnect. Close the old dedicated browser yourself before a deliberate fresh launch.
- DOM node identities deduplicate within a session. A frontend remount can invalidate them; do not manually navigate/alter the page. This is not server-side exactly-once delivery.
- Job state is persisted before dispatch. Crashed jobs are marked interrupted and never replayed. Missed messages while stopped are not recovered.
- Reply confirmation means visible in the web UI, not delivered/read on the phone. An uncertain send blocks the loop instead of duplicating actions.
- Local state contains recent conversation text and a browser profile; keep it private. Do not commit or upload it. Do not request/return secrets over this channel. Output secrecy also depends on your harness; no reliable automatic secret redaction is claimed.
- Text only, no attachments, no progress streaming or multi-machine routing in v0.1.
- Selectors can be overridden through `config.selectors`; revalidate with a separate test account/session when the upstream UI changes.

## Validation

`npm test` covers onboarding, shell-safe harness execution, limits/failures and browser DOM fixtures. It does not log into real WeChat or invoke paid providers. Complete a separate live smoke test before relying on remote execution.
