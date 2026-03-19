# Project Spec

## 0. 使用约定（跨对话记忆）

- 所有项目交流统一使用简体中文；如无特殊说明，项目内新增或修改的文案默认使用简体中文。
- 每次完成一次重要修改后，必须先做 review，再执行验证；验证通过后再向用户交付成果。
- 每次新对话开始时，先阅读本文件，再开始分析或开发。
- 当出现重大变化时必须更新本文件：架构调整、数据库结构变化、权限模型变化、核心流程变化、关键模块新增/下线。
- 本文件是项目“当前真实状态”的基线，若与其他文档冲突，以代码和本文件为准，并同步修正文档差异。
- 当前打开的 folder 视为项目级最底部目录；除非用户明确要求，过程中新增文件默认放在当前项目目录内。
- 如用户要求打包为单独文件、安装包或其他可交付安装产物，输出目录统一为 `D:\coding\completed\项目名称`，本条优先于“文件放在当前项目目录内”的默认规则。

---

## 1. Project Overview

Name: Dude Accounting (`dude-app`)

Goal:
构建一个基于 Electron 的本地单机财务软件，供代理记账企业为委托单位记账使用。软件当前仅支持企业账套与民间非营利组织账套，不支持政府会计与事业单位会计。

Current Stage:

- 已具备登录、账套、凭证、科目、辅助、期初余额、损益结转、结账等基础流程。
- 账号权限模型已从“仅功能权限”扩展为“功能权限 + 账套访问权限”；普通用户后续将按被分配账套范围获取账套列表与业务操作权限，`admin` 默认可访问全部账套。
- “系统参数设置”正从单一参数页扩展为“双层配置”：管理员维护系统级规则，普通用户维护个人偏好；第一阶段重点覆盖默认账套、默认首页、凭证默认值与高频列表默认行为。
- “我的偏好”正在扩展界面个性化能力：新增当前登录用户级壁纸替换功能，支持上传自定义背景图、上传后裁切、恢复内置默认壁纸，并要求登录页与主界面同步生效。
- 账套设置中的“期末损益结转设置”已从只读预览升级为正式维护页，可按末级损益科目保存结转目标规则。
- 正在从“桌面记账应用雏形”改造为“具备合规基础能力的代理记账单机软件”。
- 已识别的重点改造方向为：已记账不可逆、关键操作日志、电子凭证处理底座、备份与电子档案导出、账簿报表输出。
- 已落地基础财务报表快照生成、报表查询与删除能力，支持按月份/跨月区间生成并可选纳入未记账凭证，但账簿查询、打印、版式输出与标准数据导出仍未完成。
- 打印能力进入统一改造阶段：采用统一 HTML 打印文档管线，预览、系统打印与打印版 PDF 导出同版同源；第一阶段覆盖财务报表与现有全部账簿，第二阶段覆盖记账凭证打印。
- 企业账套报表输出正在从临时科目直列版升级为严格对齐系统级 Skill 的企业会计准则四表制式，范围包括资产负债表、利润表、现金流量表和所有者权益变动表。

---

## 2. Product Scope

Supported:

- 委托单位账套：`enterprise`、`npo`
- 使用者：代理记账企业内部人员
- 场景：一个软件实例维护多个委托单位账套

Explicitly Unsupported:

- 政府会计
- 事业单位会计
- 云端多端同步
- 完整内置电子档案库

---

## 3. Tech Stack

Backend (Electron Main Process):

- Language: TypeScript (Node.js runtime in Electron main)
- Framework: Electron IPC (`ipcMain.handle`) + service layer
- Database: SQLite (`better-sqlite3`)
- Domain libs: `decimal.js`

Frontend (Renderer):

- Framework: React 19 + TypeScript
- State: Zustand
- UI: Tailwind CSS + 自定义玻璃态样式 + Radix UI
- Build: `electron-vite` + Vite

Infrastructure:

- Cloud: no
- Data: local SQLite only
- Packaging: `electron-builder`

