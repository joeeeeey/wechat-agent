# WeChat Agent Skill 🐱

一个微信文件传输助手，控制一台电脑。可复用 skill + Playwright 本地运行时，AI harness 可自行替换。

**v0.1 prototype:** dedicated browser launch → local QR login → visible login detection → conversational name/preferences/consent setup → serial text tasks → replies. No multi-machine router. No rescue website yet.

## Start

See [installation](docs/setup.md), [agent adapters](docs/harnesses.md), and [SKILL.md](skills/wechat-agent/SKILL.md).

```sh
npm ci
npx playwright install chromium
npm start -- init
# Configure your local executable adapter; then:
npm start
```

Send `/ai 工作咪` after the greeting and follow the onboarding prompts. The AI responds with `[AI]`.

Claude, Codex and Grok can be connected through a stdin/stdout executable adapter. Native provider adapters are **not bundled or live-verified**. Broad execution permissions remain an explicit local harness choice.

## What is verified?

Automated core and isolated Playwright fixture tests. Public frontend assets were inspected for DOM selectors; no existing WeChat browser was controlled. Real account login and end-to-end provider execution still require a separate live smoke test. This is not a production reliability or security guarantee.

The browser is kept open without refresh/reload/recovery loops. Disconnects pause work. Old messages and crashed tasks are not automatically replayed. Text only; no attachments or in-task progress streaming yet.

Future [rescue channel](docs/rescue.md): fixed authenticated URL for status and explicit recovery, once domain and login flow are supplied. No public QR endpoints.

Private data stays outside the repo under `~/.local/share/wechat-agent/`. Never publish browser profiles, transcripts, tokens or credentials. Full-permission agents can affect the whole computer; this project is not a sandbox. Unofficial project, not affiliated with Tencent, Anthropic, OpenAI or xAI.
