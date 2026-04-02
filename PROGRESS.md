# 项目进度

## 当前阶段
- Execution

## 本次修改
- 已完成：放宽账套备份期间限制，即使没有已结账期间和可归档年度，仍可对账套执行备份；归档年度规则保持不变。
- 已完成：账套级备份与删除强提示重构，备份主流程已从整库快照切换为账套级备份包，支持导入为新账套，并把删除账套前的备份/归档硬阻断改为强提示与显式确认。
- 已完成：落地 Electron 真实用户链路断链测试计划，新增自动化审计脚本并在当前开发库上执行企业/民非账套链路走查。
- 已完成：修复审计发现的 4 个高优先级问题，并重新执行真实 Electron 复验，最新审计 `findings = 0`。
- 已完成：为所有打印预览模式补纸张方向选择，并将财务报表表头收敛为“编制单位、会计期间、单位”且避免 A4 换行。

## 影响范围
- `AGENTS.md`
- `docs/plans/2026-04-02_ledger_backup_refactor_plan.md`
- `package.json`
- `scripts/electron_breakpoint_audit.py`
- `docs/plans/2026-03-28_electron_breakpoint_test_plan.md`
- `docs/plans/2026-03-28_electron_breakpoint_fix_plan.md`
- `docs/plans/2026-04-01_print_orientation_and_report_header_plan.md`
- `docs/2026-03-28_electron_breakpoint_audit.md`
- `docs/tasks.md`
- `docs/context/latest_context.md`
- `prds/开发日志.md`
- `src/renderer/src/pages/ReportQuery.tsx`
- `src/renderer/src/pages/reportingQueryUtils.ts`
- `src/renderer/src/pages/reportingQueryUtils.test.ts`
- `src/renderer/src/pages/ReportWorkspacePage.tsx`
- `src/renderer/src/pages/SubjectBalance.tsx`
- `src/main/services/print.ts`
- `src/main/services/print.test.ts`
- `src/main/ipc/print.ts`
- `src/preload/index.ts`
- `src/main/services/reportSnapshotOutput.ts`
- `src/main/services/reportSnapshotOutput.test.ts`

## 任务进度
- 已完成：账套级备份与删除强提示重构
- 已完成：Electron 真实链路断链测试文档与脚本落盘
- 已完成：Electron 自动化连接与测试数据准备
- 已完成：企业账套主链路与打印专项走查
- 已完成：民非账套 smoke 与断链报告输出
- 已完成：审计问题修复与复验
- 待处理：清理断链测试账套

## 验证结果
- `npx vitest run src/renderer/src/pages/backupSelection.test.ts`：通过（4/4）
- `npx vitest run src/main/services/backupRecovery.test.ts src/main/services/backupCatalog.test.ts src/main/services/ledgerBackupImport.test.ts src/main/services/ledgerCompliance.test.ts`：通过（12/12）
- `npm run typecheck`：通过
- `npm test`：通过（69 个文件，334 个测试）
- `py -3 -m py_compile scripts/electron_breakpoint_audit.py`：通过
- `py -3 -m pip install --user playwright`：通过
- `py -3 -m playwright install chromium`：通过
- `npm run typecheck`：通过
- `npx vitest run src/main/services/print.test.ts src/renderer/src/pages/reportingQueryUtils.test.ts`：通过（13/13）
- `npm test`：通过（68 个文件，330 个测试）
- `py -3 scripts/electron_breakpoint_audit.py`：通过，最新产物位于 `out/electron-breakpoint-audit/20260328-165328`
- `npx vitest run src/main/services/print.test.ts src/main/services/reportSnapshotOutput.test.ts src/renderer/src/pages/reportingQueryUtils.test.ts`：通过（18/18）
- `py -3 scripts/electron_breakpoint_audit.py`：通过，最新产物位于 `out/electron-breakpoint-audit/20260401-111430`

## 方案路径
- `docs/plans/2026-04-02_ledger_backup_refactor_plan.md`
- `docs/plans/2026-03-28_electron_breakpoint_test_plan.md`
- `docs/plans/2026-03-28_electron_breakpoint_fix_plan.md`
- `docs/plans/2026-04-01_print_orientation_and_report_header_plan.md`

## 风险备注
- 已落地的新导入链路依赖 Node 内置 `node:sqlite` 操作备份载荷，运行时会出现实验特性告警，但不影响当前测试通过与功能使用。
- 账套级导入仍属于高风险数据链路，后续若扩展“覆盖导入已有账套”，必须单独立方案并补更严格回退验证。

## Lessons Learned
- 高风险流程一旦改变主语义，必须先修正文档和任务面，否则实现过程会持续与最高优先级规则冲突。
- 对账套级备份包的附件校验不能盲信源库 `sha256` 字段，打包时必须以实际复制后的附件实体重新计算摘要。
- 账套级备份的业务价值不应依附于“已结账”前提；会计科目、辅助项与期初余额这类基础资料同样需要在未结账阶段可被备份。
