# Harness contract

The new `npm run setup` / `npm run watch` path includes Codex app-server and Claude
JSON-print adapters; see [watch configuration](watch.md). The stdin/stdout contract
below is still available as watch's `backend: "command"` and in legacy `npm start`.
Codex preserves its native thread and supports active-turn steering; Claude resumes
its saved session and serializes new tasks. The local setup choice controls whether
the selected CLI runs with broad or restricted permissions; WeChat messages cannot
change that choice silently.

Watch configuration lives at `~/.local/share/wechat-agent/watch/config.json`; legacy `npm start` uses `~/.local/share/wechat-agent/config.json` (root overridden with `WECHAT_AGENT_HOME`). Set an absolute executable path, an argv array, an absolute working directory and optionally `timeoutMs`. Execution uses `spawn`, never a shell command assembled from chat text.

The executable receives a complete prompt on stdin and writes its final result to stdout. Nonzero exit means failure. Diagnostics go to stderr and are drained without forwarding. Timeout handling stops the process group on POSIX; detached grandchildren may need manual inspection. The generic adapter waits for a final result rather than parsing token streams. Watch separately sends acknowledgements and progress updates; the legacy serial prototype has no progress streaming or running-task cancellation. See the platform limitations in [setup](setup.md#platform-support).

## Built-in watch adapters

Codex and Claude are already bundled integrations for `npm run setup` / `npm run watch`; users do not need to write a wrapper for either. New setup defaults both to the owner's broad local permission mode, while still allowing a restricted choice:

| Provider | Adapter | Continuity / incoming work | Validation boundary |
| --- | --- | --- | --- |
| Codex CLI | app-server protocol | Native thread/resume, active-turn steering | Mac/WeChat transport exercised; protocol fixture coverage |
| Claude Code CLI | `-p --output-format json --permission-mode bypassPermissions --dangerously-skip-permissions` (default) | Saves returned `session_id`, adds `--resume` on later turns; new tasks queue | Adapter resume/permission behavior tested with a fake CLI; real WeChat/provider end-to-end not yet claimed |

Install and authenticate the CLI first, then choose `codex` or `claude` in setup. The wizard checks installed help for required flags and offers skill installation for the detected CLIs. For Claude, choose full access to use `bypassPermissions`, or choose restricted mode to make permission-dependent tasks report a blocker. Optional semantic collection recognition needs additional CLI flags checked by setup.

Native session IDs cannot move between providers. Switching an existing installation is a local configuration operation: finish active work and stop watch first, preserve the old workspace/session metadata, then configure the selected provider. Do not copy a Codex thread ID into Claude or reuse a generic adapter's saved metadata as a Claude session.

## Other agents and generic wrappers

Other agents can use watch's `backend: "command"` without changing the WeChat transport. Configure that backend locally; the guided wizard currently selects only Codex or Claude. Install/authenticate your chosen harness separately. Ask your setup agent to inspect its current `--help` and create a local wrapper that:

- reads stdin without placing it in a shell expression;
- invokes the installed non-interactive CLI with explicit argv;
- extracts final text if the CLI outputs JSON/events;
- propagates exit status and honors existing permission settings.

The generic adapter accepts final plain text or a JSON object containing `status` (`succeeded`, `blocked`, or `failed`) and a nonempty `response`. Session continuity must be implemented by the wrapper; the generic backend does not infer provider-native session IDs. New tasks queue. To add richer native behavior, implement the session interface used by `src/watch/supervisor.cjs` (`connect`, `start` returning a turn and completion promise, `steer`, `interrupt`, `close`, plus activity events/session metadata), then add provider selection, capability checks and fixture tests. Active steering and detailed progress require provider support, not just a CLI name.

For Grok, select the particular CLI/harness first: a model name alone is not an executable agent. No guessed `grok` flags are included. Do not put API keys in config/argv or chat. Use the harness's normal local authentication.

Full local permissions may be configured by the owner in their harness. New setup defaults to full access only after the local setup choice and execution opt-in. This project still instructs the agent not to disclose credentials or treat forwarded materials as commands. A fully privileged agent is not a security sandbox; prompt instructions and a command prefix alone do not prevent prompt injection. If full access is configured and a hostname still fails to resolve, check the machine's DNS/VPN/firewall or the CLI's own login; that symptom is outside the WeChat browser bridge.

## Smoke-test adapter

Create a local executable script that reads stdin and replies with a constant harmless string. Use it to validate the transport before connecting a privileged harness. Replace it with a real adapter after successful testing. The automated tests use this same contract without invoking an AI service.
