# Electron 真实用户链路断链测试方案

## 1. 背景
- 当前项目为 Electron 单机财务软件，账簿查询、报表输出、打印预览均依赖真实 `window.api` IPC，纯浏览器预览模式无法覆盖正式业务链路。
- 当前开发库 `%APPDATA%\dude-app-dev\dude-accounting.db` 中无账套、无凭证、无报表快照，无法直接做只读走查。
- 已确认可用登录账号为 `admin`，密码为空；`electron-vite` 原生支持 `--remoteDebuggingPort`，适合把真实 Electron renderer 暴露给自动化脚本。

## 2. 目标
- 在当前开发库上完成一轮真实用户链路断链审计。
- 覆盖账簿打印、凭证入账到报表反映、报表导出三条主链路，以及民非账套 smoke。
- 为每个断链点输出可执行的根因分析、修复建议、测试用例与证据。

## 3. 设计方案
- 自动化方式：
  - 使用 `npm run dev -- --remoteDebuggingPort 9222` 启动真实 Electron。
  - 使用 Python Playwright 通过 `chromium.connect_over_cdp('http://127.0.0.1:9222')` 连接 Electron renderer 并驱动真实 DOM。
  - 使用 Python `sqlite3` 做只读数据库核对，不使用当前全局 Node 24 直接读取 `better-sqlite3`。
- 测试数据准备：
  - 通过 UI 登录 `admin` 空密码。
  - 通过 UI 创建 `自动测试-企业账套` 与 `自动测试-民非账套`。
  - 企业账套内通过 UI 新增一个超长名称末级科目，并通过 UI 录入、审核、记账测试凭证。
  - 打印边界数据采用递增式构造：逐步增加发生额科目数量，定位“最大不溢出行数”和“首个溢出行数”。
- 断链判定：
  - 类型 A：提示无解。
  - 类型 B：流程中断。
  - 类型 C：假功能。
  - 类型 D：黑洞数据。
  - 类型 E：隐式依赖未暴露。
- 根因追踪：
  - UI：页面组件、按钮状态、提示文案、用户入口。
  - 中间层：`printUtils` 与页面参数组装。
  - IPC：`print:*`、`bookQuery:*`、`reporting:*`、`voucher:*`、`ledger:*`。
  - service/core：打印文档生成、账簿查询、报表生成、凭证状态流转、SQLite 结果。

## 4. 涉及模块
- `src/renderer/src/pages`
- `src/main/ipc`
- `src/main/services`
- `%APPDATA%\dude-app-dev\dude-accounting.db`
- `%APPDATA%\dude-app-dev\logs`

## 5. 数据结构变更
- 无产品数据结构变更。
- 执行测试时会写入当前开发库中的测试账套、测试凭证、测试报表快照与导出目录偏好。

## 6. 接口变更
- 无新增产品 IPC、preload 或类型接口。
- 自动化仅消费现有 Electron renderer DOM 和既有 IPC 通道。

## 7. 风险评估
- 当前开发库会被写入测试数据，需要通过统一前缀隔离测试账套，避免与真实开发账套混淆。
- Python 侧需安装 `playwright`，若安装失败则必须切换到 Windows UI Automation 备用方案。
- 账簿/报表打印预览若触发“超出纸张范围”，当前大概率只能复现断链，无法在同轮测试中靠现有 UI 自愈。

## 8. 回退方案
- 测试脚本与文档均为新增，可直接删除。
- 若需清理测试数据，单独执行“清理测试账套”任务，不与断链审计混做。
- 若 Playwright 方案不可用，保留文档与任务，切换到不新增产品代码的 Windows UI Automation 方案。

## 9. 任务拆解
- 任务 1：落盘计划与任务清单，创建自动化脚本与运行入口。
- 任务 2：安装 Python Playwright，启动 Electron 并连接真实 renderer。
- 任务 3：执行企业账套三条主链路与打印专项，收集截图、日志、数据库证据。
- 任务 4：执行民非账套 smoke，验证账簿、报表与导出链路。
- 任务 5：输出断链报告、Top 5、高优先级修复顺序，并同步进度与上下文文档。
