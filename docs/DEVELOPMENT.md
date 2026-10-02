# 开发文档与技术决策

更新：2026-09-30（新增：先验证核心回路、不可变事实版本、共享契约与工程约定、隐私与备份；同日产品方向调整为发现职位并在逐个批准后代为提交，见下节）；2026-10-01 补充 T02 的数据库实现、T03 的认证实现、T15 的来源目录和 T13 的职位发现。本文是本仓库的实施决策；[原始方案](PRODUCT_PLAN.md) 保留原文。原方案中的本地优先、Markdown 主数据和 SQLite 是此前设计；本轮为了后续部署到 Railway + Neon，按**云端 PostgreSQL 为主数据**规划。Markdown 仍可导入/导出。完全离线版若仍需要，应另行设计同步和冲突处理，不在 V0.1 同时维护两套数据库。当前已有 T01 骨架、T02 的数据库表与迁移、T03 的单用户登录、T15 的来源目录与搜索范围，以及 T13 从 Greenhouse 和 Ashby 招聘板块发现职位；还不能导入 JD 原文。

## 产品方向调整（2026-09-30）

用户在 S0 之后决定：不要一个“帮我手动投递”的工作台，要一个能替用户完成投递的应用。本节覆盖原方案和此前文档中“系统不发送申请、用户自行投递”的设定。

| 项目 | 此前 | 现在 |
| --- | --- | --- |
| 职位来源 | 用户粘贴 JD；V0.2 再接一种 ATS | 应用提供来源目录，用户勾选启用；发现与筛选进入 V0.1 |
| 提交 | 用户在招聘网站自行提交 | 应用代填申请表；**用户逐个批准后由应用提交** |
| 填表位置 | 无 | 用户电脑上的本地执行器（可见的浏览器窗口） |
| 模型供应商 | 待定 | DeepSeek API |
| 面试准备 | 按需求另行拆任务 | 列入路线（T19，首次真实投递之后） |

没有改变的：材料只用本人确认的事实且逐条可追溯；未知的硬条件不算满足；只处理用户选中的职位，不做海投；外部内容不能授权任何操作。

三点现实约束，决定了上面的设计：

1. **提交只能走浏览器。** Greenhouse、Lever、Ashby 的公开接口只开放读取职位；提交申请的接口需要招聘方自己的密钥，个人拿不到（T17 前按当时的官方文档复核）。所以代填和提交由 Playwright 驱动真实浏览器完成，并且按申请表类型逐个适配。
2. **执行器在本地。** 验证码、登录和无法识别的问题需要用户当场处理，机房地址也更容易被拦截，因此浏览器开在用户电脑上并保持可见。应用不破解验证码、不做反检测；遇到就暂停交给用户。
3. **不是所有网站都能自动抓取，但都能用上。** 用户要求先做赫尔辛基、之后覆盖全球，并用上 LinkedIn、Upwork、58 等网站。2026-09-30 核对、2026-10-01 复核的结果决定了每个网站走哪条路（应用里的来源目录见 T15）：

   | 网站 | 核对结果 | 接入方式 |
   | --- | --- | --- |
   | 公司招聘板块（Greenhouse、Ashby 等） | 有公开读取接口，无需登录 | `board_api`，自动 |
   | LinkedIn | 用户协议禁止用脚本、机器人、浏览器扩展等抓取或自动化操作；没有面向个人的职位接口 | `email_alert`（职位提醒邮件）+ `manual` |
   | Upwork | RSS 已于 2024-08-20 停用；有官方 GraphQL API，需用自己的账号申请 key。2026-10-01 复核：申请 key 有资格要求（搜索结果称包括较高的平台累计收支，原帮助页面返回 403，未能打开核对），条款未审 | 目前只用 `email_alert`（保存搜索并开启邮件提醒）；拿到 key 并审过条款后再加 `official_api` |
   | Työmarkkinatori | 官方检索接口只对有 Y-tunnus 的组织开放，需向 KEHA 申请 | `email_alert` + `manual` |
   | Duunitori | 存在一个能返回 JSON 的接口，但 `robots.txt` 禁止 `/api/`，没有找到公开的使用条款。2026-10-01 复核：`robots.txt` 已改为禁止全部路径 | 未获许可前不自动请求；`email_alert` + `manual` |
   | Jooble、Remotive 等聚合站 | 有官方 API（Jooble 需免费 key；Remotive 限远程岗位并有使用条件） | `official_api`，逐个核对条款后加入 |
   | 58 | 只找到面向招聘方/合作方的开放平台，没有找到面向求职者的职位检索接口（未深入核对） | `manual` |

   用账号做后台抓取或自动操作有被限制账号的风险，本项目不做，也不做验证码破解和反检测。“搜索范围”是独立的用户设置（默认赫尔辛基，可扩大到全球），与来源的接入方式无关。

