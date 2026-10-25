# T32 云资源整理维护记录

2026-10-19：T32.1 的身份、历史故障和依赖核对已完成；用户明确批准后，T32.2 的旧 staging 删除请求已成功执行。Railway 将其 `deletedAt` 设置为 2026-10-21 12:40:58 UTC（赫尔辛基 10 月 21 日 15:40:58）；当日旧项目仍可列出，尚未最终清除。用户随后要求节省开销，保留的 production/web 已启用 Serverless 闲置休眠，实测睡眠及唤醒通过。实际浏览器下载的 ZIP 已检查，包含两份 PDF，下载内容验收通过；独立求职信链接的自动化边界仍保留。当时 T32 保持未完成，等待平台最终清除核验；2026-10-25 最终核验通过，见下节。当前没有新的云端演练需求，不创建同项目 staging environment。

## 2026-10-25 最终验收：通过

- Railway 连接工具实时列出全部可访问项目：旧 `job-seeking-app-staging` 已不在清单，本应用只剩原 `job-seeking-app-production`。原 project、production environment、web service 及域名 ID 与 10 月 19 日记录一致；只有一个 environment、一个服务，没有待发布配置、Volume 或 Bucket。
- 当前服务来源仍为本仓库 `main`，`checkSuites=true`（Wait for CI）、`sleepApplication=true`，构建、迁移及健康检查配置保留。此后正常业务发布已推进到 T33.4 提交 `2e7d63b`，当前部署成功；该提交的 [CI](https://github.com/Jingyu-shanshan/job-seeking-app/actions/runs/40211590593) 全部成功，结束于 16:31:44 UTC，部署健康检查于 16:35:46 UTC 成功。本次没有触发额外发布。
- 本次 `/health` 与 `/health/ready` 均返回 200、`status: ok`；未登录读取 facts、applications 和 export 均返回 401。
- 原账户登录/退出、历史事实与投递读取、43 张业务表与 6 个附件的整理前后逐字节比对、实际浏览器 ZIP 与两份冻结 PDF 哈希，沿用 10 月 19 日已通过的维护证据。本次没有重新登录或下载，也没有把旧数据快照与后续业务变更后的当前库强行判等。
- 本次 Railway OAuth 只返回变量名；本机 Railway CLI 登录已失效，故没有重新比对数据库连接串或认证密钥的值。生产连接未替换的逐值证据来自 10 月 19 日；本次仅新增原身份/域名、现配置、发布与生产健康复核。
- 没有云端演练需求，未创建 staging environment；独立 Neon 演练资源沿用此前保留决定，本次未清理或重新查询。没有修改云端配置、业务资料、旧本地数据库，没有调用模型、填表或投递，没有留下保活或后台监控。

T32 的平台清除待办已关闭。独立求职信链接的自动化下载仍未通过验收；已验证的 ZIP 包含两份完整 PDF，此边界不影响本次云资源整理结论。10 月 19 日实测休眠/唤醒作为历史证据保留，本次仅复核开关，不重做静置或预测节费金额。私有实时证据及断言结果在 Git 忽略的 `scratch/t32/final-acceptance/`。

## 删除前清点

- 保留 `job-seeking-app-production` 原 project、`production` environment 和单个 `web` 服务。数据库连接、认证密钥、HTTPS 来源、本机 runner/桌面客户端地址均与 T12 生产配置一致。
- 删除对象固定为旧 `job-seeking-app-staging` project，其中 environment 虽名为 `production`，仍属于旧演练项目。删除前再次核实它没有 active deployment、GitHub 发布触发器、定时任务、Volume、Bucket 或自定义域名，只有独立的 Railway 服务域名。准确 ID、地址和配置仅存于 Git 忽略的 `scratch/t32/`。
- 两项目的 shared variables 均为空，生产服务变量没有 Railway 引用表达式或旧 staging 地址；生产没有依赖旧项目的服务或存储。生产 GitHub 来源仍为本仓库 `main`，原触发器和 Wait for CI 保持开启，PR 自动环境关闭。
- 旧项目当前连接原正常演练库：42 张表、16 条迁移，仅有编造账户、事实、职位和测试资料，无申请、模型调用或 PDF。与生产的数据库、认证密钥和 HTTPS 来源分别隔离，无须迁移业务资料。

## 历史失败结论

失败部署保存的变量快照与 T03a 的故障配置一致，指向演练 Neon 项目中的独立故障数据库，没有指向生产库。该库只有空 `pgmigrations` 和一个仅含 `id` 列、1 行占位数据的 `user` 表；认证建表因此报 `relation "user" already exists`（SQLSTATE `42P07`），尝试中的迁移随后回滚。这是保留的故障演练结果，旧 staging 后来已恢复正常演练库连接并停止服务。

未在任何数据库执行 reset、删表、down migration 或补写迁移记录。

## 生产与数据检查

- 删除前的生产基线为 T31 合并 main 的发布：同一提交的 GitHub CI 成功，Railway 随后自动发布成功。后续仅为应用休眠配置重新发布，见下一节。
- `/health`、`/health/ready` 均返回 200 和 `status: ok`；未登录读取 facts、applications、export 均返回 401。
- 生产共 49 张表，18 条迁移与当前仓库一致；只读核对两份实际投递文件的原始 bytes 与存储 SHA-256，均通过。
- 原账户已有浏览器会话可读事实、历史申请和冻结记录；下载的一份冻结简历 PDF 与申请文件 SHA-256 一致。删除请求后，原账户退出至登录页、使用浏览器既有凭据重新登录并再次读取历史申请均通过，未修改或保存新凭据。
- 复用现有导出实现，在生产库只读事务中生成私有 ZIP：43 张业务表、6 个附件，清单内所有文件大小、CRC 和 SHA-256 均通过。删除请求后以相同导出时间再次生成，全部文件逐字节与删除前一致。浏览器自动化下载出现 `ERR_BLOCKED_BY_CLIENT` 或超时，后续另核验了实际下载的 ZIP。
- 已直接检查用户下载目录中新下载的当日 ZIP：共 11 个文件，包含 43 张业务表、2 个 PDF 和 4 个 PNG；清单内全部大小、CRC 与 SHA-256 通过。实际 ZIP 的业务 JSON 和全部 6 个附件字节均与整理前一致。两份冻结 PDF 位于 `files/document_pdf/`，使用内部编号命名，不在 ZIP 根目录；文件确实存在，且两份 PDF 哈希与冻结申请记录一致。已在私有目录解出易读名称的简历与求职信供查看。实际 ZIP 下载和内容检查通过；独立求职信链接的自动化下载没有完成，作为边界保留，不将它误记为 ZIP 缺 PDF 或浏览器链接已通过。
- Neon 生产 PostgreSQL 18、Frankfurt 区域、ready 的原 root `main` branch 和 `history_retention_seconds=21600` 已核对。此次没有新建恢复分支或重新做时间点恢复；T12 的原恢复演练保留为历史证据，6 小时配置本身不证明某个具体时间点已可恢复。
- 删除请求后 `/health`、`/health/ready` 和未登录拒绝读取再次通过。原生产 project/environment/service、成功部署、数据库/认证变量、域名及 main/Wait for CI 触发器均与删除前一致；本应用目前只有原 production project 没有删除标记。旧 staging 的删除排期不等于它已从平台清单消失。
- 最初的删除整理阶段只对已批准的旧 Railway staging project 请求删除；随后用户授权的生产闲置休眠调整见下一节。没有调用真实模型、填写或提交申请，没有修改业务数据或旧本地数据库。登录检查正常更新认证会话。

## 按用户要求启用生产闲置休眠

范围限于本应用保留的 `job-seeking-app-production` / `production` / `web`。旧 staging 仍按原时间排定删除，其他应用的 Railway 服务不在此次调整范围。

- 已通过服务配置启用 `sleepApplication=true`。Railway 的 [Serverless 说明](https://docs.railway.com/deployments/serverless)明确：设置必须在新容器创建时应用，接口读回 true 不能证明原运行容器已生效。
- 最初的普通 redeploy 复用了旧部署的 `sleepApplication=false` 快照，已取消该次发布；随后将同一 CI 通过的提交按当前配置发布，新部署成功，实际部署 manifest 的 `sleepApplication=true` 已核实。没有上传本地未提交文件或私有资料。
- 生产 project、environment、service、域名、数据库/认证变量、main 来源与 Wait for CI 均保持原值。部署 manifest 除休眠项之外与原成功版本相同；这是用户明确要求的配置发布，不属于为 T32 额外触发无意义发布。
- 发布前确认没有 queued/running 后台运行或启用的定时预设。当前连接池会回收闲置连接，没有为此修改代码或增加轮询；本地 runner 运行时的轮询、用户访问和未来定时任务可能让服务保持唤醒。需要可靠定时运行时，应先重新评估休眠设置，不能假定休眠中的进程会按时执行计时器。
- 新部署的 `/health`、`/health/ready` 和未登录 API 拒绝通过；43 张业务表与 6 个附件再次逐字节等于整理前快照。
- 静置期间只读取 Railway 控制面，没有向应用发送保活。最后一次验收访问约 7 分钟后（418 秒）观察到实际 `SLEEPING`，HTTP 日志确认静置期间没有新增访问。随后第一次 `/health/ready` 请求用时约 1.8 秒、返回 200，无须重试；`/health` 同样通过。刷新浏览器后原登录会话和事实正常读取。休眠和唤醒均已实测，结束检查后停止业务访问，不留保活或循环健康检查。

官方说明为无出站流量后通常约 5–10 分钟休眠，数据库通信和访问响应都可能延后休眠；休眠后首次访问有冷启动等待，也可能需重试。开启休眠不代表所有费用归零，本次不预测具体节省金额。

## 10 月 19 日删除执行及当时剩余验收

用户明确批准删除 `job-seeking-app-staging` 及其中服务、环境和部署历史，保留 `job-seeking-app-production` 与全部 Neon 资源。重新核对身份和生产状态后，精确旧项目 ID 的删除命令成功返回；平台查询与项目列表均显示同一删除排期，未重复删除或改变该排期。

当时剩余（10 月 25 日已完成）：到平台排定时间之后，只读确认旧 project 不再存在且本应用在 Railway 只剩原 production project，再复核生产健康。此前不得把“已排定删除”写成“已最终清除”。实际浏览器 ZIP 已验证含完整 PDF；独立求职信链接的自动化边界不扩大为内容缺失结论。本次未创建后台监控或提醒。

独立 Neon `job-seeking-app-staging` 项目保留，当前用途是 T03a 编造资料及故障演练历史；正常演练库和故障库均不服务生产，也不能直接当作最新版本 staging。删除请求后再次通过 Neon API 核实原 production 和 staging 项目都存在。未来确需云端演练时，先确认数据库干净且迁移适配，再在保留的 Railway project 创建隔离 staging environment；独立 Neon 清理另行决定。其他应用的 Railway/Neon 项目不属于本任务。

平台边界参见 [Railway 项目](https://docs.railway.com/projects)、[Railway 环境](https://docs.railway.com/environments)。私有身份、变量、数据库审计、CI/部署记录与附件检查只保存在 `scratch/t32/`；不进入 Git。
