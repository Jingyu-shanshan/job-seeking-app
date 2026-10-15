# T24 完整设计交付

初稿：2026-10-14；复核：2026-10-15。状态：**稿件与实施规格待审定，T24 未完成；没有改动运行中的应用。**

[打开离线审阅页](designs/t24/index.html)；在顶部选择页面、页面状态、关键动作、动作状态、主题与宽度。可复制含 fragment 的地址定位同一稿件。界面继续使用英文，审阅说明使用中文；全部账户、公司、文本、文件、时间、计数和预算都是编造示例。稿件不读数据库，不连 API，不调用模型，不保存个人信息。

本次补稿沿用 [2026-10-13 概念稿](UIUX_DESIGN.md) 的视觉方向。旧 Figma 20 个画板作为概念参考；**本文件和离线审阅页是 T24 的完整路由、状态与实施补充**，旧图与本规格有冲突时以本规格为准。尚未批准的规范不能当作已上线行为。T22/T23 的业务行为已在开发分支实现，统一视觉、教程及其他页面的改造由 T25–T30 完成。

## 设计方向与范围

面向一个在 Helsinki 求职的人，主要任务是阅读原文、核对证据、审查材料和逐份批准。采用安静工作台：系统字体、浅灰绿背景、白色正文表面、森林绿主动作；深色保持相同层级。读回表单、事实正文和引用证据比图标、装饰或统计更醒目。

主入口是 Overview / Jobs / Runs / Applications / Facts；Your setup 分组含 Your details、Form answers、Criteria、Sources、Runner、Export。Quick guide 与账户操作始终可达。保留全部现有路由，按正在执行的工作高亮父入口；详情页提供真实返回链接。登录页和登录过期状态不显示业务导航。

不增加翻译系统、虚构匹配分数、图表统计、聊天、通知、自动填表、自动批准、新提交方式、OCR、文件云备份或新的 UI 依赖。来源条款、用途许可、预算及外发说明不能因视觉简化而省略。

## 可实施的视觉规则

颜色名是实施建议，精确值以本表和 [review.css](designs/t24/review.css) 为准。T25 将其应用到现有全局样式，复用业务组件；无需创建令牌服务或新增样式库。

| 语义 / 建议 CSS 名 | 浅色 | 深色 | 使用位置 |
| --- | --- | --- | --- |
| `--bg` | `#f6f7f5` | `#17231c` | 页面背景 |
| `--surface` | `#ffffff` | `#202d25` | 导航、编辑区域、事实表面 |
| `--layer` | `#edf1ed` | `#29372d` | 中性标记、原文背景、加载占位 |
| `--text` | `#1d2924` | `#eff5ef` | 正文、标题 |
| `--muted` | `#53635a` | `#b4c3b6` | 来源、时间、解释；保持可读对比度 |
| `--line` | `#d9dfd9` | `#3b4c41` | 装饰分隔线，不单独标识输入边界 |
| `--control` | `#829488` | `#7e9986` | 输入、普通按钮边框 |
| `--action` | `#225d49` | `#a9d8b8` | 主按钮、链接、当前导航、checkbox |
| `--action-hover` | `#194a39` | `#c4e8ce` | 主按钮 hover |
| `--on-action` | `#ffffff` | `#17231c` | 主按钮文字 |
| `--info-bg` / `--info-text` | `#e7f0e9` / `#225d49` | `#2b4032` / `#b7dfc2` | 已确认、一般反馈、成功 |
| `--warn-bg` / `--warn-text` | `#f7eedf` / `#77501e` | `#3e3526` / `#f0cd8a` | 待确认、过期、需处理、结果未知 |
| `--error-bg` / `--error-text` | `#fbe9e7` / `#932c2c` | `#472c2c` / `#ffb8b0` | 明确失败、字段错误、破坏性动作文字 |
| `--disabled-bg` / `--disabled-text` | `#e5e9e5` / `#53635a` | `#314237` / `#b4c3b6` | 禁用；不靠降低整体透明度 |
| `--focus` | `#225d49` | `#a9d8b8` | 3px 可见 outline，向外 3px |

正文、提示、placeholder 至少 4.5:1；大字至少 3:1；输入边界、checkbox 和焦点指示相对相邻背景至少 3:1。细分隔线是装饰线；错误还要文字说明，状态还要英文标签。用系统 `light dark` 主题跟随设备，不增加产品主题设置入口；审阅页的主题选择器仅用于审定。

| 层级 | 字号 / 行高 / 字重 | 规则 |
| --- | --- | --- |
| 页面标题 | 32 / 40px / 650；≤600px 为 28 / 35px | 一页一个 h1，长标题自然换行 |
| 区块标题 | 20 / 28px / 650 | 上方32px、下方12px |
| 行标题 | 17 / 25.5px / 650 | 不用新的展示字体 |
| 正文、表单、按钮 | 16 / 24px / 400；按钮600 | 正文连续阅读最大72ch |
| 次信息 | 14 / 21px / 400 | 文件名、来源、时间不省略关键信息 |
| 状态标记 | 13 / 19.5px / 600 | 4px圆角；文字不可只留颜色 |
| hash / 原始文本 | 14 / 22.4px | hash用等宽；长连续字符串可换行 |

间距使用 4 / 8 / 12 / 16 / 20 / 24 / 32 / 44 / 64px。宽屏侧栏224px，内容左右44px、上32px；600–899px 左右24px；≤600px 左右16px。整个工作区最大1440px，连续正文/编辑表单最大72ch；列表和双栏可更宽。面板padding20px，手机16px；圆角12px；按钮/输入圆角6px。列表优先用标题、行与分隔线，不把每个标签都包成卡片。不叠加阴影和边框。

## 组件与交互状态

