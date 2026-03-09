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
- 普通用户不得反记账；仅允许管理员执行紧急逆转并留下完整日志。

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

- 已落地基础财务报表快照生成、报表查询与删除子模块，支持按月份/跨月区间生成、未记账口径和完整模板列示；打印、版式导出与标准数据导出仍未落地。

Current Channels:

- `reporting:generate`
- `reporting:list`
- `reporting:getDetail`
- `reporting:delete`

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
- 增补管理员紧急逆转轨迹
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
- `reporting:generate/list/getDetail/delete`

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
- 报表快照需保留生成范围、是否纳入未记账凭证、截至时点/期间区间等元数据，便于后续查询与复核。
- 资产负债表按“月份”生成，取所选月份最后一天作为截至时点；利润表、业务活动表、现金流量表按“起始月份-结束月份”生成，允许跨年范围，实际取数边界为起始月份 1 日至结束月份最后 1 日。
- 勾选“未记账凭证”后，报表统计范围扩大到所选期间内未删除且未记账/已审核/已记账凭证；未勾选时默认仅统计已记账凭证。

---

## 9. Current Compliance Gaps

- 账簿查询仍未完成；财务报表已具备基础快照生成、查询与删除能力，但打印、版式导出、标准数据导出尚未完成。
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

END OF SPEC
