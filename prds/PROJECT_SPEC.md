# Project Spec

## 0. 使用约定（跨对话记忆）

- 每次新对话开始时，先阅读本文件，再开始分析或开发。
- 当出现重大变化时必须更新本文件：架构调整、数据库结构变化、权限模型变化、核心流程变化、关键模块新增/下线。
- 本文件是项目“当前真实状态”的基线，若与其他文档冲突，以代码和本文件为准，并同步修正文档差异。

---

## 1. Project Overview

Name: Dude Accounting (`dude-app`)

Goal:
构建一个基于 Electron 的本地单机财务软件，供代理记账企业为委托单位记账使用。软件当前仅支持企业账套与民间非营利组织账套，不支持政府会计与事业单位会计。

Current Stage:

- 已具备登录、账套、凭证、科目、辅助、期初余额、损益结转、结账等基础流程。
- 账套设置中的“期末损益结转设置”已从只读预览升级为正式维护页，可按末级损益科目保存结转目标规则。
- 正在从“桌面记账应用雏形”改造为“具备合规基础能力的代理记账单机软件”。
- 已识别的重点改造方向为：已记账不可逆、关键操作日志、电子凭证处理底座、备份与电子档案导出、账簿报表输出。
- 已落地基础财务报表快照生成、报表查询与删除能力，支持按月份/跨月区间生成并可选纳入未记账凭证，但账簿查询、打印、版式输出与标准数据导出仍未完成。
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
登录认证、会话绑定、权限校验。

Key Channels:

- `auth:login`
- `auth:logout`
- `auth:getUsers/createUser/updateUser/deleteUser`

### LedgerModule

Responsibility:
账套生命周期管理、模板应用、会计期间切换。

Key Channels:

- `ledger:getAll/create/update/delete/getPeriods`
- `ledger:getStandardTemplates`
- `ledger:applyStandardTemplate`

### AccountSetupModule

Responsibility:
会计科目、辅助核算类别、自定义辅助明细管理。

Key Channels:

- `subject:getAll/search/create/update/delete`
- `auxiliary:getAll/getByCategory/create/update/delete`

### VoucherModule

Responsibility:
凭证录入、查询、审核、记账、删除与状态流转。

Current Constraint:

- 已记账凭证默认应视为不可逆。
- 反记账为可分配权限，由管理员按需授权给其他账号；执行反记账时仍必须强制填写原因、审批标记并留下完整日志。
- 新建记账凭证默认日期应继承当前期间上一张凭证日期；若当前期间尚无凭证，则默认取当月 1 日。
- 凭证展示与导航顺序统一为：`记` 字号在前、`结` 字号在后，各自按凭证号升序排列。
- 即使当前期间已结账，凭证管理仍应支持双击凭证进入只读查看模式；但不得放开修改权限。

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

### BackupRecoveryModule

Responsibility:
账套备份包生成、校验、恢复。

Planned Channels:

- `backup:create`
- `backup:list`
- `backup:validate`
- `backup:restore`

### ArchiveExportModule

Responsibility:
生成电子会计档案导出包，保留元数据、校验信息、结构化入账数据和导出记录。

Planned Channels:

- `archive:export`
- `archive:list`
- `archive:getManifest`

### ReportingOutputModule

Responsibility:
账簿、报表、打印、版式输出、标准数据导出。

Status:

- 已落地基础财务报表快照生成、报表查询、删除与另存为导出子模块，支持按月份/跨月区间生成、未记账口径、完整模板列示和重复生成拦截；当前导出格式为 Excel 与 PDF。
- 企业账套报表子模块正在升级为与系统级 `qiye-cas-report-templates` Skill 一致的四表官方制式；当前已有资产负债表、利润表、现金流量表，所有者权益变动表正在补齐接入。

Current Channels:

- `reporting:generate`
- `reporting:list`
- `reporting:getDetail`
- `reporting:delete`
- `reporting:export`

---

## 6. Data Models

Existing Tables:

- `users`
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
- `archive_exports`
- `backup_packages`

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
- `reporting:generate/list/getDetail/delete/export`

In-flight:

- `auditLog:list/export`
- `backup:create/list/restore/validate`
- `eVoucher:import/list/verify/parse/convert`
- `archive:export/list/getManifest`

---

## 8. Key Constraints

- 默认离线单机模式，核心数据保存在本地 SQLite。
- 一个账套对应一个委托单位，不支持政府和事业单位会计模板。
- 普通用户不得对已记账凭证执行反记账。
- 管理员紧急逆转必须强制记录原因并写入操作日志。
- 末级损益科目必须维护完整结转规则；若存在未配置或失效规则，不得执行期末损益结转。
- 电子凭证处理必须具备重复入账拦截能力。
- 账套删除必须经过备份/导出前置校验。
- 备份文件与档案导出文件不得混用。
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
- 电子会计档案导出接口尚未完成。
- 操作日志查询与导出尚未完成。
- 账套备份/恢复尚未完成。
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