| 组件 | 正常 | hover / active | focus | disabled / busy | error / success |
| --- | --- | --- | --- | --- | --- |
| 主按钮 | 绿底，对应区块一个主要动作 | 深浅对应的hover色；按下最多位移1px | 3px outline | 实体禁用色；`Saving…` 等短文案，同区防重入 | 就近持久反馈；不只toast |
| 普通按钮 / 链接 | 表面底＋控件边框；链接有下划线 | 中性层底或下划线强调 | 同一outline | 有原因文字和可达恢复入口 | 失败仍保留原对象或输入 |
| 表单字段 | 可见label，提示在字段下；最小44px高 | 原生控件行为 | 同一outline | 保存期间锁当前编辑组，导航仍可用 | 错误文字＋`aria-invalid`＋`aria-describedby` |
| checkbox / radio / select | 原生，选择框20px；label点击区≥44px | 原生选中；绿accent | 可见outline | 必须显示禁用原因，尤其敏感模型许可 | 立即保存的checkbox失败回滚到服务器状态 |
| details | summary≥44px，可见展开指示 | 原生展开，不做手工文字伪按钮 | summary outline | 内容加载中保留summary | 原文/历史/撤回可键盘展开 |
| 状态标记 | `To confirm` / `Confirmed` / `Withdrawn` 等 | 没有点击行为时不用按钮样式 | 仅交互标记可聚焦 | 不用完成色表达等待 | 所有状态同时有文字含义 |
| 加载 | 标题、返回入口保留，静态行占位＋加载文字 | 无shimmer | 不抢焦点 | `aria-busy` 限定数据区域 | 失败原位替换为原因和Try again |
| 整页反馈 | 页面加载失败放标题下 | 不自动消失 | 用户主动重试后可聚焦反馈 | 401回登录且保留next；403解释可信地址 | 不暴露内部堆栈、密钥或个人原文 |

不做页入场动画。必要颜色反馈可在150ms内过渡；`prefers-reduced-motion` 下取消动画和位移。文本选择、caret、checkbox、焦点沿用主题色；滚动条保留平台行为。

字段错误在提交或字段已触达时出现，顶部错误摘要仅在多个字段错误时使用，每项链接到字段。用户输入保留在当前组件内；本任务不增加含个人资料的草稿缓存。当前登录过期会重新登录，尚未持久化的编辑可能丢失；不声称恢复能力已经存在。

## 布局、焦点与响应式

以 **app pane 的可用宽度** 判断布局。Web 1440/1024px保留侧栏，768/390/360px收为Menu；Electron app pane 605/360px都采用Menu和单列，不能用整个窗口宽度决定它。设计稿的宽度是内容画板宽度，外侧审阅工具条不属于产品。

导航为原生可收起Menu，展开后占据正常文档流，关闭后焦点回summary；当前页面、Quick guide、账户及Sign out可见。没有额外浮层库。宽屏双栏按“主要文本→对应证据/操作”排列，窄屏按同一语义顺序。审核证据紧随它对应的陈述，不放到手机最末而失去上下文。不使用固定底栏遮挡编辑区或长错误。200%缩放按缩放后的可用宽度进入单列；列表不能产生全页横向滚动。

跳到主内容链接是进入应用后的首个可聚焦入口；路由切换更新页面title并聚焦h1或main。操作失败保留当前输入/卡片并聚焦就近错误；普通checkbox保存保持当前控件焦点。撤回导致卡片移动时，成功反馈获得焦点；查看重复事实时清理活跃过滤、展开Withdrawn并定位该事实。恢复先读保留许可；编辑成功聚焦待确认新版本反馈。读取导入后聚焦“预览已就绪”状态，保持下一步可达；不靠自动滚动替代聚焦。

批准区必须位于 **实际字段读回、附件、截图入口及冻结JD说明之后**。无横向常驻批准按钮，手机必须能先读完整内容。字段/附件/原文变化、名额不足、必填题未知或Runner状态不合适时，批准按钮不可操作且解释原因。`to_verify` 仅显示用户核实，不提供重试提交；验证码/CAPTCHA在本地可见Chrome由用户处理。

Electron右侧工具栏单独采用多行控件，左右返回/前进/刷新＋地址、保存动作与状态文字均完整。目标高度160px；T25同时修改 `main.ts` 的 `toolbarHeight` 与 `toolbar.css`，检查最小右pane约479px，禁止96px固定高度配换行而截断。应用主题不强制覆盖第三方页面。

打印只输出 `DocumentSheet`。A4 210×297mm，上下16mm、左右18mm，白纸黑字。新应用壳、Menu、教程、反馈、文件选择和按钮都不打印；改变header/main结构时重查打印选择器。打印对话框是浏览器能力；发起Print不等于PDF已保存。保留原有“打印保存→选择文件→文字核对→保留PDF”，不新增生成器。

## 业务语义与关键分支

**Facts**：current.status决定分区；待确认优先，已确认其次；正常区按已有类别、createdAt和ID稳定排序。Withdrawn位于最后且默认折叠，独立数量，不被活跃筛选隐藏；历史版本状态不改变当前分区。许可是独立资格，不是已经外发/使用的记录。proposed未确认时两种资格均不生效；新版本两个许可off。敏感内容永不外发，模型checkbox禁用有原因；材料资格仍独立。撤回不是删除；Confirm again保留旧许可且操作前展示；不自动重新导入或恢复同文。

**导入**：PDF/Markdown先提取成候选，预览不写库、不外发。PDF最多2MiB/20页，文本20万字符/200候选，选中正文最多5000字符。扫描件、加密、损坏、超限分别给恢复方式。候选保留原文、类别、选中状态、来源，PDF有逐页文字和页码；Markdown无页码。可编辑/拆分/合并/取消，拆分两边非空、合并保留页码；多栏/表格按行读取须校对。服务器按当前正文与本批选中候选再次去重，全部取消合法。保存原子成功后报added/skipped/cancelled；失败保留审阅修改。当前/撤回同文/本批重复分别说明；查看不恢复。source文件名/摘要/页码/校对标记不进入模型。

**Jobs与模型**：Eligible / To confirm / Ruled out来自真实硬条件；原文不说不能算通过。缺JD、来源失效、模型失败和stale分别表达。Summary只发JD；Match发JD＋确认且模型许可的事实；Draft发JD＋确认且模型及材料许可的事实。每个动作明确DeepSeek、请求次数、离开EU及真实已记录用量/估算费用，不虚构预报价或匹配分数。模型失败重试可能继续消耗预算，失败不清零。修改要求使用现有RequirementForm；查看引文必须定位对应原文。

**草稿与文档**：Included / Left out与事实Confirmed不同；确定性校验通过不是语义正确。用户逐句读取，改写/移出/放回/恢复模型正文沿用检查和历史。没有证据的陈述不能因绿色视觉自动通过。原文/事实变化显示过期而不删除历史。成稿、PDF当前性、缺姓名/陈述、文字不符各给明确入口；主题不改PDF文字与样式。

