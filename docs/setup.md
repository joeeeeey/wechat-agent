# Install and run

## Platform support

Guided installation and persistent watch currently support **macOS only**, including installation through an AI agent using the skill. Installing or reading `SKILL.md` on Windows does not install a compatible runtime.

Native Windows, WSL2 and Linux are not supported setup targets yet. Both setup and watch explicitly check for macOS. The current implementation also relies on `/dev/tty`, POSIX process inspection and Unix-domain control sockets; optional rescue heartbeat installation uses macOS LaunchAgents. Windows support requires runtime and installer changes plus platform testing, not just PowerShell instructions. Do not bypass the guards or recommend WSL2 as an already supported workaround.

The **Windows runner smoke** GitHub Actions workflow uses standard `windows-latest` to check Node 22, dependency installation, portable configuration/collection logic and an isolated Playwright Chromium login/send/logout fixture. It also verifies the current setup/watch platform rejection. These checks provide a Windows development test environment; they do not establish Windows installation, real WeChat login or Codex/Claude execution support.

## Current macOS guided setup

Use the one-command installer in [README](../README.md), or run `npm ci` and
`npm run setup` from a checkout. It selects an installed/authenticated Codex or
Claude CLI, saves private watch configuration, optionally installs the skill and
prepares rescue configuration, then opens a dedicated browser for a local scan.
See [watch configuration](watch.md) for markers, file handling, permissions and
`npm run watch -- start|status|stop|restart`.

After login, the connected message introduces `/ai help`, `/ai config`, `/ai status`, and configuration examples such as `/ai config set 回复风格 详细`. Users can also ask the configured assistant alias to change preferences in natural language. Names, aliases and response preferences reload live; check/progress intervals remain local-only and require a deliberate watch restart. Finish collection before sending configuration commands, since all messages inside a batch are treated as materials.

New setup defaults to broad local agent permissions: Codex uses `danger-full-access`; Claude uses `bypassPermissions` plus its non-interactive skip-permissions flag. You can choose a restricted mode during setup. If a task still reports DNS or connection failure in broad mode, verify the host independently (for example, resolve `api.notion.com` and run a credential-free `curl -I https://api.notion.com`) before changing the WeChat bridge; that indicates the machine's DNS/VPN/firewall or CLI login rather than the browser transport.

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

## Re-run setup with full permissions

Use the latest installed setup from the local terminal/agent. After pending work finishes, stop watch and run the installed launcher with `setup` (or `npm run setup` from its checkout). Accept the default permission choice: **Codex 3** (`danger-full-access`, `approvalPolicy: never`) or **Claude 2** (`bypassPermissions` with `--dangerously-skip-permissions`). Setup replaces an old saved restricted mode; it does not use that old mode as the prompt default. Keep the existing identity and workspace answers, enable execution, then start watch. A compatible running WeChat browser is reused; do not request `--browser` or delete native session metadata for a permission change.

Running setup from an old installed release still runs old code: update the installation first. The bootstrap upgrade requires the old controller/browser to be stopped, so plan a new scan if using that upgrade route. A running restricted AI turn cannot promote its own sandbox via `/ai config`; the locally restarted executor receives the new policy on native session resume. Full access removes the added agent sandbox/approval restriction, not OS privacy controls, service authorization or actual network failures.
