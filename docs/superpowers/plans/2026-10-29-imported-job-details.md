# Imported Job Details and Duplicate Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持修正已导入岗位的基本资料，并在重复导入时提供已有岗位链接和明确的另建选项。

**Architecture:** 手工修正独立存储，详情和列表在筛选前覆盖显示字段，不改写来源或不可变快照。网页创建入口共用重复候选查询及数据库事务；冲突返回结构化 409，明确另建则创建独立 job 和快照，保留 `saved_job.url` 唯一约束。

**Tech Stack:** TypeScript 6、Angular 22 Signal Forms、Fastify 5、TypeBox、PostgreSQL 18、node:test、Vitest；现有 npm workspaces。

**Spec:** `docs/superpowers/specs/2026-10-29-imported-job-details-design.md`（需求及建议边界）；执行时同时阅读 `docs/DEVELOPMENT.md`、根目录及 `apps/web/CLAUDE.md`。

## Global Constraints

- 不新增依赖。
- 原始 JD 快照与已提交材料不得原地覆盖。
- 沿用现有英文界面文案、Angular Signal Forms、登录和 Origin 校验。
- 标题最多 1000 字符，公司最多 1000 字符，地点最多 5000 字符，链接最多 2000 字符。
- 不调用真实付费模型，不修改生产数据库，不清理历史重复记录。

## Review Focus

- 可选值清空与后续重新抓取：公司 null、地点空字符串、链接 null 应保留，不能被来源回填（Task 1/2）。
- 同一岗位存在多种地址或只有粘贴快照：跟踪参数、LinkedIn 别名和历史链接仍需提示重复（Task 3）。
- 同公司同标题但不同地点或多个候选：展示所有候选，允许另建，不能自动合并（Task 3/4）。
- 重复请求或并发导入：未确认前零写入、零分析；普通并发请求只创建一条（Task 3/4）。
- 提示后更换输入、保存失败或已删除岗位：旧确认不得用于新输入，失败保留表单，删除记录不作为候选（Task 1–4）。

---

## 文件与复用范围

修改 `packages/shared/src/jd.ts`、`index.ts` 定义和导出契约；保留 `saved.ts` 对 `PasteJobRequestSchema` 的既有别名，新增另一个网页创建请求 schema，防止把另建权限意外带入桌面 API。

新增 `apps/server/src/jd/details.ts` 管理手工修正与可编辑性，`apps/server/src/jd/import.ts` 管理网页重复查询与创建事务。修改 `jd/routes.ts`、`discovery/routes.ts` 接入。复用 `rules/job-page.ts`、`rules/same-job.ts`，不改变自动发现和邮件合并规则。`jd/saved.ts`、`discovery/same-job.ts` 的查询参数类型扩为 `Pool | PoolClient`，允许现有保存逻辑使用调用方事务。

新增网页 `jobs/job-details-form.ts` 及测试；修改 `job-detail.ts`、`jobs-api.ts`、`paste-job.ts`、`import-job-link.ts`、`search-jobs.ts` 和相邻测试。重复提示使用一个小组件 `jobs/duplicate-job.ts` 及测试，避免三处复制链接和按钮逻辑。新增数据库迁移；其余配置、路由、自动发现、桌面工具栏和 runner 不新增功能。

### Task 1: 已导入岗位资料的持久化与读写 API

**Files:**
- Create: `apps/server/migrations/1793270000000_job-details.sql`
- Create: `apps/server/src/jd/details.ts`
- Modify: `packages/shared/src/jd.ts`, `packages/shared/src/index.ts`
- Modify: `apps/server/src/jd/routes.ts`, `apps/server/src/discovery/routes.ts`
- Test: `apps/server/src/jd/routes.test.ts`, `apps/server/src/discovery/routes.test.ts`, `apps/server/src/db/schema.test.ts`

