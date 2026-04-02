# 账套级备份与删除软提示重构方案

## 1. 背景

- 当前 `backup:create` 仍复制整库 SQLite 文件，`backup:restore` 也是整库覆盖恢复。
- 当前账套删除前依赖 `ledgerCompliance` 做“已校验备份 + 已校验归档”硬阻断。
- 新目标是把备份主流程改为“以账套为单位的备份包”，并支持把备份包导入为新账套，便于增量导入其他单位账套。

## 2. 目标

- 备份对象改为单账套，不再以整个数据库为备份目标。
- 新增“账套备份包导入为新账套”能力，不做覆盖已有账套。
- 删除账套时，备份与归档都改为强提示，不再作为硬阻断条件。
- 保留历史整库快照记录的校验/删除能力，但不再作为新流程创建对象。

## 3. 设计方案

- 将备份包升级为“账套级传输包”，目录内包含：
  - `manifest.json`
  - 账套级 SQLite 载荷文件
  - `electronic-vouchers/` 原件目录
- 账套级 SQLite 载荷仅保存单账套所需数据：
  - `ledgers`
  - `periods`
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
  - `electronic_voucher_files`
  - `electronic_voucher_records`
  - `electronic_voucher_verifications`
  - `voucher_source_links`
  - `report_snapshots`
  - `operation_logs`
  - 被上述记录引用到的 `users` 子集
- 明确不打包全局配置与运行态数据：
  - `user_preferences`
  - `user_ledger_permissions`
  - `system_settings`
  - `backup_packages`
  - `archive_exports`
- 导入流程固定为“导入为新账套”：
  - 读取备份包并校验 manifest、SQLite 载荷哈希、原件清单。
  - 新建账套并建立旧 ID 到新 ID 的映射。
  - 电子凭证原件复制到新账套目录并重写 `stored_path`。
  - 用户按 `username` 优先复用；不存在时创建“历史导入用户”桩账号，禁止自动授予账套权限。
- 历史整库快照保留为 legacy 记录：
  - 允许继续校验与删除。
  - 不再作为新建备份和账套导入的来源。
- 删除账套改为“强提示 + 显式确认”：
  - `ledgerCompliance` 提供风险快照，不再抛错阻断。
  - 删除弹窗展示“缺少已校验账套备份”“缺少已校验电子档案归档”的风险提示。
  - 后端删除接口要求显式确认标记，并将风险快照写入操作日志。

## 4. 涉及模块

- `src/main/services`
- `src/main/ipc`
- `src/preload`
- `src/renderer/src/pages`
- `src/main/database`
- `AGENTS.md`
- `prds/PROJECT_SPEC.md`
- `prds/prd.md`
- `prds/合规整改计划.md`
- `docs/tasks.md`
- `PROGRESS.md`
- `docs/context/latest_context.md`

## 5. 数据结构变更

- `backup_packages` 新增区分字段，用于标识 `ledger_backup` 与 `system_db_snapshot_legacy`。
- 账套级备份 manifest 升级为新版本，记录：
  - 包类型
  - 账套元数据
  - SQLite 载荷路径/哈希/大小
  - 原件清单
  - 导出表范围
- 不新增新的业务全局表；账套级导入优先复用现有账套相关表结构。

## 6. 接口变更

- `backup:create`：从“整库快照”改为“账套级备份包生成”。
- 新增 `backup:import`：支持从备份记录或路径导入为新账套。
- `backup:restore`：退出主流程，不再暴露为新 UI 入口。
- 新增账套删除预检接口，用于返回风险快照。
- `ledger:delete`：从单个 `ledgerId` 入参改为对象载荷，包含显式风险确认标记。

## 7. 风险评估

- 最大风险在于账套导入时的外键重映射与电子凭证原件搬迁。
- 次级风险在于 legacy 整库快照与新账套包共存期间的 UI 语义混淆。
- 删除账套从硬阻断改为强提示后，必须把风险快照和确认信息写入操作日志，避免静默放行。

## 8. 回退方案

- 保留 legacy 整库快照的校验/删除分支，直到新账套包与导入链路验证稳定。
- 若导入链路验证失败，可回退为“仅上线账套级备份包生成/校验”，暂不开放导入入口。
- 删除账套软提示改造可与备份导入链路独立回退。

## 9. 任务拆解

### [ ] 文档与任务面先同步

- 类型：Docs
- 模块：docs / prds
- 描述：先修正 `AGENTS.md`、`PROJECT_SPEC.md`、`prd.md`、`合规整改计划.md` 与任务状态，消除与新方案冲突的约束。
- 依赖：无
- 风险：低
- 优先级：1

### [ ] 账套级备份包测试先行

- 类型：Test
- 模块：service / core
- 描述：为账套级备份包生成、附件清单、legacy 兼容校验先写失败测试。
- 依赖：文档与任务面先同步
- 风险：中
- 优先级：1

### [ ] 实现账套级备份包与元数据迁移

- 类型：Feature
- 模块：service / ipc / core
- 描述：替换整库快照创建逻辑，增加账套包与 legacy 元数据分流。
- 依赖：账套级备份包测试先行
- 风险：高
- 优先级：2

### [ ] 账套导入测试先行

- 类型：Test
- 模块：service / core
- 描述：为导入新账套、ID 映射、历史用户复用/补桩先写失败测试。
- 依赖：实现账套级备份包与元数据迁移
- 风险：高
- 优先级：2

### [ ] 实现账套导入与删除强提示

- 类型：Feature
- 模块：service / ipc / preload / ui
- 描述：新增账套导入入口，改造删除账套预检与确认流程。
- 依赖：账套导入测试先行
- 风险：高
- 优先级：2

### [ ] 完成回归验证与日志同步

- 类型：Test
- 模块：docs / test
- 描述：执行定向测试、`npm run typecheck`、`npm test`，同步开发日志、进度与上下文快照。
- 依赖：实现账套导入与删除强提示
- 风险：中
- 优先级：2
