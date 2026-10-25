# Job Search Workbench

个人求职应用：从用户选定的来源发现并筛选职位、总结 JD、为选中的职位写简历和求职信、代填申请表并在用户逐个批准后提交，之后协助准备面试。为后续部署到 Railway + Neon，本轮采用云端 PostgreSQL 主数据；Markdown 保留为可导入/导出的便携格式。当前有可运行的骨架（T01：Angular 页面 + Fastify `/health`，同一进程提供）、PostgreSQL 表结构与迁移（T02，含 `/health/ready`）、单用户登录（T03）、职位来源目录（T15，`/sources` 页）、从 Greenhouse、Ashby 招聘板块发现职位（T13，`/jobs` 页），JD 导入与总结（T05：读取或粘贴职位原文，用 DeepSeek 总结，每一条都引用原文），个人事实（T04，`/facts` 页：不可变版本、逐条确认、两个可见性开关、PDF/Markdown 候选审核后导入），桌面应用（T21，`npm run desktop`：在内置浏览器里自己浏览招聘网站，一键保存正在看的职位页，或 LinkedIn 结果页上已显示的职位条目），筛选条件与证据匹配（T06，`/criteria` 页：地点、职位名称、工作语言、雇佣形式等各设为硬条件或偏好，职位按硬条件分为合格、待确认、淘汰并说明理由；职位页可让 DeepSeek 把 JD 要求对应到已确认的事实），职位提醒邮件导入（T20，`/jobs/alerts` 页：粘贴邮件源码或上传 `.eml`，按发件人和主题认出 LinkedIn、Duunitori、The Hub、Jooble、Glassdoor、Totaljobs、Snaphunt、Upwork、Wärtsilä、Teamtailor 等的提醒邮件并读出其中的职位；与招聘板块上同公司同标题的职位合并），材料草稿（T07：职位页让 DeepSeek 写简历或求职信，每条陈述引用事实版本或原文，确定性校验决定哪些进文档），以及人工审核与 PDF（T08：草稿页逐条改写、移出或放回陈述并重新校验，显示与所引事实的差异；`/profile` 页填写写进文档的姓名和联系方式；成稿页 `/drafts/:id/document` 是单栏 A4 模板，在浏览器里存储为 PDF 后上传，文字与文档一致才保存）。原始方案中的本地优先/SQLite 设计保留在参考文档中。

V0.1 的流程：发现与筛选 → JD 总结 → 确认个人事实 → 解释匹配与未知项 → 生成有证据的简历和求职信 → 人工审核与 PDF → 本地执行器代填申请表 → 用户逐个批准后提交 → 冻结投递版本 → 数据导出；隔离恢复演练作为维护工具保留。只投用户选中的职位，不做海投；没有用户对该职位的批准就不提交。核心回路已用一次性脚本验证（S0，2026-09-30），骨架（T01–T03）、来源目录（T15）、Greenhouse 和 Ashby 招聘板块的职位发现（T13）、JD 导入与总结（T05）、个人事实（T04）、桌面应用（T21）、筛选条件与证据匹配（T06）、职位提醒邮件导入（T20）、材料草稿与事实校验（T07）和人工审核与 PDF（T08）已完成，已经能用生成的材料自己投递。申请资料与表单答案（T16）、本地执行器（T17）、逐个批准与提交（T18）和冻结申请记录（T09）也已完成。导出与恢复（T10）按 2026-10-11 用户调整后的范围完成：保留数据导出，以及供维护者手动执行的 PostgreSQL 隔离恢复演练。接下来是真实流程验证（T11）。不含个人数据的云端预部署演练（T03a）推迟到基本功能完成之后，详见 [任务清单](docs/TASKS.md)。

