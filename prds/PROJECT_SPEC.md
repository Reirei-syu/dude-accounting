# Project Spec

## 0. 使用约定（跨对话记忆）

- 每次新对话开始时，先阅读本文件，再开始分析或开发。
- 当出现重大变化时必须更新本文件：架构调整、数据库结构变化、权限模型变化、核心流程变化、关键模块新增/下线。
- 本文件是项目“当前真实状态”的基线，若与其他文档冲突，以代码和本文件为准，并同步修正文档差异。

---

## 1. Project Overview

Name: Dude Accounting (`dude-app`)

Goal:
构建一个基于 Electron 的本地化桌面会计系统，统一账套管理、科目设置、凭证处理、期初余额、结账与系统管理能力。

Current Stage:

- 已形成可运行主流程：登录 -> 账套 -> 凭证录入/管理 -> 科目与辅助设置 -> 期初余额 -> 结账。
- 已纳入期末损益结转主流程：支持按当前会计期间预览/执行损益结转，并在结账前校验当前期间是否已完成损益结转。
- 报表输出、账簿查询中的部分页面仍为占位入口（未完成业务实现）。

---

## 2. Tech Stack

Backend (Electron Main Process):

- Language: TypeScript (Node.js runtime in Electron main)
- Framework: Electron IPC (`ipcMain.handle`) + service layer
- Database: SQLite (`better-sqlite3`)
- Domain libs: `decimal.js`（金额精度处理）

Frontend (Renderer):

- Framework: React 19 + TypeScript
- State: Zustand
- UI: Tailwind CSS + 自定义玻璃态样式 + Radix UI（Dialog/ContextMenu 等）
- Build: `electron-vite` + Vite

Infrastructure:

- Docker: no
- Cloud: no（当前为本地单机数据存储）
- Packaging: `electron-builder`（win/mac/linux）

---

## 3. Repository Structure

/src/main
/database # SQLite 初始化、迁移兼容、种子数据
/ipc # IPC 接口与权限校验入口
/security # 密码哈希/验证
/services # 账套设置、现金流映射、损益结转等业务服务

/src/preload # contextBridge 暴露 window.api（类型声明见 index.d.ts）

/src/renderer/src
/pages # 页面级业务（凭证、科目、账套、系统）
/components # 布局与通用组件（Sidebar/Tab/Workspace）
/stores # Zustand 状态
/assets # 样式与资源

/prds # 产品、技术与开发日志文档

/design-system # 设计系统基线

---

## 4. Core Modules

### AuthSessionModule

Responsibility:
登录认证、会话绑定（按 renderer sender 维度）与权限校验。

Functions:

- `auth:login(username, password)`
- `auth:logout()`
- `auth:getUsers/createUser/updateUser/deleteUser`（管理员）
- `requireAuth/requireAdmin/requirePermission`

Dependencies:

- `src/main/security/password.ts`
- `users` 表

---

### LedgerModule

Responsibility:
账套生命周期管理、会计准则模板应用、会计期间基础维护。

Functions:

- `ledger:getAll/create/update/delete/getPeriods`
- `ledger:getStandardTemplates`
- `ledger:applyStandardTemplate`

Dependencies:

- `seedSubjectsForLedger`
- `seedCashFlowItemsForLedger`
- `seedCashFlowMappingsForLedger`
- `seedPLCarryForwardRulesForLedger`

---

### AccountSetupService

Responsibility:
会计科目与辅助核算档案的核心规则（含多辅助类别、系统科目限制、自定义辅助明细绑定）。

Functions:

- `listSubjects`
- `createSubject`
- `updateSubject`
- `listAuxiliaryItems`
- `createAuxiliaryItem`
- `updateAuxiliaryItem`
- `deleteAuxiliaryItem`

Dependencies:

- `subjects`
- `auxiliary_items`
- `subject_auxiliary_categories`
- `subject_auxiliary_custom_items`

---

### VoucherModule

