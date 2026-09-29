# Job Search Workbench

个人求职工作台。为后续部署到 Railway + Neon，本轮采用云端 PostgreSQL 主数据；Markdown 保留为可导入/导出的便携格式。当前仅有项目框架和规划文档，**没有可运行的应用，也没有安装依赖**。原始方案中的本地优先/SQLite 设计保留在参考文档中。

V0.1 先完成一份职位描述（JD）的流程：手动导入 → 确认个人事实 → 解释匹配与未知项 → 生成有证据的简历和求职信 → 人工审核与 PDF → 记录实际申请版本并验证备份恢复。用户自行投递；系统不自动发送申请。

| 路径 | 用途 |
| --- | --- |
| `apps/web/` | 后续 Angular 界面 |
| `apps/server/` | 后续 Fastify API；生产时同源提供 Angular 页面 |
| `docs/PRODUCT_PLAN.md` | 原始产品设计草案（保留原文，**其中建议和示例不是已确认默认值**） |
| `docs/DEVELOPMENT.md` | 本轮技术决策、边界与开发约定 |
| `docs/TASKS.md` | 按阶段排列的开发任务与验收条件 |
| `docs/OPEN_SOURCE_REUSE.md` | 已核对的开源复用候选及采用时机 |
| `docs/DEPLOYMENT.md` | Railway + Neon 的计划部署流程 |

技术栈：Angular 22 / TypeScript 6.0.x、Node.js 24 LTS / Fastify 5、PostgreSQL（Neon）、`pg`、版本化数据库迁移。身份验证使用 Better Auth。决策与未定事项见 [开发文档](docs/DEVELOPMENT.md)，部署步骤见 [部署文档](docs/DEPLOYMENT.md)。