| 路径 | 用途 |
| --- | --- |
| `apps/web/` | Angular 界面（目前有登录页、状态页、职位列表与职位详情页、粘贴页、提醒邮件导入页、草稿页、成稿页、个人事实页、个人资料页、条件页和来源页） |
| `apps/server/` | Fastify API；同源提供构建后的 Angular 页面 |
| `packages/shared/` | Web 与 API 共用的 schema 与类型 |
| `apps/desktop/` | 桌面应用（Electron，T21）：左边是应用界面，右边是内置浏览器，用户自己浏览并一键保存正在看的职位；只在用户电脑上运行 |
| `apps/runner/` | 本地投递执行器（T17）：在用户电脑上的可见 Chrome 窗口里填写 Greenhouse 申请表并停在提交前；提交在 T18 |
| `docs/PRODUCT_PLAN.md` | 原始产品设计草案（保留原文，**其中建议和示例不是已确认默认值**） |
| `docs/DEVELOPMENT.md` | 本轮技术决策、边界与开发约定 |
| `docs/TASKS.md` | 按阶段排列的开发任务与验收条件 |
| `docs/UIUX_DESIGN.md` | 2026-10-13 后续 UIUX 提案：20 个可编辑 Figma 画板、静态预览与路由/任务对应 |
| `docs/T24_DESIGN_HANDOFF.md` | T24 完整设计补稿：规范、全路由与操作状态对应；用户已批准合并，界面实现仍在后续任务 |
| `docs/T31_ACCEPTANCE.md` | T31 真实路由/状态、隔离业务流程、可访问性、Electron、打印与安全验收及已知限制 |
| `docs/OPEN_SOURCE_REUSE.md` | 已核对的开源复用候选及采用时机 |
| `docs/DEPLOYMENT.md` | Railway + Neon 的计划部署流程 |

2026-10-14 完成 T22 的 Facts 状态分区和 T23 的 PDF/Markdown 候选审核：PDF 有文字层、最多 2 MiB/20 页；两种格式均先校对正文/类别、拆分/合并并选择，再原子导入待确认，两种许可默认关闭，重复撤回项不自动恢复。来源保留文件名、PDF 页码与摘要，预览不写入事实，不调用模型。2026-10-16 完成 T25 的分组导航、原生窄屏 Menu、统一亮暗控件和 160px Electron 工具栏；2026-10-18 完成 T26 的可跳过/续读/重看三步教程和真实下一步首页；T27 的职位获取、条件分组、详情阶段与阻塞提示已完成；T28 的证据审核、PDF 状态、实际表单预览与逐份批准流程已完成；T29 的申请状态、冻结历史追溯与分层面试准备/私人笔记已完成；T30 的资料/答案/条件/来源表单、运行预算与冻结设置、Runner 令牌及导出状态已完成。2026-10-19 完成 T31 的路由/状态矩阵、隔离完整流程、Electron/打印及安全回归，并修复登录和 Facts 的失败重试；真实听读、实体设备及系统 PDF 最终另存的边界见 [验收报告](docs/T31_ACCEPTANCE.md)。T32.1 云资源清点已完成，旧 staging 已获批准并请求删除，保留的 production/web 另按用户要求启用闲置休眠；实际下载 ZIP 的两份 PDF 和完整性已核验，2026-10-25 已确认旧 staging 从清单消失，原生产身份、域名、发布配置和健康复核通过，T32 完成；本次复验及下载边界详见 [维护记录](docs/T32_MAINTENANCE.md)、[任务清单](docs/TASKS.md) 与 [设计说明](docs/UIUX_DESIGN.md)。上述本地 UI 验证未写生产数据；合并到 main 后沿用既有 CI 自动发布。

本地运行：`npm ci && npm run build && npm start`，然后打开 <http://127.0.0.1:3000>；开发时分别运行 `npm run dev:server` 和 `npm run dev:web`。桌面应用：先 `npm start`，再 `npm run desktop`（加载 `JSA_APP_URL`，默认 <http://127.0.0.1:3000>；第一次运行会下载 Electron）。执行器：在应用的 Runner 页签发令牌，写进 `.env` 的 `JSA_RUNNER_TOKEN`，再 `npm run runner`（需要已安装 Google Chrome）。数据库用本地 PostgreSQL 容器，启动命令见 `CLAUDE.md`，`npm run db:migrate` 执行迁移，`npm run auth:create-account -- <邮箱>` 创建唯一的账户（公开注册已关闭）。检查：`npm run lint`、`npm run typecheck`、`npm test`（数据库测试需要 `TEST_DATABASE_URL`）。数据库地址、会话密钥和模型密钥放在根目录 `.env`（见 `.env.example`），不入库。登录后在 `/export` 下载包含 Markdown/JSON/PDF 的 ZIP。数据库的手动隔离恢复演练沿用 T02 的 `npm run db:restore-drill`，说明见 [部署文档](docs/DEPLOYMENT.md#数据导出与手动隔离恢复t10)。

技术栈：Angular 22 / TypeScript 6.0.x、Node.js 24 LTS / Fastify 5、PostgreSQL（Neon）、`pg`、版本化数据库迁移。身份验证使用 Better Auth；模型为 DeepSeek API；填表用本地 Playwright。决策与未定事项见 [开发文档](docs/DEVELOPMENT.md)，部署步骤见 [部署文档](docs/DEPLOYMENT.md)。
