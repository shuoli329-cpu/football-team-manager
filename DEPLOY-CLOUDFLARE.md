# kickoff-teammates 部署与迁移说明

本包来自 ChatGPT Sites 源码仓库提交 e335c7f82a977ea59fbf77bab6dfbd1af5a7a3ed。包含现有页面、样式、交互、API、Worker 入口、构建配置、依赖锁文件及数据库结构。运行时凭据、线上数据库内容与 Git 历史不在包内。

## 在 Cloudflare 上准备构建

1. 使用 Node.js 22.13 或更高版本。在解压目录运行 `npm ci` 和 `npm run build`。原构建走 Vinext 和 Cloudflare Vite 插件，输出客户端资产和 Worker。可以参考 `npm start` 在本地运行原有 Worker 配置。
2. 在自己的 Cloudflare 账户创建 D1，并应用 `drizzle/0000_chilly_magneto.sql` 创建表。在 Pages Functions 的目标环境为它绑定 `DB`。原构建配置里的数据库 ID 是占位符。在迁移真实数据前，先比较线上表结构和仓库迁移，避免漏掉线上新增的列或索引。
3. 在 Cloudflare 后端环境的 Secrets 中设置新的 `ADMIN_PASSWORD_HASH`。它是管理密码的 64 位小写十六进制 SHA-256 摘要。请在本机计算，避免把密码或摘要写入仓库、客户端代码和公开日志。
4. 现有入口为 `worker/index.ts`。若目标必须是 Pages，需要将原 Worker 构建适配为 Pages Functions 高级模式的 `_worker.js`，保留它依赖的模块及静态资源路由，启用 `nodejs_compat`，并核对 Pages 的 D1 绑定。包中保留了原始构建代码和配置。直接上传源码 ZIP 或仅上传客户端产物无法运行现有 API。Cloudflare Workers 搭配静态资产则更接近原部署形态。
5. 在隔离的预览环境检查首页、赛事列表、报名与取消、我的报名、管理登录、出勤和导出，再切换自定义域名或正式流量。

## 迁移风险

- 数据库：比赛、报名、成员、出勤与管理员限流依赖 D1。迁移脚本只创建结构。若要保留历史记录，应单独做受控数据迁移。报名记录包含手机号码及取消凭据的哈希。
- 域名：浏览器将取消凭据保存在 localStorage。换域名后，新站读不到旧域名保存的凭据，即使历史报名已迁移。
- 登录：源码包含依赖 ChatGPT Sites 请求头与登录路由的辅助模块。当前业务页面和 API 未调用它，管理入口使用自己的密码验证。若以后启用该模块，需要迁移登录流程并使用可信认证来源。
- 存储与连接器：Sites 清单未绑定 R2。Worker 保留了连接器运行时与预览代码，当前业务未发现连接器调用。
- 本包完成了源码归档和凭据筛查。当前交互依赖后端，因此未提供可独立部署的静态 dist/build，也未执行 Cloudflare 部署或端到端验收。

参考
- https://developers.cloudflare.com/pages/functions/advanced-mode/
- https://developers.cloudflare.com/pages/functions/bindings/
- https://developers.cloudflare.com/pages/get-started/direct-upload/
