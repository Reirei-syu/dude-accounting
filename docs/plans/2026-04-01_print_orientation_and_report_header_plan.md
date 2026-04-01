# 打印方向与报表表头收敛方案

## 1. 背景
- 2026-03-28 的断链修复后，打印预览已支持缩放与紧凑模式，但还未支持用户切换横向/竖向排版。
- 用户新增约束要求：财务报表表头仅保留“编制单位、会计期间、单位”，不再显示取数范围与口径；并确保 A4 状态下表头不换行。

## 2. 目标
- 所有打印预览模式支持纸张横向/竖向切换。
- 财务报表的打印预览与导出 HTML 头部只保留三项信息，并避免换行。

## 3. 设计方案
- `print.ts`：
  - 在预览工具栏新增“纸张方向”选择。
  - 预览页在前端实时切换 `orientation-portrait / orientation-landscape`。
  - 打印与 PDF 导出通过 `print.print / print.exportPdf` 传入方向覆盖。
- `ipc/print.ts`、`preload/index.ts`：
  - `print.print` / `print.exportPdf` 支持接收 `{ jobId, orientation }`。
- `reportSnapshotOutput.ts`：
  - 报表导出 HTML 的 meta 区改为三列固定布局，启用 `white-space: nowrap` 与省略。
- `ipc/print.ts`：
  - 报表打印预览的 `getReportSegment` 不再写入取数范围与口径元信息。

## 4. 涉及模块
- `src/main/services/print.ts`
- `src/main/ipc/print.ts`
- `src/preload/index.ts`
- `src/main/services/reportSnapshotOutput.ts`
- 对应单测文件

## 5. 风险评估
- 纸张方向切换会影响预览尺寸和实际打印参数，必须通过真实 Electron 复验。
- 表头不换行依赖 grid 布局和文本省略，需要确保长账套名不会把中间“会计期间”挤掉。

## 6. 回退方案
- 回退上述四个模块和单测。
- 重新执行真实 Electron 审计确认恢复到旧行为。

## 7. 任务拆解
- 任务 1：实现打印预览方向选择与方向参数透传。
- 任务 2：收紧报表打印/导出表头信息。
- 任务 3：补测试并做真实 Electron 复验。
