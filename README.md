# Job Search Workbench

个人求职应用：从用户选定的来源发现并筛选职位、总结 JD、为选中的职位写简历和求职信、代填申请表并在用户逐个批准后提交，之后协助准备面试。为后续部署到 Railway + Neon，本轮采用云端 PostgreSQL 主数据；Markdown 保留为可导入/导出的便携格式。当前有可运行的骨架（T01：Angular 页面 + Fastify `/health`，同一进程提供）、PostgreSQL 表结构与迁移（T02，含 `/health/ready`）和单用户登录（T03），**还没有任何业务功能**。原始方案中的本地优先/SQLite 设计保留在参考文档中。

V0.1 的流程：发现与筛选 → JD 总结 → 确认个人事实 → 解释匹配与未知项 → 生成有证据的简历和求职信 → 人工审核与 PDF → 本地执行器代填申请表 → 用户逐个批准后提交 → 冻结投递版本并验证备份恢复。只投用户选中的职位，不做海投；没有用户对该职位的批准就不提交。核心回路已用一次性脚本验证（S0，2026-09-30）；接下来搭骨架（T01–T03）并做一次不含个人数据的预部署演练（T03a），详见 [任务清单](docs/TASKS.md)。

| 路径 | 用途 |
| --- | --- |
| `apps/web/` | Angular 界面（目前只有外壳和状态页） |
| `apps/server/` | Fastify API；同源提供构建后的 Angular 页面 |
| `packages/shared/` | Web 与 API 共用的 schema 与类型 |
| `apps/runner/` | 后续本地投递执行器：在用户电脑上用浏览器填表并提交（T17 创建） |
| `docs/PRODUCT_PLAN.md` | 原始产品设计草案（保留原文，**其中建议和示例不是已确认默认值**） |
| `docs/DEVELOPMENT.md` | 本轮技术决策、边界与开发约定 |
| `docs/TASKS.md` | 按阶段排列的开发任务与验收条件 |
| `docs/OPEN_SOURCE_REUSE.md` | 已核对的开源复用候选及采用时机 |
| `docs/DEPLOYMENT.md` | Railway + Neon 的计划部署流程 |

本地运行：`npm ci && npm run build && npm start`，然后打开 <http://127.0.0.1:3000>；开发时分别运行 `npm run dev:server` 和 `npm run dev:web`。数据库用本地 PostgreSQL 容器，启动命令见 `CLAUDE.md`，`npm run db:migrate` 执行迁移，`npm run auth:create-account -- <邮箱>` 创建唯一的账户（公开注册已关闭）。检查：`npm run lint`、`npm run typecheck`、`npm test`（数据库测试需要 `TEST_DATABASE_URL`）。数据库地址、会话密钥和模型密钥放在根目录 `.env`（见 `.env.example`），不入库。

技术栈：Angular 22 / TypeScript 6.0.x、Node.js 24 LTS / Fastify 5、PostgreSQL（Neon）、`pg`、版本化数据库迁移。身份验证使用 Better Auth；模型为 DeepSeek API；填表用本地 Playwright。决策与未定事项见 [开发文档](docs/DEVELOPMENT.md)，部署步骤见 [部署文档](docs/DEPLOYMENT.md)。