---

## 4. Repository Structure

/src/main
/database # SQLite 初始化、迁移、种子数据
/ipc # IPC 接口与权限控制入口
/security # 认证与安全相关逻辑
/services # 业务服务层

/src/preload # contextBridge 与 window.api 类型声明

/src/renderer/src
/pages # 页面级业务
/components # 布局与通用组件
/stores # Zustand 状态
/assets # 样式与资源

/prds # 产品、规格、开发日志与合规整改文档

---

## 5. Core Modules

### AuthSessionModule

Responsibility:
登录认证、会话绑定、功能权限校验、账套访问权限校验。

Key Channels:

- `auth:login`
- `auth:logout`
- `auth:getUsers/createUser/updateUser/deleteUser`

### LedgerModule

Responsibility:
账套生命周期管理、模板应用、会计期间切换。

Current Constraint:

- 账套 `start_period` 的历史兼容归一化改为应用启动时执行一次，不再在 `ledger:getAll` 首页读取链路中每次全量扫描 `periods`、`vouchers`、`initial_balances`。
- `initialBalance:save` 在保存期初余额时会同步补齐 `periods` 记录，避免后续期间列表与期初数据脱节。
- 账套列表与期间列表查询已收口到 `ledgerCatalog` service，`ledger.ts` 中的读路径主要负责鉴权与 IPC 编排。
- 账套创建、账套更新、标准模板切换已收口到 `ledgerLifecycle` service，`ledger.ts` 中的写路径主要负责鉴权、telemetry 与操作日志。

Key Channels:

- `ledger:getAll/create/update/delete/getPeriods`
- `ledger:getStandardTemplates`
- `ledger:applyStandardTemplate`

### UserPreferenceModule

Responsibility:
维护当前登录用户的个人偏好，仅影响当前用户的默认行为，不得突破系统级规则边界。
当前还承载用户级界面个性化偏好，包括默认账套、默认首页和自定义壁纸。

Planned Channels:

- `settings:getUserPreferences`
- `settings:setUserPreferences`
- `settings:getWallpaperState`
- `settings:getLoginWallpaperState`
- `settings:chooseWallpaper`
- `settings:applyWallpaperCrop`
- `settings:restoreDefaultWallpaper`

### AccountSetupModule

Responsibility:
会计科目、辅助核算类别、自定义辅助明细管理。

Key Channels:

- `subject:getAll/search/create/update/delete`
- `auxiliary:getAll/getByCategory/create/update/delete`

Current Extension:

- 会计准则设置页支持“自定义一级科目模板”，仅允许在 `enterprise` 与 `npo` 既有口径内追加非系统一级科目。
- 自定义一级科目模板用于新建账套和无业务数据账套的模板重建，不直接覆盖已有业务账套中的现存科目。
- 会计准则设置页顶栏新增“自定义模板”入口，独立用于维护“自行添加的一级科目模板”；该入口支持自定义模板名称、模板说明、模板下载、批量导入、手动新增、保存与一键清空自定义新增科目。
- 独立“自定义模板”属于完整模板实体，允许使用与系统预设模板相同的一级科目编码；其编码唯一性仅在同一自定义模板内部约束，不与系统预设模板或其他自定义模板做全局冲突校验。

- 一级科目模板的批量导入采用“按科目代码合并”规则：导入同码条目覆盖当前草稿或已保存条目，导入异码条目追加保留，不允许整体覆盖原有手动维护记录。
- 模板下载生成的 Excel 导入模板中，`科目类别`、`余额方向`、`现金流量科目`、`是否启用`、`期末结转目标科目` 均通过下拉选项限制录入范围；其中“期末结转目标科目”显示“科目代码 + 科目名称”，导入时后端自动转译为内部科目代码。
- 系统预置模板仅支持“模板维护/清空模板”，不支持删除模板实体；独立自定义模板支持删除整个模板实体，删除后应从自定义模板列表中移除并保留操作日志。

