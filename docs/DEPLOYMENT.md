# Railway + Neon 部署计划

更新：2026-09-29。**这是未来发布步骤，尚无可运行应用、Railway 项目或 Neon 数据库；下列 npm 脚本名称须在 T01/T02 实现后核对。** 源码仍只在本地 Git，当前不发布。

## 拓扑

一个 Railway 服务运行 Fastify，同时提供 Angular 静态页面和同源 `/api`；生产 PostgreSQL 在 Neon。这样不需要第二个 Web 服务、跨源 Cookie 或前端数据库变量。Railway 的 [`PORT` 与 `0.0.0.0` 要求](https://docs.railway.com/networking/troubleshooting/application-failed-to-respond)在 T01 实现，本地开发默认只监听 loopback。Railway 从仓库根目录构建两个 npm 工作区；应用启动前执行数据库迁移。

个人事实、JD 快照、申请状态及有大小上限的实际投递文件都以 Neon 为主数据。Railway 容器目录仅可用于临时构建/处理；若以后附件规模不适合 PostgreSQL，再评估 [Railway Storage Bucket](https://docs.railway.com/storage-buckets)。不为 V0.1 先添 Volume 或对象存储。

## 需要的环境变量

| 变量 | 位置 | 用途 |
| --- | --- | --- |
| `DATABASE_URL` | Railway 服务变量；仅后端代码读取 | 先使用 Neon **direct** PostgreSQL URL，包含 `sslmode=require`；小 `pg.Pool` 用于运行时，迁移也用该 URL。开发与生产必须指向不同数据库/分支。[Neon 连接说明](https://github.com/neondatabase/website/blob/main/content/docs/get-started/connect-neon.md) |
| `BETTER_AUTH_SECRET` | Railway 服务变量；仅后端代码读取 | 高熵会话密钥；不写进前端或 Git。[Better Auth 安装说明](https://better-auth.com/docs/installation) |
| `BETTER_AUTH_URL` | Railway 服务变量；仅后端代码读取 | 实际 HTTPS 应用来源；本地使用本地地址，生产使用 Railway/自定义域名。 |
| `NODE_ENV=production` | Railway 服务端 | 生产行为与安全 Cookie。 |
| `PORT` | Railway 注入 | 服务读取平台端口，不在仓库固定。 |

模型供应商确定后再添加其 API Key。变量放在 [Railway Service Variables](https://docs.railway.com/variables)；这些变量**在构建和运行阶段都可见**，因此 Angular 构建脚本不得读取或内嵌数据库 URL、会话密钥或模型密钥，发布前检查最终 JS bundle。保留 Neon URL 的 TLS 证书校验，不使用 `rejectUnauthorized: false`。

V0.1 单用户、单服务先用 direct URL，避免多余连接配置。若连接数或实例数确实需要 Neon pooler，届时改为 pooled `DATABASE_URL`（主机含 `-pooler`），另加 direct `DIRECT_URL` 供迁移、备份与需要会话特性的操作；两者职责参考[本地参考项目的部署手册](/Users/wass/Workspace/freelance-web-platform/docs/runbooks/deployment.md)，使用前再核对所选迁移工具。[Neon pooled/direct 说明](https://github.com/neondatabase/website/blob/main/content/docs/get-started/connect-neon.md)

## 发布顺序（T12 才执行）

1. 建独立 Neon 开发/生产分支或项目；在非生产库验证**业务和 Better Auth 认证表**的版本化 SQL 迁移、首次登录与隔离恢复。准备受控的首次账户创建，生产关闭公开注册。
2. 本仓库目前只有本地 Git、没有远程地址。实际发布时先由用户选定并配置远程仓库供 Railway 连接，或改用 [Railway CLI 发布](https://docs.railway.com/cli/deploying)；Railway 建**一个**服务，以项目根目录为构建上下文。T01 提供 `npm ci`、`npm run build`、`npm start`，其中构建包含 Angular 与服务，启动只运行 Fastify。[构建/启动设置](https://docs.railway.com/builds/build-and-start-commands)
3. 在服务端配置上述变量。**每次生产迁移前确认 Neon 恢复点/备份可用**；T02/T03 提供包含业务与认证表的生产迁移脚本，以 Railway [Pre-Deploy Command](https://docs.railway.com/deployments/pre-deploy-command)独立运行，失败则停止发布。迁移工具必须存在于预部署镜像中。生产不运行 reset、`db push`、开发迁移或示例 seed。
4. 服务提供 `/health`（进程）与 `/health/ready`（含有界数据库查询）；`pg.Pool` 处理 idle 连接错误及 Neon 休眠唤醒后的重连。Railway 发布健康检查使用 `/health/ready`，超时须容纳数据库唤醒；该检查只覆盖部署切流，日常可用性需另行监测。[Railway 健康检查](https://docs.railway.com/deployments/healthchecks)
5. 发布后检查 HTTPS、登录/退出、未授权访问、JD 导入、事实确认、PDF 归档与导出；执行一次备份到隔离数据库的恢复。应用回滚到上个构建时保持数据库迁移向前兼容，不对生产做破坏性 down migration。

Railway 已[弃用 `railway.toml`/`railway.json`](https://docs.railway.com/config-as-code)，新服务不能启用旧格式；本仓库不创建空配置。未来确需配置即代码时采用 [`.railway/railway.ts`](https://docs.railway.com/infrastructure-as-code) 并以当前文档核对。

## 从参考仓库借用的流程

本机 `freelance-web-platform` 的 [`docs/runbooks/deployment.md`](/Users/wass/Workspace/freelance-web-platform/docs/runbooks/deployment.md) 和 API 配置证明了 `PORT`、独立迁移、`/health`、`/health/ready`、pooled/direct URL 分工及回滚流程的用法。该项目没有现成 Railway 配置文件；它的 Next/Medusa/多 Demo 服务和定时重置数据流程不适用于这个单用户工作台，不复制到本仓库。