## V0.1 范围

发现 → 筛选 → 总结 JD → 用户选择职位 → 生成简历/求职信 → 人工审核和 PDF → 代填申请表 → 用户逐个批准 → 提交并冻结投递版本 → 验证完整导出/恢复。第一版只做一种来源适配器和一种申请表适配器，其余来源先用粘贴方式进入同一流程。只生成、导出或打开申请页都不代表已申请；提交成功或用户手动登记才算。

V0.2 做面试准备（T19）、运行预设与预算（T14）以及更多来源/申请表适配器。Electron、公司研究、DeepSeek Harness、离线同步、图谱和多用户都不阻塞 V0.1。

## 实施顺序（2026-09-30 调整）

S0 已完成：一次性脚本（`/scratch/` + `/vault/`，均不入 Git）跑通了“事实 → JD 要求 → 匹配 → 有引用的草稿 → 确定性校验”，用户确认草稿可以投出。保留项是模型输出当时由会话内的 Claude 产出，DeepSeek 的真实调用在 T05 首次接入时补验。接下来是 T01–T03 的骨架；骨架完成后用 T03a 做一次不含个人数据的预部署演练，云端风险不留到 T12。之后按 [任务清单](TASKS.md) 的顺序，**先做赫尔辛基的职位搜索**：T01 → T02 → T15 → T13 → T05，然后是 T04、T06、T20 → 材料（T07、T08）→ 代填与提交（T16、T17、T18、T09）。T03/T03a 在第一次云端部署前完成，不阻塞本地的发现功能。做完 T08 时已经能用生成的材料自己投递，执行器不是前面任务的前置条件。

## 已选技术栈