**Interfaces:**
- Produce `JobDetailsSchema` / `JobDetails = { title: string; company: string | null; location: string; url: string | null }`，四字段均必填；拒绝额外属性，复用既有限长和非空规则。
- Produce `JobDetail.canEditDetails: boolean`；更新 `apps/web/src/app/jobs/job-detail.spec.ts` 中完整 `JobDetail` fixture，默认 false。
- Produce `loadJobDetails(db: Pool | PoolClient, jobIds: readonly string[]): Promise<Map<string, JobDetails>>`。
- Produce `canEditJobDetails(db: Pool | PoolClient, jobId: string): Promise<boolean>`：未删除且有 saved_job、启用来源的 alert_job、paste 快照，或没有 job_posting 的独立链接导入快照（catalog 为 company_page/greenhouse_board/ashby_board）。
- Produce `PUT /api/jobs/:id/details`，body `JobDetails`，200 `JobDetail`；不存在或已删除 404，仅发现且未导入 409。

- [ ] **Step 1: 写失败测试。** 增加 `edits imported details without rewriting history`：粘贴岗位后 PUT 标题 Engineer II、公司 null、地点 Tampere、链接 null；断言 200，GET 详情及列表同值，snapshot id/字段/body、summary、draft、application 内容未变。增加保存页、启用邮件岗位、无文本保存岗位可编辑及仅发现岗位拒绝用例。增加 `rejects invalid job details`，断言空白标题、超长值、http、带用户名密码地址、额外属性均 400，缺失/删除岗位 404；无 session 401、错误 Origin 403。

  核心断言（使用本文件已有 call/detail helper）：
  ```ts
  assert.equal(response.statusCode, 200);
  assert.equal(updated.company, null);
  assert.equal(updated.location, 'Tampere');
  assert.equal(updated.url, null);
  assert.deepEqual(updated.snapshot, before.snapshot);
  ```

- [ ] **Step 2: 验证失败。** Run `npm run build -w @jsa/shared && node --env-file-if-exists=.env --test apps/server/src/jd/routes.test.ts apps/server/src/discovery/routes.test.ts apps/server/src/db/schema.test.ts`。Expected：新端点测试因 404 或未修正返回值失败；数据库测试不得仅 skip。

- [ ] **Step 3: 实现契约及迁移。** `job_details(job_id uuid primary key references job(id), title text not null, company text null, location text not null, url text null)`，数据库加长度和非空标题约束；不迁移/复制既有来源。实现上述函数和 PUT 的 upsert，trim 字段，公司空白转 null、地点空白转 ''、链接空白转 null，非空链接使用 URL 校验且不得携带凭据。迁移测试断言无修正行也能读取旧岗位、约束拒绝非法直接写入。

- [ ] **Step 4: 接入读取与筛选。** `loadJobDetail` 先取得现有 head，再按修正行整体覆盖四字段（不能 coalesce，否则清空失效），之后才 `checkJobs`。列表在组装完所有来源且移除 deleted 之后批量应用修正，之后才 `checkJobs` 和排序。新增 `keeps cleared details after source refresh`：更新来源字段再读，断言 company/url 仍 null；地点 criterion 使用 Tampere。核对导出自动包含新表，增加现有 `exportArchive` 路由测试断言 `data.json.job_details` 保存修正值。

- [ ] **Step 5: 验证并提交。** 重跑 Step 2，Expected：全部通过且数据库测试已运行；提交上述任务文件，message `feat: edit imported job details without rewriting snapshots`。

### Task 2: 岗位详情编辑表单

**Files:**
- Create: `apps/web/src/app/jobs/job-details-form.ts`, `apps/web/src/app/jobs/job-details-form.spec.ts`
- Modify: `apps/web/src/app/jobs/jobs-api.ts`, `apps/web/src/app/jobs/job-detail.ts`, `apps/web/src/app/jobs/job-detail.spec.ts`

**Interfaces:**
- Consume Task 1 的 `JobDetails`、`JobDetail.canEditDetails` 和 PUT。
- Produce `JobsApi.updateDetails(jobId: string, details: JobDetails): Promise<JobDetail>`。
- Produce `JobDetailsForm`，`job = input.required<JobDetail>()`、`saved = output<JobDetail>()`、`cancelled = output<void>()`。

