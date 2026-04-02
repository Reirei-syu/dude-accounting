# 项目进度

## 当前阶段
- Execution

## 本次修改
- 已完成：打印预览主链路切换为 page model 驱动，`PrintJobRecord` 现保存 `sourceDocument + layoutResult + layoutVersion`，预览页按显式页列表渲染，不再依赖预览窗口内的 DOM 临时拆页结果。
- 已完成：新增 `print:getPreviewModel` 与 `print:updatePreviewSettings`，预览设置改为由主进程重排并在账簿场景下回写 `book_print_settings_<bookType>`，预览窗口不再直接读写用户偏好。
- 已完成：补充打印分页模型、预览壳子与 IPC 偏好逻辑测试，并尝试扩展真实 Electron 审计脚本以断言多页页数与第 2 页页眉。
- 已完成：账簿打印预览新增自动分页，长表不再因段落超出单页高度被统一拦截；分页后每页继续沿用完整账簿页眉与列头。
- 已完成：将应用版本号继续递增至 `1.0.10`，同步更新 `package.json` 与 `package-lock.json`，保证超长账簿自动分页修复与安装包版本一致。
- 已完成：执行 Windows 安装包构建脚本，生成 `D:\coding\completed\dude-app\dude-app-1.0.10-setup.exe` 与 `dude-app-latest-setup.exe` 别名。
- 已完成：统一打印预览设置栏，补齐纸张方向、缩放比例、页边距预设、内容密度预设与“恢复默认”，报表/账簿/凭证三类打印预览统一共用同一套工具栏。
- 已完成：账簿打印预览支持按 `bookType` 记住最近一次设置，并通过预览窗口继承登录态复用 `user_preferences`，不新增公开 IPC。
- 已完成：账簿打印预览在超过 1 页时改为从 `thead` 重复完整页眉，确保第 2 页开始继续展示账簿名、科目/辅助科目、编制单位、会计期间、单位与列头。
- 已完成：放宽账套备份期间限制，即使没有已结账期间和可归档年度，仍可对账套执行备份；归档年度规则保持不变。
- 已完成：账套级备份与删除强提示重构，备份主流程已从整库快照切换为账套级备份包，支持导入为新账套，并把删除账套前的备份/归档硬阻断改为强提示与显式确认。
- 已完成：落地 Electron 真实用户链路断链测试计划，新增自动化审计脚本并在当前开发库上执行企业/民非账套链路走查。
- 已完成：修复审计发现的 4 个高优先级问题，并重新执行真实 Electron 复验，最新审计 `findings = 0`。
- 已完成：为所有打印预览模式补纸张方向选择，并将财务报表表头收敛为“编制单位、会计期间、单位”且避免 A4 换行。

## 影响范围
- `docs/plans/2026-04-02_print_preview_rearchitecture_plan.md`
- `src/main/services/printLayout.ts`
- `src/main/services/printMeasurement.ts`
- `src/main/services/printPreviewShell.ts`
- `src/main/services/printLayout.test.ts`
- `src/main/services/printPreviewShell.test.ts`
- `src/main/ipc/print.test.ts`
- `AGENTS.md`
- `docs/plans/2026-04-02_ledger_backup_refactor_plan.md`
- `package.json`
- `scripts/electron_breakpoint_audit.py`
- `docs/plans/2026-03-28_electron_breakpoint_test_plan.md`
- `docs/plans/2026-03-28_electron_breakpoint_fix_plan.md`
- `docs/plans/2026-04-01_print_orientation_and_report_header_plan.md`
- `docs/plans/2026-04-02_print_settings_repeat_book_header_plan.md`
- `docs/2026-03-28_electron_breakpoint_audit.md`
- `docs/tasks.md`
- `docs/context/latest_context.md`
- `prds/开发日志.md`
- `package.json`
- `package-lock.json`
- `prds/PROJECT_SPEC.md`
- `prds/prd.md`
- `src/renderer/src/pages/ReportQuery.tsx`
- `src/renderer/src/pages/reportingQueryUtils.ts`
- `src/renderer/src/pages/reportingQueryUtils.test.ts`
- `src/renderer/src/pages/ReportWorkspacePage.tsx`
- `src/renderer/src/pages/SubjectBalance.tsx`
- `src/main/services/print.ts`
- `src/main/services/print.test.ts`
- `src/main/services/bookExport.test.ts`
- `src/main/ipc/print.ts`
- `src/main/ipc/session.ts`
- `src/main/ipc/session.test.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`
- `src/main/services/reportSnapshotOutput.ts`
- `src/main/services/reportSnapshotOutput.test.ts`