**表单、批准与申请**：表单问题不猜，匹配答案遵守wordings/选项/地点，敏感可选题需此职位选择。start fill仅填写且停在Submit前；审批只授权这一份，绑定实际读回、JD、答案和附件哈希。请求被接受后显示Approved；只在确认页回执或用户核实后显示Applied。批准请求超时必须先刷新当前状态，不能提供盲目再次批准/提交。unused approval可撤回；submitting不能关窗。unknown仍占名额，只给Yes/No核实。申请详情展示冻结正文、历史事实、发送PDF/哈希、当时表单与回执；manual分支没有伪造Runner回执。外部记录需JD和非未来发送时间，保持当前文件选择规则。

**面试**：只对Applied开放，来源是冻结JD和实际投出PDF。应用内陈述遵守历史及当前模型许可，省略不许可或敏感内容；不改取当前草稿。外部PDF只发送连续摘录，用户核对私密信息并单独勾选允许外发；空白表示排除。尚未生成显示来源/生成，已生成显示四类练习、STAR待确认和私人笔记，不再重复生成。练习/笔记不成为事实或投递材料；笔记不外发。

**Runs与设置**：预设保存和启动分开；后台只发现/读JD/总结/匹配/草稿。新预设草稿/投递/成本/定时默认0，requests20/time600/discovery20沿用代码；不是所有请求预算默认0。执行期间用捕获的source/criteria/config，失败/停止/恢复不重置计数、预算或未知预留；停止撤回unused approvals；同一活动运行互斥。定时0off或1–168h、漏跑不补、每轮新预算，stopped/failed暂停相应计划。资料不外发，答案只用户写，条件逐项有强度与未知处理，来源保留access/terms/rate/status。Runner令牌只显示一次且可撤销，不等于批准。Export是直接下载私有ZIP，排除认证和令牌；不伪造下载完成或新增备份/恢复。

## 路由、画板与实现对应

