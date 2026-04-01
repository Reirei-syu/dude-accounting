# Electron 断链问题修复方案

## 1. 背景
- 2026-03-28 的真实 Electron 链路审计确认了 4 个高优先级问题：账簿打印无恢复控件、报表查询渲染风暴、科目余额表全屏查看无打印桥接、报表默认口径提示缺失。
- 这些问题横跨 renderer 页面、打印预览 HTML 以及页面状态同步逻辑，需要统一修复并复验。

## 2. 目标
- 修复 `PRINT-001`、`BOOK-001`、`REPORT-001`、`REPORT-002`。
- 保持现有 IPC 协议不扩口。
- 修复后重新执行真实 Electron 链路审计，目标为 `findings = 0`。

## 3. 设计方案
- `ReportQuery.tsx`：
  - 将 `filteredRows`、`filterOptions` 改为稳定 memo。
  - 为勾选态同步补“仅在结果变化时 setState”的守卫，消除渲染风暴。
- `ReportWorkspacePage.tsx`：
  - 在报表生成区显式提示“默认仅统计已记账凭证”。
  - 生成成功文案在默认口径下追加解释，降低“保存成功但报表无变化”的误判。
- `SubjectBalance.tsx`：
  - 在全屏查看弹层内增加“打印预览”桥接按钮。
  - 补充全屏查看用途说明与无障碍描述。
- `print.ts`：
  - 在打印预览工具栏新增缩放选择与紧凑模式切换。
  - 将溢出提示文案改为引导用户调整缩放/紧凑模式，不再只给死提示。
  - 预览页通过 CSS 变量控制缩放与紧凑模式，让用户在预览态即可恢复流程。
- 测试：
  - 扩展 `reportingQueryUtils.test.ts` 与 `print.test.ts`。
  - 重新执行真实 Electron 审计脚本。

## 4. 涉及模块
- `src/renderer/src/pages/ReportQuery.tsx`
- `src/renderer/src/pages/reportingQueryUtils.ts`
- `src/renderer/src/pages/ReportWorkspacePage.tsx`
- `src/renderer/src/pages/SubjectBalance.tsx`
- `src/main/services/print.ts`
- `src/main/services/print.test.ts`

## 5. 数据结构变更
- 无。

## 6. 接口变更
- 无新增 IPC。
- 打印预览页新增前端工具栏控件，但复用既有 `print:*` 通道。

## 7. 风险评估
- 打印预览缩放依赖 Chromium 的 `zoom` 行为，需要通过真实 Electron 复验。
- 报表查询勾选态改为带守卫同步，需要确保不影响批量导出与批量删除。

## 8. 回退方案
- 回退上述 renderer/service 改动。
- 回退新增单测。
- 回退后重新执行审计脚本确认问题复现。

## 9. 任务拆解
- 任务 1：修复报表查询渲染风暴。
- 任务 2：修复报表默认口径提示缺失。
- 任务 3：修复科目余额表全屏查看打印桥接。
- 任务 4：修复打印预览恢复控件缺失。
- 任务 5：执行 typecheck、测试与真实 Electron 复验。