### VoucherModule

Responsibility:
凭证录入、查询、审核、记账、删除与状态流转。

Current Constraint:

- 已记账凭证默认应视为不可逆。
- 反记账为可分配权限，由管理员按需授权给其他账号；执行反记账时仍必须强制填写原因、审批标记并留下完整日志。
- 新建记账凭证默认日期应继承当前期间上一张凭证日期；若当前期间尚无凭证，则默认取当月 1 日。
- 凭证展示与导航顺序统一为：`记` 字号在前、`结` 字号在后，各自按凭证号升序排列。
- 即使当前期间已结账，凭证管理仍应支持双击凭证进入只读查看模式；但不得放开修改权限。
- 凭证保存/更新的分录校验、现金流匹配和写库流程已收口到 `voucherLifecycle` service，`voucher.ts` 中该链路主要负责权限、期间校验和 IPC 返回结构。
- 凭证列表、取号、分录明细查询已收口到 `voucherCatalog` service，`voucher.ts` 中对应读路径主要负责鉴权与 telemetry 包装。
- 凭证批量审核、记账、反记账、删除/恢复删除状态流转已收口到 `voucherBatchLifecycle` service，`voucher.ts` 中对应链路主要负责权限、参数校验与操作日志。
- 凭证位置交换的查询、换位方案构建与事务写回已收口到 `voucherSwapLifecycle` service，`voucher.ts` 中对应链路主要负责权限、同账套同期间约束与 telemetry 包装。

Key Channels:

- `voucher:getNextNumber`
- `voucher:save`
- `voucher:update`
- `voucher:list`
- `voucher:getEntries`
- `voucher:batchAction`

### PeriodAndCarryForwardModule

Responsibility:
损益结转规则维护、损益结转、期末结账、反结账、期间冻结控制。

Key Channels:

- `plCarryForward:listRules/preview/execute`
- `plCarryForward:saveRules`
- `period:getStatus/close/reopen`
- `initialBalance:list/save`

### AuditLogModule

Responsibility:
记录关键业务过程日志，并支持按人员、时间、内容查询与导出。

Status:

- 新增中的合规模块。

Planned Channels:

- `auditLog:list`
- `auditLog:export`

### RuntimeTelemetryModule

Responsibility:
记录关键 IPC 调用的结构化运行日志，补充耗时、状态、异常堆栈等排障信息。

Status:

- 已支持按天写入本地 JSONL 日志文件，路径为应用 `userData/logs/runtime-YYYY-MM-DD.jsonl`。
- 运行日志与业务操作日志分离：`operation_logs` 用于业务留痕，`runtime-*.jsonl` 用于排查性能与异常。
- 当前已覆盖报表导出/生成、备份创建/校验/恢复、归档导出/校验/删除、电子凭证导入/校验/解析/转换等关键 IPC。
- 当前已额外覆盖首页和高频读路径，包括 `ledger:getAll`、`ledger:getPeriods`、`backup:list`、`archive:list`、`reporting:list`、`reporting:getDetail`。
- 当前也已覆盖账套写路径，包括 `ledger:create`、`ledger:update`、`ledger:delete`、`ledger:applyStandardTemplate`。
- 当前也已覆盖账簿高频读路径，包括 `bookQuery:listSubjectBalances`、`bookQuery:getDetailLedger`、`bookQuery:getJournal`、`bookQuery:getAuxiliaryBalances`、`bookQuery:getAuxiliaryDetail`。

### ElectronicVoucherModule

Responsibility:
电子凭证接收、验签/验真状态留痕、解析、去重、入账关联。

Scope of current phase:

- 数电发票
- 银行电子回单/对账单

Planned Channels:

- `eVoucher:import`
- `eVoucher:list`
- `eVoucher:verify`
- `eVoucher:parse`
- `eVoucher:convert`

Current Import Constraint:

- 电子凭证导入在文件落盘后必须以单事务写入 `electronic_voucher_files`、`electronic_voucher_records`、`electronic_voucher_verifications`；若数据库写入失败，必须回滚并清理已复制的孤儿文件。

### BackupRecoveryModule

Responsibility:
账套备份包生成、校验、恢复。

Status:

- 已支持系统级数据库快照备份包生成、manifest 清单写入、完整性校验与整库恢复。
- 备份创建支持用户自定义保存目录，并记忆最近一次使用的备份目录。
- 恢复既支持按系统内备份记录恢复，也支持从自选备份包目录直接发起恢复。
- 备份时间选择器需基于已结账会计期间提供选择，并默认指向最近一次已结账期间。
- 当前恢复语义仍为“整库覆盖 + 应用重启”，不支持单账套局部恢复。
- 备份记录的查询、校验状态更新、删除元数据已收口到 `backupCatalog` service，IPC 仅保留权限校验与流程编排。

Current Channels:

- `backup:create`
- `backup:list`
- `backup:validate`
- `backup:delete`
- `backup:restore`

### ArchiveExportModule

Responsibility:
生成电子会计档案导出包，保留元数据、校验信息、结构化入账数据和导出记录。

Status:

- 归档导出支持用户自定义保存目录，并记忆最近一次使用的归档目录。
- 已支持电子档案导出包完整性校验，覆盖 manifest 校验、必要文件存在性检查与原始凭证目录数量核对。
- 归档时间选择器需基于已结账期间可归并出的会计年度提供选择，不再允许自由录入年度文本。
- 归档记录的查询、校验状态更新、删除元数据已收口到 `archiveCatalog` service，IPC 仅保留权限校验与流程编排。

Current Channels:

- `archive:export`
- `archive:list`
- `archive:validate`
- `archive:delete`
- `archive:getManifest`

### ReportingOutputModule

Responsibility:
账簿、报表、打印、版式输出、标准数据导出。

Status:

- 已落地基础财务报表快照生成、报表查询、删除与另存为导出子模块，支持按月份/跨月区间生成、未记账口径、完整模板列示和重复生成拦截；当前导出格式为 Excel 与 PDF。
- 企业账套报表子模块正在升级为与系统级 `qiye-cas-report-templates` Skill 一致的四表官方制式；当前已有资产负债表、利润表、现金流量表，所有者权益变动表正在补齐接入。
- 报表导出的目录偏好、默认路径、单个/批量导出编排已收口到 `reportExport` service，IPC 仅保留鉴权、弹窗与操作日志。
- 报表快照查询/明细/删除已收口到 `reportSnapshotCatalog` service，HTML/Excel/PDF 输出辅助已收口到 `reportSnapshotOutput` service；`reporting.ts` 当前主要保留报表计算与快照生成主链路。
- 账簿查询的数据读取层已收口到 `bookQueryData` service，`bookQuery.ts` 当前主要保留结果组装与账簿口径计算。
- 账簿导出的目录偏好、默认路径、导出编排已收口到 `bookQueryExport` service，`ipc/bookQuery.ts` 中的导出链路主要负责鉴权、弹窗、telemetry 与操作日志。

Current Channels:

- `reporting:generate`
- `reporting:list`
- `reporting:getDetail`
- `reporting:delete`
- `reporting:export`
- `reporting:exportBatch`

### PrintOutputModule

Responsibility:
统一打印任务生成、打印预览、系统打印、打印版 PDF 导出，要求三者同版同源。

Planned Channels:

- `print:prepare`
- `print:getJobStatus`
- `print:openPreview`
- `print:print`
- `print:exportPdf`
- `print:dispose`

---

## 6. Data Models

Existing Tables:

- `users`
- `user_ledger_permissions`
- `user_preferences`
- `ledgers`
- `subjects`
- `auxiliary_items`
- `subject_auxiliary_categories`
- `subject_auxiliary_custom_items`
- `vouchers`
- `voucher_entries`
- `cash_flow_items`
- `cash_flow_mappings`
- `pl_carry_forward_rules`
- `initial_balances`
- `periods`
- `system_settings`
- `report_snapshots`