| 层 | 选择 | 边界与依据 |
| --- | --- | --- |
| Web | Angular 22 + TypeScript 6.0.x | 使用框架自带路由/表单；[兼容表](https://angular.dev/reference/versions)要求 Node `^24.15.0` 等受支持版本、TypeScript `>=6.0.0 <6.1.0`。 |
| 服务 | Node.js 24 LTS + Fastify 5 | 一个进程提供 `/api` 与 Angular 构建产物；按需用 [`@fastify/static`](https://github.com/fastify/fastify-static)，同源会话，不先拆第二个前端服务。 |
| 数据库 | PostgreSQL；生产使用 Neon | 开发用本地 PostgreSQL 或独立 Neon 开发分支，生产数据不能用于测试。事实、JD 快照、材料、申请和审核记录均有同一主数据位置。本地容器和 CI 用 PostgreSQL 18（Neon 支持 14–18，2026-10-01 核对）；创建 Neon 项目时选同一主版本，否则同步修改 CI 镜像和本地命令。 |
| 数据访问 | [`pg`/node-postgres](https://node-postgres.com/features/pooling) 的小连接池 | Railway 是常驻 Node 服务，可直接使用标准 PostgreSQL TCP 连接；先用 Neon **direct** `DATABASE_URL`。处理 idle `error` 和 Neon 休眠后的重连；连接压力确有需要时再改用 pooler。无需额外 serverless 驱动或 ORM。URL 必须带 `sslmode=verify-full`：`pg` 目前把 `require` 当作 `verify-full`，但已声明下个大版本改为 libpq 语义（不校验证书），所以生产环境下服务拒绝其他取值。 |
| 迁移 | [`node-pg-migrate`](https://salsita.github.io/node-pg-migrate/) + 版本化 SQL | 复用迁移状态与并发锁，生产迁移在 Railway pre-deploy 独立执行（`npm run db:migrate`）；使用 Neon direct URL，不在每次请求或服务启动时改 schema。迁移是 `apps/server/migrations/` 下只含 up 部分的 SQL 文件，已执行过的文件不再修改。 |
| 身份验证 | [Better Auth](https://better-auth.com/docs/integrations/fastify) + PostgreSQL | 复用会话与密码处理；生产关闭公开注册，首次账户由受控初始化流程创建。[生成的认证 SQL](https://better-auth.com/docs/concepts/database) 纳入同一版本化迁移，不在生产启动时自动修改 schema。所有资料 API 都必须检查会话。T03 已实现（Better Auth 1.7.7）：邮箱 + 密码、一个账户（数据库唯一索引保证），公开注册在所有环境关闭，账户只能用 `npm run auth:create-account` 在终端创建；`/api` 下除 `/api/auth/*` 外默认要求会话，所有写请求要求受信 `Origin`。前端直接用 `HttpClient` 调 Better Auth 接口，不引入其客户端库。 |
| 附件与便携格式 | PostgreSQL `TEXT`/`JSONB`，小文件用限额 `BYTEA`；Markdown/JSON/PDF 导出 | 已确认事实的正文和版本在数据库；Obsidian Vault 作为导入/导出格式。原始 JD、实际投递 PDF 均持久化并保留哈希。若文件规模使数据库成本或备份不可接受，再用 [Railway Storage Bucket](https://docs.railway.com/storage-buckets)，不把容器目录当主数据。 |
| 检索 | PostgreSQL 全文检索，实际需要时建索引 | 不继续使用 SQLite FTS5，也不预装向量库。 |
| 模型 | DeepSeek API（2026-09-30 用户选定），固定步骤直接调用 | 用于 JD 要求抽取与总结、匹配解释、材料草稿、表单问题到已有答案的映射。接口与 JSON 输出方式在 T05 接入前核对当时的官方文档，并限制每次运行的请求数和费用。模型不能确认事实，也不能替用户回答新问题。数据会离开欧盟处理，因此只发送标记为可外发的事实（见下方规则）。 |
| PDF | HTML/CSS + 浏览器打印先验证 | PDF 质量、文本提取和实际投递文件归档仍须验收。 |
| 职位来源 | 来源目录 + 逐个适配器，原生 `fetch` | 接入方式四种：`board_api`、`official_api`、`email_alert`、`manual`。先做 Greenhouse 公开招聘板块接口，第二种做 Ashby（2026-09-30 决定）；每个来源记录接入方式、条款核对日期和限流。不写通用爬虫。 |
| 投递执行器 | 本地 Node 进程 + [Playwright](https://playwright.dev/)，可见浏览器窗口 | npm 工作区 `apps/runner`（T17 创建），不部署到 Railway。用可撤销的令牌向 API 领取已批准的任务并回传预览、结果和回执。先做 Greenhouse 托管的申请表，第二种做 Ashby。 |
| 共享契约 | npm 工作区 `packages/shared` + [TypeBox](https://github.com/sinclairzx81/typebox)（MIT） | Web 与 API 共用的 schema/类型：Fastify 通过 `@fastify/type-provider-typebox` 用它校验和序列化，Angular 只导入类型（TypeBox 不进浏览器包）。共享包以构建产物 `dist/` 被引用，改动后需重新构建。 |
| 测试与质量 | `node:test`（服务端、共享包）+ Vitest（Angular CLI 默认）；ESLint + Prettier；GitHub Actions | T01 已定。服务端和共享包直接用 Node 的类型剥离运行 TypeScript，不装 ts-node/tsx，因此相对导入带 `.ts` 后缀且只用可擦除语法。ESLint 禁止 `apps/server/src/rules/` 导入 Fastify 或 `pg`。CI 依次执行 lint、typecheck、build、test。不用 ORM，所以数据层测试必须连真实 PostgreSQL（本地容器或独立 Neon 分支），不用 mock 代替：测试从 `TEST_DATABASE_URL` 指向的服务器上为每个测试文件新建并删除临时库；本地未设置时跳过，CI 用 PostgreSQL 服务容器，未设置则直接失败。真实命令见 `CLAUDE.md`。 |

具体版本以 `package-lock.json` 为准（T01 确定）。候选库与许可证见 [开源复用清单](OPEN_SOURCE_REUSE.md)，部署拓扑与步骤见 [部署文档](DEPLOYMENT.md)。

## 最小结构与数据归属

```text
apps/web/       Angular 页面：资料、JD、匹配、审核、申请记录
apps/server/    Fastify API：PostgreSQL、模型、来源适配器、导出；生产托管 Web 静态产物。
                规则（硬条件评估、陈述校验、状态流转、批准校验）放在不 import Fastify/pg 的纯模块，可脱离数据库测试
apps/runner/    本地投递执行器（T17 创建）：Playwright 填表、预览、经批准后提交；只在用户电脑上运行
packages/shared/ Web 与 API 共用的 schema 与类型
docs/           原方案、决策、任务、复用调研和部署步骤
```

V0.1 的业务对象是 `Fact`、`Source`、`JobSnapshot`、`Match`、`Artifact`、`ProfileAnswer`（表单答案）、`Approval` 和 `Application`；不为平台化预建服务。事实采用不可变版本：`fact` 是稳定身份，只追加的 `fact_version` 保存正文、哈希、来源、确认状态和可见性；确认绑定到版本，编辑正文即产生新的 proposed 版本，“正文变化使旧确认失效”因此无需额外逻辑。材料中的每条陈述和冻结的申请以外键引用 `fact_version` ID 而不复制正文，历史不会漂移。可见性拆为两个独立开关：“可发送给模型供应商”与“可出现在正式材料”。原始 JD 与投递材料不能原地覆盖；用户在应用外修改最终文件时，应导入实际发送的版本。数据库中的 PDF/原件要限制单文件大小，并与结构化记录一同进入备份/恢复验证。

T02 建立的最小表（2026-10-01）：`fact`/`fact_version`；`job`（职位身份）/`job_snapshot`（抓取或粘贴的原文）/`job_requirement`（要求、JD 原文引用及子串校验结果）；`match`（合格/待确认/不合格）/`match_requirement`（每条要求的符合/不符合/未知）/`match_evidence`（支持该结论的事实版本）；`artifact`（简历或求职信）/`artifact_claim`（有序陈述）/`artifact_claim_fact`（陈述引用的事实版本）；`application`（只在已提交或待核实时存在）/`application_artifact`/`application_fact_version`。数据库直接保证的只有数据完整性：`fact_version` 只能改状态（proposed/confirmed/retired）和两个可见性开关、不能删除；`job_snapshot` 不能修改，同一职位的相同正文只存一份，被引用时不能删除；两者的 SHA-256 由触发器计算；新事实版本默认 proposed 且两个开关为否；所有引用都是外键，默认禁止删除被引用的行。哪些事实可以被引用、状态如何流转等需要判断的规则仍放在纯规则模块。事实类型、要求类型、匹配理由、渲染后的文件、批准、来源和表单答案由各自任务的迁移添加；材料和申请的冻结（T09）也在那时补上。

T15 的来源（2026-10-01）：来源目录是代码里的常量（`apps/server/src/sources/catalog.ts`），不进数据库，因为加一项之前必须先核对条款，这是代码评审的事；每项是一个网站加一种接入方式，所以目录里不可能出现“全网搜索”。数据库只存用户的选择：`source`（目录项 ID、参数如板块名、启用开关、上次成功/失败）和单行的 `search_scope`。一次发现运行能请求哪些来源由纯规则 `sourcesToRequest` 决定（已启用、仍在目录中、接入方式是 `board_api` 或 `official_api`），提醒邮件和粘贴的来源永远不会被请求。搜索范围只用于筛选，不影响选哪些来源。“赫尔辛基”指 Helsinki 和 Espoo，不含 Vantaa（2026-10-01 用户决定）。

T13 的发现（2026-10-01 Greenhouse，2026-10-02 Ashby）：用户在 `/jobs` 页手动运行，没有定时运行（T14 再做）。一次运行只读 `sourcesToRequest` 返回的来源，最多 20 次请求，按目录项的限额间隔请求，同一时间只有一次运行；运行在请求内同步完成。每个适配器读一个来源的全部在招职位，结果存进 `job_posting`：一行是一个来源列出的一个职位，每次成功读取时原地刷新，不再列出的标为关闭，读取失败时什么都不改。`job_posting` 不是 JD 快照：JD 原文由 T05 存入不可修改的 `job_snapshot`。同一目录项的两个来源列出同一职位 ID 时指向同一个 `job`，所以“多来源只算一个”由数据保证；跨网站的同一职位（如 LinkedIn 提醒邮件和公司板块）由 T20 按公司和标题对应。职位是否在搜索范围内由纯规则 `classifyLocation` 在读取列表时根据地点原文计算，不存库：只有所有地点都能确认在范围外才算范围外，地点缺失或认不出的归入待确认。远程职位只在用户选择包括远程时才算，且要写明可以从芬兰（或 EU、Europe、EMEA、Nordics、全球）远程；只写 “Remote” 的归入待确认，因为这类职位常常只招公司所在国的人（2026-10-01 用户决定）。各网站的写法差异由适配器抹平，地点规则只读一种格式：多个地点用 `;` 分隔，远程写在文字里（Ashby 的国家和远程字段由适配器写进地点原文）。规则的细节见 [任务清单](TASKS.md) 的 T13。

原方案的 `vault/`、`app-data/`、`artifacts/` 目录不作为 Railway 生产主数据。Railway 可以附加持久卷，但这会增加部署和扩容约束；目前一个 Neon 数据库即可承载个人 MVP 的结构化资料与有界附件。[Railway 卷说明](https://docs.railway.com/volumes)

## 不可省略的规则

- 本人确认且允许公开的事实才可进入正式材料；正文变化使旧确认失效，历史投递版本保持冻结。
- 硬条件未知单独呈现，不算通过；模型分数不能覆盖已知不满足的硬条件。
- 外部 JD、网页、邮件、申请表页面上的文字和模型输出都是不可信数据，不能授权读取密钥、改变规则、批准或提交申请。
- 提交必须有用户对**该职位**的批准。批准绑定职位快照、材料文件哈希和表单答案，任一变化即失效；一次批准只用于一次提交。结果不明时标为待核实，不自动重试。只投用户选中的职位，每次运行有数量上限。
- 表单里没有已确认答案的问题，由用户回答；模型和执行器都不能编写答案。工作许可、薪资等敏感答案只在该申请问到时使用。
- 执行器不破解验证码、不规避网站的自动化检测、不保存第三方网站的密码；遇到验证码或登录就暂停，由用户在可见窗口里处理。需要登录或条款禁止自动化的网站只支持粘贴导入。
- 云端必须先有登录和服务端会话校验；同源、HTTPS、Origin 校验、请求大小限制和敏感字段最小外发同时落实。Neon 连接只在服务端，不能进入 Angular 构建产物。
- 凭据只放 Railway 服务变量/本地受保护环境，不进 Git、导出包或日志。Railway 变量也会进入**构建环境**，构建脚本不得把它们嵌入 Angular 产物，发布前检查 bundle。Neon TLS 保持证书校验，不设置 `rejectUnauthorized: false`。
- 材料生成采用“选择再渲染”：模型只返回结构化输出，每条陈述引用事实版本 ID；由确定性代码核对数字、日期、技能与所引事实一致。无引用或校验失败的陈述不能进入材料。
- JD 要求的抽取必须引用 JD 原文片段并做子串校验；校验不过的要求标为待确认，不进入硬条件评估。
- 模型请求只包含标记为“可发送给模型供应商”的事实。供应商是 DeepSeek，数据在欧盟以外处理：姓名、电话、邮箱、住址、工作许可和薪资期望一律不进入模型请求，这些字段由应用代码直接写入材料和表单。Neon 和 Railway 的区域仍按数据合规选择。
- 备份既覆盖数据库中的事实、状态、快照与附件，也提供用户可迁移的 Markdown/JSON/PDF 导出；至少执行一次隔离恢复验证。不只依赖 Neon 单一提供方：定期 `pg_dump` 到用户控制的存储，并核对所选套餐的时间点恢复窗口。

## 开发前仍需真实输入

已有：首个 JD、个人事实样本（S0）、模型供应商（DeepSeek；API Key 已放在本地 `.env`，2026-09-30 验证可用）、首个适配对象（Greenhouse，其次 Ashby）。关注公司名单属于个人求职意向，放在已忽略的 `/vault/`，不写入本仓库。仍需确定：每次运行的模型费用上限、申请表常见问题的答案（T16）、账户初始化方式/实际域名、Neon/Railway 区域、数据保留及备份位置（含 `pg_dump` 的存放处）。原方案的“20 个职位 / 5 套材料 / 3 个申请 / €2”仅是例子，不自动写成默认值。