Responsibility:
凭证录入、修改、列表查询、审核/记账状态流转与分录查询。

Functions:

- `voucher:getNextNumber`
- `voucher:save`
- `voucher:update`
- `voucher:list`
- `voucher:getEntries`
- `voucher:batchAction` (`audit/bookkeep/unbookkeep/unaudit/delete`)

Dependencies:

- `vouchers`
- `voucher_entries`
- 权限：`voucher_entry/audit/bookkeeping`
- 凭证录入时会计科目仅允许选择末级科目；数字关键字按代码/名称前缀联想；回车可自动选中当前联想结果中的第一个末级科目；同时提供默认收起的树形手动选科目弹窗。

---

### CashFlowModule

Responsibility:
现金流量项目管理与自动匹配规则管理；支撑凭证录入现金流归集。

Functions:

- `cashflow:getItems`
- `cashflow:getMappings`
- `cashflow:createMapping/updateMapping/deleteMapping`
- `applyCashFlowMappings`（服务层自动匹配）

Dependencies:

- `cash_flow_items`
- `cash_flow_mappings`

---

### PLCarryForwardModule

Responsibility:
按会计期间生成损益结转预览与自动凭证；企业账套结转至所有者权益类科目，民非账套结转至净资产类科目；结账前校验当前期间是否已完成损益结转。

Functions:

- `plCarryForward:listRules`
- `plCarryForward:preview`
- `plCarryForward:execute`
- 内部校验：`assertPeriodCarryForwardCompleted`

Dependencies:

- `pl_carry_forward_rules`
- `subjects`
- `vouchers`
- `voucher_entries`
- `system_settings`

---

### InitialBalanceAndPeriodModule

Responsibility:
期初余额录入与年末结账结转（生成下一年度 1 月期初）；执行期间闭账前校验当前期间损益结转状态。

Functions:

- `initialBalance:list/save`
- `period:getStatus/close`
- 年末结账时执行 `carryForwardYear`

Dependencies:

- `initial_balances`
- `periods`
- `vouchers/voucher_entries`

---

## 5. Data Models

User (`users`)

- id
- username
- real_name
- password_hash
- permissions (JSON)
- is_admin
- created_at

Ledger (`ledgers`)

- id
- name
- standard_type (`enterprise` | `npo`)
- start_period
- current_period
- created_at

Subject (`subjects`)

- id
- ledger_id
- code
- name
- parent_code
- category
- balance_direction
- has_auxiliary
- is_cash_flow
- level
- is_system
- created_at

AuxiliaryItem (`auxiliary_items`)

- id
- ledger_id
- category
- code
- name
- created_at

SubjectAuxiliaryCategory (`subject_auxiliary_categories`)

- id
- subject_id
- category

SubjectAuxiliaryCustomItem (`subject_auxiliary_custom_items`)

- id
- subject_id
- auxiliary_item_id

Voucher (`vouchers`)

- id
- ledger_id
- period
- voucher_date
- voucher_number
- voucher_word
- status
- creator_id / auditor_id / bookkeeper_id
- is_carry_forward
- created_at / updated_at

VoucherEntry (`voucher_entries`)

- id
- voucher_id
- row_order
- summary
- subject_code
- debit_amount
- credit_amount
- auxiliary_item_id
- cash_flow_item_id

CashFlowItem (`cash_flow_items`)

- id
- ledger_id
- code
- name
- category
- direction
- is_system

CashFlowMapping (`cash_flow_mappings`)

- id
- ledger_id
- subject_code
- counterpart_subject_code
- entry_direction
- cash_flow_item_id

PLCarryForwardRule (`pl_carry_forward_rules`)

- id
- ledger_id
- from_subject_code
- to_subject_code

InitialBalance (`initial_balances`)

- id
- ledger_id
- period
- subject_code
- debit_amount
- credit_amount

Period (`periods`)

- id
- ledger_id
- period
- is_closed
- closed_at