Report Snapshot Persistence Constraint:

- `report_snapshots` 通过 `(ledger_id, report_type, period)` 的唯一约束兜底同一账套、同一报表类型、同一会计期间范围的重复生成拦截；旧库迁移时应先清理重复快照再补唯一索引。

System Setting Keys:

- `subject_template.enterprise`
- `subject_template.npo`
- `print_show_page_number`

Subject Category Rules:

- `enterprise` 账套保持六大类：`asset`、`liability`、`common`、`equity`、`cost`、`profit_loss`
- `npo` 账套改为五大类：`asset`、`liability`、`net_assets`、`income`、`expense`
- 旧版 `npo` 账套遗留的 `equity` 与 `profit_loss` 必须在迁移时分别改写为 `net_assets` 与 `income/expense`
- `npo` 账套的期末结转来源科目只允许来自 `income` 与 `expense`，结转目标只允许来自 `net_assets`

Compliance Tables Added / To Be Added:

- `operation_logs`
- `electronic_voucher_files`
- `electronic_voucher_records`
- `electronic_voucher_verifications`
- `voucher_source_links`
- `archive_exports`（含 `validated_at` 字段）
- `backup_packages`（含 `manifest_path`、`backup_period` 字段）

Voucher Model Direction:

- 保留 `status`
- 增补已记账元数据
- 增补反记账轨迹（原因、审批标记、执行人、执行时间）
- 增补电子凭证来源关联

---

## 7. API Surface（Current + In-flight）

Current:

- `auth:*`
- `ledger:*`
- `subject:*`
- `auxiliary:*`
- `voucher:*`
- `cashflow:*`
- `plCarryForward:*`
- `initialBalance:*`
- `period:*`
- `settings:*`
- `bookQuery:listSubjectBalances/getDetailLedger/getJournal/getAuxiliaryBalances/getAuxiliaryDetail`
- `reporting:generate/list/getDetail/delete/export/exportBatch`
- `eVoucher:import/list/verify/parse/convert`
- `print:*`
- `backup:create/list/validate/delete/restore`
- `archive:export/list/validate/delete/getManifest`

Current Authorization Semantics:

- `auth:login` 返回功能权限与账套访问范围信息。
- `auth:getUsers/createUser/updateUser` 需同时读取/维护账号被授权的账套 ID 集合。
- `ledger:getAll` 返回当前登录用户可访问的账套列表；`admin` 返回全部账套。
- 系统级规则保存在 `system_settings`；个人偏好保存在 `user_preferences`，按当前登录用户作用域读取。

Settings Extension:

- `settings:getSubjectTemplate`
- `settings:getSubjectTemplateReference`
- `settings:parseSubjectTemplateImport`
- `settings:saveSubjectTemplate`
- `settings:importSubjectTemplate`
- `settings:downloadSubjectTemplate`
- `settings:clearSubjectTemplate`
- `settings:getUserPreferences`
- `settings:setUserPreferences`

User Preference Keys:

- `default_ledger_id`
- `default_home_tab`
- `custom_wallpaper_relative_path`
- `voucher_print_layout`
- `voucher_print_double_gap`

In-flight:

- `auditLog:list/export`
- `eVoucher:import/list/verify/parse/convert`

---

## 8. Key Constraints