## 任务进度
- 已完成：打印预览可信多页重构
- 已完成：账套级备份与删除强提示重构
- 已完成：Electron 真实链路断链测试文档与脚本落盘
- 已完成：Electron 自动化连接与测试数据准备
- 已完成：企业账套主链路与打印专项走查
- 已完成：民非账套 smoke 与断链报告输出
- 已完成：审计问题修复与复验
- 已完成：打印设置扩展与账簿续页表头
- 已完成：账簿预览自动分页与超长账簿修复
- 已完成：版本递增与 Windows 安装包构建
- 待处理：清理断链测试账套

## 验证结果
- `npm run typecheck`：通过
- `npx vitest run src/main/services/printPreviewShell.test.ts src/main/services/printLayout.test.ts src/main/ipc/print.test.ts src/main/services/print.test.ts src/main/services/bookExport.test.ts src/main/services/reportSnapshotOutput.test.ts`：通过（29/29）
- `npm test`：通过（72 个文件，345 个测试）
- `py -3 scripts/electron_breakpoint_audit.py`：未通过；主进程 `[print] prepare:*` 日志显示打印任务已快速 `ready`，但当前 Playwright 审计脚本仍在识别独立预览窗口时超时，需要单独继续修复审计脚本的窗口识别逻辑。
- `npm run typecheck`：通过
- `npx vitest run src/main/services/print.test.ts src/main/services/bookExport.test.ts`：通过（16/16）
- `npm test`：通过（69 个文件，337 个测试）
- `py -3 scripts/electron_breakpoint_audit.py`：通过，最新产物位于 `out/electron-breakpoint-audit/20260402-161335`
- `py -3 scripts/electron_breakpoint_audit.py`：通过，最新产物位于 `out/electron-breakpoint-audit/20260402-170312`
- `powershell -ExecutionPolicy Bypass -File scripts/build-win-installer.ps1`：通过，生成 `D:\coding\completed\dude-app\dude-app-1.0.10-setup.exe`
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
- `docs/plans/2026-04-02_print_settings_repeat_book_header_plan.md`

## 风险备注
- 当前默认启用的是“主进程估算分页 + page model 渲染”，隐藏 Chromium 实测分页代码已保留但未作为默认路径启用；若后续要切回实测分页，需要先解决隐藏测量窗口稳定性与自动化识别问题。
- 真实 Electron 审计脚本已扩展页数与第 2 页页眉断言，但独立预览窗口仍存在自动化识别超时，当前只能把该问题标记为验证脚本残余风险，不能据此宣称真实链路复验已完全通过。
- 已落地的新导入链路依赖 Node 内置 `node:sqlite` 操作备份载荷，运行时会出现实验特性告警，但不影响当前测试通过与功能使用。
- 账套级导入仍属于高风险数据链路，后续若扩展“覆盖导入已有账套”，必须单独立方案并补更严格回退验证。
- 打印预览窗口当前通过继承调用者登录态来复用 `settings:getUserPreferences / settings:setUserPreferences`；后续若继续把独立窗口扩展为更多业务入口，需要同步评估权限边界与 CSP 风险。
- 构建产物体积较大（当前 setup 约 396MB），后续如需缩减分发成本，应单独规划安装包瘦身，不在本轮顺手处理。

