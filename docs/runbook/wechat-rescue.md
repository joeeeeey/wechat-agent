# 微信状态监测与恢复确认

入口：`https://wechat-rescue.critdeck.com`。Cloudflare Worker + D1 + Access 通过声明式配置和幂等脚本管理；独立 macOS LaunchAgent 每 30 秒上报状态。本功能不改动微信浏览器、supervisor 或 relay VM。

## 页面功能

- 展示工作 Mac 心跳、微信连接状态、最后观测时间和最近一次恢复在线确认时间。
- 每 15 秒更新；设备心跳超过 90 秒未到达时显示失联。微信观测超过 90 秒或源文件不可读时显示未知，不能把上报器活着等同于微信在线。
- 从离线/未知变为在线，或设备心跳中断超过 90 秒后恢复在线时，记录恢复确认时间。首次在线不算恢复；轮询之间短暂断线可能无法捕获。
- 微信离线时提示在工作 Mac 手动登录；状态源观测到在线后自动确认。这里没有远程扫码、二维码展示、浏览器控制或远程重登按钮。
- 邮箱登录到期或网络失败时清除页面在线结论，提示重新打开救援页登录。

## 资源与权限

- `infra/cloudflare/wechat-rescue/stack.json` 管理 Worker、D1、域名及两个允许邮箱：`joeeey9303@gmail.com`、`513358386@qq.com`。
- Access 邮箱验证码登录，会话一小时。Worker 验证 JWT 签名、issuer、audience、有效期和邮箱；页面、脚本和状态 API 全部受保护。workers.dev 和预览 URL 禁用。
- 上报器只读取现有本机 `state.json`，只发送固定设备 ID、枚举连接状态和规范化观测时间；不上传聊天记录、二维码、浏览器会话、错误原文或凭据。
- 上报使用 Cloudflare D1 管理 API，不增加公开写入端点，不放宽 Access。复用本机已有 SOPS 加密账户凭据，明文仅存在子进程内存；该 token 是账户级权限，并非设备专用最小权限 token。
- `device_heartbeat` 仅保存单设备当前状态和恢复时间，云端生成接收时间。旧 `device_status` 表保留，不删数据。

## 测试、计划和部署

```bash
node --test infra/cloudflare/wechat-rescue/worker.test.mjs
python3 -m unittest discover -s scripts -p 'test_wechat_rescue*.py'
python3 scripts/wechat_rescue_apply.py --credentials /stable/private/path/to/cloudflare.env.sops
python3 scripts/wechat_rescue_apply.py --credentials /stable/private/path/to/cloudflare.env.sops --apply
python3 scripts/wechat_rescue_install.py --credentials /absolute/path/to/secrets/cloudflare-critdeck.env.sops
python3 scripts/wechat_rescue_install.py --credentials /absolute/path/to/secrets/cloudflare-critdeck.env.sops --apply
```

云端先设置 Access，再创建/复用 D1 并执行幂等 schema、上传 Worker、绑定域名；账户不匹配、已有异主资源、额外 Access 策略时中止。不会自动订购付费方案。

本机安装器把仓库脚本复制到 `~/.local/share/wechat-rescue/`，生成 `~/Library/LaunchAgents/com.critdeck.wechat-rescue-heartbeat.plist`。它只管理这个独立任务，不修改现有微信服务。加密凭据路径必须稳定，不要引用可能清理的 `/tmp`。依赖 Python 3、SOPS、本机既有解密环境和网络；用户登录后 launchd 定期运行，休眠或注销期间不会上报。

安装器默认只读计划；重复 apply 只更新独立任务。脚本不记录明文凭据或原始状态，launchd 输出丢弃以避免日志无限增长；排障可手动运行下方的一次上报。

```bash
python3 scripts/wechat_rescue_heartbeat.py --credentials /absolute/path/to/secrets/cloudflare-critdeck.env.sops --database DATABASE_ID --dry-run
# 移除 --dry-run 后执行一次上报，仅输出允许的状态字段。
launchctl print gui/$(id -u)/com.critdeck.wechat-rescue-heartbeat
```

## 验收

1. 未登录访问入口、`/api/status` 和 `/app.js` 均进入 Access 邮箱登录。
2. 读回策略仅允许上述两邮箱，workers.dev/预览关闭。
3. D1 连续两次读回 `received_at` 前进，源观测时间新鲜，设备为 `work-mac-joey`。
4. 所有者打开入口并实际收取验证码，查看两个时间持续更新。
5. 自动测试覆盖离线→在线恢复、陈旧观测、陈旧心跳、未知状态和鉴权；真实微信退出/登录由所有者操作，自动化不触碰浏览器。短于采样周期的断线不保证记录。

## 回滚

停用独立心跳：`launchctl bootout gui/$(id -u)/com.critdeck.wechat-rescue-heartbeat`，再移除该任务 plist，防止下次登录重启。保留运行目录和 D1 数据用于排查。恢复上一版 Worker 后重跑云端 apply；不要删除 Access 或降低策略来排障。