- 默认离线单机模式，核心数据保存在本地 SQLite。
- 一个账套对应一个委托单位，不支持政府和事业单位会计模板。
- `admin` 默认拥有全部账套访问权，无需显式勾选单个账套授权。
- 普通用户仅可查看和操作被分配的账套；未分配账套不得出现在账套列表、功能入口、查询结果或可提交的业务操作中。
- 新增或调整账套级授权时，需同时检查登录会话、账套列表、业务 IPC 与账号管理界面是否保持一致，不允许仅前端隐藏而后端放行。
- 新建或重命名账套时，账套名称在去除首尾空格后必须与现有账套名称保持唯一，不得与既有账套完全同名。
- 系统参数仅承载系统级规则；个人偏好必须与系统规则分层，且个人偏好只能在系统允许范围内生效。
- 个人偏好中的默认账套必须限制在当前用户被授权的账套集合内；若偏好中的账套失效，应自动回退到首个可访问账套或空状态。
- 打印预览、系统打印与打印版 PDF 导出必须使用同一份 HTML 打印文档，不允许按输出方式分别维护多套模板。
- 大体量打印任务允许先进入“生成中”状态，再打开预览窗口；稳定性优先于即时秒开预览。
- 第一阶段账簿打印按当前页面筛选结果生成单个打印文档，不支持跨账簿类型混合批量。
- 第二阶段记账凭证打印必须支持单张整页与 A4 一页两张（上下结构）两种版式；两联版式的上下间距按当前用户记住上次设置。
- 普通用户不得对已记账凭证执行反记账。
- 管理员紧急逆转必须强制记录原因并写入操作日志。
- 末级损益科目必须维护完整结转规则；若存在未配置或失效规则，不得执行期末损益结转。
- 自定义导入的一级科目模板只能扩展 `enterprise` 或 `npo` 账套，不得引入第三类会计准则。
- 自定义模板中的损益类、收入类、费用类一级科目必须声明期末结转目标科目。
- 自定义模板导入后仅影响新建账套或无业务数据的模板重建流程，不允许静默覆盖已有业务账套的一级科目。
- 一级科目模板的新增、修改、导入、清空与模板下载仅允许管理员账号执行；普通用户最多只读查看。
- 一级科目模板不再维护独立排序号，统一按科目代码自动排序；手动维护界面应提供已有一级科目只读参考与结转目标下拉选择。
- 模板维护弹窗中的“当前模板科目”应基于“当前准则既有一级科目基线 + 已保存模板覆盖/新增”生成，不能只显示已保存的自定义新增条目。
- “自定义模板”入口仅维护“自行添加的一级科目模板”；其“清空模板”语义为一键删除自定义新增科目，不删除系统基线一级科目。
- 独立“自定义模板”允许与系统预设模板复用相同一级科目编码，因为其本身为独立模板，不参与系统预设模板的编码冲突校验；但同一自定义模板内部仍不得重复编码。
- 电子凭证处理必须具备重复入账拦截能力。
- 账套删除必须经过备份/导出前置校验。
- 备份文件与档案导出文件不得混用。
- 备份与归档创建目录允许用户自定义；恢复允许用户从自选备份包目录发起，但恢复目标始终为当前系统数据库。
- 备份与归档的校验时间戳应采用本地时间写入，不再使用 UTC 时间戳显示。
- 当存在更新版本的备份包或归档包时，允许删除旧版本产物；最新版本不得直接删除。
- 备份与归档时间选择器必须采用选择方式；备份默认选中最近一次已结账会计期间，归档默认选中最近一次可归档年度。
- 金额按“分”存储，输入允许两位小数。
- 凭证列表与凭证录入导航序列应保持一致的字号排序规则：普通记账凭证在前，结账凭证在后。
- 民间非营利组织报表模板行取数必须按显式科目映射汇总，并兼容父级科目下新增明细科目余额。
- 民间非营利组织现金流量表不得依赖现金流量项目名称模糊匹配，应按对方科目/现金流量项目 code 的显式映射取数。
- 报表快照需保留生成范围、是否纳入未记账凭证、截至时点/期间区间等元数据，便于后续查询与复核。
- 同一账套下，同报表类型、同会计期间范围的报表快照不得重复生成；如已存在，必须先删除原快照后再生成。
- 资产负债表按“月份”生成，取所选月份最后一天作为截至时点；利润表、业务活动表、现金流量表按“起始月份-结束月份”生成，允许跨年范围，实际取数边界为起始月份 1 日至结束月份最后 1 日。
- 勾选“未记账凭证”后，报表统计范围扩大到所选期间内未删除且未记账/已审核/已记账凭证；未勾选时默认仅统计已记账凭证。
- 报表导出需采用规范化白底黑字表样，标题居中、期间/单位信息置顶、细边框表格输出，优先贴近财政部官方报表表样；当前通过另存为方式提供 Excel 与 PDF 两种导出格式。
- 企业账套的资产负债表、利润表、现金流量表、所有者权益变动表必须与系统级 `qiye-cas-report-templates` Skill 的官方制式保持一致，不得回退为按科目直列的简化版。
- 民间非营利组织报表模板需严格参照《民间非营利组织会计制度》会民非 01/02/03 表的官方制式，查询、生成预览和导出三处保持同一表格结构。

