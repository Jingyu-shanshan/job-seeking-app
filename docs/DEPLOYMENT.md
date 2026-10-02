# Railway + Neon 部署计划

更新：2026-10-01。**这是未来发布步骤，尚无 Railway 项目或 Neon 数据库；`npm ci`、`npm run build`、`npm start` 已在 T01 实现，迁移命令 `npm run db:migrate` 已在 T02 实现，账户创建命令 `npm run auth:create-account` 已在 T03 实现。** 源码在 GitHub `Jingyu-shanshan/job-seeking-app`（公开仓库），当前不发布。骨架（T01–T03）完成后先做一次不含个人数据的预部署演练（T03a），更早暴露 Railway、Neon、Better Auth 和 pre-deploy 迁移的问题；正式发布仍是 T12。

## 拓扑

一个 Railway 服务运行 Fastify，同时提供 Angular 静态页面和同源 `/api`；生产 PostgreSQL 在 Neon。这样不需要第二个 Web 服务、跨源 Cookie 或前端数据库变量。Railway 的 [`PORT` 与 `0.0.0.0` 要求](https://docs.railway.com/networking/troubleshooting/application-failed-to-respond)在 T01 实现，本地开发默认只监听 loopback。Railway 从仓库根目录构建两个 npm 工作区；应用启动前执行数据库迁移。

个人事实、JD 快照、申请状态及有大小上限的实际投递文件都以 Neon 为主数据。Railway 容器目录仅可用于临时构建/处理；若以后附件规模不适合 PostgreSQL，再评估 [Railway Storage Bucket](https://docs.railway.com/storage-buckets)。不为 V0.1 先添 Volume 或对象存储。

## 需要的环境变量

| 变量 | 位置 | 用途 |
| --- | --- | --- |
| `DATABASE_URL` | Railway 服务变量；仅后端代码读取 | 先使用 Neon **direct** PostgreSQL URL，并把 Neon 给出的 `sslmode=require` 改为 `sslmode=verify-full`：`pg` 下个大版本会让 `require` 不再校验证书，因此 `NODE_ENV=production` 时服务和迁移都拒绝其他取值（URL 中其他参数如 `channel_binding` 在 T03a 时核对）。小 `pg.Pool` 用于运行时，迁移也用该 URL。开发与生产必须指向不同数据库/分支。[Neon 连接说明](https://github.com/neondatabase/website/blob/main/content/docs/get-started/connect-neon.md) |
| `BETTER_AUTH_SECRET` | Railway 服务变量；仅后端代码读取 | 高熵会话密钥（`openssl rand -base64 32`，服务要求至少 32 个字符）；不写进前端或 Git。迁移命令不读取它。[Better Auth 安装说明](https://better-auth.com/docs/installation) |
| `BETTER_AUTH_URL` | Railway 服务变量；仅后端代码读取 | 实际 HTTPS 应用来源（如 `https://<服务>.up.railway.app`）；生产必须是 https，会话 Cookie 因此带 Secure。它也是生产中唯一受信的 `Origin`：从其他地址（包括同一服务的另一个域名）发出的写请求和登录都会被拒，换域名时要同步修改。本地默认 `http://127.0.0.1:$PORT`。 |
| `NODE_ENV=production` | Railway 服务端 | 生产行为与安全 Cookie。 |
| `PORT` | Railway 注入 | 服务读取平台端口，不在仓库固定。 |
| `DEEPSEEK_API_KEY` | Railway 服务变量；仅后端代码读取 | 模型调用（T05 起）。变量名在接入时按实际代码核对。 |

变量放在 [Railway Service Variables](https://docs.railway.com/variables)；这些变量**在构建和运行阶段都可见**，因此 Angular 构建脚本不得读取或内嵌数据库 URL、会话密钥或模型密钥，发布前检查最终 JS bundle。保留 Neon URL 的 TLS 证书校验，不使用 `rejectUnauthorized: false`。

V0.1 单用户、单服务先用 direct URL，避免多余连接配置。若连接数或实例数确实需要 Neon pooler，届时改为 pooled `DATABASE_URL`（主机含 `-pooler`），另加 direct `DIRECT_URL` 供迁移、备份与需要会话特性的操作；两者职责的用法见文末“从参考仓库借用的流程”，使用前再核对所选迁移工具。[Neon pooled/direct 说明](https://github.com/neondatabase/website/blob/main/content/docs/get-started/connect-neon.md)

## 本地投递执行器

代填和提交申请表的执行器（`apps/runner`，T17）**不部署到 Railway**：它在用户电脑上运行，打开可见的浏览器窗口。它只通过 HTTPS 调用本服务的 API，用用户在应用里签发、可撤销的令牌认证；令牌只存哈希，可在界面中吊销。Railway 服务不需要 Chromium，也不直接访问招聘网站的申请页面。

## 区域与备份

- **区域**：Neon 项目和 Railway 服务在创建时选择区域，两者应彼此靠近，并按数据合规选择。若在欧盟求职，个人经历数据宜留在欧盟区域，并把 GDPR 与模型供应商所在地一并考虑。事后更换区域可能要迁移数据，因此在 T03a 创建演练环境时就确定。
- **PostgreSQL 版本**：Neon 支持 14–18（2026-10-01 核对）。本地容器和 CI 用 18，创建 Neon 项目时选 18；若选其他主版本，同步修改 `.github/workflows/ci.yml` 和 `CLAUDE.md` 中的容器镜像。
- **备份**：Neon 的时间点恢复窗口（2026-10-01 核对 [Neon 套餐说明](https://neon.com/docs/introduction/plans)）：Free 为 6 小时且不可调；Launch 默认 1 天、最长 7 天；Scale 默认 1 天、最长 30 天。付费套餐按变更历史另计 $0.20/GB-月，且只有根分支能做时间点恢复。Free 套餐的计算节点闲置 5 分钟后休眠且不能关闭（Launch 可关闭，Scale 可配置），所以 `/health/ready` 和连接超时要容纳唤醒。不论哪种套餐，都定期用 direct URL 执行 `pg_dump`，存到用户控制、且与 Neon 不同提供方的存储，并验证能恢复到隔离库；T10 以此为验收。T02 的 `npm run db:restore-drill` 已在本地对样例数据演练过 `pg_dump` → 隔离库 `pg_restore` → 逐表比对，T10 在此基础上做真实数据和定期备份。

## 发布顺序（T12 才执行）

1. 建独立 Neon 开发/生产分支或项目；在非生产库验证**业务和 Better Auth 认证表**的版本化 SQL 迁移、首次登录与隔离恢复。公开注册在代码中始终关闭；迁移后用 `railway run npm run auth:create-account -- <email>` 创建唯一账户（在本机运行，使用 Railway 的变量连接 Neon direct URL，密码在终端输入；T03a 时确认这一方式可行）。Better Auth 在生产默认开启限流，计数存于进程内存，按 `X-Forwarded-For` 识别客户端；T03a 时确认 Railway 代理如何设置该头，必要时配置 `advanced.ipAddress`。
2. 远程仓库是 GitHub `Jingyu-shanshan/job-seeking-app`。实际发布时由用户决定让 Railway 连接该仓库，或改用 [Railway CLI 发布](https://docs.railway.com/cli/deploying)；Railway 建**一个**服务，以项目根目录为构建上下文。T01 已提供 `npm ci`、`npm run build`、`npm start`，其中构建包含共享包、服务和 Angular，启动只运行 Fastify；桌面应用（`apps/desktop`，T21）只在用户电脑上运行，不构建也不部署，`npm ci` 只装它的 npm 包，不下载 Electron 程序本体（Electron 44 在第一次运行时才下载）。构建需要 devDependencies（TypeScript、Angular CLI）：若构建阶段已带 `NODE_ENV=production`，`npm ci` 会跳过它们而导致构建失败，届时安装命令改为 `npm ci --include=dev`，在 T03a 演练时确认。[构建/启动设置](https://docs.railway.com/builds/build-and-start-commands)
3. 在服务端配置上述变量。**每次生产迁移前确认 Neon 恢复点/备份可用**；业务表迁移已由 T02 提供，认证表由 T03 加入同一套迁移；Pre-Deploy Command 为 `npm run db:migrate`，以 Railway [Pre-Deploy Command](https://docs.railway.com/deployments/pre-deploy-command)独立运行，失败则停止发布（迁移在单个事务内执行，失败不留半套 schema）。迁移工具必须存在于预部署镜像中。生产不运行 reset、`db push`、开发迁移或示例 seed。
4. 服务提供 `/health`（进程）与 `/health/ready`（5 秒内完成的数据库查询，失败返回 503）；`pg.Pool` 处理 idle 连接错误及 Neon 休眠唤醒后的重连。Railway 发布健康检查使用 `/health/ready`，超时须容纳数据库唤醒；该检查只覆盖部署切流，日常可用性需另行监测。[Railway 健康检查](https://docs.railway.com/deployments/healthchecks)
5. 发布后检查 HTTPS、登录/退出、未授权访问、JD 导入、事实确认、PDF 归档与导出，以及本地执行器用令牌领取任务、吊销令牌后被拒；执行一次备份到隔离数据库的恢复。应用回滚到上个构建时保持数据库迁移向前兼容，不对生产做破坏性 down migration。

Railway 已[弃用 `railway.toml`/`railway.json`](https://docs.railway.com/config-as-code)，新服务不能启用旧格式；本仓库不创建空配置。未来确需配置即代码时采用 [`.railway/railway.ts`](https://docs.railway.com/infrastructure-as-code) 并以当前文档核对。

## 从参考仓库借用的流程

作者本机的 `freelance-web-platform` 项目（未纳入本仓库，他人无法打开）中的 `docs/runbooks/deployment.md` 和 API 配置证明了 `PORT`、独立迁移、`/health`、`/health/ready`、pooled/direct URL 分工及回滚流程的用法。该项目没有现成 Railway 配置文件；它的 Next/Medusa/多 Demo 服务和定时重置数据流程不适用于这个单用户工作台，不复制到本仓库。
