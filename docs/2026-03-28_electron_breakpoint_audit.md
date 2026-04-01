# Electron 真实用户链路修复与复验结果

## 本轮结论
- 已完成 4 个审计问题的代码修复：`PRINT-001`、`BOOK-001`、`REPORT-001`、`REPORT-002`。
- 修复后重新执行真实 Electron 审计脚本，最新产物目录为 `out/electron-breakpoint-audit/20260328-165328`。
- 复验结果：`summary.json` 中 `findings = 0`，企业账套与民非账套核心链路均跑通。

## 修复项与落点

### 1. 报表查询渲染风暴
- 修复文件：
  - `[ReportQuery.tsx](D:/coding/dude accounting/dude-app/src/renderer/src/pages/ReportQuery.tsx)`
  - `[reportingQueryUtils.ts](D:/coding/dude accounting/dude-app/src/renderer/src/pages/reportingQueryUtils.ts)`
  - `[reportingQueryUtils.test.ts](D:/coding/dude accounting/dude-app/src/renderer/src/pages/reportingQueryUtils.test.ts)`
- 修复内容：
  - 将 `filteredRows`、`filterOptions` 稳定 memo 化。
  - 为 `selectedSnapshotIds` 清理逻辑增加“数组值未变化时不 setState”守卫。
- 复验结果：
  - 最新复验未再产出 `REPORT-002`。

### 2. 报表默认口径提示缺失
- 修复文件：
  - `[ReportWorkspacePage.tsx](D:/coding/dude accounting/dude-app/src/renderer/src/pages/ReportWorkspacePage.tsx)`
- 修复内容：
  - 在报表生成区域新增显式提示：默认仅统计已记账凭证。
  - 默认口径下的成功文案追加解释，明确引导用户勾选“未记账凭证”或先去记账。
- 复验结果：
  - 最新复验里，未记账口径不再被脚本判定为断链。

### 3. 科目余额表全屏查看无打印桥接
- 修复文件：
  - `[SubjectBalance.tsx](D:/coding/dude accounting/dude-app/src/renderer/src/pages/SubjectBalance.tsx)`
- 修复内容：
  - 在全屏查看弹层中新增“打印预览”按钮。
  - 补充全屏查看说明文案和 `Dialog.Description`，同时收掉无障碍 warning。
- 复验结果：
  - 最新复验未再产出 `BOOK-001`。

### 4. 打印预览无恢复控件
- 修复文件：
  - `[print.ts](D:/coding/dude accounting/dude-app/src/main/services/print.ts)`
  - `[print.test.ts](D:/coding/dude accounting/dude-app/src/main/services/print.test.ts)`
- 修复内容：
  - 在预览工具栏中新增缩放选择。
  - 新增“紧凑模式”切换。
  - 将溢出提示改成“请调整缩放、紧凑模式或内容后重试”，给用户明确恢复路径。
- 复验结果：
  - 最新复验中边界打印仍可能在默认 100% 下触发溢出提示，但预览页已经具备恢复控件，脚本不再把它判定成断链。

## 复验摘要
- 实际运行：
  - `npm run typecheck`
  - `npx vitest run src/main/services/print.test.ts src/renderer/src/pages/reportingQueryUtils.test.ts`
  - `py -3 scripts/electron_breakpoint_audit.py`
- 最新审计结果：
  - 企业账套：UI 登录、UI 建账套、UI 保存凭证、UI 批量审核/记账、科目余额表查询/打印预览、利润表生成、导出、批量导出通过。
  - 民非账套：科目余额表、业务活动表、现金流量表 smoke 通过。
  - 审计脚本输出：`findings = 0`。

## 仍需注意
- 当前开发库里累计保留了多轮调试产生的 `自动测试-*` 账套，清理任务已单独保留在 `docs/tasks.md` 中，尚未执行。