- [ ] **Step 1: 写失败测试。** `opens and saves imported job details` 断言仅 canEditDetails=true 出现 Edit details，输入初值来自当前详情；填写公司 Acme Oy、地点 Espoo 后点 Save details，PUT body 为完整四字段，flush 后父页更新。`clears optional values` 断言公司/链接空串发送 null、地点空串发送 ''；`cancel does not write` 用 `http.expectNone`；`retains edits on failure` flush 500 后保留输入并显示 alert。另测空白标题/非法链接无请求、提交中不能重复保存及键盘取消后的焦点回到 Edit details。

  ```ts
  const request = http.expectOne(`/api/jobs/${jobId}/details`);
  expect(request.request.method).toBe('PUT');
  expect(request.request.body).toEqual({
    title: 'Engineer II', company: 'Acme Oy', location: 'Espoo', url: null,
  });
  ```

- [ ] **Step 2: 验证失败。** Run `npm test -w @jsa/web -- --include src/app/jobs/job-details-form.spec.ts --include src/app/jobs/job-detail.spec.ts`。Expected：新增组件/操作缺失失败。

- [ ] **Step 3: 实现表单与集成。** 用 Signal Forms、现有 label/错误样式，按钮文案 Edit details / Save details / Cancel。编辑模型从 job 输入初始化；仅保存成功 emit。父页使用现有 httpResource 的值更新方式接收完整 JobDetail；关闭编辑后管理焦点。显示原始 JD 的区域继续显示 snapshot 原值，不把 metadata 当成原文更正。

- [ ] **Step 4: 验证并提交。** 重跑 Step 2，Expected PASS；提交任务文件，message `feat: add imported job details editor`。

### Task 3: 网页导入重复协议与独立另建

**Files:**
- Create: `apps/server/src/jd/import.ts`
- Modify: `packages/shared/src/jd.ts`, `packages/shared/src/index.ts`
- Modify: `apps/server/src/jd/routes.ts`, `apps/server/src/jd/saved.ts`, `apps/server/src/discovery/same-job.ts`, `apps/server/src/discovery/routes.ts`
- Test: `apps/server/src/jd/routes.test.ts`, `apps/server/src/jd/saved.test.ts`, `apps/server/src/discovery/routes.test.ts`

**Interfaces:**
- Produce `CreateImportedJobRequestSchema` / `CreateImportedJobRequest`：原 PasteJobRequest 字段加 `createNew?: boolean`，供 POST /jobs；不修改 PasteJobRequestSchema 或桌面请求。
- Extend `ImportJobLinkRequest` 增加 `createNew?: boolean`。
- Produce `DuplicateJobSchema` / `DuplicateJob = { id: string; title: string; company: string | null; location: string }`；`DuplicateJobResponseSchema` / `DuplicateJobResponse = { code: 'duplicate_job'; message: string; jobs: DuplicateJob[] }`，jobs 至少一项。
- Produce `findDuplicateJobs(db: Pool | PoolClient, input: { url: string; title?: string; company?: string | null }): Promise<DuplicateJob[]>`。
- Produce `importJob(pool: Pool, page: PasteJobRequest, catalogId: 'paste' | 'company_page' | 'greenhouse_board' | 'ashby_board', options: { createNew?: boolean; requestedUrl?: string }): Promise<{ jobId: string } | DuplicateJobResponse>`。
- POST /jobs 保留 201 JobDetail；POST /jobs/import-link 保留 200 JobDetail；两者重复时 409 DuplicateJobResponse，通过 reply.code(409).send 返回，不能依赖默认错误处理器保留自定义字段。

