# 开发文档与技术决策

更新：2026-09-28。本文是本轮仓库决策；[原始方案](PRODUCT_PLAN.md) 是产品设计输入，其中数量、预算、技术选项和版本路线并非用户已确认的个人默认值。当前只建立框架，不编写或运行产品代码。

## 目标与边界

V0.1 只处理用户手动提供的一份 JD。用户确认个人事实，系统展示硬条件、未知项和事实依据，生成可审核的英文申请材料，导出可检查的 PDF，并记录用户实际投出的版本及本地备份。事实未确认时不得进入正式材料；生成/导出/打开申请页不算“已申请”；用户自行完成投递。

V0.2 才开始按关注公司接入一个公开 ATS 来源。Electron、公司研究、DeepSeek Harness、同步、图谱、多用户和复杂多 Agent 都由真实使用需求触发，不是 V0.1 的依赖。

## 已选技术栈

| 层 | 选择 | 理由与实施边界 |
| --- | --- | --- |
| Web | Angular 22 + TypeScript 6.0.x | 沿用原方案指定的 Angular 方向；表单、路由先用框架内置能力。Angular 22 要求 Node `^24.15.0` 等受支持版本、TypeScript `>=6.0.0 <6.1.0`。[兼容表](https://angular.dev/reference/versions) |
| 运行时 | Node.js 24 LTS（至少 24.15）+ npm | 与 Angular 22 兼容；采用维护中的 LTS，不用双后端。[Node 发行状态](https://nodejs.org/en/about/previous-releases) |
| 本地 API | Fastify 5，单进程，JSON over loopback | 复用路由、请求大小限制与 JSON Schema 校验，不自写 HTTP 框架；仍需单独校验本地会话、Origin 与业务权限。[Fastify 验证文档](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) |
| 个人事实 | Markdown 文件 + Node 文件 API | 人能直接阅读和迁移；Obsidian 只是可选编辑器。事实 ID、版本、确认状态与公开范围由应用控制。 |
| 业务状态 | SQLite，先用 Node `node:sqlite` | 单用户本地事务与备份足够；Node 24 的内置模块目前为 **release candidate**，开发时先验证 FTS5、备份和目标系统；若验证失败再换 `better-sqlite3`。[Node SQLite 文档](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html) |
| 检索 | SQLite FTS5，按实际搜索需求加入 | 不先装向量数据库或图数据库。[FTS5 文档](https://www.sqlite.org/fts5.html) |
| 模型 | V0.1 固定步骤的直接调用；供应商待定 | 先用规则与人工确认守住事实边界。模型只建议文本和映射，不能确认事实、扩大来源或提交申请；不先接 dsh。 |
| PDF | 固定 HTML/CSS 模板 + 浏览器打印先验证 | 若实测不能可靠导出并保存实际投递版，再采用自动 PDF 工具；PDF 质量和文本提取必须验收。 |

具体 npm 补丁版本、锁文件和安装命令在第一个编码任务中确定；本轮没有 `package.json` 或依赖安装。候选库、许可和可复用位置见 [开源调研](OPEN_SOURCE_REUSE.md)。

## 最小结构与数据归属

```text
apps/web/       Angular 页面：资料、JD、匹配、审核、申请记录
apps/server/    本地 API：业务规则、文件/SQLite、模型调用、导出
docs/           原方案、决策、任务和复用调研
vault/          运行时个人事实 Markdown（忽略 Git）
app-data/       运行时 SQLite 与索引（忽略 Git）
artifacts/      运行时草稿、PDF 与冻结申请包（忽略 Git）
```

`vault/` 的确认事实为个人资料主数据；SQLite 中的申请状态与历史也是主数据，不能只备份 Markdown。原始 JD、研究来源和实际投递文件保留版本，不原地改写。数据库只保存可重建索引的说法不适用于申请记录。三类运行时目录由应用启动时按明确的数据位置创建，当前不放个人资料或示例简历进仓库。

V0.1 开发顺序见 [TASKS.md](TASKS.md)。业务对象先覆盖 `Fact`、`JobSnapshot`、`Match`、`Artifact`、`Application`，不要为未来平台化先拆服务或建立通用 Agent 框架。新增字段时以真实 JD 和验收用例核对。

## 必须守住的规则

- 只有本人确认且允许公开的事实可进入正式材料；正文改动使旧确认失效，历史投递版本仍冻结。
- 硬条件的未知值单独呈现，不当作满足；模型分数不能推翻已知不满足的硬条件。
- 外部 JD、网页、邮件和模型输出均是数据，不能成为工具授权或系统指令。
- 本地服务仅监听 loopback；请求校验会话、Origin、大小和内容；模型只接收本次必要资料，密钥不入 Vault、日志或 Git。
- PDF 和导出草稿不等于实际投递文件；“已申请”只能由用户确认并记录时间/版本。
- 备份必须包含 Markdown、SQLite、原始快照和投递文件；V0.1 做一次真实恢复验证。

## 待使用者确认的输入

这些是开发开始前需要的真实资料或偏好，不从原方案示例自动填入：首个有权使用的 JD、可确认的个人经历样本、目标运行系统、模型供应商与可接受费用、实际数据/备份位置。职位来源优先级和 DOCX 需求留到对应阶段再问。原方案的“20 个职位 / 5 套材料 / 3 个申请 / €2”仅是示例。