---

Additional NPO Constraint:

- `npo` 账套的基础分类必须固定为“资产、负债、净资产、收入、费用”，不得继续把收入与费用并入单一 `profit_loss`，也不得继续将净资产存成 `equity`

## 9. Current Compliance Gaps

- 账簿查询仍未完成；财务报表已具备基础快照生成、查询、删除与 Excel/PDF 另存为导出能力，但打印和标准数据导出尚未完成。
- 电子凭证标准化接收、验签/验真、解析、结构化入账尚未完成。
- 电子会计档案已支持导出与包级校验，但仍缺少更细粒度的结构化入账文件校验规则与可读性检查记录。
- 操作日志查询与导出尚未完成。
- 账套备份已支持系统级数据库快照包生成、manifest 校验与整库恢复，但仍缺少单账套局部恢复、自定义外部存储策略与异地备份机制。
- 已记账凭证控制需要从当前实现继续收紧。

---

## 10. Verification Baseline

Required after each compliance slice:

- `npm run typecheck`
- `npm test`

Documentation sync required:

- `prds/prd.md`
- `prds/PROJECT_SPEC.md`
- `prds/合规整改计划.md`
- `prds/开发日志.md`

---

## 11. Book Query Pilot Status Update (2026-03-11)

- 民非账套账簿查询试点已覆盖：科目余额表、科目明细账、序时账、辅助余额表、辅助明细账。
- 当前已打通的账簿交叉查询链路包括：
  - 科目余额表 -> 科目明细账
  - 科目余额表 -> 辅助余额表
  - 辅助余额表 -> 辅助明细账
  - 科目明细账 / 辅助明细账 / 序时账 -> 凭证录入
- 辅助账当前口径说明：辅助期初余额按历史凭证滚算，不拆分科目期初数。
- `bookQuery` IPC 现包含：`listSubjectBalances`、`getDetailLedger`、`getJournal`、`getAuxiliaryBalances`、`getAuxiliaryDetail`。

---

## 12. Book Query Coverage Update (2026-03-11)

- 账簿查询模块当前已同时支持 `enterprise` 与 `npo` 两类账套。
- 当前已覆盖的账簿子功能包括：科目余额表、科目明细账、序时账、辅助余额表、辅助明细账。
- 账簿查询默认日期范围统一为“本年 1 月 1 日至今天”；全屏查看、右键交叉查询、未记账凭证口径在企业账套与民非账套保持一致。
- `bookQuery` IPC 现作为通用账簿查询入口供两类账套共用：`listSubjectBalances`、`getDetailLedger`、`getJournal`、`getAuxiliaryBalances`、`getAuxiliaryDetail`。
- 账簿查询模块现已支持每种账簿按当前筛选结果导出 `Excel` 与 `PDF`，导出采用另存为流程，并记忆上一次保存目录。
- 凭证分录需显式保存 `voucher_entries.auxiliary_item_id`，账簿辅助查询不得再依赖“科目仅绑定唯一辅助项”的推断作为主路径；该推断仅保留为历史数据兼容。

---

END OF SPEC
