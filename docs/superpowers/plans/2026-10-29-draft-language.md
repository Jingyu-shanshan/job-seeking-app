# Draft Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为简历和求职信增加中文、芬兰语选择，保留默认英语和既有审阅/PDF 流程。

**Architecture:** 在现有生成请求和不可变 artifact 中保存 `language`，经加载器传到审阅及文档页面。最新草稿继续按 kind 查询，仅在重复生成判断中比较语言；扩展现有规则检查和文档固定文案，不增加翻译流水线。

**Tech Stack:** TypeScript、TypeBox、Fastify 5、PostgreSQL SQL migrations、Angular 22、node:test、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-29-draft-language-design.md`（建议设计，执行前待用户确认）。

## Global Constraints

- 不新增依赖，不新增模型调用步骤；每次点击仍只发送一次 DeepSeek 请求。
- 不增加发送给模型的个人资料；沿用事实确认和可见性限制，保留费用记录、失败记录和并发保护。
- 不修改原始事实、JD 引文、历史草稿正文或已保存的 PDF。
- 不放宽无引用、撤销事实、数字、限定词、状态、敏感信息、占位符或 PDF 文本校验。
- 不做全站国际化、语言自动识别、任意语言输入、历史语言版本列表或自动翻译已编辑文本。
- 测试仅使用虚构数据；真实模型调用需要另行明确数据和费用上限。

## Review Focus

- 省略语言的旧请求、已有英文草稿和 PDF：继续按英语处理且文本不变（任务 1、3）。
- 同一 kind 切换语言或并发点击：切换可生成，同语言重复被拒；不同语言仍串行保护同一 kind（任务 1）。
- 中文数字紧贴汉字、芬兰语百分号前空格：识别相同数值，阻止伪造数值和丢失限定词（任务 2）。
- 翻译后的状态词、月份和专有名称：识别有限等价表达，保持原名，不能用非英语绕过原有检查（任务 2）。
- 中文字体及中芬 PDF 提取：文字可读且匹配；遗漏、增文、越界保持拒绝（任务 3、4）。

---

## 文件结构与影响范围

- `packages/shared/src/drafts.ts`、`documents.ts`、`index.ts`：语言 schema、类型和输出字段。
- 新迁移 `apps/server/migrations/1793232000000_draft-language.sql`：artifact 语言列及约束；创建前确认编号未被占用。
- `apps/server/src/drafts/{routes,write,load}.ts`：默认值、提示词、保存、加载、重复生成判定。
- `apps/server/src/rules/statement.ts`：复用现有数值、日期、名称、状态检查，扩展有限的三语表达识别。
- `apps/server/src/rules/document.ts`、`documents/routes.ts`：文案、文件名、语言输出。
- `apps/web/src/app/jobs/{job-drafts,jobs-api,job-detail}.ts`：两个选择器和请求传递。
- `apps/web/src/app/drafts/{draft-page,document-page,document-sheet}.ts`：语言展示、文档 `lang`、字体回退。
- 对应已有测试及类型构建报错涉及的虚构 fixture：同步必需字段，不手工复制无关测试。
- `jd/routes.ts`、`forms/job-form.ts`、`applications/routes.ts` 作为调用方回归核对：最新草稿仍每 kind 一份，文件选择和申请冻结无需引入语言版本选择。
- 工作区已有 `runs.ts`、`runs.spec.ts` 未提交改动：不纳入本功能提交。

### Task 1: 语言契约、持久化和生成

**Files:**
- Modify: `packages/shared/src/drafts.ts`, `packages/shared/src/documents.ts`, `packages/shared/src/index.ts`
- Create: `apps/server/migrations/1793232000000_draft-language.sql`
- Modify: `apps/server/src/drafts/routes.ts`, `apps/server/src/drafts/write.ts`, `apps/server/src/drafts/load.ts`
- Test: `apps/server/src/drafts/routes.test.ts`, `apps/server/src/db/schema.test.ts`
- Modify: `apps/server/src/documents/routes.ts`（补全新返回字段）及构建指出的 Draft/DraftSummary/DraftDocument 测试 fixture。

**Interfaces:**
- Produces: `DraftLanguageSchema`, `type DraftLanguage = 'en' | 'zh' | 'fi'`，从 `@jsa/shared` 导出。
- Produces: `WriteDraftRequest = { kind: DraftKind; language?: DraftLanguage }`；`Draft`、`DraftSummary`、`DraftDocument` 都有必填 `language: DraftLanguage`。
- Produces: `WriteOptions.language: DraftLanguage`；`StoredDraft.language: DraftLanguage`；`writeDraft(options: WriteOptions): Promise<string>` 返回值不变。
- Consumes: 现有 `latestDrafts(pool, snapshotId): Promise<StoredDraft[]>`，保持每 kind 最新一份的接口。

- [ ] **Step 1: 添加失败测试。** 在既有 route fixture 中扩展 draft 请求 helper，使它可额外传入 language。加入以下具名用例和断言（`res` 为现有注入响应）：

```ts
// omitted language defaults to English
assert.equal(res.statusCode, 201);
assert.equal(res.json<Draft>().language, 'en');
// Chinese and Finnish language survive generation and reload
assert.equal(res.json<Draft>().language, language); // 分别 zh、fi
assert.equal((await read(res.json<Draft>().id)).language, language);
// unknown language is refused before a model call
assert.equal(invalid.statusCode, 400); // language: 'de'、''、null 分别测试
assert.equal(deepseek.requests.length, beforeRequests);
// a different language permits generation with unchanged facts
assert.equal(changed.statusCode, 201);
assert.equal(repeated.statusCode, 409); // 最新草稿同语言、同事实
```

另测同 kind 两次并发（包括选择不同语言）不会并行调用模型；测试前后请求数量，并保留旧 ID 可读取的断言。数据库测试断言不指定语言插入 artifact 得到 `en`、显式 `zh`/`fi` 可保存、`de` 违反 check；测试升级前有英文 artifact 的迁移路径。

- [ ] **Step 2: 验证测试失败。** Run: `npm run build -w @jsa/shared && npm test -w @jsa/server`。预期新增用例因语言未返回、未校验或未持久化失败；数据库不可用导致 skip 不算验证。

- [ ] **Step 3: 实现契约和 migration。** 新列 `artifact.language text not null default 'en' check (language in ('en','zh','fi'))`，采用已有 SQL migration 格式。将输出 schema、loader SQL、`checkDraft`、`summariseDraft` 和文档返回值贯通；旧请求在路由中用 `language ?? 'en'`。保持 artifact 不可变，不更新旧正文；同步所有编译受影响 fixture。

- [ ] **Step 4: 实现生成规则。** `writeDraft` 的 options 保存 language；共享提示词移除固定英文规则，使用服务端枚举映射追加目标语言要求，JSON key、事实 ref 和 quote 不翻译；姓名/公司/技术名保持原样，日期 `YYYY-MM`，数字用阿拉伯数字。语言不得从任意用户字符串拼成指令。写入 artifact 时保存 language。重复判断只在最新同 kind 草稿语言相同且事实相同才拒绝；路由 writing key 和数据库锁仍按 snapshot/kind，保持下游最新草稿定义不变。

提示词测试核对目标语言、不再有冲突英文要求、发送内容仍只有允许的事实与职位文本；适配现有通过 system prompt 全等区分简历/信件的模拟响应，不能让中文简历误走信件 fixture。

- [ ] **Step 5: 验证通过。** Run: `npm run typecheck`、`npm test -w @jsa/server`。预期新增测试和原有生成/并发/费用/失败用例通过；记录数据库测试是否实际运行。

- [ ] **Step 6: 提交本任务。** 精确暂存本任务文件和必要 fixture，`git commit -m "feat: persist draft output language"`，不要暂存工作区原有 runs 改动。

### Task 2: 三语输出的事实校验

**Files:**
- Modify: `apps/server/src/rules/statement.ts`
- Test: `apps/server/src/rules/statement.test.ts`, `apps/server/src/drafts/routes.test.ts`
- Modify: `apps/server/src/drafts/write.ts`（生成格式约束如需收紧）

**Interfaces:**
- Consumes: 任务 1 的三种语言输出；原始事实与 JD quote 不变。
- Produces: 保持 `statementProblems(statement: StatementInput, context: StatementContext): Problem[]` 和现有调用签名。校验同时理解有限三语表达，不依赖目标语言跳过检查，也不修改原始展示文本。

- [ ] **Step 1: 添加失败测试。** 沿用已有 `me`、`passes`、`fails` helper；分别覆盖英语事实翻译为中文/芬兰语及三语事实原文。固定核心断言：

```ts
passes(me('处理时间减少了约30%。', facts.result));
passes(me('Lyhensin käsittelyaikaa noin 30 %.', facts.result));
fails(me('处理时间减少了约40%。', facts.result), 'number');
fails(me('Lyhensin käsittelyaikaa 30 %.', facts.result), 'qualifier');
passes(me('Finnish：基础（A2）', facts.finnish));
passes(me('Finnish: perustaso (A2)', facts.finnish));
fails(me('Finnish (A2)', facts.finnish), 'status');
```

补充表驱动用例：`约/noin/about`，`超过/yli/over`，`至多/enintään/up to`；`基础/perustaso/basic`，`预计/odotettu/expected`，`进行中/kesken/in progress`。相同类别跨语言允许，删除或升级类别仍拒绝。月份覆盖 `March 2021`、`2021年3月`、`maaliskuu 2021` 与 `2021-03` 的等价及错误月份；`30%` 紧贴汉字和 `30 %` 均被提取。

专有名词使用原样 `Acme Oy`、`PostgreSQL`，并断言凭空添加 `AWS` 仍失败；原始 quote 被翻译仍为 `quote_not_found`；中文连接句新增 `40%` 仍失败。保留敏感信息、无引用和撤销事实的原测试。

- [ ] **Step 2: 验证失败。** Run: `cd apps/server && node --test src/rules/statement.test.ts`。预期跨语言限定词/状态和中文数值边界新增断言失败。

- [ ] **Step 3: 最小扩展规则。** 在原有 qualifier/status/month 提取中增加上述明确表达映射，将语义相同的限定类别和状态类别比较。调整数值边界允许紧贴汉字，同时保留技术标识符中的数字边界；增加 `%` 前空格支持。只在检查内部规范化，不改事实或正文；保留 A2 等级检查。名称保持保守原文匹配，不整体关闭大小写名称检查；芬兰语句首普通词采用现有句首处理。未知表达不作为自动通过的证据。

- [ ] **Step 4: 验证通过。** Run: `cd apps/server && node --test src/rules/statement.test.ts`；再运行 `npm test -w @jsa/server`。三语正例通过，伪造数值、状态升级及旧英文负例全部继续失败于指定 code。

- [ ] **Step 5: 提交。** `git add apps/server/src/rules/statement.ts apps/server/src/rules/statement.test.ts apps/server/src/drafts/routes.test.ts apps/server/src/drafts/write.ts`；`git commit -m "fix: validate multilingual draft statements"`。

### Task 3: 本地化文档和 PDF 兼容

**Files:**
- Modify: `apps/server/src/rules/document.ts`, `apps/server/src/documents/routes.ts`
- Test: `apps/server/src/rules/document.test.ts`, `apps/server/src/documents/routes.test.ts`, `apps/server/src/rules/pdf.test.ts`

**Interfaces:**
- Consumes: 任务 1 的 `Draft.language` 和 `DraftDocument.language`。
- Produces: `documentBlocks(draft: Pick<Draft, 'kind' | 'statements' | 'language'>, profile: Profile): DocumentBlock[]`。
- Produces: `documentFileName(kind: DraftKind, job: { title: string; company: string | null }, profile: Pick<Profile, 'name'>, language: DraftLanguage = 'en'): string`；其余 piece/PDF 接口不变。

- [ ] **Step 1: 添加失败测试。** 三语 resume 和 cover letter 分别断言固定文案，采用下表精确值；英文原有快照不变。测试 `zh`/`fi` 文件名末尾分别包含 ` - zh`、` - fi` 且仍最多 150 字符；英文文件名与旧值完全相同。非英语后缀在截断预算内保留。

| 文案 | en（保持原值） | zh | fi |
|---|---|---|---|
| experience | Experience | 工作经历 | Työkokemus |
| projects | Projects | 项目经历 | Projektit |
| skills | Skills | 技能 | Osaaminen |
| education | Education | 教育经历 | Koulutus |
| languages | Languages | 语言能力 | Kielitaito |
| certifications | Certifications | 证书 | Sertifikaatit |
| salutation | Dear Hiring Manager, | 尊敬的招聘负责人： | Hyvä rekrytoija, |
| sign-off | Kind regards, | 此致敬礼 | Ystävällisin terveisin, |

PDF 规则测试用虚构中文/芬兰语 pieces 及 PdfPage items：相同文字通过；遗漏、额外文字、越界分别失败。路由集成核对 `language`、localized blocks 和相应 PDF current 状态；英文旧 PDF 的 current 状态不得仅因迁移改变。

- [ ] **Step 2: 验证失败。** Run: `cd apps/server && node --test src/rules/document.test.ts src/rules/pdf.test.ts`。预期本地化文案和新文件名断言失败。

- [ ] **Step 3: 实现文案映射。** 直接在现有 `document.ts` 放三语固定映射；姓名、联系方式和公司原文不翻译，空章节不增加标题。`documentState` 按草稿语言生成 blocks/文件名；页面与 PDF 核对共用同一 pieces 来源，保持旧英文精确文本。

- [ ] **Step 4: 验证通过。** Run: `npm test -w @jsa/server`。要求 document、PDF 和 application/form 回归测试通过，旧稿和旧 PDF 可读。

- [ ] **Step 5: 提交。** 精确暂存本任务文件，`git commit -m "feat: localize generated document text"`。

### Task 4: 语言选择、审阅和打印页面

**Files:**
- Modify: `apps/web/src/app/jobs/job-drafts.ts`, `apps/web/src/app/jobs/jobs-api.ts`, `apps/web/src/app/jobs/job-detail.ts`
- Modify: `apps/web/src/app/drafts/draft-page.ts`, `apps/web/src/app/drafts/document-page.ts`, `apps/web/src/app/drafts/document-sheet.ts`
- Test: `apps/web/src/app/jobs/job-detail.spec.ts`, `apps/web/src/app/drafts/draft-page.spec.ts`, `apps/web/src/app/drafts/document-page.spec.ts`

**Interfaces:**
- Consumes: 任务 1 的 `WriteDraftRequest`、`DraftLanguage`、`DraftSummary.language`、`DraftDocument.language`。
- Produces: `JobDrafts.write = output<WriteDraftRequest>()`；`JobsApi.writeDraft(snapshotId: string, request: WriteDraftRequest): Promise<Draft>`；页面 `writeDraft(snapshotId: string, request: WriteDraftRequest)` 贯通 kind/language。
- Produces: `DocumentSheet.language = input.required<DraftLanguage>()`，host 绑定 `lang`；既有 kind/blocks 输入不变。

- [ ] **Step 1: 添加失败测试。** 在现有职位页测试中通过带 label 的 select 选择语言，分别断言：

```ts
expect(request.request.body).toEqual({ kind: 'resume', language: 'zh' });
expect(request.request.body).toEqual({ kind: 'cover_letter', language: 'fi' });
// 无草稿、未操作的选择器
expect(request.request.body).toEqual({ kind: 'resume', language: 'en' });
```

另测最新中文稿时简历选择器默认 `zh`，更改简历不会更改求职信；最新稿未过期但选择不同语言时显示生成按钮，同语言不显示；busy 或无可用事实时两个 select 和生成按钮禁用。失败后保留选择、显示现有错误且不跳转。审阅页显示草稿语言；文档 sheet 的 `lang` 为 `zh`/`fi`，screen-only 的语言标签不进入打印正文。

- [ ] **Step 2: 验证失败。** Run: `npm test -w @jsa/web -- --include='src/app/jobs/job-detail.spec.ts' --include='src/app/drafts/draft-page.spec.ts' --include='src/app/drafts/document-page.spec.ts'`。预期选择器/语言属性缺失导致新增测试失败。

- [ ] **Step 3: 实现最小界面。** 使用既有 Angular signal、原生带 label 的 select 和 output；选项严格为 `English`、`中文`、`Suomi`。初次读取最新稿初始化每 kind 选择，之后普通刷新不覆盖用户当前选择。更换语言不修改已有稿，仅影响下次生成。说明更换语言会产生付费的新草稿；两种 kind 保持独立。API 和父组件按新接口透传，沿用导航和费用刷新。

- [ ] **Step 4: 实现文档语言展示。** 审阅页和文档页非打印区域显示语言；将语言传入 DocumentSheet 并绑定 host `lang`，沿用现有字体栈并增加 `PingFang SC`、`Microsoft YaHei`、`Noto Sans CJK SC` 回退，不下载字体。不得向可打印文档添加服务端 pieces 中没有的文字。

- [ ] **Step 5: 验证通过。** Run: `npm test -w @jsa/web`、`npm run build`、`npm run typecheck`、`npm run lint`。确认本次修改相关检查通过，既有 runs 改动导致的失败单独报告，不擅自修改。

- [ ] **Step 6: 人工核对实际打印。** 使用虚构中文和芬兰语草稿，在浏览器审阅、打印为 PDF，再上传验证。核对中文无缺字、中芬换行无截断、字体文本可提取、PDF 被正确关联到对应草稿。不要调用真实模型；如未具备浏览器/数据库条件，明确记录未完成，不能声称端到端通过。

- [ ] **Step 7: 提交。** 精确暂存上述前端文件，`git commit -m "feat: select resume and cover letter language"`。

## 执行交接与自审

建议采用 Native：这四个任务共享同一条请求/文档链路，在当前会话逐项实施更省上下文；最终整体审查生成、校验和打印的衔接。

自审已覆盖 schema/导出、迁移、生成、重复规则、锁、费用、加载、页面、文档固定文案、PDF、调用方和 fixture；Review Focus 五项均对应任务测试。尚未运行任何实现测试；本次只交付待审阅设计和计划。执行前需要用户审阅设计及计划并选择执行方式。
