# WeChat Agent 🐱

用微信文件传输助手，给 Mac 上的 AI 发任务、图片、文件和一批聊天记录。

## 一条命令安装（macOS）

先安装并登录 **Codex CLI 或 Claude Code CLI**，然后在 Mac 终端运行：

```bash
curl -fsSL https://raw.githubusercontent.com/joeeeeey/wechat-agent/main/scripts/bootstrap-macos.sh | bash
```

安装器会：

1. 检查 Node.js 22+；缺少时在私人目录安装校验过 SHA-256 的 Node，不修改系统 Node。
2. 安装项目依赖和 Playwright Chromium。
3. 引导选择 Codex/Claude、助手名、机器名、工作目录、监控时长和执行权限。
4. 询问是否安装对应 CLI 的 `wechat-agent` skill，以及是否配置可选 Cloudflare 救援/状态页。
5. 打开专用浏览器。用手机微信扫码，程序自动识别登录，无需额外回复“已扫码”。

已有其他微信控制器时先停止它并关闭它的专用浏览器，避免同一个账号被两套程序操作。安装器不会主动接管其他安装的会话。

所有私人配置、会话元数据、下载文件和浏览器资料保存在 `~/.local/share/wechat-agent/`，不进入仓库。CLI 登录凭据继续由 Codex/Claude 管理，不需要把 API key 发给微信或填入安装命令。

### 用 AI agent 自然语言安装

可以把这句话发给已经配置好的 Codex 或 Claude：

> 请从 https://github.com/joeeeeey/wechat-agent 安装 WeChat Agent，读取仓库的 skills/wechat-agent/SKILL.md，先检查系统兼容性，再引导我配置助手名、工作目录和权限；暂不启用救援。扫码登录由程序自动检测，完成后告诉我如何在微信里查看和修改配置。

