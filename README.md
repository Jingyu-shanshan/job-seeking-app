# Job Search Workbench

个人求职应用：从用户选定的来源发现并筛选职位、总结 JD、为选中的职位写简历和求职信、代填申请表并在用户逐个批准后提交，之后协助准备面试。为后续部署到 Railway + Neon，本轮采用云端 PostgreSQL 主数据；Markdown 保留为可导入/导出的便携格式。当前仅有项目框架和规划文档，**没有可运行的应用，也没有安装依赖**。原始方案中的本地优先/SQLite 设计保留在参考文档中。

V0.1 的流程：发现与筛选 → JD 总结 → 确认个人事实 → 解释匹配与未知项 → 生成有证据的简历和求职信 → 人工审核与 PDF → 本地执行器代填申请表 → 用户逐个批准后提交 → 冻结投递版本并验证备份恢复。只投用户选中的职位，不做海投；没有用户对该职位的批准就不提交。核心回路已用一次性脚本验证（S0，2026-09-30）；接下来搭骨架（T01–T03）并做一次不含个人数据的预部署演练（T03a），详见 [任务清单](docs/TASKS.md)。

| 路径 | 用途 |
| --- | --- |
| `apps/web/` | 后续 Angular 界面 |
| `apps/server/` | 后续 Fastify API；生产时同源提供 Angular 页面 |
| `packages/shared/` | 后续 Web 与 API 共用的 schema 与类型（T01 创建） |
| `apps/runner/` | 后续本地投递执行器：在用户电脑上用浏览器填表并提交（T17 创建） |
| `docs/PRODUCT_PLAN.md` | 原始产品设计草案（保留原文，**其中建议和示例不是已确认默认值**） |
| `docs/DEVELOPMENT.md` | 本轮技术决策、边界与开发约定 |
| `docs/TASKS.md` | 按阶段排列的开发任务与验收条件 |
| `docs/OPEN_SOURCE_REUSE.md` | 已核对的开源复用候选及采用时机 |
| `docs/DEPLOYMENT.md` | Railway + Neon 的计划部署流程 |

技术栈：Angular 22 / TypeScript 6.0.x、Node.js 24 LTS / Fastify 5、PostgreSQL（Neon）、`pg`、版本化数据库迁移。身份验证使用 Better Auth；模型为 DeepSeek API；填表用本地 Playwright。决策与未定事项见 [开发文档](docs/DEVELOPMENT.md)，部署步骤见 [部署文档](docs/DEPLOYMENT.md)。
