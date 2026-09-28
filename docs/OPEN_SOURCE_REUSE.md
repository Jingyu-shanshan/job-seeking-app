# 开源复用清单

核对日期：2026-09-28。以下链接指向项目主仓或官方文档；**当前均未安装或复制进本仓库**。实施时锁定具体版本/commit，复核该版本的许可证和 API，再按实际需求安装。优先调用现有库/API，避免复制整个求职产品或维护私有分叉。

## V0.1：直接复用

| 项目 / 来源 | 已核对许可 | 在本项目中复用什么 | 采用时机与边界 |
| --- | --- | --- | --- |
| [Angular](https://github.com/angular/angular) · [Reactive Forms](https://angular.dev/guide/forms/reactive-forms) | MIT | 路由、表单验证、组件能力；资料确认和材料审核不另造表单框架。 | T01；[官方兼容表](https://angular.dev/reference/versions) 为 Angular 22 + TS 6.0.x + Node 24.15+。 |
| [Angular Material/CDK](https://github.com/angular/components) · [LICENSE](https://github.com/angular/components/blob/main/LICENSE) | MIT | 按需要用现成输入、对话框、表格和无障碍交互。 | T03–T07 按页面引入，不复制组件源码或一次装满扩展。 |
| [Fastify](https://github.com/fastify/fastify) · [验证文档](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) | MIT | 本地 HTTP 路由、JSON Schema 入参校验及响应约束。 | T01；选择稳定的 5.x，仍须实现 loopback、会话和 Origin 校验。 |
| [Node `node:sqlite`](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html) + [SQLite FTS5](https://www.sqlite.org/fts5.html) | Node 内置；SQLite 为 public domain | 预处理语句、事务、备份；搜索需要时用 FTS5。 | T02 先验证 Node 24.15+ 支持、FTS5 和备份。`node:sqlite` 仍是 release candidate；若目标环境验证失败，改用 [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)（[MIT](https://github.com/WiseLibs/better-sqlite3/blob/master/LICENSE)），Electron 打包时需处理原生模块。 |
| Node `fs` / `crypto` / `fetch` | Node 内置 | Markdown 文件读写、内容哈希、后续公开 API 请求。 | 能用标准库就不加文件层、哈希或 HTTP 客户端包装。 |

## V0.1：出现明确需求时再引入

| 项目 / 来源 | 已核对许可 | 可复用位置 | 触发条件 |
| --- | --- | --- | --- |
| [Ajv](https://github.com/ajv-validator/ajv) | MIT | 校验外部 JSON、模型结构化输出。 | Fastify 自带的 JSON Schema 校验不能覆盖该输入路径时再直接安装；模型结果还需校验事实 ID、权限和业务规则。 |
| [OpenAI Node SDK](https://github.com/openai/openai-node) · [DeepSeek 官方兼容示例](https://api-docs.deepseek.com/guides/harness) | SDK Apache-2.0 | 当选用兼容接口的模型供应商时，复用超时/重试/调用协议。 | T05–T06 确认供应商和数据发送范围后；本项目不预设用户已有 DeepSeek Key。供应商的 JSON 输出也不能代替事实校验。[DeepSeek JSON 模式说明](https://api-docs.deepseek.com/guides/json_mode/) |
| [gray-matter](https://github.com/jonschlinkert/gray-matter) | MIT | 解析个人事实 Markdown 的 YAML front matter。 | T02 确定采用该文件格式时再引入；不要手写 front matter 解析器。 |
| [marked](https://github.com/markedjs/marked) + [DOMPurify](https://github.com/cure53/DOMPurify) | MIT；Apache-2.0/MPL-2.0 | 显示需要格式化的 Markdown，并净化 HTML。 | 仅在界面需要渲染外部 Markdown/HTML 时加入；[marked 不负责净化](https://github.com/markedjs/marked#warning-marked-does-not-sanitize-the-output-html)，纯文本展示优先。 |
| [PDF.js](https://github.com/mozilla/pdf.js) / [Mammoth](https://github.com/mwilliamson/mammoth.js) | Apache-2.0 / [BSD-2-Clause](https://github.com/mwilliamson/mammoth.js/blob/master/LICENSE) | 从用户授权的 PDF / DOCX 履历提取文本，形成待确认事实。 | T03 有真实文件导入需求后；V0.1 先支持手动录入/粘贴。提取内容不能自动变为已确认事实。 |
| 浏览器打印 / [Playwright `page.pdf()`](https://playwright.dev/docs/api/class-page#page-pdf) | 浏览器原生 / [Apache-2.0](https://github.com/microsoft/playwright/blob/main/LICENSE) | HTML/CSS 简历模板输出 PDF。 | T07 先验证浏览器打印的质量及实际文件归档；只有受控自动导出确有必要时才引入 Playwright/Chromium。 |

## 参考现成格式和模板，避免移植整套应用

| 项目 | 许可与复用范围 | 结论 |
| --- | --- | --- |
| [JSON Resume](https://github.com/jsonresume/jsonresume.org) · [schema](https://github.com/jsonresume/jsonresume.org/blob/master/packages/schema/README.md) | MIT；可参考标准字段并做导出兼容。 | 本项目的事实确认、来源和版本需要独立主模型；旧独立 `resume-schema` 仓库已归档，不从旧仓开新依赖。 |
| [Reactive Resume](https://github.com/reactive-resume/reactive-resume) · [现行 LICENSE](https://github.com/reactive-resume/reactive-resume/blob/main/LICENSE) | 当前主分支 MIT；可按固定 commit 评估模板/排版代码。 | 整套 React/PostgreSQL 应用不适合直接嵌入 Angular/SQLite；复用具体代码前复核对应 commit 的许可并保留 notice。 |
| [OpenResume](https://github.com/xitanggg/open-resume) | AGPL-3.0。 | 只作界面和排版参考；不直接复制代码，以免无意引入不同的发布义务。 |

## V0.2 之后：公开职位来源与执行器

| 来源 | 复用方式 | 阶段边界 |
| --- | --- | --- |
| [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html) | 配置公司 board token，以公开 GET 接口读取职位和 JD；用 Node `fetch`，不写爬虫。 | T11 按真实关注公司决定是否第一个接入。公开 GET 不等于拥有申请 POST 权限。 |
| [Lever Postings API](https://github.com/lever/postings-api) | 按目标公司的 site 与 global/EU 地址读取公开 JSON。 | T11 后续候选；该文档仓库许可不明，引用 API 行为，不复制仓库代码。 |
| [Ashby Public Job Posting API](https://developers.ashbyhq.com/docs/public-job-posting-api) | 读取指定 job board 的公开 JSON；主动发现排除 `isListed=false`。 | T11 后续候选；仍需来源范围、限流和去重。 |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE) | MIT；仅考虑多步公司研究等受控任务。 | V0.3 以后再评估。项目仍处开发预览，[安全声明](https://github.com/deepseek-ai/deepseek-harness/blob/master/SAFETY.md)要求谨慎；业务事实与申请状态不能存于 Agent 会话。 |
| [Electron `printToPDF`](https://www.electronjs.org/docs/latest/api/web-contents) | 桌面版可复用自带 PDF 接口。 | V1.0 桌面化时再选，不能成为 V0.1 Web 导出的前置依赖。 |

**采用检查**：先证明该功能进入当前任务范围，再看标准库/现有依赖是否已覆盖；若复制代码，记录具体仓库、commit、许可证和 notice。对第三方职位来源只复用公开接口，不绕过登录或验证码，不复用自动投递代码。