**当前只支持 macOS。** Windows 可以让 agent 读取 skill，但尚不能运行本项目的 setup/watch；原生 Windows、WSL2 和 Linux 都没有支持的安装流程。自然语言安装不会自动消除平台限制，具体见[平台支持说明](docs/setup.md#platform-support)。

## 怎么用

### 支持哪些 AI agent？

不只支持 Codex。安装前先登录对应 CLI，setup 会检测并让你选择：

| 执行器 | 当前接入 | 会话与后续消息 |
| --- | --- | --- |
| Codex CLI | 内置 app-server 适配器 | 保留原生 thread，支持执行中追加指令 |
| Claude Code CLI | 内置 JSON print 适配器 | 保留原生 session，通过 `--resume` 延续；新任务排队 |
| 其他本地 AI agent CLI | 可配置 `command` 通用适配器 | 需要符合 stdin/stdout 协议；原生会话延续由包装器实现 |

**Claude 已有代码支持，不需要另写适配器。** 安装并登录兼容版本的 Claude Code 后，在 setup 中选择 `claude` 即可；安装器会检查必需参数。真实微信端到端目前主要验证了 Mac/Codex，Claude 的会话恢复有隔离测试，仍需在你的账号上完成扫码、执行和续聊验收。

其他 agent 的基本接入通常只需一个本地包装器：从 stdin 读任务，用明确参数调用 CLI，把最终结果写到 stdout、诊断写到 stderr，并返回正确退出码。要支持原生会话恢复、运行中追加指令、进度事件或取消，则需要进一步适配执行器接口。不能直接填一个模型名就接入。详见[执行器协议](docs/harnesses.md)。

默认唤醒名是 `小助手` / `ai`。例如：

```text
小助手帮我总结这份文件
小助手读取附件 A1，列出重点
```

图片和文件**单独到达时不回复、不执行任务**。小助手收到明确指令后才处理材料。回复会带上助手名、机器身份和请求号，并在长任务中途同步进展。

收集群聊时，用微信的**逐条转发**：

```text
小助手1111 总结下面的聊天，列出分歧和待办
（逐条转发文字、图片或文件）
1111
```

`小助手1111` 或 `小助手收集` 是开始；**单独的 `1111` 或 `mmmm` 是结束**。开始标记后可以直接附上任务要求。中间内容全部作为材料，包括出现“小助手”的转发文字；结束后统一处理一次。没有提供原始群名、发送人或时间时，程序不会猜测这些信息。

默认一批最多 **30 条材料**，文字、图片、文件各算一条；达到上限会自动结束并处理，不必再发结束符。开始/结束指令和助手回执不计数。可用 `/ai config set 收集上限 50`，或在配置文件设置 `collection.maxMessages`（1–1000）；新批次生效。

常见表达用配置里的规则识别；可选 AI 语义识别用于更自由的“接下来发一批消息”表达，可能多等数秒。“小助手 在吗”“帮我检查 PR”等普通问候和任务直接交给助手，不经过收集识别。只有包含收集或未来批次表达的消息才进入语义识别；识别服务失败时会准确提示原因。收集中不会对材料运行语义命令判断。具体配置见 [watch 配置](docs/watch.md)。

本次实测的 File Helper 网页对合并转发显示“不支持”，无法从该占位消息取得聊天正文。可改用逐条转发、文本文件或截图。

## 在微信里查看和修改配置

首次扫码连接后的欢迎消息会列出以下入口和修改示例；助手名称和唤醒词以你的配置为准：

```text
/ai help
/ai config
/ai status
/ai config set 回复风格 详细
/ai config set 助手名 小助手
/ai config set 结束符 ["1111","mmmm"]
小助手，把回复风格改为详细，以后用英文回复
```

`/ai help` 列出系统命令，`/ai config` 显示可修改项，`/ai status` 查看监控状态和截止时间。系统命令无需调用 AI；自然语言改配置由当前 AI 执行器调用同一套校验接口。改名会保留原唤醒词，固定 `/ai` 入口始终可用。

助手/机器显示名、唤醒词、回复语言/风格、收集规则、登录提醒和附件限制都支持热更新，**不刷新微信、不重启 AI 会话**。保存后 supervisor 约 1 秒内读取；后续任务使用新偏好，进行中的任务不重新执行。检查与反馈间隔为只读，微信命令和 AI 都不能修改；运行时固定为启动值。若需调整，必须在本机配置后重启 watch，避免误改导致长时间无法响应。默认仍为 20 秒检查、45 秒反馈。

收集期间的 `/ai` 命令也是聊天材料，不会修改配置；当前批次保留开始时的结束符和条数上限。工作目录、执行权限、CLI 和救援凭据仍在本机配置，不在微信展示。监控时长配置不会延长当前截止时间，续期仍用本机 `start --hours`。字段和值的完整说明见 [watch 配置](docs/watch.md#wechat-system-commands)。

## 启动、停止和重启

安装后可在任意目录运行：

```bash
~/.local/share/wechat-agent/bin/wechat-agent status
~/.local/share/wechat-agent/bin/wechat-agent stop
~/.local/share/wechat-agent/bin/wechat-agent start
~/.local/share/wechat-agent/bin/wechat-agent restart
```

`stop` / `restart` 管理 watch 和 AI 执行器，保留微信浏览器。Codex 使用同一原生 thread；Claude 保存并 `--resume` 同一个原生 session。Codex 支持运行中追加输入；Claude/自定义命令适配器串行排队。

需要重新打开浏览器、扫码时，显式执行：

```bash
~/.local/share/wechat-agent/bin/wechat-agent restart --browser
```

到期后重新授权 48 小时：

```bash
~/.local/share/wechat-agent/bin/wechat-agent start --hours 48
```

默认每 20 秒检查，长任务约每 45 秒反馈。页面仅在显式启动新浏览器时首次导航，**不会自动刷新、重登或重复执行失败任务**。电脑需保持开机、联网，专用浏览器需保持运行；这不是开机自启服务。

登录到期提醒默认按约 24 小时估算，在预计到期前 60/30/10 分钟提醒；这不是微信承诺的有效期。重新扫码后按实际观察重计时。

## 开发与已有安装

从源码安装：

```bash
git clone https://github.com/joeeeeey/wechat-agent.git
cd wechat-agent
npm ci
npm run setup
```

源码对应命令是 `npm run watch -- start|status|stop|restart`。旧的 `npm start` 串行原型仍保留，不能与新 watch 同时运行；旧资料不会自动迁移或重新执行。原生会话接管和升级见 [安装说明](docs/setup.md)。

云端救援默认关闭。启用后，邮箱登录救援页即可查看状态；点击“生成登录二维码”，在线时也可测试重新登录；页面会显示这台 Mac 的二维码，并随二维码变化更新。在线时先在独立页面生成二维码，手机扫码确认后才切换连接；二维码自动撤下，watch 恢复接收新任务；旧消息不会重放。不会刷新微信页面，过期二维码仅通过页面自带的二维码刷新按钮更新。配置见 [救援说明](docs/rescue.md)。

## 验证范围

真实 Mac 已验证：扫码、文字、原图/文件下载，以及包含 5 条文字和 2 张图片的一批材料经原 Codex 会话总结、回传微信。可复用安装器、消息状态机、下载、Codex 协议、Claude 恢复和提醒另有隔离测试。没有在全新 Mac 上验证完整一键安装，也没有宣称 Claude 的真实微信端到端已验证。

`/ai` 系统命令和热更新已通过隔离浏览器及执行器测试；尚未在真实微信和真实 AI 上验证自然语言改配置的完整流程。

此项目不是权限沙箱。新安装默认让 Codex 使用 `danger-full-access`，让 Claude 使用 `bypassPermissions`，与用户在本机直接运行的全权限模式保持一致；setup 仍可选择受限模式。附件与聊天记录只是材料，不是新权限。回复可见仅代表网页端显示，不证明手机已读。

## 用自然语言卸载

在本机 Codex / Claude 中发送（不要从即将关闭的微信通道发起）：

> 请帮我卸载 WeChat Agent。先读取安装目录里的 skill 和 docs/uninstall.md，确认安装位置及运行状态。如果有正在执行的任务，请告诉我，等任务结束后再卸载。停止它的监控和专用浏览器，移除程序、启动入口，以及 Codex/Claude 中对应的 wechat-agent skill。如果配置过救援，检查并清理它专属的本机后台服务。默认保留配置、下载文件和会话数据，并告诉我保留在哪里。不要删除项目工作区、共享依赖或 Codex/Claude 的登录凭据；云端救援资源是否删除，单独问我。完成后验证没有残留进程。

若还要删除本地运行数据，可补充：

> 我不需要保留 WeChat Agent 的本地配置、下载文件、浏览器资料和运行记录。请列出准备删除的专属目录，确认范围后清理；保留我的项目工作区和 Codex/Claude 原生历史会话。

当前没有 `uninstall` 子命令。Agent 应按[卸载说明](docs/uninstall.md)检查实际安装后清理；`stop` 只停止 watch/执行器，**不会关闭专用浏览器，也不会卸载程序**。

非官方项目，与腾讯、OpenAI、Anthropic 无隶属关系。
