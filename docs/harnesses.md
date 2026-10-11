# Harness contract

`config.json` lives outside the repository at `~/.local/share/wechat-agent/` (override with `WECHAT_AGENT_HOME`). Set an absolute executable path, an argv array, an absolute working directory and optionally `timeoutMs`. Execution uses `spawn`, never a shell command assembled from chat text.

The executable receives a complete prompt on stdin and writes only the final human-facing text to stdout. Nonzero exit means failure. Diagnostics go to stderr and are drained without forwarding. A timeout kills the process group on POSIX; detached grandchildren or Windows subprocess trees may need manual cleanup. This first version waits for completion and does not stream progress or support cancellation of a running task.

## Claude, Codex, Grok

These are interchangeable **through a local adapter implementing this contract**, not three bundled, verified native integrations. Install/authenticate your chosen harness separately. Ask your setup agent to inspect its current `--help` and create a local wrapper that:

- reads stdin without placing it in a shell expression;
- invokes the installed non-interactive CLI with explicit argv;
- extracts final text if the CLI outputs JSON/events;
- propagates exit status and honors existing permission settings.

For Grok, select the particular CLI/harness first: a model name alone is not an executable agent. No guessed `grok` flags are included. Do not put API keys in config/argv or chat. Use the harness's normal local authentication.

Full local permissions may be configured by the owner in their harness. This project does not automatically add bypass flags. WeChat setup records consent to requested tasks, not permission to perform unrelated actions. A fully privileged agent is not a security sandbox; prompt instructions and a command prefix alone do not prevent prompt injection.

## Smoke-test adapter

Create a local executable script that reads stdin and replies with a constant harmless string. Use it to validate the transport before connecting a privileged harness. Replace it with a real adapter after successful testing. The automated tests use this same contract without invoking an AI service.
