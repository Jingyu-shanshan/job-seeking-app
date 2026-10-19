# T31 UIUX 发布验收（2026-10-19）

验收对象为 T22–T30 合并后的真实 Angular 路由、Fastify API、PostgreSQL 与本地 runner。结论：本报告所列自动化发布门槛通过，发现的登录/事实异常恢复问题已修复；设备与辅助技术的人工边界见末节。本次全部使用编造账户、事实、职位、模型响应和表单；没有真实模型费用或真实投递，没有重启旧业务数据库。T32 云资源整理不在本次范围。

## 可复现的发布门槛

新增 [scripts/ui-acceptance.mjs](../scripts/ui-acceptance.mjs)，复用现有 Playwright、服务端测试夹具和 Node assert，没有新测试框架或依赖。CI 在生产构建、完整测试后执行此脚本，成功后再执行既有隔离恢复演练。

```bash
npm run lint
npm run typecheck
npm run build
npm run build -w @jsa/desktop
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres npm test
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres node scripts/ui-acceptance.mjs
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres npm run db:restore-drill
```

`TEST_DATABASE_URL` 必须指向允许创建一次性数据库的测试服务器。脚本只新建/删除 `jsa_test_*` 库，不读取 `.env` 的业务数据库；本机端口 33131 必须空闲，已安装 Google Chrome，且已完成构建。结果、截图及 PDF 写入忽略的 `scratch/t31/`。第三方 API 由 `fakeDeepSeek`/`fakeGreenhouse` 返回编造数据，runner 浏览器的全部请求均被拦截，并断言主机和提交次数；没有向真实公司发送数据。

实际通过的检查：

- 完整测试包含真实隔离 PostgreSQL、Chrome 表单、权限、不可变记录与预算；最终前端 278 项通过。各 workspace 的最终合计与 CI 结果见 T31 任务记录。
- 连贯流程：首次登录的原样重试与深链接返回 → 跳过教程 → 新事实确认/独立许可 → 粘贴已发现职位的 JD → 总结/匹配 → 两类草稿/证据 → Chrome A4 PDF → 真实服务端文字与边界校验 → 表单 → runner 暂停补答/Continue → 预览 → 界面批准 → 一次假提交 → 冻结申请 → 面试/私人笔记。五次模型请求全部是模拟响应，批准前表单 POST 为 0，批准后为 1；实际发出文件的 SHA-256 下载复核一致，姓名联系方式和私人笔记没有进入模型请求。
- 21 个实际页面组合（含两类草稿/成稿、未知页）× 1440/1024/768/390/360px × 亮暗，共 210 次页面访问；均检查深链接加载、主内容焦点、减少动态效果偏好和横向溢出。另对 17 个资源页面在宽屏亮色/窄屏暗色逐一检查 loading → error → retry。
- 使用当前构建重跑既有 T25–T30 编造数据浏览器脚本：190 + 53 + 69 + 56 + 61 + 105 = 534 组布局/axe/交互检查，未报告页面异常或 axe 违规。覆盖 1440/1024/768/605/390/360px；原有脚本及原始 JSON 留在忽略的 `scratch/t25/`–`scratch/t30/`，本次日志在 `scratch/t31/`。
- 额外 11 组内容/打印检查：空事实、全部撤回及展开、大量待确认（80 条）、多段正文、无空格长文本、长邮箱/长错误、同内容重试，以及四页 A4。正文/次要文字/主按钮/信息/警告/错误共八组 token 在亮暗两种主题的最低对比度为 **5.58:1**。正文和状态文字超过 4.5:1；状态同时有文字标记。
- 29 个浏览器 JS/CSS/HTML 产物检查未发现数据库 URL、私钥、配置中的密钥原文或 TypeBox `~kind`。49 表的编造数据 `pg_dump` → 隔离 `pg_restore` 对比通过。

## T24 场景与真实状态矩阵

