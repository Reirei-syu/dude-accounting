# 打印设置扩展与账簿续页表头方案

## 1. 背景

- 当前打印预览页已支持纸张方向、缩放和紧凑模式，但设置项分散，无法系统处理“1 页放不下”的打印场景。
- 账簿打印预览在超过 1 页时，仅重复列表列头，未重复账簿名、科目/辅助科目、账套、期间、单位等页眉信息，导致第 2 页起可读性不足。
- 账簿 PDF 导出链路已在分页时重绘标题与表头，本轮应优先修复统一打印预览链路，避免两套实现继续分叉。

## 2. 目标

- 将打印预览统一升级为“纸张方向 + 缩放 + 页边距 + 内容密度 + 恢复默认”的设置栏，覆盖报表、账簿、凭证三类预览。
- 账簿打印预览按 `bookType` 记忆最近一次设置，存入 `user_preferences`。
- 账簿超过 1 页时，从第 2 页开始继续重复完整页眉与列表列头，保证脱离第一页也能读。

## 3. 设计方案

- `src/main/services/print.ts`
  - 新增 `PrintPreviewSettings`、页边距预设、内容密度预设。
  - 将账簿页眉移入 `thead`，通过重复表头实现跨页完整页眉续打。
  - 统一打印预览页脚本，使用同一设置栏驱动纸张方向、缩放、页边距与内容密度。
- `src/main/ipc/print.ts`
  - `PrintJobRecord` 增加 `bookType`。
  - 打开账簿打印预览时透传 `persistPreferenceKey=book_print_settings_<bookType>`。
  - 打印预览窗口继承当前调用者会话，使预览页可复用 `settings:getUserPreferences / settings:setUserPreferences`。
- `src/main/ipc/session.ts`
  - 新增面向 `webContents` 的会话绑定工具，供独立打印预览窗口继承登录态。
- `src/preload/index.d.ts`
  - 补齐 `print.print` / `print.exportPdf` 当前实际支持的 payload 类型声明。

## 4. 涉及模块

- `src/main/services/print.ts`
- `src/main/ipc/print.ts`
- `src/main/ipc/session.ts`
- `src/preload/index.d.ts`
- `src/main/services/print.test.ts`
- `src/main/services/bookExport.test.ts`
- `src/main/ipc/session.test.ts`

## 5. 数据结构变更

- 不新增表结构。
- 继续复用 `user_preferences`，新增动态键模式：
  - `book_print_settings_<bookType>`
- 值统一为 JSON：
  - `orientation`
  - `scalePercent`
  - `marginPreset`
  - `densityPreset`

## 6. 接口变更

- 不新增公开 IPC channel。
- 内部变更：
  - `PrintJobRecord.bookType?: string | null`
  - `buildPrintPreviewHtml(...)` 增加 `initialSettings` 与 `persistPreferenceKey`
  - `session.ts` 增加基于 sender/webContents 继承会话的工具函数

## 7. 风险评估

- 打印预览页改为在独立窗口读取和写入用户偏好，若会话未正确继承，会导致设置无法记忆。
- 账簿页眉移入 `thead` 后，需要确保布局在横向/竖向、辅助明细账双行页眉等场景下不发生错位。
- 设置栏同时作用于报表/账簿/凭证，必须确认旧有打印与导出不回退。

## 8. 回退方案

- 回退 `print.ts`、`ipc/print.ts`、`ipc/session.ts`、`preload/index.d.ts` 及对应测试文件。
- 重新执行：
  - `npm run typecheck`
  - `npx vitest run src/main/services/print.test.ts src/main/services/bookExport.test.ts`
  - `npm test`
  - `py -3 scripts/electron_breakpoint_audit.py`

## 9. 任务拆解

- 任务 1：补失败测试，覆盖统一设置栏、账簿完整续页页眉、账簿设置持久化默认值。
- 任务 2：实现 `print.ts` 的统一设置栏与账簿 `thead` 重复页眉。
- 任务 3：实现打印预览窗口会话继承与 `bookType` 偏好键透传。
- 任务 4：补 `bookExport` 多页 PDF 回归测试，确保现有导出分页链路未被破坏。
- 任务 5：执行 `typecheck`、定向 vitest、全量 `npm test` 与真实 Electron 复验。
