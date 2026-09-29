# 开发文档与技术决策

更新：2026-09-29。本文是本仓库的实施决策；[原始方案](PRODUCT_PLAN.md) 保留原文。原方案中的本地优先、Markdown 主数据和 SQLite 是此前设计；本轮为了后续部署到 Railway + Neon，按**云端 PostgreSQL 为主数据**规划。Markdown 仍可导入/导出。完全离线版若仍需要，应另行设计同步和冲突处理，不在 V0.1 同时维护两套数据库。当前没有产品代码或依赖。

## V0.1 范围

先处理用户手动提供的一份 JD：确认个人事实 → 显示匹配证据和未知项 → 生成简历/求职信 → 人工审核和 PDF → 冻结实际投递版本 → 验证完整导出/恢复。生成、导出或打开申请页都不代表已申请；投递由用户自行完成。

V0.2 再按关注公司接入一种公开 ATS 来源。Electron、公司研究、DeepSeek Harness、离线同步、图谱和多用户都不阻塞 V0.1。

## 已选技术栈

| 层 | 选择 | 边界与依据 |
| --- | --- | --- |
| Web | Angular 22 + TypeScript 6.0.x | 使用框架自带路由/表单；[兼容表](https://angular.dev/reference/versions)要求 Node `^24.15.0` 等受支持版本、TypeScript `>=6.0.0 <6.1.0`。 |
| 服务 | Node.js 24 LTS + Fastify 5 | 一个进程提供 `/api` 与 Angular 构建产物；按需用 [`@fastify/static`](https://github.com/fastify/fastify-static)，同源会话，不先拆第二个前端服务。 |
| 数据库 | PostgreSQL；生产使用 Neon | 开发用本地 PostgreSQL 或独立 Neon 开发分支，生产数据不能用于测试。事实、JD 快照、材料、申请和审核记录均有同一主数据位置。 |
| 数据访问 | [`pg`/node-postgres](https://node-postgres.com/features/pooling) 的小连接池 | Railway 是常驻 Node 服务，可直接使用标准 PostgreSQL TCP 连接；先用 Neon **direct** `DATABASE_URL`。处理 idle `error` 和 Neon 休眠后的重连；连接压力确有需要时再改用 pooler。无需额外 serverless 驱动或 ORM。 |
| 迁移 | [`node-pg-migrate`](https://salsita.github.io/node-pg-migrate/) + 版本化 SQL | 复用迁移状态与并发锁，生产迁移在 Railway pre-deploy 独立执行；使用 Neon direct URL，不在每次请求或服务启动时改 schema。 |
| 身份验证 | [Better Auth](https://better-auth.com/docs/integrations/fastify) + PostgreSQL | 复用会话与密码处理；生产关闭公开注册，首次账户由受控初始化流程创建。[生成的认证 SQL](https://better-auth.com/docs/concepts/database) 纳入同一版本化迁移，不在生产启动时自动修改 schema。所有资料 API 都必须检查会话。 |
| 附件与便携格式 | PostgreSQL `TEXT`/`JSONB`，小文件用限额 `BYTEA`；Markdown/JSON/PDF 导出 | 已确认事实的正文和版本在数据库；Obsidian Vault 作为导入/导出格式。原始 JD、实际投递 PDF 均持久化并保留哈希。若文件规模使数据库成本或备份不可接受，再用 [Railway Storage Bucket](https://docs.railway.com/storage-buckets)，不把容器目录当主数据。 |
| 检索 | PostgreSQL 全文检索，实际需要时建索引 | 不继续使用 SQLite FTS5，也不预装向量库。 |
| 模型/PDF | 固定步骤直接调用；HTML/CSS + 浏览器打印先验证 | 供应商待定。模型不能确认事实；PDF 质量、文本提取和实际投递文件归档仍须验收。 |

具体补丁版本和锁文件在第一个编码任务确定。候选库与许可证见 [开源复用清单](OPEN_SOURCE_REUSE.md)，部署拓扑与步骤见 [部署文档](DEPLOYMENT.md)。

## 最小结构与数据归属

```text
apps/web/       Angular 页面：资料、JD、匹配、审核、申请记录
apps/server/    Fastify API：规则、PostgreSQL、模型、导出；生产托管 Web 静态产物
docs/           原方案、决策、任务、复用调研和部署步骤
```

V0.1 只需 `Fact`、`JobSnapshot`、`Match`、`Artifact`、`Application` 等真实业务对象；不为平台化预建服务。事实保留来源、确认状态、公开范围、正文哈希和版本。原始 JD 与投递材料不能原地覆盖；用户在应用外修改最终文件时，应导入实际发送的版本。数据库中的 PDF/原件要限制单文件大小，并与结构化记录一同进入备份/恢复验证。

原方案的 `vault/`、`app-data/`、`artifacts/` 目录不作为 Railway 生产主数据。Railway 可以附加持久卷，但这会增加部署和扩容约束；目前一个 Neon 数据库即可承载个人 MVP 的结构化资料与有界附件。[Railway 卷说明](https://docs.railway.com/volumes)

## 不可省略的规则

- 本人确认且允许公开的事实才可进入正式材料；正文变化使旧确认失效，历史投递版本保持冻结。
- 硬条件未知单独呈现，不算通过；模型分数不能覆盖已知不满足的硬条件。
- 外部 JD、网页、邮件和模型输出都是不可信数据，不能授权读取密钥、改变规则或发送申请。
- 云端必须先有登录和服务端会话校验；同源、HTTPS、Origin 校验、请求大小限制和敏感字段最小外发同时落实。Neon 连接只在服务端，不能进入 Angular 构建产物。
- 凭据只放 Railway 服务变量/本地受保护环境，不进 Git、导出包或日志。Railway 变量也会进入**构建环境**，构建脚本不得把它们嵌入 Angular 产物，发布前检查 bundle。Neon TLS 保持证书校验，不设置 `rejectUnauthorized: false`。
- 备份既覆盖数据库中的事实、状态、快照与附件，也提供用户可迁移的 Markdown/JSON/PDF 导出；至少执行一次隔离恢复验证。

## 开发前仍需真实输入

首个有权使用的 JD、可确认的个人经历样本、账户初始化方式/实际域名、模型供应商和预算、数据保留及备份位置仍需确定。原方案的“20 个职位 / 5 套材料 / 3 个申请 / €2”仅是例子，不自动写成默认值。