下表沿用 [T24 的 28 个场景](T24_DESIGN_HANDOFF.md#路由画板与实现对应)，以真实组件的共用状态归类，不把设计稿数量当作运行时证据。`通过` 表示该行列出的适用状态已验证；`—` 表示不适用，原因见后文。证据为提交的 specs/发布脚本，以及本次编造数据浏览器记录。

| T24 场景 / 路由 | loading | empty / no-results | error / retry | busy / success | blocked / outdated | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| login `/login` | — | 必填校验通过 / — | 原样登录重试通过 | 禁止重复请求/返回原链接通过 | 未登录拦截通过 / — | `login.spec.ts`、`app.spec.ts`、发布脚本 |
| overview `/` | 通过 | 首次空资料通过 / — | 通过 | 只读下一步通过 / — | 缺许可/待核实优先通过 / — | `home.spec.ts`、T26、发布脚本 |
| guide `/` | — | — / — | 存储失败降级通过 | 继续/完成/跳过/续读通过 | 不阻塞深链接通过 / — | `quick-guide.spec.ts`、T26 |
| facts `/facts` | 通过 | 无事实/全撤回/筛选无结果通过 | 加载及新建原样重试通过 | 确认/许可/撤回反馈通过 | 敏感项不能外发通过 / — | `facts.spec.ts`、content、发布脚本 |
| fact-edit `/facts` | — | 必填校验通过 / — | 保存失败保留输入通过 | 新建/编辑/确认通过 | 编辑清确认/许可通过 / 历史保留通过 | `facts.spec.ts`、服务端 facts 回归 |
| import `/facts` | 预览等待通过 | 空文件通过 / — | 失败/重选通过 | 预览不写入、保存通过 | 格式/大小/页数/文字层拦截通过 / — | `fact-import.spec.ts`、服务端 facts 回归 |
| candidates `/facts` | — | 无候选/全重复通过 | 批次失败回滚/重试通过 | 校对/拆分/合并/选择/原子导入通过 | 许可默认关闭、撤回重复不恢复通过 / — | `fact-import.spec.ts`、facts 路由测试 |
| jobs `/jobs` | 通过 | 无职位/无合格结果通过 | 通过 | 读取来源/分组通过 | 未知与淘汰独立通过 / 过期证据通过 | `jobs.spec.ts`、T27、发布脚本 |
| paste `/jobs/paste` | — | 必填校验通过 / — | 保留原文重试通过 | 保存/防重复通过 | 非 HTTPS/超长拒绝通过 / — | `paste-job.spec.ts`、T27 |
| alerts `/jobs/alerts` | — | 无可读职位通过 / — | 导入失败重试通过 | 导入/重复识别通过 | 来源关闭/非提醒拒绝通过 / — | `import-alerts.spec.ts`、alerts 服务端测试 |
| job `/jobs/:id` | 通过 | 无 JD/总结/匹配通过 / — | 读取/模型失败重试通过 | 总结/匹配/草稿通过 | 无许可/硬条件未知通过 / 过期通过 | `job-detail.spec.ts`、T27、发布脚本 |
| form `/jobs/:id` | 读取等待通过 | 未读/缺答案通过 / — | 保存/读取重试通过 | 保存/Ready to fill 通过 | 可选敏感答案保留、未知必填暂停通过 / 题目变化通过 | `job-form.spec.ts`、forms 服务端测试、发布脚本 |
| approval `/jobs/:id` | 读取等待通过 | 尚无任务/预览通过 / — | 刷新/批准失败通过 | 预览先于批准、只提交一次通过 | CAPTCHA/离线/上限/待核实通过 / 批准失效通过 | `job-fill.spec.ts`、runner/submit 测试、发布脚本 |
| manual `/jobs/:id` | 读取等待通过 | 无 PDF 通过 / — | 保存失败保留通过 | 仅登记实际发出文件通过 | 无 JD/未来时间/空附件拒绝通过 / — | `job-applications.spec.ts`、applications 服务端测试 |
| runs `/runs` | 通过 | 无预设/运行通过 / — | 原样保存/加载重试通过 | 保存/启动分开、停止/恢复通过 | 默认零预算、未知用量保留通过 / 冻结设置通过 | `runs.spec.ts`、runs 服务端测试、T30 |
| draft `/drafts/:id` | 通过 | 空/被排除陈述通过 / — | 读取/编辑重试通过 | 编辑/排除/恢复与焦点通过 | 无证据/校验失败不入文档通过 / 过期通过 | `draft-page.spec.ts`、T28、发布脚本 |
| document `/drafts/:id/document` | 通过 | 无保存文件通过 / — | 加载/上传重试通过 | 上传中/保存当前文件通过 | 缺姓名、空/超限/不符 PDF 拦截通过 / 文件过期通过 | `document-page.spec.ts`、T28、发布脚本、content |
| applications `/applications` | 通过 | 无申请通过 / — | 通过 | 三种真实状态通过 / — | 未知结果只去核实通过 / — | `applications.spec.ts`、T29、发布脚本 |
| application `/applications/:id` | 通过 | 缺文件/来源/回执通过 / — | 通过 | 冻结文件下载通过 / — | 缺历史引用说明通过 / 当前与历史区别通过 | `application-page.spec.ts`、T29、发布脚本 |
| interview `/applications/:id/interview` | 通过 | 未生成/STAR 缺项通过 / — | 生成/笔记重试通过 | 不重复生成/保存笔记通过 | 非 Applied/无许可/摘录校验通过 / 使用冻结来源通过 | `interview-page.spec.ts`、interviews 服务端测试、发布脚本 |
| profile `/profile` | 通过 | 空资料通过 / — | 原样保存重试通过 | 未改/未存/保存中/已存通过 | 无效邮箱/链接通过 / — | `profile.spec.ts`、T30、发布脚本 |
| answers `/answers` | 通过 | 无答案通过 / — | 保存/删除重试通过 | 等待锁定/保存通过 | 敏感选项/地点范围通过 / — | `answers.spec.ts`、T30 |
| criteria `/criteria` | 通过 | 空选项通过 / — | 通过 | 等待锁定/保存通过 | 未知硬条件规则通过 / — | `criteria.spec.ts`、T30 |
| sources `/sources` | 通过 | 无来源通过 / — | 添加/切换/读取重试通过 | 等待锁定/保存通过 | 不支持请求的来源通过 / — | `sources.spec.ts`、T30 |
| runner `/runner` | 通过 | 无令牌通过 / — | 刷新/创建/撤销失败通过 | 一次展示/隐藏/撤销通过 | 无效名称/撤销鉴权通过 / — | `runner.spec.ts`、T30、runner 服务端测试 |
| export `/export` | — | — / — | 浏览器管理下载 | 发起提示/ZIP 下载哈希通过 | 鉴权/不导出认证与令牌通过 / — | `export.spec.ts`、T30、export 服务端测试 |
| not-found `**` | — | — / — | — | 未知页/返回入口通过 | 无当前导航通过 / — | `app.spec.ts`、T25、发布脚本 |
| desktop Electron toolbar | 真实加载/地址通过 | 空页提示通过 / — | 长错误/Sign in 恢复通过 | 忙碌禁重复/显式保存通过 | 无隐式读取、隔离会话通过 / — | desktop 25 项测试、Electron 实窗检查 |

不适用的归类：没有后台读取的静态表单/教程/未知页不虚构 loading；没有筛选器或结果列表的表单不虚构 no-results；历史、版本、批准之外不虚构 outdated；只读页面没有写操作 busy/success；原生 ZIP 下载由浏览器控制，页面只能确认请求发起，不能可靠报告系统已保存或下载最终失败。可选空输入、无数据与无筛选结果在表中分别说明。

## 设备、键盘、辅助功能和打印

| 矩阵项 | 结果与证据 |
| --- | --- |
| 桌面/窄屏亮暗及减少动态效果 | 通过；上述 534 组浏览器检查与发布脚本覆盖，截图目检包括 360px、900×600 Electron、605px pane 和 A4 首尾页。 |
| Electron 360px / 约 605px pane | 通过；实际 Electron 44 窗口测得 840px 测试窗口左 pane 360px、1440px 左 pane 605px。仅测试窗口放宽最小值；产品仍保持 minWidth 900。 |
| Electron 最小 900×600 | 通过；实际左 pane 为 378px，按现有布局公式，不误写成 360px；右工具栏始终 160px。六组尺寸/亮暗检查，app pane 和工具栏 axe 均通过。 |
| 200% 缩放 | 通过；真实 Electron `webContents.setZoomFactor(2)` 下无横向溢出，菜单仍可用。与窄屏 viewport 仿真分别记录。 |
| 键盘/焦点/历史/深链接 | 通过；Enter/Tab/Escape、跳主内容、窄菜单关闭返回 summary、路由聚焦 main、前进/后退和 run 查询保留。全部 18 个受保护路由新增携带 query/fragment 的未登录回归。 |
| 触控目标/触摸 | 原生按钮、输入、summary 及复选框标签维持约 44px 目标；534 组 axe/布局检查无违规。390px 合成触摸的菜单展开、导航、自动收起通过；实体手机为不适用的本机设备范围，见限制。 |
| label/标题/ARIA/错误与状态 | specs 与 axe 检查通过；字段错误 `aria-describedby`、失败 `role=alert`、结果 `role=status` 保留。macOS 真实辅助功能树可读到分区标题、菜单、按钮、上传控件、正文及长状态。没有把 AX 树等同屏幕阅读器的听读验证。 |
| A4 正文与分页 | 通过；真实闭环两种单页 PDF 均被服务端接受；额外四页样本逐页文字/坐标符合 `pdfTextProblems`，未混入 shell、教程或页眉页脚，Poppler 渲染首尾页目检通过。 |
| 系统打印对话框 | 通过打开与设置检查；实际显示 A4 210×297mm、竖向、100%、全部 1 页和“保存为 PDF”。保存位置对话框自动化超时，未得到系统另存文件，随后关闭隔离测试进程；最终保存/重传只在 Chrome 自动打印链路验证。 |

Electron 的 Playwright 上下文必须显式 `emulateMedia` 为亮/暗；否则自动化默认亮色会覆盖原生 `nativeTheme`，形成误标的暗色截图。本次确认轮已按实际媒体偏好重新检查/截图，没有因此修改产品主题实现。

## 安全回归与本次修复

| 规则 | 结果与证据 |
| --- | --- |
| 默认许可、确认与敏感事实 | 通过；facts/rules/form-answers 测试及连贯流程。新版本 proposed、两许可关闭，敏感正文即使勾选也禁止外发。 |
| 冻结版本与 PDF 哈希 | 通过；schema/applications/interviews 测试、49 表恢复对比及实际申请文件下载；后续事实/草稿变动不重写投递历史。 |
| 单份会话批准/失效/一次提交 | 通过；runner API/submit 规则与浏览器测试覆盖快照/文件/答案/页面变化、Origin 与令牌隔离；连贯流程批准前 0 次、批准后 1 次假提交。 |
| 未知结果不重试 | 通过；runner 浏览器与服务端测试覆盖超时、窗口关闭、断连、撤销令牌；`to_verify` 保留，界面无再次批准/自动投递。 |
| 预算与零默认值 | 通过；runs/rules 测试检查并发扣减、未知预留不退、停止/恢复不清数、默认关闭模型/草稿/投递/定时、24 小时 5 份上限。 |
| 浏览器密钥与导出边界 | 通过；产物扫描、认证/Origin 测试和 ZIP 清单哈希检查；导出不含认证表或 runner 明文令牌。 |

发布前发现并修复三项用户可见问题：

1. 登录暂时失败被放入 Signal Form 的根校验错误，导致原样再次提交不发请求；改用独立错误 signal，保留字段校验与 busy 防重复。
2. Facts 在加载失败时读取 `resource.value()` 导致运行异常；先检查 `hasValue()`，并补充原页 Try again。
3. 新增事实的服务端失败同样阻止原样提交；独立显示错误并保留输入。若列表原先加载失败，新增成功后重新读取，避免事实已存但页面不显示。

以上均有失败复现及修复后回归，没有新增业务 API、数据库迁移或运行时依赖。现有权限、证据校验、预算、提交和冻结规则未修改。

## 已知限制

- 未用 VoiceOver/NVDA 完整听读；本次证明的是真实 macOS AX 树、ARIA/焦点/键盘和自动检查，不能证明每款屏幕阅读器的播报时序。实体 iPhone/Android、Safari/Firefox 与实体纸张输出未测；手机使用 Chrome viewport 和合成触摸。
- 系统打印只完成对话框与设置检查，另存对话框超时未完成最终保存；Chrome 自动打印、PDF 内容/分页/上传闭环已通过。没有发出实体打印任务。
- 模拟模型/假表单验证产品与安全流程，不证明真实模型回答质量、招聘网站当前兼容性或第三方验证码可用性。真实外发和真实申请仍需逐次授权。
- 本次不在生产账户写测试资料或做完整真实申请；合并 main 后沿用既有 Wait for CI 自动发布，云资源整理另属 T32。原始检查产物保存在 git 忽略目录，不作为新的用户数据或云存储功能。
