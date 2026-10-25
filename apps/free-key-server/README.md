# Codex Ultra Free Key Server

Independent Node.js service for the CodexUltraFree machine-bound key flow.

## Rules

- Keys use `cxu-` plus 48 random alphanumeric characters (52 characters total).
- Normal keys are valid for 24 hours by default; administrators can configure the number of days.
- Valid keys have no refresh-count limit.
- Normal user machines must refresh the free model list at least once every five hours.
- The registered Windows development machine bypasses keys, refresh gates, campaigns, and gateway restrictions.
- Discord `/free-key required:<code>` consumes a short-lived machine-bound code and replies ephemerally.
- Refresh responses can include structured campaign JSON for future notices or advertising.

## Start

1. Configure the variables in `.env.example`.
2. Run `npm run free-key:build` from the repository root.
3. Run `npm run free-key:start`.
4. Expose `/discord/interactions` through HTTPS and configure it as the Discord Interaction Endpoint URL.
5. Run `npm run free-key:register` once to register the slash command.

The main application connects with `CODEX_ULTRA_FREE_KEY_SERVICE_URL` and optional `CODEX_ULTRA_FREE_KEY_SERVICE_SECRET`.

Campaigns are structured JSON. Arbitrary third-party HTML is intentionally not accepted.

See `../../docs/free-model-key-flow.md` for the complete Chinese deployment, Discord, systemd, reverse-proxy, administration, backup, and troubleshooting guide.

## 管理员控制台

启动后打开 `https://your-domain.example/admin`。管理员账号由以下环境变量提供：
`FREE_KEY_ADMIN_USERNAME`、`FREE_KEY_ADMIN_PASSWORD_HASH`、`FREE_KEY_ADMIN_SESSION_SECRET`。
密码只保存为 scrypt 哈希，浏览器仅接收签名的 HttpOnly 会话 Cookie，不使用 localStorage 保存管理员密钥。

管理员可以按机器哈希、Discord 用户或 key preview 查询密钥，手工按天数签发并撤销密钥，同时修改刷新周期、默认有效期和广告设置。
