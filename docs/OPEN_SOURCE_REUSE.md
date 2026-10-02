# 开源复用清单

核对日期：2026-09-28；Railway + Neon 适配补充于 2026-09-29。以下链接指向项目主仓或官方文档；**除标明“已采用”的行外，均未安装或复制进本仓库**。实施时锁定具体版本/commit，复核该版本的许可证和 API。2026-09-29 的云端主数据决策覆盖了原清单中的 SQLite/本地 Vault 选择。2026-09-30 新增的候选标注“待核对”，尚未核对许可与版本兼容性。同日产品方向调整后，公开职位来源和 Playwright 进入 V0.1，模型供应商定为 DeepSeek。

## V0.1：直接复用

| 项目 / 来源 | 已核对许可 | 在本项目中复用什么 | 采用时机与边界 |
| --- | --- | --- | --- |
| [Angular](https://github.com/angular/angular) · [Reactive Forms](https://angular.dev/guide/forms/reactive-forms) | MIT | 路由、表单验证、组件能力；资料确认和材料审核不另造表单框架。 | T01；[官方兼容表](https://angular.dev/reference/versions) 为 Angular 22 + TS 6.0.x + Node 24.15+。 |
| [Angular Material/CDK](https://github.com/angular/components) · [LICENSE](https://github.com/angular/components/blob/main/LICENSE) | MIT | 按需要用现成输入、对话框、表格和无障碍交互。 | T04–T08 按页面引入，不复制组件源码或一次装满扩展。 |
| [Fastify](https://github.com/fastify/fastify) · [验证文档](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) | MIT | HTTP 路由、JSON Schema 入参校验及响应约束。 | T01；选择稳定的 5.x。生产仍需会话、Origin 与业务权限检查。 |
| [`@fastify/static`](https://github.com/fastify/fastify-static) | MIT | 在同一个 Railway 服务中提供 Angular 构建产物及 SPA 路由回退。 | T01；按 Fastify 5 兼容版本引入，不先开第二个 Web 服务。 |
| [PostgreSQL](https://www.postgresql.org/docs/current/) + [`pg`](https://node-postgres.com/features/pooling) · [LICENSE](https://github.com/brianc/node-postgres/blob/master/LICENSE) | PostgreSQL License；`pg` MIT | Neon 使用标准 PostgreSQL，`pg.Pool` 供常驻 Fastify 服务连接。 | T02 已采用：`pg` 8.23（MIT，2026-10-01 按 npm 元数据核对），5 个连接的小连接池 + direct URL，连接压力出现再使用 Neon pooler；不加 ORM。 |
| [`node-pg-migrate`](https://github.com/salsita/node-pg-migrate) | MIT | 版本化 SQL 迁移、迁移记录及并发控制。 | T02 已采用：`node-pg-migrate` 9.0（MIT），只写 SQL 迁移文件；在 Railway pre-deploy 使用 direct URL，不自写迁移状态。 |
| [Better Auth](https://better-auth.com/docs/integrations/fastify) · [PostgreSQL 适配](https://better-auth.com/docs/adapters/postgresql) | [MIT](https://github.com/better-auth/better-auth/blob/main/packages/better-auth/package.json) | 云端单用户会话、密码和 Cookie；通用客户端可用于 Angular。 | T03 已采用：`better-auth` 1.7.7（MIT，2026-10-01 按 npm 元数据核对），只在服务端使用 Kysely 适配器接 `pg` 连接池；公开注册关闭，所有资料 API 在服务端验证会话。前端没有引入它的客户端库，三个接口直接用 `HttpClient` 调用。 |
| Node `crypto` / `fetch` | Node 内置 | 内容哈希、后续公开 ATS API 请求。 | 能用标准库就不加哈希或 HTTP 客户端包装；生产文件不持久化在容器目录。T13 的招聘板块和 T05 的 DeepSeek 调用都用原生 `fetch`。 |
| [htmlparser2](https://github.com/fb55/htmlparser2) + [entities](https://github.com/fb55/entities) | htmlparser2 MIT；entities BSD-2-Clause（2026-10-02 按 npm 元数据核对） | 把 Greenhouse 职位正文（转义过一次的 HTML）解码并转成纯文本，作为 JD 快照。 | T05 已采用：htmlparser2 12.0、entities 8.1，两者此前已作为 Angular 构建工具的依赖在锁文件里，没有新增安装的包；只用其解析回调产出文本，从不渲染来源的 HTML。 |

## V0.1：出现明确需求时再引入

| 项目 / 来源 | 已核对许可 | 可复用位置 | 触发条件 |
| --- | --- | --- | --- |
| [TypeBox](https://github.com/sinclairzx81/typebox) + [`@fastify/type-provider-typebox`](https://github.com/fastify/fastify-type-provider-typebox)；Node 内置 `node:test`；[typescript-eslint](https://github.com/typescript-eslint/typescript-eslint)、[angular-eslint](https://github.com/angular-eslint/angular-eslint)、[Prettier](https://github.com/prettier/prettier) | 均为 MIT（2026-09-30 按 npm 元数据核对） | `packages/shared` 中共用的 schema/类型，服务端与共享包的测试，以及 lint/格式化。 | T01 已采用：`typebox` 1.x、类型提供者 6.x，与 Fastify 5、TypeScript 6.0.x 一起通过构建和测试。Angular 端用 CLI 默认的 Vitest。 |
| [Ajv](https://github.com/ajv-validator/ajv) | MIT | 校验外部 JSON、模型结构化输出。 | Fastify 自带的 JSON Schema 校验不能覆盖该输入路径时再直接安装；模型结果还需校验事实 ID、权限和业务规则。 |
| [OpenAI Node SDK](https://github.com/openai/openai-node) · [DeepSeek 官方兼容示例](https://api-docs.deepseek.com/guides/harness) | SDK Apache-2.0 | 供应商已定为 DeepSeek API（2026-09-30）；若其兼容接口可用，复用该 SDK 的超时/重试/调用协议。 | T05 首次接入前按当时的官方文档核对接口与兼容性；API Key 由用户提供。供应商的 JSON 输出也不能代替事实校验。[DeepSeek JSON 模式说明](https://api-docs.deepseek.com/guides/json_mode/)。T05 决定不引入（2026-10-02）：只调用一个接口，用原生 `fetch` 即可，且不需要 SDK 的自动重试（失败的调用由用户决定是否重试，每次都记录）。 |
| [gray-matter](https://github.com/jonschlinkert/gray-matter) | MIT | 解析导入/导出的 Obsidian 风格 Markdown front matter。 | T04 真正需要该格式时再引入；Markdown 不再是云端主数据。 |
| [marked](https://github.com/markedjs/marked) + [DOMPurify](https://github.com/cure53/DOMPurify) | MIT；Apache-2.0/MPL-2.0 | 显示需要格式化的 Markdown，并净化 HTML。 | 仅在界面需要渲染外部 Markdown/HTML 时加入；[marked 不负责净化](https://github.com/markedjs/marked#warning-marked-does-not-sanitize-the-output-html)，纯文本展示优先。 |
| [PDF.js](https://github.com/mozilla/pdf.js) / [Mammoth](https://github.com/mwilliamson/mammoth.js) | Apache-2.0 / [BSD-2-Clause](https://github.com/mwilliamson/mammoth.js/blob/master/LICENSE) | 从用户授权的 PDF / DOCX 履历提取文本，形成待确认事实。 | T04 有真实文件导入需求后；V0.1 先支持手动录入/粘贴。提取内容不能自动变为已确认事实。 |
| 浏览器打印 / [Playwright `page.pdf()`](https://playwright.dev/docs/api/class-page#page-pdf) | 浏览器原生 / [Apache-2.0](https://github.com/microsoft/playwright/blob/main/LICENSE) | HTML/CSS 简历模板输出 PDF。 | T08 先验证浏览器打印的质量及实际文件归档；只有受控自动导出确有必要时才在服务端引入 Playwright/Chromium。 |
| [Playwright](https://github.com/microsoft/playwright) | [Apache-2.0](https://github.com/microsoft/playwright/blob/main/LICENSE) | 本地投递执行器 `apps/runner`：在可见的浏览器窗口里填写申请表、上传文件、截图预览并在批准后提交。 | T17；只装在执行器工作区，不进 Railway 镜像。不引入验证码破解或反检测插件。 |

## 参考现成格式和模板，避免移植整套应用

| 项目 | 许可与复用范围 | 结论 |
| --- | --- | --- |
| [JSON Resume](https://github.com/jsonresume/jsonresume.org) · [schema](https://github.com/jsonresume/jsonresume.org/blob/master/packages/schema/README.md) | MIT；可参考标准字段并做导出兼容。 | 本项目的事实确认、来源和版本需要独立主模型；旧独立 `resume-schema` 仓库已归档，不从旧仓开新依赖。 |
| [Reactive Resume](https://github.com/reactive-resume/reactive-resume) · [现行 LICENSE](https://github.com/reactive-resume/reactive-resume/blob/main/LICENSE) | 当前主分支 MIT；可按固定 commit 评估模板/排版代码。 | 整套 React 应用不适合直接嵌入 Angular；复用具体代码前复核对应 commit 的许可并保留 notice。 |
| [OpenResume](https://github.com/xitanggg/open-resume) | AGPL-3.0。 | 只作界面和排版参考；不直接复制代码，以免无意引入不同的发布义务。 |

## 公开职位来源（V0.1 先接一种）与以后的执行器

| 来源 | 复用方式 | 阶段边界 |
| --- | --- | --- |
| [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html) | 配置公司 board token，以公开 GET 接口读取职位和 JD；用 Node `fetch`，不写爬虫。 | T13 第一个接入（2026-09-30 决定）。公开 GET 不等于拥有申请 POST 权限，提交由 T17 的本地执行器在浏览器中完成。 |
| [Lever Postings API](https://github.com/lever/postings-api) | 按目标公司的 site 与 global/EU 地址读取公开 JSON。 | T13 后续候选；该文档仓库许可不明，引用 API 行为，不复制仓库代码。 |
| [Ashby Public Job Posting API](https://developers.ashbyhq.com/docs/public-job-posting-api) | 读取指定 job board 的公开 JSON；主动发现排除 `isListed=false`。 | 第二个接入；仍需来源范围、限流和去重。 |
| [Upwork GraphQL API](https://www.upwork.com/developer/documentation/graphql/api/docs/index.html) · [RSS 停用说明](https://support.upwork.com/hc/en-us/articles/52052528243731-RSS-deprecation) | 官方 API，需用户用自己的 Upwork 账号申请 key；RSS 已于 2024-08-20 停用。 | 待核对条款与个人用途是否获批；拿到 key 前用提醒邮件或粘贴。 |
| [Työmarkkinatori 职位接口](https://tyomarkkinatori.fi/en/instructions-and-support/interfaces/interfaces-for-job-postings) | 检索接口的权限绑定组织的 business ID，需向 KEHA 提交启用表单。 | 个人无法使用；走提醒邮件或粘贴。 |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE) | MIT；仅考虑多步公司研究等受控任务。 | V0.3 以后再评估。项目仍处开发预览，[安全声明](https://github.com/deepseek-ai/deepseek-harness/blob/master/SAFETY.md)要求谨慎；业务事实与申请状态不能存于 Agent 会话。 |
| [Electron `printToPDF`](https://www.electronjs.org/docs/latest/api/web-contents) | 桌面版可复用自带 PDF 接口。 | Electron 已在 T21 引入（只做内置浏览器和保存当前职位）；PDF 仍先按 T08 的浏览器打印验证，`printToPDF` 不能成为 V0.1 Web 导出的前置依赖。 |

**采用检查**：先证明该功能进入当前任务范围，再看标准库/现有依赖是否已覆盖；若复制代码，记录具体仓库、commit、许可证和 notice。对第三方职位来源只复用公开接口，不绕过登录或验证码，不复用第三方的自动海投代码；本项目的提交只发生在用户逐个批准之后。

**已淘汰的本地存储候选**：[Node `node:sqlite`](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)、[SQLite FTS5](https://www.sqlite.org/fts5.html) 和 [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) 仍可服务未来完全离线版；当前 Railway + Neon 路线不同时维护 SQLite。需要搜索时先用 [PostgreSQL 全文检索](https://www.postgresql.org/docs/current/textsearch.html)。