SystemSetting (`system_settings`)

- key
- value
- updated_at

---

## 6. API Endpoints（IPC Channels）

Auth:

- `auth:login`
- `auth:logout`
- `auth:getUsers`
- `auth:createUser`
- `auth:updateUser`
- `auth:deleteUser`

Ledger:

- `ledger:getAll`
- `ledger:create`
- `ledger:update`
- `ledger:delete`
- `ledger:getPeriods`
- `ledger:getStandardTemplates`
- `ledger:applyStandardTemplate`

Subject & Auxiliary:

- `subject:getAll`
- `subject:search`
- `subject:create`
- `subject:update`
- `subject:delete`
- `auxiliary:getAll`
- `auxiliary:getByCategory`
- `auxiliary:create`
- `auxiliary:update`
- `auxiliary:delete`

Voucher:

- `voucher:getNextNumber`
- `voucher:save`
- `voucher:update`
- `voucher:list`
- `voucher:getEntries`
- `voucher:batchAction`

Cash Flow:

- `cashflow:getItems`
- `cashflow:getMappings`
- `cashflow:createMapping`
- `cashflow:updateMapping`
- `cashflow:deleteMapping`

P&L Carry Forward:

- `plCarryForward:listRules`
- `plCarryForward:preview`
- `plCarryForward:execute`

Initial Balance & Period:

- `initialBalance:list`
- `initialBalance:save`
- `period:getStatus`
- `period:close`

Settings:

- `settings:get`
- `settings:getAll`
- `settings:set`

---

## 7. Coding Conventions

General:

- TypeScript 优先，输入输出结构显式化（preload `index.d.ts` 同步维护）。
- 前端状态集中在 Zustand；页面内尽量只处理展示和交互。
- 业务规则放在 main/service 或 main/ipc，不放 renderer。

Main Process:

- IPC 层负责鉴权、参数透传和错误包装，复杂规则下沉到 service。
- 数据写入优先使用事务，保持账务数据一致性。

Renderer:

- Workspace + Tab 架构统一承载页面。
- 占位页面统一使用 `PlaceholderPage`，待业务补齐后替换。

---

## 8. Constraints

- 默认离线单机模式，所有核心数据保存在本地 SQLite。
- 除登录外，IPC 调用都依赖会话；敏感操作依赖权限键：
  `voucher_entry`, `audit`, `bookkeeping`, `system_settings`, `ledger_settings`。
- 企业与民非账套模板都内置，账套创建后自动灌入对应系统科目和规则。
- 系统科目（`is_system = 1`）禁止改名、禁止删除。
- 新建明细科目必须选择上级科目，并沿用上级类别与余额方向。
- 凭证录入与凭证修改时，所有分录必须使用当前账套下的末级会计科目，前后端都要执行强制校验。
- 辅助核算类别允许多选；选中 `custom` 时必须绑定至少一个自定义辅助明细。
- 已被凭证引用的辅助项不可删除。
- 会计准则模板切换仅允许在“无凭证且无非零期初余额”账套上执行。
- 期末损益结转按当前会计期间执行，仅统计当前期间内已记账且非损益结转凭证的损益类科目发生额。
- 自动生成的损益结转凭证标记 `is_carry_forward = 1`；同一期间已存在未审核损益结转凭证时允许删除后重建，已审核或已记账时禁止重跑。
- 期间结账前必须完成当前期间损益结转；若当前期间无可结转金额，则允许直接结账。
- 期末结账按期间闭账，12 月结账会自动结转生成下一年度 1 月期初余额。
- 金额按“分”存储（整数），输入允许两位小数。

---

## 9. Future Modules (Optional)

- 报表输出模块完善：资产负债表、利润表/业务活动表、现金流量表。
- 账簿查询模块完善：总账、明细账、辅助账等。
- 账套备份/恢复能力（当前菜单有入口，占位中）。
- 云备份与多端同步（尚未规划实现）。

---

END OF SPEC