| 画板 | 现有路由 / 场景 | 主要实现文件 / 复用组件 | 后续任务 |
| --- | --- | --- | --- |
| [login](designs/t24/index.html#login) · Sign in | `/login` | [login/login.ts](../apps/web/src/app/login/login.ts) | T25–T26 |
| [overview](designs/t24/index.html#overview) · Your next step | `/` | [home/home.ts](../apps/web/src/app/home/home.ts) | T26 |
| [guide](designs/t24/index.html#guide) · A short guide to your workbench | `/` | [home/home.ts](../apps/web/src/app/home/home.ts) | T26 |
| [facts](designs/t24/index.html#facts) · Facts about you | `/facts` | [facts/facts.ts](../apps/web/src/app/facts/facts.ts) | T22 / T25 |
| [fact-edit](designs/t24/index.html#fact-edit) · Add or edit a fact | `/facts` | [facts/fact-card.ts](../apps/web/src/app/facts/fact-card.ts) | T22 / T25 |
| [import](designs/t24/index.html#import) · Import your experience | `/facts` | [facts/fact-import.ts](../apps/web/src/app/facts/fact-import.ts) | T23 / T25 |
| [candidates](designs/t24/index.html#candidates) · Review candidates | `/facts` | [facts/fact-import.ts](../apps/web/src/app/facts/fact-import.ts) | T23 / T25 |
| [jobs](designs/t24/index.html#jobs) · Jobs | `/jobs` | [jobs/jobs.ts](../apps/web/src/app/jobs/jobs.ts) | T27 |
| [paste](designs/t24/index.html#paste) · Paste a job | `/jobs/paste` | [jobs/paste-job.ts](../apps/web/src/app/jobs/paste-job.ts) | T27 |
| [alerts](designs/t24/index.html#alerts) · Import job-alert emails | `/jobs/alerts` | [jobs/import-alerts.ts](../apps/web/src/app/jobs/import-alerts.ts) | T27 |
| [job](designs/t24/index.html#job) · Backend Engineer | `/jobs/:id` | [jobs/job-detail.ts](../apps/web/src/app/jobs/job-detail.ts) | T27 |
| [form](designs/t24/index.html#form) · Application form | `/jobs/:id` | [answers/job-form.ts](../apps/web/src/app/answers/job-form.ts) | T28 |
| [approval](designs/t24/index.html#approval) · Review this application | `/jobs/:id` | [runner/job-fill.ts](../apps/web/src/app/runner/job-fill.ts) | T28 |
| [manual](designs/t24/index.html#manual) · Record an application you sent yourself | `/jobs/:id` | [applications/job-applications.ts](../apps/web/src/app/applications/job-applications.ts) | T29 |
| [runs](designs/t24/index.html#runs) · Runs | `/runs` | [runs/runs.ts](../apps/web/src/app/runs/runs.ts) | T30 |
| [draft](designs/t24/index.html#draft) · Resume draft | `/drafts/:id` | [drafts/draft-page.ts](../apps/web/src/app/drafts/draft-page.ts) | T28 |
| [document](designs/t24/index.html#document) · Resume for Backend Engineer | `/drafts/:id/document` | [drafts/document-page.ts](../apps/web/src/app/drafts/document-page.ts) | T28 |
| [applications](designs/t24/index.html#applications) · Applications | `/applications` | [applications/applications.ts](../apps/web/src/app/applications/applications.ts) | T29 |
| [application](designs/t24/index.html#application) · Backend Engineer · Application | `/applications/:id` | [applications/application-page.ts](../apps/web/src/app/applications/application-page.ts) | T29 |
| [interview](designs/t24/index.html#interview) · Interview preparation | `/applications/:id/interview` | [interviews/interview-page.ts](../apps/web/src/app/interviews/interview-page.ts) | T29 |
| [profile](designs/t24/index.html#profile) · Your details | `/profile` | [profile/profile.ts](../apps/web/src/app/profile/profile.ts) | T30 |
| [answers](designs/t24/index.html#answers) · Form answers | `/answers` | [answers/answers.ts](../apps/web/src/app/answers/answers.ts) | T30 |
| [criteria](designs/t24/index.html#criteria) · Criteria | `/criteria` | [criteria/criteria.ts](../apps/web/src/app/criteria/criteria.ts) | T30 |
| [sources](designs/t24/index.html#sources) · Sources | `/sources` | [sources/sources.ts](../apps/web/src/app/sources/sources.ts) | T30 |
| [runner](designs/t24/index.html#runner) · Runner | `/runner` | [runner/runner.ts](../apps/web/src/app/runner/runner.ts) | T30 |
| [export](designs/t24/index.html#export) · Export your data | `/export` | [export/export.ts](../apps/web/src/app/export/export.ts) | T30 |
| [not-found](designs/t24/index.html#not-found) · Page not found | `**` | [not-found/not-found.ts](../apps/web/src/app/not-found/not-found.ts) | T25 |
| [desktop](designs/t24/index.html#desktop) · Built-in browser | `Electron toolbar` | [toolbar/toolbar.css](../apps/desktop/src/toolbar/toolbar.css) | T25 |

## 关键操作状态对应

每个下列动作在审阅页均有正常、进行中、失败、不可操作及完成反馈五种视图。进入链接后用“动作状态”切换。破坏性动作复用现有语义：事实Withdraw、答案Delete、来源Remove、unused approval Withdraw、草稿Leave out分别表达，不新增同名混合动作。

| 画板 / 动作 | 正常 / 五态入口 | 进行中 | 失败恢复与不可操作原因 |
| --- | --- | --- | --- |
| login · Sign in | [login](designs/t24/index.html#login?action=sign-in&state=ready) | Signing in… | The email address or password is wrong. Check them and try again. / Enter a valid email address and your password. |
| guide · Previous | [guide](designs/t24/index.html#guide?action=guide-back&state=ready) | Returning to the previous step… | Could not remember the guide position. You can still use the app. / This is the first step. |
| guide · Continue | [guide](designs/t24/index.html#guide?action=guide-next&state=ready) | Opening the next step… | Could not remember your progress. You can still continue. / The guide is already finished. Open Quick guide to read it again. |
| guide · Skip guide | [guide](designs/t24/index.html#guide?action=guide-skip&state=ready) | Closing the guide… | Could not remember that you skipped it. The guide may appear again. / The guide is already closed. |
| facts · Confirm | [facts](designs/t24/index.html#facts?action=confirm&state=ready) | Confirming fact… | Could not confirm this fact. It is still To confirm. Try again. / A fact change is already being saved. Wait for it to finish. |
| facts · Model permission | [facts](designs/t24/index.html#facts?action=permissions&state=ready) | Saving permission choices… | Could not save permission choices. Your changes are still here. Try again. / This fact contains sensitive information, so model permission cannot be enabled. |
| facts · Material permission | [facts](designs/t24/index.html#facts?action=material-permission&state=ready) | Saving material permission… | Could not save material permission. Your changes are still here. Try again. / A fact change is already being saved. |
| facts · Withdraw | [facts](designs/t24/index.html#facts?action=withdraw&state=ready) | Withdrawing fact… | Could not withdraw the fact. It remains in its current section. Try again. / This fact has already been withdrawn. |
| facts · Confirm again | [facts](designs/t24/index.html#facts?action=restore&state=ready) | Confirming again… | Could not confirm again. The fact is still withdrawn. Try again. / Another change is being saved. Retained permissions are shown above. |
| fact-edit · Save fact | [fact-edit](designs/t24/index.html#fact-edit?action=save-fact&state=ready) | Saving fact… | Could not save fact. Your changes are still here. Try again. / Enter non-empty text of at most 5,000 characters. |
| import · Read PDF | [import](designs/t24/index.html#import?action=read-pdf&state=ready) | Reading the PDF… | Could not read the PDF. Choose another file or paste its text. / Choose a non-empty PDF within 2 MiB and 20 pages. |
| import · Read Markdown | [import](designs/t24/index.html#import?action=read-markdown&state=ready) | Reading Markdown… | Could not read the text file. Your pasted text is still here. Try another file. / Choose a non-empty text file within the text limit. |
| import · Preview text | [import](designs/t24/index.html#import?action=preview-paste&state=ready) | Preparing candidates… | Could not prepare candidates. Your text is still here. Try again. / Paste non-empty text of at most 200,000 characters. |
| candidates · Split at cursor | [candidates](designs/t24/index.html#candidates?action=split&state=ready) | Splitting candidate… | Place the cursor between two non-empty parts. / Select a cursor position that leaves text on both sides; no more than 200 candidates. |
| candidates · Merge with next | [candidates](designs/t24/index.html#candidates?action=merge&state=ready) | Merging candidates… | These candidates could not be merged. Their text is still here. / There is no next candidate to merge. |
| candidates · Save selected candidates | [candidates](designs/t24/index.html#candidates?action=save-candidates&state=ready) | Saving reviewed candidates… | No facts were saved. Your corrections and selections are still here. Try saving again. / Correct or uncheck selected blank or oversized candidates. |
| candidates · Discard preview | [candidates](designs/t24/index.html#candidates?action=discard&state=ready) | Closing preview… | Could not close this preview. Your review is still here. / A save is in progress. Wait for its result. |
| jobs · Find jobs | [jobs](designs/t24/index.html#jobs?action=discover&state=ready) | Reading your enabled boards. This can take a minute. | Could not finish reading the boards. Previously saved jobs remain; review any partial results before trying again. / Enable a supported board on Sources, or paste a job instead. |
| paste · Save the job | [paste](designs/t24/index.html#paste?action=save-job&state=ready) | Saving job… | Could not save job. Your changes are still here. Try again. / Enter the required title, HTTPS job URL and original text within the supported limits. |
| alerts · Import emails | [alerts](designs/t24/index.html#alerts?action=import-emails&state=ready) | Reading the selected emails… | This message could not be imported. The email text is still here. Results show any other messages already imported. / Paste original email source or select non-empty .eml files within the existing limits. |
| job · Read job text | [job](designs/t24/index.html#job?action=read-job&state=ready) | Reading the original job description… | The source could not be read. Existing text is kept; paste the description or use the desktop app. / None of the enabled supported sources lists this job. Paste its original text. |
| job · Summarise | [job](designs/t24/index.html#job?action=summary&state=ready) | DeepSeek is preparing the summary. This can take two minutes. | DeepSeek could not prepare the summary. Check the recorded usage before trying again; the request may have used the budget. / Save the original job text before summarising. |
| job · Match requirements with facts | [job](designs/t24/index.html#job?action=match&state=ready) | DeepSeek is preparing the match. This can take two minutes. | DeepSeek could not prepare the match. Check the recorded usage before trying again; the request may have used the budget. / Confirm a fact and allow it to go to DeepSeek before matching. |
| job · Write resume | [job](designs/t24/index.html#job?action=resume&state=ready) | DeepSeek is preparing a resume draft. This can take two minutes. | DeepSeek could not prepare a resume draft. Check the recorded usage before trying again; the request may have used the budget. / No confirmed fact is permitted for both model and material use. |
| job · Write cover letter | [job](designs/t24/index.html#job?action=cover-letter&state=ready) | DeepSeek is preparing a cover letter draft. This can take two minutes. | DeepSeek could not prepare a cover letter draft. Check the recorded usage before trying again; the request may have used the budget. / No confirmed fact is permitted for both model and material use. |
| job · Save requirement | [job](designs/t24/index.html#job?action=save-requirement&state=ready) | Saving requirement… | Could not save requirement. Your changes are still here. Try again. / Enter requirement text and keep it and the quote within 1,000 characters. A quote absent from the original stays To confirm. |
| job · Remove requirement | [job](designs/t24/index.html#job?action=remove-requirement&state=ready) | Removing requirement… | Could not remove the requirement. It remains available. Try again. / Another job change is being saved. |
| job · Read application form | [job](designs/t24/index.html#job?action=read-form&state=ready) | Reading the Greenhouse application form… | Could not read the form. Try again or open the source page. / Only a supported Greenhouse job can be read. Apply manually for other sources. |
| form · Save answer | [form](designs/t24/index.html#form?action=save-answer&state=ready) | Saving answer… | Could not save answer. Your changes are still here. Try again. / Answer the required question using one of its supported choices. |
| form · Use saved answer | [form](designs/t24/index.html#form?action=choose-answer&state=ready) | Applying the selected answer… | Could not use this answer. The previous choice is kept. Try again. / This answer does not fit the question’s choices or location scope. |
| form · Fill in the form with the runner | [form](designs/t24/index.html#form?action=start-fill&state=ready) | Waiting for the local runner… | Could not start this fill. Your answers and kept PDFs remain available. / Answer required questions and choose current kept PDFs before filling. |
| approval · Look at the form again | [approval](designs/t24/index.html#approval?action=look-again&state=ready) | Asking the runner to read the form again… | Could not request another readback. Existing readback stays visible but is not a new approval. / Wait until the current fill is paused or filled; the runner must be available. |
| approval · Approve and submit | [approval](designs/t24/index.html#approval?action=approve&state=ready) | Approval sent. The runner rechecks the form before pressing Submit once. | Could not confirm approval. Refresh the fill state before doing anything else; do not start another submission. / The readback is outdated, a required field is unresolved, or the submission limit is exhausted. |
| approval · Withdraw your approval | [approval](designs/t24/index.html#approval?action=withdraw-approval&state=ready) | Withdrawing unused approval… | Could not withdraw approval. Refresh the fill state to check whether it was already used. / There is no unused approval; submission has started or finished. |
| approval · Close the window | [approval](designs/t24/index.html#approval?action=close-fill&state=ready) | Closing this fill… | Could not close the fill. Check the live runner and refresh its state. / Submit is in progress. Wait for its result. |
| approval · Continue | [approval](designs/t24/index.html#approval?action=continue-fill&state=ready) | Resuming the paused fill… | Could not continue this fill. Check the visible window and try again. / This fill is not paused, or the runner is unavailable. |
| approval · Yes, it went through | [approval](designs/t24/index.html#approval?action=settle-yes&state=ready) | Recording your verification… | Could not save your verification. The result remains unknown. Try again. / Verification is available only when the result is unknown. |
| approval · No, it did not go through | [approval](designs/t24/index.html#approval?action=settle-no&state=ready) | Recording your verification… | Could not save your verification. The result remains unknown. Try again. / Verification is available only when the result is unknown. |
| manual · Record application | [manual](designs/t24/index.html#manual?action=record-manual&state=ready) | Saving application record… | Could not save application record. Your changes are still here. Try again. / Provide a valid sent time and the job text; check the PDF file limits. |
| runs · Save preset | [runs](designs/t24/index.html#runs?action=save-preset&state=ready) | Saving preset… | Could not save preset. Your changes are still here. Try again. / Correct any invalid limit. Repeat is 0 or 1–168 hours. |
| runs · Start run | [runs](designs/t24/index.html#runs?action=start-run&state=ready) | Starting run… | Could not start the run. Check recent runs before retrying to avoid an unintended second run. / Another run is active, or the selected preset is invalid. |
| runs · Stop | [runs](designs/t24/index.html#runs?action=stop-run&state=ready) | Stopping after the current step… | Could not stop the run. Refresh its status before trying again. / This run is already stopped or finished. |
| runs · Resume | [runs](designs/t24/index.html#runs?action=resume-run&state=ready) | Resuming run… | Could not resume the run. Refresh its status before retrying. / Another run is active, the run cannot be resumed, or its budget is exhausted. |
| draft · Save wording | [draft](designs/t24/index.html#draft?action=edit-statement&state=ready) | Saving statement wording… | Could not save statement wording. Your changes are still here. Try again. / Correct the wording and keep it within the existing statement limit. |
| draft · Leave out | [draft](designs/t24/index.html#draft?action=leave-out&state=ready) | Leaving statement out… | Could not leave this statement out. Its current inclusion is unchanged. / Another statement change is being saved. |
| draft · Put back | [draft](designs/t24/index.html#draft?action=put-back&state=ready) | Checking and including statement… | Could not put this statement back. It remains left out. / This statement does not pass the deterministic checks. |
| draft · Use model wording | [draft](designs/t24/index.html#draft?action=reset-wording&state=ready) | Restoring model wording… | Could not restore the model wording. Your current wording remains. / This statement already uses the model wording. |
| document · Print | [document](designs/t24/index.html#document?action=print&state=ready) | The browser print dialog is open. Choose Save as PDF. | If the print dialog did not open, use the browser’s Print command. The app cannot read whether you saved a file. / Read and correct the missing document details before making an application PDF. |
| document · Verify uploaded PDF | [document](designs/t24/index.html#document?action=verify-pdf&state=ready) | Reading and comparing the PDF text… | The PDF was not kept. Read the mismatch details and print the current document again. / Add your name and valid included statements, then select a non-empty PDF within the existing limits. |
| application · Download PDF as sent | [application](designs/t24/index.html#application?action=download-sent&state=ready) | Requesting the frozen PDF… | Could not read this file. Retry the download; the application record is unchanged. / No file was recorded with this application. |
| interview · Generate interview practice | [interview](designs/t24/index.html#interview?action=generate-practice&state=ready) | DeepSeek is preparing interview practice. This can take two minutes. | DeepSeek could not prepare interview practice. Check the recorded usage before trying again; the request may have used the budget. / The application must be Applied. Read valid frozen sources and explicitly allow any external PDF excerpts. |
| interview · Save notes | [interview](designs/t24/index.html#interview?action=save-notes&state=ready) | Saving practice notes… | Could not save practice notes. Your changes are still here. Try again. / Generate practice first, then make a note change within the existing text limit. |
| profile · Save | [profile](designs/t24/index.html#profile?action=save-profile&state=ready) | Saving details… | Could not save details. Your changes are still here. Try again. / Make a change before saving. |
| answers · Save answer | [answers](designs/t24/index.html#answers?action=save-answer-record&state=ready) | Saving answer… | Could not save answer. Your changes are still here. Try again. / Provide at least one wording and an answer that fits its supported format. |
| answers · Delete answer | [answers](designs/t24/index.html#answers?action=delete-answer&state=ready) | Deleting saved answer… | Could not delete this answer. It remains available. / Another answer change is being saved. |
| criteria · Save criteria | [criteria](designs/t24/index.html#criteria?action=save-criteria&state=ready) | Saving criteria… | Could not save criteria. Your changes are still here. Try again. / Make a change before saving. |
| sources · Add Ashby board | [sources](designs/t24/index.html#sources?action=add-ashby&state=ready) | Saving Ashby source… | Could not save Ashby source. Your changes are still here. Try again. / Enter a supported board name, rather than a URL. |
| sources · Use LinkedIn job alerts | [sources](designs/t24/index.html#sources?action=toggle-alert&state=ready) | Saving alert source selection… | Could not save alert source selection. Your changes are still here. Try again. / A source change is already being saved. |
| sources · Add board | [sources](designs/t24/index.html#sources?action=add-source&state=ready) | Saving source… | Could not save source. Your changes are still here. Try again. / Enter the supported board identifier in the format shown by this source. |
| sources · Source enabled choice | [sources](designs/t24/index.html#sources?action=toggle-source&state=ready) | Saving source selection… | Could not save source selection. Your changes are still here. Try again. / A source change is already being saved. |
| sources · Remove board | [sources](designs/t24/index.html#sources?action=remove-source&state=ready) | Removing source… | Could not remove the board. It remains configured. / A source change is already being saved. |
| runner · Create token | [runner](designs/t24/index.html#runner?action=issue-token&state=ready) | Creating token… | Could not create the token. Retry only after checking whether a token was issued. / Enter a computer name within the existing limit. |
| runner · Revoke | [runner](designs/t24/index.html#runner?action=revoke-token&state=ready) | Revoking token… | Could not revoke this token. Refresh its status before trying again. / This token is already revoked. |
| export · Download the export | [export](designs/t24/index.html#export?action=download-export&state=ready) | Download requested. Your browser handles the file transfer. | If no ZIP was downloaded, sign in and try the download again. Keep any partial file separate. / Sign in before downloading your private data. |
| desktop · Save this job | [desktop](designs/t24/index.html#desktop?action=save-visible-job&state=ready) | Reading and saving the visible job… | Could not save this page. Keep the page open and try again, or paste its job text. / Open a supported job page and sign in to the app pane first. |
| desktop · Save jobs on this page | [desktop](designs/t24/index.html#desktop?action=save-visible-results&state=ready) | Reading and saving visible job entries… | Could not save these entries. Previously saved jobs remain; try again on this visible page. / This is not a supported LinkedIn results page with visible job entries. |

## 补稿状态定位

页面状态通过明确fragment定位，不依赖截图命名。不是每个页面都能首次为空或stale：列表空态给下一步；表单首次空白仍可编辑；不存在的详情给返回入口；纯静态Export和404不虚构加载接口。基础401/403处理继承应用壳，编辑/导入页的保存401/403使用对应动作错误＋登录/可信地址说明，不把已有未保存输入说成服务器保存成功。

| 画板 | 可定位的页面状态 |
| --- | --- |
| [login](designs/t24/index.html#login) | [正常](designs/t24/index.html#login?view=normal) · [登录过期](designs/t24/index.html#login?view=expired) |
| [overview](designs/t24/index.html#overview) | [正常](designs/t24/index.html#overview?view=normal) · [加载](designs/t24/index.html#overview?view=loading) · [加载失败 / 重试](designs/t24/index.html#overview?view=load-error) · [权限不足](designs/t24/index.html#overview?view=forbidden) · [登录过期](designs/t24/index.html#overview?view=session-expired) · [首次为空](designs/t24/index.html#overview?view=empty) · [清单已完成](designs/t24/index.html#overview?view=complete) |
| [guide](designs/t24/index.html#guide) | [第一步](designs/t24/index.html#guide?view=normal) · [第二步](designs/t24/index.html#guide?view=step2) · [第三步 / 完成](designs/t24/index.html#guide?view=step3) · [本地存储不可用](designs/t24/index.html#guide?view=storage-unavailable) |
| [facts](designs/t24/index.html#facts) | [正常](designs/t24/index.html#facts?view=normal) · [加载](designs/t24/index.html#facts?view=loading) · [加载失败 / 重试](designs/t24/index.html#facts?view=load-error) · [权限不足](designs/t24/index.html#facts?view=forbidden) · [登录过期](designs/t24/index.html#facts?view=session-expired) · [首次为空](designs/t24/index.html#facts?view=empty) · [筛选为空](designs/t24/index.html#facts?view=filtered) · [撤回区展开](designs/t24/index.html#facts?view=withdrawn) · [敏感事实](designs/t24/index.html#facts?view=sensitive) |
| [fact-edit](designs/t24/index.html#fact-edit) | [手填](designs/t24/index.html#fact-edit?view=normal) · [编辑现有事实](designs/t24/index.html#fact-edit?view=edit) · [字段错误](designs/t24/index.html#fact-edit?view=invalid) |
| [import](designs/t24/index.html#import) | [选择文件 / 粘贴](designs/t24/index.html#import?view=normal) · [扫描件 / 无文字](designs/t24/index.html#import?view=scanned) · [加密 PDF](designs/t24/index.html#import?view=password) · [损坏 / 伪装 PDF](designs/t24/index.html#import?view=broken) · [文件 / 页数 / 字数超限](designs/t24/index.html#import?view=limit) · [候选数超限](designs/t24/index.html#import?view=candidates) |
| [candidates](designs/t24/index.html#candidates) | [PDF 候选](designs/t24/index.html#candidates?view=normal) · [Markdown 候选](designs/t24/index.html#candidates?view=markdown) · [当前 / 本批 / 撤回重复](designs/t24/index.html#candidates?view=duplicates) · [全部取消](designs/t24/index.html#candidates?view=cancelled) · [选中空白 / 超长](designs/t24/index.html#candidates?view=invalid) |
| [jobs](designs/t24/index.html#jobs) | [正常](designs/t24/index.html#jobs?view=normal) · [加载](designs/t24/index.html#jobs?view=loading) · [加载失败 / 重试](designs/t24/index.html#jobs?view=load-error) · [权限不足](designs/t24/index.html#jobs?view=forbidden) · [登录过期](designs/t24/index.html#jobs?view=session-expired) · [首次为空](designs/t24/index.html#jobs?view=empty) · [没有合格职位](designs/t24/index.html#jobs?view=no-eligible) · [发现部分失败](designs/t24/index.html#jobs?view=discovery-partial) |
| [paste](designs/t24/index.html#paste) | [正常](designs/t24/index.html#paste?view=normal) · [字段错误](designs/t24/index.html#paste?view=invalid) |
| [alerts](designs/t24/index.html#alerts) | [正常](designs/t24/index.html#alerts?view=normal) · [加载](designs/t24/index.html#alerts?view=loading) · [加载失败 / 重试](designs/t24/index.html#alerts?view=load-error) · [权限不足](designs/t24/index.html#alerts?view=forbidden) · [登录过期](designs/t24/index.html#alerts?view=session-expired) · [首次为空](designs/t24/index.html#alerts?view=empty) · [不支持的提醒](designs/t24/index.html#alerts?view=unsupported) · [部分文件失败](designs/t24/index.html#alerts?view=partial) · [地址未解析](designs/t24/index.html#alerts?view=unresolved) |
| [job](designs/t24/index.html#job) | [正常](designs/t24/index.html#job?view=normal) · [加载](designs/t24/index.html#job?view=loading) · [加载失败 / 重试](designs/t24/index.html#job?view=load-error) · [权限不足](designs/t24/index.html#job?view=forbidden) · [登录过期](designs/t24/index.html#job?view=session-expired) · [缺少 JD 原文](designs/t24/index.html#job?view=no-text) · [原文 / 总结 / 匹配过期](designs/t24/index.html#job?view=stale) · [没有可外发事实](designs/t24/index.html#job?view=no-facts) · [职位不存在](designs/t24/index.html#job?view=not-found) |
| [form](designs/t24/index.html#form) | [正常](designs/t24/index.html#form?view=normal) · [加载](designs/t24/index.html#form?view=loading) · [加载失败 / 重试](designs/t24/index.html#form?view=load-error) · [权限不足](designs/t24/index.html#form?view=forbidden) · [登录过期](designs/t24/index.html#form?view=session-expired) · [不支持的站点](designs/t24/index.html#form?view=unsupported) · [未回答必填题](designs/t24/index.html#form?view=unknown) · [Runner 离线](designs/t24/index.html#form?view=runner-offline) |
| [approval](designs/t24/index.html#approval) | [正常](designs/t24/index.html#approval?view=normal) · [加载](designs/t24/index.html#approval?view=loading) · [加载失败 / 重试](designs/t24/index.html#approval?view=load-error) · [权限不足](designs/t24/index.html#approval?view=forbidden) · [登录过期](designs/t24/index.html#approval?view=session-expired) · [Approved 等待执行](designs/t24/index.html#approval?view=approved) · [提交进行中](designs/t24/index.html#approval?view=submitting) · [确认成功](designs/t24/index.html#approval?view=applied) · [用户核实未成功](designs/t24/index.html#approval?view=not-submitted) · [填写暂停](designs/t24/index.html#approval?view=paused) · [批准失效](designs/t24/index.html#approval?view=expired) · [CAPTCHA / 邮件验证码](designs/t24/index.html#approval?view=needs-action) · [结果未知](designs/t24/index.html#approval?view=to-verify) · [24 小时 / 运行名额用完](designs/t24/index.html#approval?view=cap) |
| [manual](designs/t24/index.html#manual) | [正常](designs/t24/index.html#manual?view=normal) · [缺少原文](designs/t24/index.html#manual?view=no-text) · [时间错误](designs/t24/index.html#manual?view=future-time) |
| [runs](designs/t24/index.html#runs) | [正常](designs/t24/index.html#runs?view=normal) · [加载](designs/t24/index.html#runs?view=loading) · [加载失败 / 重试](designs/t24/index.html#runs?view=load-error) · [权限不足](designs/t24/index.html#runs?view=forbidden) · [登录过期](designs/t24/index.html#runs?view=session-expired) · [首次为空](designs/t24/index.html#runs?view=empty) · [预算用完](designs/t24/index.html#runs?view=budget) · [模型操作互斥](designs/t24/index.html#runs?view=model-busy) · [定时暂停 / 漏跑](designs/t24/index.html#runs?view=schedule) |
| [draft](designs/t24/index.html#draft) | [正常](designs/t24/index.html#draft?view=normal) · [加载](designs/t24/index.html#draft?view=loading) · [加载失败 / 重试](designs/t24/index.html#draft?view=load-error) · [权限不足](designs/t24/index.html#draft?view=forbidden) · [登录过期](designs/t24/index.html#draft?view=session-expired) · [引用事实 / JD 变化](designs/t24/index.html#draft?view=stale) · [改写校验不通过](designs/t24/index.html#draft?view=invalid) · [全部陈述移出](designs/t24/index.html#draft?view=empty) |
| [document](designs/t24/index.html#document) | [正常](designs/t24/index.html#document?view=normal) · [加载](designs/t24/index.html#document?view=loading) · [加载失败 / 重试](designs/t24/index.html#document?view=load-error) · [权限不足](designs/t24/index.html#document?view=forbidden) · [登录过期](designs/t24/index.html#document?view=session-expired) · [缺姓名 / 可用陈述](designs/t24/index.html#document?view=missing) · [文档已变](designs/t24/index.html#document?view=stale) · [上传文字不匹配](designs/t24/index.html#document?view=mismatch) |
| [applications](designs/t24/index.html#applications) | [正常](designs/t24/index.html#applications?view=normal) · [加载](designs/t24/index.html#applications?view=loading) · [加载失败 / 重试](designs/t24/index.html#applications?view=load-error) · [权限不足](designs/t24/index.html#applications?view=forbidden) · [登录过期](designs/t24/index.html#applications?view=session-expired) · [首次为空](designs/t24/index.html#applications?view=empty) |
| [application](designs/t24/index.html#application) | [正常](designs/t24/index.html#application?view=normal) · [加载](designs/t24/index.html#application?view=loading) · [加载失败 / 重试](designs/t24/index.html#application?view=load-error) · [权限不足](designs/t24/index.html#application?view=forbidden) · [登录过期](designs/t24/index.html#application?view=session-expired) · [结果未知](designs/t24/index.html#application?view=to-verify) · [手动记录](designs/t24/index.html#application?view=manual) · [未记录文件](designs/t24/index.html#application?view=no-files) · [记录不存在](designs/t24/index.html#application?view=missing) |
| [interview](designs/t24/index.html#interview) | [正常](designs/t24/index.html#interview?view=normal) · [加载](designs/t24/index.html#interview?view=loading) · [加载失败 / 重试](designs/t24/index.html#interview?view=load-error) · [权限不足](designs/t24/index.html#interview?view=forbidden) · [登录过期](designs/t24/index.html#interview?view=session-expired) · [尚未生成](designs/t24/index.html#interview?view=unprepared) · [应用外 PDF 摘录授权](designs/t24/index.html#interview?view=external) · [历史 / 当前许可不足](designs/t24/index.html#interview?view=omitted) · [申请未确认成功](designs/t24/index.html#interview?view=not-submitted) · [摘录非原文 / 敏感](designs/t24/index.html#interview?view=bad-excerpt) |
| [profile](designs/t24/index.html#profile) | [正常](designs/t24/index.html#profile?view=normal) · [加载](designs/t24/index.html#profile?view=loading) · [加载失败 / 重试](designs/t24/index.html#profile?view=load-error) · [权限不足](designs/t24/index.html#profile?view=forbidden) · [登录过期](designs/t24/index.html#profile?view=session-expired) · [首次空白表单](designs/t24/index.html#profile?view=blank) · [字段错误](designs/t24/index.html#profile?view=invalid) |
| [answers](designs/t24/index.html#answers) | [正常](designs/t24/index.html#answers?view=normal) · [加载](designs/t24/index.html#answers?view=loading) · [加载失败 / 重试](designs/t24/index.html#answers?view=load-error) · [权限不足](designs/t24/index.html#answers?view=forbidden) · [登录过期](designs/t24/index.html#answers?view=session-expired) · [首次为空](designs/t24/index.html#answers?view=empty) |
| [criteria](designs/t24/index.html#criteria) | [正常](designs/t24/index.html#criteria?view=normal) · [加载](designs/t24/index.html#criteria?view=loading) · [加载失败 / 重试](designs/t24/index.html#criteria?view=load-error) · [权限不足](designs/t24/index.html#criteria?view=forbidden) · [登录过期](designs/t24/index.html#criteria?view=session-expired) · [字段错误](designs/t24/index.html#criteria?view=invalid) |
| [sources](designs/t24/index.html#sources) | [正常](designs/t24/index.html#sources?view=normal) · [加载](designs/t24/index.html#sources?view=loading) · [加载失败 / 重试](designs/t24/index.html#sources?view=load-error) · [权限不足](designs/t24/index.html#sources?view=forbidden) · [登录过期](designs/t24/index.html#sources?view=session-expired) · [首次为空](designs/t24/index.html#sources?view=empty) · [来源条款 / 不支持访问](designs/t24/index.html#sources?view=blocked) · [限流 / 无法访问](designs/t24/index.html#sources?view=rate) |
| [runner](designs/t24/index.html#runner) | [正常](designs/t24/index.html#runner?view=normal) · [加载](designs/t24/index.html#runner?view=loading) · [加载失败 / 重试](designs/t24/index.html#runner?view=load-error) · [权限不足](designs/t24/index.html#runner?view=forbidden) · [登录过期](designs/t24/index.html#runner?view=session-expired) · [首次为空](designs/t24/index.html#runner?view=empty) · [一次性显示令牌](designs/t24/index.html#runner?view=issued) · [令牌撤销](designs/t24/index.html#runner?view=revoked) · [本地运行器离线](designs/t24/index.html#runner?view=offline) |
| [export](designs/t24/index.html#export) | [正常](designs/t24/index.html#export?view=normal) · [登录过期](designs/t24/index.html#export?view=session-expired) |
| [not-found](designs/t24/index.html#not-found) | [已登录](designs/t24/index.html#not-found?view=normal) · [未登录](designs/t24/index.html#not-found?view=signedout) |
| [desktop](designs/t24/index.html#desktop) | [正常](designs/t24/index.html#desktop?view=normal) · [应用未登录](designs/t24/index.html#desktop?view=signin) · [不支持的页面](designs/t24/index.html#desktop?view=unsupported) · [页面已导航](designs/t24/index.html#desktop?view=navigated) |

审阅页只模拟设计；字段编辑后切换画板会恢复编造样例，动作点击展示进行中稿，状态选择器选择结果。某些即时动作（文件选择、checkbox、下载链接）用选择器定位状态，不增加产品的第二次确认按钮。预览不实现完整业务状态机；发生后真正的分区、数量、导航和对象变化按以上规范及现有服务返回执行。

## 审定与实施门槛

需要用户审定：整体视觉/导航分组、手机和Electron密度、Facts许可/撤回表达、导入审阅、实际表单在单份批准之前的顺序，以及各设置/异常状态。用户批准前 `docs/TASKS.md` 的 T24 checkbox保持未勾选；本次交付完成不等于T24已验收。审定后先T25，再T26–T30；T31负责真实交互、辅助技术与打印的完整验收。

设计检查使用本机Chrome和编造数据，检查结果见任务记录。运行 `node docs/designs/t24/check.mjs` 可检查路由、实现文件、操作状态、六种宽度、亮暗主题、可见导航/焦点、无远程请求及稿件渲染；若本机保留 `scratch/t22/node_modules/axe-core/axe.min.js`，还会检查全部正常页面的WCAG A/AA规则。未安装时明确报告未运行，脚本不自动下载依赖。截图与结果仅在忽略的 `scratch/t24/`；不把设计稿检查声称为生产Angular、Electron、屏幕阅读器或真实PDF验收。
