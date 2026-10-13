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

## 怎么用

默认唤醒名是 `主咪` / `zhumi`。例如：

```text
主咪帮我总结这份文件
主咪读取附件 A1，列出重点
```

图片和文件**单独到达时不回复、不执行任务**。主咪收到明确指令后才处理材料。回复会带上助手名、机器身份和请求号，并在长任务中途同步进展。

收集群聊时，用微信的**逐条转发**：

```text
主咪1111 总结下面的聊天，列出分歧和待办
（逐条转发文字、图片或文件）
1111
```

`主咪1111` 或 `主咪收集` 是开始；**单独的 `1111` 或 `mmmm` 是结束**。开始标记后可以直接附上任务要求。中间内容全部作为材料，包括出现“主咪”的转发文字；结束后统一处理一次。没有提供原始群名、发送人或时间时，程序不会猜测这些信息。

常见表达用配置里的规则识别；可选 AI 语义识别用于更自由的“接下来发一批消息”表达，可能多等数秒。收集中不会对材料运行语义命令判断。具体配置见 [watch 配置](docs/watch.md)。

本次实测的 File Helper 网页对合并转发显示“不支持”，无法从该占位消息取得聊天正文。可改用逐条转发、文本文件或截图。

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

安装器中的云端选项只准备私有配置，并在展示计划、确认后执行已有部署脚本；默认关闭。当前救援是**经过认证的状态页/心跳**，不是自动扫码。参阅 [救援说明](docs/rescue.md)。

## 验证范围

真实 Mac 已验证：扫码、文字、原图/文件下载，以及包含 5 条文字和 2 张图片的一批材料经原 Codex 会话总结、回传微信。可复用安装器、消息状态机、下载、Codex 协议、Claude 恢复和提醒另有隔离测试。没有在全新 Mac 上验证完整一键安装，也没有宣称 Claude 的真实微信端到端已验证。

此项目不是权限沙箱。安装时显式选择执行范围；Codex 默认工作区写入，Claude 沿用本地权限，不自动加跳过审批参数。附件与聊天记录只是材料，不是新权限。回复可见仅代表网页端显示，不证明手机已读。

非官方项目，与腾讯、OpenAI、Anthropic 无隶属关系。
