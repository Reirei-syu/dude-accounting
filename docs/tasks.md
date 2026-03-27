# 项目任务列表

## 当前阶段
- Execution

## 任务列表

### [x] 安装升级数据路径保护
- 类型：修复
- 模块：core / service
- 描述：将打包版数据库与默认日志路径从安装目录切回稳定的 userData，并兼容从旧安装目录自动迁移数据库。
- 完成时间：2026-03-27
- 修改文件：`src/main/services/runtimeDatabasePath.ts`、`src/main/services/runtimeDatabasePath.test.ts`、`src/main/services/diagnosticsLogPath.ts`、`src/main/services/diagnosticsLogPath.test.ts`
- 影响范围：打包版主数据库路径、旧安装目录数据库迁移、默认日志路径

### [x] 安装器文案与升级验证
- 类型：修复
- 模块：config / docs
- 描述：移除安装器中“数据库写入安装目录”的错误前提，补齐规范文档、验证与重新打包。
- 完成时间：2026-03-27
- 修改文件：`build/installer.nsh`、`docs/plans/2026-03-27_runtime_data_path_protection_plan.md`、`AGENTS.md`、`prds/PROJECT_SPEC.md`、`prds/prd.md`、`prds/开发日志.md`
- 影响范围：安装器提示文案、运行规范文档、升级验证记录

### [x] 会计科目现金流量父子继承规则
- 类型：开发
- 模块：service / core
- 描述：在会计科目创建与编辑流程中，强制执行“上级科目为现金流量科目时，下级科目必须为现金流量科目”，并在父级被设置为现金流量科目时向下级联同步。
- 完成时间：2026-03-27
- 修改文件：`src/main/services/accountSetup.ts`、`src/main/services/accountSetup.test.ts`
- 影响范围：科目新增、科目编辑、父子级现金流量标记同步

### [x] 科目列表现金流量状态展示
- 类型：开发
- 模块：ui
- 描述：在科目列表新增“现金流量”列，对现金流量科目显示“是”，并在表单中对受父级约束的科目禁用取消操作。
- 完成时间：2026-03-27
- 修改文件：`src/renderer/src/pages/SubjectSettings.tsx`
- 影响范围：科目列表展示、上级科目选择交互、现金流量复选框约束

### [x] 文档与验证同步
- 类型：验证
- 模块：docs / prds
- 描述：补充计划、更新开发日志、进度与上下文快照，并执行类型检查与测试。
- 完成时间：2026-03-27
- 修改文件：`docs/plans/2026-03-27_subject_cashflow_flag_plan.md`、`docs/context/latest_context.md`、`PROGRESS.md`、`prds/PROJECT_SPEC.md`、`prds/开发日志.md`
- 影响范围：任务跟踪、上下文恢复、模块规则文档、验证记录

## 状态

- [ ] 未完成
- [x] 已完成
- [-] 已废弃
