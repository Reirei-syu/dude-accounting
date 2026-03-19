# MAINTENANCE

## 1. 项目架构图（文字版）

```text
Electron Desktop App
├─ Main Process
│  ├─ src/main/index.ts
│  │  └─ 应用启动、窗口创建、IPC 注册
│  ├─ src/main/database/*
│  │  └─ SQLite 初始化、迁移、索引、旧库兼容修补
│  ├─ src/main/ipc/*
│  │  └─ IPC 入口、权限校验、参数收口、结果返回
│  ├─ src/main/services/*
│  │  └─ 报表、账簿、备份、归档、电子凭证、打印、日志等核心逻辑
│  └─ src/main/security/*
│     └─ 认证与安全相关逻辑
├─ Preload
│  └─ src/preload/index.ts
│     └─ 暴露 window.api，连接 main 与 renderer
└─ Renderer
   ├─ src/renderer/src/pages/*
   │  └─ 业务页面
   ├─ src/renderer/src/components/*
   │  └─ 通用组件
   ├─ src/renderer/src/stores/*
   │  └─ Zustand 状态管理
   └─ src/renderer/src/assets/*
      └─ 样式与静态资源
```

核心数据链路：

```text
Renderer 页面
-> preload window.api
-> ipcMain.handle
-> service / database
-> 返回结构化结果
-> Renderer 渲染
```

关键存储：

- SQLite：账套、凭证、报表快照、归档记录、备份记录、操作日志。
- 文件系统：电子凭证原文件、备份包、电子档案导出包、打印/导出产物。
- 运行日志：应用 `userData/logs/runtime-YYYY-MM-DD.jsonl`。

日志分工：

- `operation_logs`：记录谁在什么时间做了什么业务动作，偏审计留痕。
- `runtime-*.jsonl`：记录关键 IPC 的耗时、状态、异常堆栈，偏运行排障。

## 2. 常见问题排查流程

### 2.1 启动慢、首页卡顿、界面像“假死”

1. 先看当天运行日志 `runtime-YYYY-MM-DD.jsonl`，确认是否卡在 `ledger:*`、`reporting:*`、`backup:*`、`archive:*`、`eVoucher:*`。
2. 再看最近是否刚导入大批凭证、生成跨期报表、执行备份或归档导出。
3. 如果是账簿/报表导致，优先怀疑主进程同步计算或同步文件 IO 被放大。
4. 如需进一步确认，优先复现同一账套、同一期间、同一操作，不要先改数据库。

### 2.2 报表、账簿或导出明显变慢

1. 查运行日志中的 `durationMs`，确认是 `reporting:*`、`bookQuery:*` 还是打印/导出链路。
2. 对照账套数据量，确认是否出现跨年度、大期间、未记账凭证一并纳入的情况。
3. 如同一账套重复变慢，优先做一次备份，再评估是否需要清理历史测试数据。
4. 若问题持续，补抓同一操作 3 次以上的耗时日志，避免只凭单次波动判断。

### 2.3 备份创建、校验或恢复失败

1. 先看系统内 `backup_packages` 对应记录是否存在。
2. 确认备份目录下同时存在数据库备份文件和 `manifest.json`。
3. 在系统内先执行一次“校验备份”；若校验失败，再检查文件是否被手动移动、改名或删除。
4. 如果恢复中断，先检查 `userData/pending-restore-log.json` 是否残留，再确认数据库是否已重新初始化。
5. 恢复类故障不要直接覆盖现库，先复制现场文件再处理。

### 2.4 电子档案导出失败或删除失败

1. 先看 `archive_exports` 记录状态，再看导出目录是否完整。
2. 检查 `manifest.json`、`vouchers.json`、`voucher-entries.json`、`electronic-vouchers.json`、`operation-logs.json` 是否齐全。
3. 删除失败时先分清是“记录删除失败”还是“物理目录不存在/受保护”。
4. 若用户手工移动过导出目录，优先走“仅删记录”确认流程，不要直接跳过校验。

### 2.5 电子凭证导入、校验、解析、转换失败

1. 先看当天运行日志里对应的 `eVoucher:*` 记录，确认失败发生在导入、验真、解析还是转换。
2. 再看 `operation_logs` 是否已有 import/verify/parse/convert 留痕。
3. 导入失败时重点检查源文件是否存在、目标账套是否存在、是否出现重复指纹。
4. 如果怀疑半成品数据，核对 `electronic_voucher_files`、`electronic_voucher_records`、`electronic_voucher_verifications` 是否成对出现。
5. 导入链路已经做了失败清理；若仍有孤儿文件，优先保留现场并补一条问题记录。

### 2.6 打印或 PDF 导出异常

1. 先区分是报表导出、打印预览还是系统打印失败。
2. 检查运行日志是否有对应 IPC 失败记录，确认是生成 HTML、保存文件还是 BrowserWindow 打印链路出错。
3. 如只在某一台机器失败，优先排查本机打印机驱动、权限或保存目录问题。

## 3. 每月例行维护清单

- 执行 `npm run typecheck`。
- 执行 `npm test`。
- 执行 `npx eslint . --no-cache --quiet`。
- 抽查当天或最近 7 天运行日志，确认是否有持续重复的 `warn` / `error`。
- 抽查 `operation_logs` 中备份、归档、电子凭证、报表相关失败记录。
- 在系统内随机选择 1 个账套执行一次备份创建 + 备份校验。
- 在系统内随机选择 1 个账套执行一次电子档案导出 + 校验。
- 随机选择 1 个账套执行一次报表生成 + Excel/PDF 导出。
- 抽查 1 条电子凭证完整链路：导入 -> 校验 -> 解析 -> 转换。
- 检查 `userData/logs` 目录大小；如历史运行日志明显堆积，归档或清理 90 天前日志。
- 检查 `pending-restore-log.json`、临时导出目录、异常残留目录是否存在。
- 检查数据库文件、WAL 文件是否异常增大；如近期有大量写入操作，安排一次业务空闲时段做检查点和备份。

## 4. 生产问题快速定位建议

- 先看运行日志，再看业务操作日志，不要反过来。
- 先定位哪个 IPC 慢或报错，再回到对应 service 和数据库表。
- 先保留现场文件，再做清理或恢复。
- 凡是涉及恢复、删除、覆盖的操作，先做一次额外备份。
