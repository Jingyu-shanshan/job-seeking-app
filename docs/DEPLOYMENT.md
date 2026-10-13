# Railway + Neon 部署计划

更新：2026-10-13。**T12 发布进行中：T03a 演练已通过，独立生产环境已创建，现有数据库已迁入；生产应用与登录验收尚未完成。** 用户已选择让 Railway 连接现有 GitHub 公开仓库的 `main` 分支自动发布，并迁移现有本地资料和投递记录。T03a 的不含个人数据预部署演练仍须先完成，再迁入真实数据并完成正式发布验收。`npm ci`、`npm run build`、`npm start`、`npm run db:migrate` 和 `npm run auth:create-account` 已实现。

## 拓扑

一个 Railway 服务运行 Node 24 + Fastify，同时提供 Angular 静态页面和同源 `/api`；生产 PostgreSQL 在 Neon。这样不需要第二个 Web 服务、跨源 Cookie 或前端数据库变量。Railway 的 [`PORT` 与 `0.0.0.0` 要求](https://docs.railway.com/networking/troubleshooting/application-failed-to-respond)在 T01 实现，本地开发默认只监听 loopback。Railway 从仓库根目录依次构建共享包、服务和 Angular；应用启动前执行数据库迁移。

个人事实、JD 快照、申请状态及有大小上限的实际投递文件都以 Neon 为主数据。Railway 容器目录仅可用于临时构建/处理；若以后附件规模不适合 PostgreSQL，再评估 [Railway Storage Bucket](https://docs.railway.com/storage-buckets)。不为 V0.1 先添 Volume 或对象存储。

## 需要的环境变量

| 变量                                             | 位置                             | 用途                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                   | Railway 服务变量；仅后端代码读取 | 使用 Neon **direct** PostgreSQL URL（主机没有 `-pooler`），把 `sslmode=require` 改为 `sslmode=verify-full`。生产服务和迁移拒绝其他模式，保留证书与主机名校验。小 `pg.Pool` 用于运行时，迁移也用该 URL。本地、演练和生产连接分开。[Neon 连接说明](https://github.com/neondatabase/website/blob/main/content/docs/get-started/connect-neon.md) |
| `BETTER_AUTH_SECRET`                             | Railway 服务变量；仅后端代码读取 | 高熵会话密钥（`openssl rand -base64 32`，服务要求至少 32 个字符）；不写进前端或 Git。迁移命令不读取它。[Better Auth 安装说明](https://better-auth.com/docs/installation)                                                                                                                                                                     |
| `BETTER_AUTH_URL`                                | Railway 服务变量；仅后端代码读取 | 实际 HTTPS 应用来源（如 `https://<服务>.up.railway.app`）；生产必须是 https，会话 Cookie 因此带 Secure。它也是生产中唯一受信的 `Origin`：从其他地址（包括同一服务的另一个域名）发出的写请求和登录都会被拒，换域名时要同步修改。本地默认 `http://127.0.0.1:$PORT`。                                                                           |
| `NODE_ENV=production`                            | Railway 服务端                   | 生产行为与安全 Cookie。                                                                                                                                                                                                                                                                                                                      |
| `PORT`                                           | Railway 注入                     | 服务读取平台端口，不在仓库固定。                                                                                                                                                                                                                                                                                                             |
| `DEEPSEEK_API_KEY`                               | Railway 服务变量；仅后端代码读取 | 总结、匹配和材料生成所需的模型密钥；缺少时这些操作返回 503。迁移与登录不需要它。                                                                                                                                                                                                                                                             |
| `RAILPACK_NODE_NPM_INSTALL=npm ci --include=dev` | Railway 服务变量；构建阶段       | 按 lockfile 安装，并明确保留 TypeScript、Angular CLI 等构建依赖。[Railpack 安装建议](https://railpack.com/config/recommendations)                                                                                                                                                                                                            |

变量放在 [Railway Service Variables](https://docs.railway.com/variables)；这些变量**在构建和运行阶段都可见**，因此 Angular 构建脚本不得读取或内嵌数据库 URL、会话密钥或模型密钥，发布前检查最终 JS bundle。保留 Neon URL 的 TLS 证书校验，不使用 `rejectUnauthorized: false`。

Neon 支持 `channel_binding=require`，但当前 `pg` 的 URL 参数不会独自启用或强制 channel binding；它需在 Pool/Client 配置中设置 `enableChannelBinding: true` 才在服务器提供时使用 SCRAM-SHA-256-PLUS。本次使用 `verify-full`，不把 URL 中的 `channel_binding` 当成已强制生效的安全保证。[Neon TLS](https://github.com/neondatabase/website/blob/main/content/docs/connect/connect-securely.md)、[node-postgres SSL](https://node-postgres.com/features/ssl)

V0.1 单用户、单服务先用 direct URL，避免多余连接配置。若连接数或实例数确实需要 Neon pooler，届时改为 pooled `DATABASE_URL`（主机含 `-pooler`），另加 direct `DIRECT_URL` 供迁移、备份与需要会话特性的操作；两者职责的用法见文末“从参考仓库借用的流程”，使用前再核对所选迁移工具。[Neon pooled/direct 说明](https://github.com/neondatabase/website/blob/main/content/docs/get-started/connect-neon.md)

## 本地投递执行器

代填和提交申请表的执行器（`apps/runner`，T17）**不部署到 Railway**：它在用户电脑上运行，打开可见的浏览器窗口。它只通过 HTTPS 调用本服务的 API（`JSA_APP_URL`），用用户在应用的 Runner 页签发、可撤销的令牌认证（`JSA_RUNNER_TOKEN`，放在用户电脑上的 `.env`）；令牌只存哈希，可在界面中吊销。Railway 服务不需要 Chromium，也不直接访问招聘网站的申请页面。

## 区域与恢复窗口

- **区域**：默认 Neon AWS Frankfurt（`aws-eu-central-1`）和 Railway EU West Metal / Amsterdam（`europe-west4-drams3a`）。Neon 项目区域创建后固定，换区域须新建项目迁移；Railway 无 Volume 的服务可更换区域。数据库位于欧盟不改变 DeepSeek 调用会把选定内容发给模型供应商的事实。[Neon 区域](https://github.com/neondatabase/website/blob/main/content/docs/introduction/regions.md)、[Railway 区域](https://docs.railway.com/deployments/regions)
- **环境隔离**：演练和生产分别创建独立的 Neon 项目与 Railway 项目，使用各自的密钥、账户和 URL；演练项目只放编造数据，不从生产分支复制。生产数据库放在项目的 root branch（初始 `main`），避免把 child branch 当作可直接做时间点恢复的生产库。
- **PostgreSQL 版本**：Neon 自 2026-06-05 起默认创建 PostgreSQL 18 项目，仍支持 14–17。本地容器和 CI 用 18，新建演练与生产项目都选 18。[Neon 官方更新](https://github.com/neondatabase/website/blob/main/content/changelog/2026-06-05.md)
- **恢复窗口**：本次演练与生产均为 Free，实际项目配置已确认 `history_retention_seconds=21600`；演练已按记录时间点创建隔离恢复分支并核对资料。每次生产迁移前仍须实核历史窗口、最早可恢复时间及恢复方式，并私下登记。2026-10-13 官方套餐说明为 Free 最长 6 小时且最多 1 GB 变更历史、Launch 最长 7 天、Scale 最长 30 天；时间点恢复只支持 root branches。这些套餐上限不等于本项目已经有可用恢复点。每次生产迁移前重新确认可恢复状态。[Neon 套餐](https://github.com/neondatabase/website/blob/main/content/docs/introduction/plans.md)

按 2026-10-11 用户决定，T10 不提供用户备份功能、日常自动备份或云端备份存储；手动 PostgreSQL 导出与隔离恢复仍是维护操作。

## 数据导出与手动隔离恢复（T10）

登录后的 `/export` 页下载一个 ZIP：`facts.md` 可在 Facts 页重新导入为待确认事实；`applications.md` 列出申请状态与投递文件；`data.json` 保存全部业务表，附件列指向 `files/` 中的原始 PDF/截图；`manifest.json` 记录格式版本、迁移版本和各文件的大小与 SHA-256。登录凭据、会话及执行器令牌不进入导出。ZIP 含个人资料，应私下保管；它是可读副本，完整数据库恢复使用 PostgreSQL 工具。当前 ZIP 在内存中生成，大量附件接近服务的内存上限时需要改为流式导出。

2026-10-11 用户决定保留数据导出，取消面向用户的数据库备份、日常自动备份和云端备份存储。T02 的手动隔离恢复演练继续作为维护工具保留；维护者需要 `pg_dump`、`pg_restore` 和 `psql`，客户端版本不得早于数据库版本（本地与 CI 是 PostgreSQL 18）。

```bash
# TEST_DATABASE_URL 指向允许创建一次性数据库的本地测试服务器。
# 只写入编造数据，手动执行 pg_dump → 隔离库 pg_restore。
npm run db:restore-drill
```

演练脚本创建源库与恢复库，迁移并写入各表的样例数据，以 `pg_dump --format=custom --no-owner` 导出，再用 `pg_restore --no-owner --exit-on-error --single-transaction` 恢复到隔离库。随后逐表比对行数与校验值，并核对实际投递文件哈希、不可变规则和迁移状态；结束后清理临时文件和两个一次性库，不写主库。这个样例演练不能替代 T12 对现有完整数据库的迁移核验。

## 现有本地数据库迁入 Neon（T12）

1. 先完成不含个人数据的云端演练；核对本地库的 `pgmigrations` 与发布版本，确认 Neon 生产目标是新空库，已有数据时停止，不覆盖。暂停本地服务、执行器及其他写入，完成未结束的投递处理，固定迁移切换点；导出后不继续写本地库。
2. 使用 PostgreSQL 18 客户端，将完整本地数据库导出到本机私有、Git 忽略的目录。完整 dump 包括业务表、原始 PDF/截图、认证表、执行器令牌哈希、批准与回执及 `pgmigrations`；它含敏感数据，不能进入 Git、构建上下文、日志或演练项目。连接信息只由私有环境或受保护的 PostgreSQL 连接配置提供，不在文档、命令记录或输出里写实际值。

   ```bash
   # 两个 URL 来自私有配置；目标是 Neon production root branch 上的新空库。
   umask 077
   pg_dump --format=custom --no-owner --no-acl \
     --file "<私有目录>/database.dump" "$LOCAL_DATABASE_URL"
   pg_restore --no-owner --no-acl --exit-on-error --single-transaction \
     --dbname "$NEON_DATABASE_URL" "<私有目录>/database.dump"
   ```

3. **目标库不先运行迁移或 seed。** dump 已含 schema 和迁移状态，先完整恢复；单事务恢复失败时停止，核对错误后再对确认为空的目标重试，不使用 `--clean` 覆盖已有库。所有表在源库与目标库用相同时区、稳定排序计算行数和内容摘要，包括认证表、执行器表与 `pgmigrations`；有序列时也核对其状态。仅在私有目录保存摘要，不打印真实行。对 `document_pdf`、`application_file` 以及填写/提交截图逐个重新计算原始 bytes 的 SHA-256，与源库对应 bytes 的哈希核对；PDF 和申请文件还须与存储哈希一致，引用 PDF 的申请文件按其对应 PDF 核对。申请状态、批准、事实版本引用和冻结来源均须一致。
4. 核对完成后用发布版本执行 `npm run db:migrate`，已有迁移应不再执行；若有待执行项，先确认恢复点并记录变更，再迁移。生产第一次启动前完成上述比较，避免登录或执行器活动改变会话与联系时间，使摘要失去同一快照的意义。恢复已有认证账户时使用原账户登录，不再运行账户创建命令。
5. 再从 Neon 数据库做完整私有 dump，在生产项目内另建独立空数据库，使用其单独 URL 按相同命令做隔离恢复，核对逐表摘要、迁移状态、申请状态和原始附件哈希。隔离服务验证已有账户登录、历史申请读取、PDF 下载和导出；不可变规则的验证只在隔离库进行，不在生产库试写。恢复验证不调用模型、不提交申请，不把真实资料复制到编造数据的演练项目。验证后清理隔离库和不再需要的临时副本，保留必要的私有迁移记录；生产保持原库。
6. 完成验收才切换桌面应用和本地执行器的 `JSA_APP_URL` 为生产 HTTPS 来源，核对生产签发的令牌及吊销行为；本地旧库保持只读，避免出现两个继续写入的主库。迁移或验收失败时维持原切换点，不让两个环境重复执行投递。完整恢复始终先到新空库，确认登录和历史记录可用后再切换连接。

PostgreSQL 18 的本机工具连接 Neon 时同样保持 `sslmode=verify-full`。本机没有 `~/.postgresql/root.crt` 时，使用 `PGSSLROOTCERT=system` 指定系统可信根证书；不要为恢复操作关闭证书校验。[PostgreSQL TLS 与根证书](https://www.postgresql.org/docs/18/libpq-ssl.html)

## 发布顺序与验收（T12）

1. 创建上述独立演练环境，在编造数据上验证业务与认证表迁移、首次登录、健康检查和隔离恢复。公开注册始终关闭；只有空库需要用 `railway run npm run auth:create-account -- <email>` 创建演练账户，密码在本机终端输入。Better Auth 生产默认限流，计数在单进程内存中；Railway 部署使用 `advanced.ipAddress.ipAddressHeaders: ['x-real-ip']`，不信任客户可传的 XFF。官方列出的客户端 IP 头是 `X-Real-IP`，演练还须发送伪造的 X-Real-IP/XFF，确认会话记录的是代理确定的实际 IP。现有固定 `BETTER_AUTH_URL` 足够，不启用泛用 `trustProxy: true` 或动态来源推断。[Railway 请求头](https://docs.railway.com/networking/public-networking/specs-and-limits)、[Better Auth IP 设置](https://better-auth.com/docs/reference/security#ip-address-headers)
2. Railway 连接现有 GitHub 仓库的 `main` 分支自动发布，先启用 Wait for CI，CI 通过才发布；T12 代码通过审核并合入 `main` 后再开启生产首次部署，避免空库在恢复前自动运行迁移。以仓库根目录为构建上下文，Builder 用 Railpack，Build Command 为 `npm run build`，Start Command 为 `npm start`。`.nvmrc` 固定 Node 24；`RAILPACK_NODE_NPM_INSTALL=npm ci --include=dev` 明确保留构建依赖。Railpack 自身已有 `NPM_CONFIG_PRODUCTION=false`，不能仅凭 `NODE_ENV=production` 断言它会省略 devDependencies。桌面应用和执行器只在用户电脑运行，不构建或部署，不下载 Electron/Chromium。[GitHub 自动发布](https://docs.railway.com/deployments/github-autodeploys)、[Railpack Node](https://railpack.com/languages/node/)
3. 创建生产环境并按上节迁入现有本地数据库；配置服务端变量并确认恢复点可用。Pre-Deploy Command 为 `npm run db:migrate`，**Pre-deploy Timeout 设为 300 秒**；默认没有超时，失败不重试且停止发布。迁移在应用镜像的独立容器中执行，迁移依赖必须存在于该镜像；不依赖其文件写入持久化。业务与认证迁移在单事务内执行，失败不留半套 schema。生产不运行 reset、`db push`、开发迁移或示例 seed。[Pre-deploy](https://docs.railway.com/deployments/pre-deploy-command)
4. 服务提供 `/health`（进程）与 `/health/ready`（5 秒内完成数据库查询，失败返回 503）；`pg.Pool` 处理 idle 连接错误及 Neon 休眠唤醒后的重连。Railway Healthcheck Path 为 `/health/ready`，**Healthcheck Timeout 为 300 秒**，给数据库唤醒留余量。该检查只覆盖部署切流，日常可用性需另行监测。Railway HTTP 无数据传输 5 分钟关闭，持续传输最长 15 分钟，上传体须在 5 分钟内完成；应用自己的超时和文件上限仍适用。[健康检查](https://docs.railway.com/deployments/healthchecks)、[公共网络限制](https://docs.railway.com/networking/public-networking/specs-and-limits)
5. 验收 HTTPS、登录/退出、未授权访问、资料和历史投递记录、实际 PDF 下载、导出、隔离恢复及重新部署后的数据完整性；检查最终前端 bundle 不含服务端密钥。模型调用和真实申请提交不属于部署烟测，仍需逐次明确批准。演练环境用编造任务验证执行器；生产只验证本地执行器能以令牌连接 API，以及吊销后被拒，不在生产创建示例任务或按真实申请的 Submit。

## 应用回滚

只回滚到**已确认兼容当前同一份 schema** 的上一个构建，数据库迁移保留向前，不执行破坏性 down migration。演练应在迁移后的数据库上跑前后两个兼容构建，验证登录、历史申请和附件，再把这个范围记入私有发布记录。

不能任意回滚到 T09 之前的构建：这些版本的申请写入路径没有当前的 `method`、冻结来源和文件记录约定，旧写入可能失败或破坏投递追溯。需要更早版本时先评估兼容性并做向前修复；数据库恢复另按新空库、隔离核验和显式连接切换执行，不能用构建回滚代替。

Railway 已[弃用 `railway.toml`/`railway.json`](https://docs.railway.com/config-as-code)，新服务不能启用旧格式，已有旧服务的读取将在 2026-12-01 截止。本次用控制台配置单服务，不增加配置依赖；确需配置即代码时采用 [`.railway/railway.ts`](https://docs.railway.com/infrastructure-as-code)，经 CLI plan/apply 管理，不假定 GitHub 构建会自动应用它。

## 从参考仓库借用的流程

作者本机的 `freelance-web-platform` 项目（未纳入本仓库，他人无法打开）中的 `docs/runbooks/deployment.md` 和 API 配置证明了 `PORT`、独立迁移、`/health`、`/health/ready`、pooled/direct URL 分工及回滚流程的用法。该项目没有现成 Railway 配置文件；它的 Next/Medusa/多 Demo 服务和定时重置数据流程不适用于这个单用户工作台，不复制到本仓库。