- [ ] **Step 1: 写失败测试。** `reports duplicates without writing` 对粘贴和链接导入断言 409、code='duplicate_job'、jobs 包含旧 id；前后 job/saved_job/snapshot/reading/model_call 数量相同。地址用例包含 utm/fragment、LinkedIn 别名、仅 paste 快照、修正前后 URL；公司标题用例包含 Acme Oy / acme、Full-Stack Engineer / fullstack engineer、不同地点、缺公司但不同 URL 不匹配、缺公司但同 URL 匹配。多个候选断言全部返回且按 id 稳定排序；删除岗位排除。历史地址匹配先于公司标题匹配。

  ```ts
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, 'duplicate_job');
  assert.deepEqual(response.json().jobs.map((job: { id: string }) => job.id), [existing.id]);
  assert.equal(await count('job'), jobsBefore);
  ```

- [ ] **Step 2: 验证失败。** Run `npm run build -w @jsa/shared && node --env-file-if-exists=.env --test apps/server/src/jd/routes.test.ts apps/server/src/jd/saved.test.ts apps/server/src/discovery/routes.test.ts`。Expected：新增 409/独立另建断言失败。

- [ ] **Step 3: 实现查询及事务。** 候选来源为未删除 job 的 posting、saved、启用 alert、snapshot 和 job_details；URL 用 jobPageAddress 逐个规范化并匹配 requested/resolved 地址（含 job_reading），去重 id；无 URL 命中才按 sameJobKey 匹配，Task 1 修正行存在时替代来源公司/标题。`importJob` 使用一个 checked-out client 开事务，`pg_advisory_xact_lock(hashtextextended('web-job-import', 0))` 串行检查和创建；带 error listener，catch rollback、finally 移除 listener 并 release。普通链接创建继续调用 saveJobPage（db 参数扩为 Pool|PoolClient）；普通粘贴或明确另建使用现有 insert-job/insert-snapshot SQL，链接另建同时记录实际 method/requested/resolved 的 job_reading，不写 saved_job。不改变原始快照触发器。

- [ ] **Step 4: 接入两个路由和列表。** 链接入口先验证读取方式/URL/站点策略；未另建时可先按请求 URL 只读查重，命中立即 409，未命中才抓取。抓取后通过 importJob 在事务内再次检查规范化后的请求 URL、结果 URL 和公司标题。另建不绕过原有抓取安全限制。列表的 paste 快照分支同时纳入没有 posting/saved/启用 alert 的独立 company_page/greenhouse_board/ashby_board 快照；先取每岗位最新快照再判断目录来源，保留最早 firstSeenAt，链接类型 origin='saved'、粘贴 origin='pasted'、imported=true。Task 1 可编辑性规则覆盖这些独立记录。

- [ ] **Step 5: 加回归并验证。** `creates another only when explicitly requested` 断言 createNew=true 得到新 id、相同原文的新 snapshot、旧岗位零变化、两个 id 均在列表且可编辑；下一次普通导入返回两条候选；链接另建保留读取来源。`serializes concurrent normal imports` 用 Promise.all 两次相同普通导入，断言一次成功一次 409、仅一条新 job。测试默认 summary 重试复用旧 id；更新原 routes.test.ts 中重复链接曾返回 200 的断言。测试 helper 不得全局默认 createNew=true；仅原有确实需要独立 fixture 的测试显式另建。重跑 Step 2，Expected 全部 PASS，desktop saved.test.ts 原有幂等性继续通过。

- [ ] **Step 6: 提交。** 提交任务文件，message `feat: detect duplicate job imports before creating records`。

### Task 4: 三个网页入口的重复提示与确认

**Files:**
- Create: `apps/web/src/app/jobs/duplicate-job.ts`, `apps/web/src/app/jobs/duplicate-job.spec.ts`
- Modify: `apps/web/src/app/jobs/jobs-api.ts`, `apps/web/src/app/jobs/paste-job.ts`, `apps/web/src/app/jobs/import-job-link.ts`, `apps/web/src/app/jobs/search-jobs.ts`
- Test: `apps/web/src/app/jobs/paste-job.spec.ts`, `apps/web/src/app/jobs/import-job-link.spec.ts`, `apps/web/src/app/jobs/search-jobs.spec.ts`
- Modify: `docs/DEVELOPMENT.md`（补记新行为与另建的快照存储方式）

