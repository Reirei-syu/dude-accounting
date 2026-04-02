# 打印预览可信多页重构方案

## 1. 背景

- 现有 Electron 打印预览把分页逻辑埋在预览页脚本里，依赖 DOM 运行时测量与节点重写，分页结果不是显式数据模型。
- 账簿、报表、凭证三类打印链路虽然共用统一预览工具栏，但没有共用同一套分页结果结构。
- 最终打印与 PDF 导出依赖预览窗口当前 DOM，导致设置调整、预览展示与最终输出之间缺少可验证的一致性边界。

## 2. 目标

- 应用内预览显式展示多页 page model，不再依赖长 HTML 的隐式浏览器分页。
- 每页显式携带完整页眉、列头和页内截断边界。
- 保持纸张方向、缩放、页边距、内容密度与 `book_print_settings_<bookType>` 偏好能力不回退。
- 保持 `print:prepare -> getJobStatus -> openPreview -> print/exportPdf -> dispose` 主流程不变，但让 job 以分页结果为事实来源。

## 3. 设计方案

- 采用“内容模型 -> 分页结果 -> 预览渲染”的三段式结构。
- `PrintDocument` 继续作为打印源内容模型，承载标题、元信息、列定义、行定义与凭证版式。
- 新增 `PrintLayoutResult / PrintPageModel / PrintLayoutDiagnostics`，显式描述页数、每页 HTML、首末行 key 与分页诊断。
- 主进程在 `print:prepare` 阶段先构造 `PrintDocument`，再计算 `PrintLayoutResult`，预览页只负责渲染 page model。
- 账簿/报表当前默认使用主进程估算分页，隐藏 Chromium 测量页代码保留但不作为默认路径；凭证按单张/双联语义直接生成页模型。
- 预览页改为 `print:updatePreviewSettings` 驱动重排，不再由预览窗口直接读写 `settings:getUserPreferences / settings:setUserPreferences`。

## 4. 涉及模块

- `src/main/services/print.ts`
- `src/main/services/printLayout.ts`
- `src/main/services/printMeasurement.ts`
- `src/main/services/printPreviewShell.ts`
- `src/main/ipc/print.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`
- `scripts/electron_breakpoint_audit.py`

## 5. 数据结构变更

- 不新增数据库表。
- 继续复用 `user_preferences` 的 `book_print_settings_<bookType>`。
- 新增内存模型：
  - `PrintPageModel`
  - `PrintLayoutDiagnostics`
  - `PrintLayoutResult`
  - `PrintPreviewModel`
- `PrintJobRecord` 从“仅保存 `html`”改为保存：
  - `settings`
  - `sourceDocument`
  - `layoutResult`
  - `layoutVersion`

## 6. 接口变更

- 保留：
  - `print:prepare`
  - `print:getJobStatus`
  - `print:openPreview`
  - `print:print`
  - `print:exportPdf`
  - `print:dispose`
- 新增：
  - `print:getPreviewModel`
  - `print:updatePreviewSettings`
- 调整：
  - `print:getJobStatus` 额外返回 `pageCount / layoutVersion / layoutError`
  - `print.print / print.exportPdf` 收紧为仅接收 `jobId`
  - 预览窗口不再直接调用设置 IPC

## 7. 风险评估

- 风险级别：高风险。
- 本次改动横跨 `main services / ipc / preload / preview shell / audit script`，直接影响账簿、报表、凭证打印主链路。
- 当前残余风险：
  - 隐藏 Chromium 实测分页默认路径仍未稳定，先保留代码但未作为默认启用。
  - 真实 Electron 审计脚本当前仍存在“等待预览窗口超时”的自动化识别问题，需要单独继续修复审计脚本或改为新的窗口识别策略。

## 8. 回退方案

- 代码回退重点文件：
  - `src/main/ipc/print.ts`
  - `src/main/services/printLayout.ts`
  - `src/main/services/printPreviewShell.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
- 回退后重新执行：
  - `npm run typecheck`
  - `npm test`

## 9. 任务拆解

- [x] 建立 page model、分页诊断与按页 HTML 渲染结构。
- [x] 改造打印 job，使 `PrintJobRecord` 以 `sourceDocument + layoutResult` 为主。
- [x] 改造 preload 与预览页，接入 `getPreviewModel / updatePreviewSettings`。
- [x] 为分页模型、预览壳子与 IPC 偏好逻辑补充定向单测。
- [x] 扩展真实 Electron 审计脚本，尝试增加页数与第 2 页页眉断言。
- [-] 隐藏 Chromium 实测分页默认启用。
  - 当前保留代码，但默认仍走主进程估算分页，待审计脚本与实测链路稳定后再切换。
