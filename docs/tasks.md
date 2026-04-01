# 项目任务列表

## 当前阶段
- Execution

## 任务列表

### [x] Electron 真实链路断链测试文档与脚本落盘
- 类型：开发
- 模块：docs / scripts
- 描述：新增断链审计计划文档、自动化脚本入口与任务清单，为真实 Electron 走查提供统一执行骨架。
- 完成时间：2026-03-28
- 修改文件：`docs/plans/2026-03-28_electron_breakpoint_test_plan.md`、`docs/tasks.md`、`package.json`、`scripts/electron_breakpoint_audit.py`
- 影响范围：测试计划落盘、自动化执行入口、任务跟踪

### [x] Electron 自动化连接与测试数据准备
- 类型：验证
- 模块：ui / service / core
- 描述：安装 Python Playwright，连接真实 Electron，登录 admin 并写入企业/民非测试账套、企业长文本测试科目与测试凭证。
- 完成时间：2026-03-28
- 修改文件：`scripts/electron_breakpoint_audit.py`
- 影响范围：当前开发库 `%APPDATA%\\dude-app-dev\\dude-accounting.db` 中新增 `自动测试-*` 账套、凭证与报表快照

### [x] 企业账套主链路与打印专项走查
- 类型：验证
- 模块：ui / service / core
- 描述：完成科目余额表打印链路、凭证保存到利润表反映链路、报表导出链路走查，并输出企业账套断链问题。
- 完成时间：2026-03-28
- 修改文件：`scripts/electron_breakpoint_audit.py`、`docs/2026-03-28_electron_breakpoint_audit.md`
- 影响范围：账簿打印、报表口径提示、报表查询状态管理、导出验证

### [x] 民非账套 smoke 与断链报告输出
- 类型：验证
- 模块：ui / docs
- 描述：完成民非账套账簿与报表 smoke，并输出断链总览、问题卡、测试用例、Top 5 与系统性总结。
- 完成时间：2026-03-28
- 修改文件：`docs/2026-03-28_electron_breakpoint_audit.md`、`scripts/electron_breakpoint_audit.py`
- 影响范围：民非账套基础回归、断链审计结论落盘

### [x] 审计问题修复与复验
- 类型：开发
- 模块：ui / service / docs
- 描述：修复审计发现的 4 个高优先级问题，并重新执行真实 Electron 链路复验，确认 `findings = 0`。
- 完成时间：2026-03-28
- 修改文件：`docs/plans/2026-03-28_electron_breakpoint_fix_plan.md`、`src/renderer/src/pages/ReportQuery.tsx`、`src/renderer/src/pages/reportingQueryUtils.ts`、`src/renderer/src/pages/reportingQueryUtils.test.ts`、`src/renderer/src/pages/ReportWorkspacePage.tsx`、`src/renderer/src/pages/SubjectBalance.tsx`、`src/main/services/print.ts`、`src/main/services/print.test.ts`、`docs/2026-03-28_electron_breakpoint_audit.md`
- 影响范围：报表查询状态管理、账簿/报表打印预览、报表默认口径提示、全屏查看打印桥接

### [x] 打印方向与报表表头收敛
- 类型：开发
- 模块：ui / service / preload / docs
- 描述：为所有打印预览模式补横向/竖向排版选择，并将财务报表表头收敛为“编制单位、会计期间、单位”三项且避免 A4 下换行。
- 完成时间：2026-04-01
- 修改文件：`docs/plans/2026-04-01_print_orientation_and_report_header_plan.md`、`src/main/services/print.ts`、`src/main/ipc/print.ts`、`src/preload/index.ts`、`src/main/services/reportSnapshotOutput.ts`、`src/main/services/print.test.ts`、`src/main/services/reportSnapshotOutput.test.ts`
- 影响范围：所有打印预览模式、报表打印预览、报表 HTML/PDF 导出头部布局

### [ ] 清理断链测试账套
- 类型：运维
- 模块：ui / docs
- 描述：清理本次调试与正式审计过程中留在当前开发库中的多组 `自动测试-*` 账套，必要时先备份再删除。
- 依赖：无
- 风险：账套删除前必须先做备份/归档校验，不能直接清库

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