**Interfaces:**
- Consume Task 3 的请求/409 契约；`JobsApi.paste(job: CreateImportedJobRequest): Promise<JobDetail>`；`JobsApi.importLink(url: string, method: ImportJobLinkRequest['method'] = 'direct', createNew = false): Promise<JobDetail>`，false 时不发 createNew 字段。
- Produce `duplicateJobs(error: unknown): DuplicateJob[] | null`（位于 jobs-api.ts）：只接收 HttpErrorResponse 409、code='duplicate_job' 且字段形状合法的响应，其他错误继续现有 errorMessage。
- Produce `DuplicateJobNotice`，`jobs = input.required<DuplicateJob[]>()`、`busy = input(false)`、`createAnother = output<void>()`，三入口共用。

- [ ] **Step 1: 写失败测试。** 三入口注入 409，断言显示 This job is already added.、所有 `/jobs/:id` 链接和 Create another imported job；`http.expectNone` 验证未分析/未导航。点击另建断言同一输入且 createNew=true；新成功结果沿用原入口成功流程（链接导入才继续已有分析步骤）。再测改变输入后清提示、下一次普通提交不带 true、另建失败后仍能重试、busy 时不可重复触发。搜索按 candidate.url 隔离冲突，不能把 A 的确认用于 B。结构不合法的 409 走普通错误，不显示确认按钮。

  ```ts
  expect(page().textContent).toContain('This job is already added.');
  expect(page().querySelector('a[href="/jobs/job-1"]')).not.toBeNull();
  http.expectNone((request) => request.url.includes('/summary'));
  expect(router.navigate).not.toHaveBeenCalled();
  ```

- [ ] **Step 2: 验证失败。** Run `npm test -w @jsa/web -- --include src/app/jobs/duplicate-job.spec.ts --include src/app/jobs/paste-job.spec.ts --include src/app/jobs/import-job-link.spec.ts --include src/app/jobs/search-jobs.spec.ts`。Expected：重复提示/另建动作缺失失败。

- [ ] **Step 3: 实现提示和动作。** 复用 RouterLink、原有提交方法及错误文案；createNew 是按钮触发的本次参数，不是持久的表单开关。粘贴/链接提示用 linkedSignal 随完整输入重置；重置时同时清除关联成功结果和重试状态。搜索候选保持各自的重复列表和 busy 状态。另建动作读取当前完整有效表单，若已改变则回到普通检查；本次操作结束后移除另建意图。提示 role=status，操作错误 role=alert，显示后将焦点移至提示标题；保留普通非重复错误路径。

- [ ] **Step 4: 验证并记录。** 重跑 Step 2，然后 `npm test`、`npm run build`、`npm run typecheck`、`npm run lint`，Expected 全部成功；必须确认 TEST_DATABASE_URL 的数据库测试实际运行，未配置则报告未验证而不能宣称通过。用假数据、假 fetch/模型验证保存修改→返回列表→重复提示→打开已有岗位→明确另建全链路；无真实外部抓取或付费模型请求。更新 DEVELOPMENT.md。

- [ ] **Step 5: 提交。** 提交任务文件，message `feat: offer existing job links and explicit duplicate import`。

## 自检与交接

- 需求 1 对应 Task 1/2；需求 2 对应 Task 3/4；Review Focus 五项均有具体测试。
- 新增契约在后续任务使用同名字段；桌面 SavePageRequestSchema 不继承 createNew。详情页仍使用 JobDetail 响应，成功调用方无需改成 union。
- 导出通过自动枚举表覆盖 job_details；不需要修改导出格式、历史快照、runner、配置或添加依赖。现有自动发现/邮件合并不拓展为公司标题猜测新规则。
- 建议 Native 执行：四个任务依赖相邻接口，由同一实现者顺序完成更省上下文，末尾一次独立审查。执行前请用户审阅尤其是字段范围、去重规则和网页入口范围。