## Lessons Learned
- 打印预览重构时，先把分页结果提升为主进程显式模型，比继续在预览页里堆 DOM 修补更容易验证和回退。
- 隐藏窗口里的 Chromium 布局测量并不天然稳定，尤其在 Electron + CDP 自动化场景下，必须预留可回退的估算分页路径，否则打印任务会卡在 `preparing`。
- 真实 Electron 审计脚本识别独立预览窗口时，不能只依赖“新页面事件”，还要考虑 `data:` URL、独立 BrowserWindow 与 CDP 上下文枚举行为差异。
- 高风险流程一旦改变主语义，必须先修正文档和任务面，否则实现过程会持续与最高优先级规则冲突。
- 对账套级备份包的附件校验不能盲信源库 `sha256` 字段，打包时必须以实际复制后的附件实体重新计算摘要。
- 账套级备份的业务价值不应依附于“已结账”前提；会计科目、辅助项与期初余额这类基础资料同样需要在未结账阶段可被备份。
- 打印预览这类独立窗口如果要读写用户偏好，不能只看 preload 是否暴露了 API，还必须确认该窗口本身是否继承了可用会话；否则行为会在真实 Electron 下静默失效。
## 2026-04-02 Review Fix
- 当前阶段：Execution
- 当前任务：修复账套备份导入遗漏 `periods.closed_at` 与 `operation_logs.reason/approval_tag` 的回归问题。
- 本次修改：
  - `src/main/services/backupRecovery.ts` 导入 periods 时补回 `closed_at`。
  - `src/main/services/backupRecovery.ts` 导入 operation logs 时补回 `reason`、`approval_tag`。
  - `src/main/services/ledgerBackupImport.test.ts` 补充期间关闭时间与审批留痕保留断言。
- 影响范围：账套备份包导入后的期间状态展示、操作日志查询与导出留痕。
- 任务进度百分比：100%
- 方案路径：`docs/plans/2026-04-02_ledger_backup_refactor_plan.md`
- 验证结果：
  - `npx vitest run src/main/services/ledgerBackupImport.test.ts`：通过
  - `npx vitest run src/main/services/backupRecovery.test.ts`：通过
  - `npm run typecheck`：通过
  - `npm test`：通过（69 个文件，334 个测试）
- 风险备注：本次仅补回已在生产 schema 与既有查询链路中使用的字段，未扩展导入范围，也未触碰 UI / IPC 契约。
- Lessons Learned：
  - 账套级导入不能只验证“记录数量还在”，还要验证合规字段与状态字段的保真。
  - 导入测试 fixture 若简化过头，会把真实 schema 上的静默丢字段问题掩盖掉；后续此类测试应优先贴近生产表结构。

## 2026-04-02 Residual Risk Fix
- 当前阶段：Execution
- 当前任务：修复打印预览残余风险，收敛“真实 Electron 无法稳定证明多页账簿预览可信”的最后一处自动化阻塞。
- 本次修改：
  - `src/main/ipc/print.ts` 新增测量结果校验与回退收口，测量页如果丢行、空分页或顺序错乱，自动退回 `estimateTableRowGroups(...)`。
  - `src/main/ipc/print.ts` 修复隐藏测量宿主，克隆测量页时继承 `preview-canvas orientation-*` 类名，保证 A4 宽高约束真实生效。
  - `scripts/electron_breakpoint_audit.py` 修复 `boundaryPrint` 汇总覆盖问题，保留 `multiPageModel` 审计结果。
  - `src/main/ipc/print.test.ts` 补充分页测量回退回归测试。
- 影响范围：账簿多页分页稳定性、打印预览可信度、真实 Electron 审计脚本。
- 任务进度百分比：100%
- 方案路径：`docs/plans/2026-04-02_print_preview_rearchitecture_plan.md`
- 验证结果：
  - `npx vitest run src/main/ipc/print.test.ts`：通过（6/6）
  - `npm run typecheck`：通过
  - `npm test`：通过（72 个文件，347 个测试）
  - `py -3 scripts/electron_breakpoint_audit.py`：通过，最新产物位于 `out/electron-breakpoint-audit/20260402-213326`
- 风险备注：
  - 账簿多页预览的最新真实审计结果已收敛：`multiPagePreview.pageCount = 7`、`multiPageModel.pageCount = 7`、`errors = []`。
  - 当前与打印链路直接相关的残余风险已解除；项目级剩余待办仍是“清理自动测试账套”。
- Lessons Learned：
  - 只给测量逻辑加 fallback 不够，必须先验证测量结果是否覆盖全部行，否则“看起来成功”的空分页会污染主链路。
  - 真实 Chromium 布局测量时，克隆节点所在宿主如果丢失版式约束类名，分页算法会在错误尺寸上得出错误但稳定的结果。
  - 审计脚本写汇总时要避免“先写局部字段，再整体覆盖对象”的模式，否则很容易把关键诊断结果静默抹掉。
