# 安装升级数据路径保护方案

## 1. 背景
- 当前打包版主数据库路径绑定到安装目录 `data`，安装升级或改安装目录后可能读到新空库。
- 当前打包版默认诊断日志也依赖安装目录。
- 用户要求新版本安装后不得修改、重置或丢失任何既有用户数据和设置。

## 2. 目标
- 打包版主数据库默认固定存放于 `userData/data`。
- 兼容历史版本：若旧版本把数据库放在安装目录 `data`，首次启动时自动迁移到 `userData/data`。
- 打包版默认诊断日志改为 `userData/logs`。
- 安装器文案不再假设“数据库写入安装目录”。

## 3. 设计方案
- 调整 `runtimeDatabasePath.ts`：打包版默认路径切换到 `userData/data`，并兼容从旧安装目录迁移。
- 调整 `diagnosticsLogPath.ts`：默认日志目录统一使用 `baseDir/logs`。
- 调整 `build/installer.nsh`：去除安装目录数据库假设。
- 先补测试，再实现代码，最后重新打包验证。

## 4. 涉及模块
- `src/main/services/runtimeDatabasePath.ts`
- `src/main/services/runtimeDatabasePath.test.ts`
- `src/main/services/diagnosticsLogPath.ts`
- `src/main/services/diagnosticsLogPath.test.ts`
- `build/installer.nsh`

## 5. 数据结构变更
- 无数据库表结构变化，仅调整运行时文件物理路径。

## 6. 接口变更
- 无 IPC 字段变更。

## 7. 风险评估
- 旧安装目录数据库迁移判断错误会导致遗漏旧数据。
- 需要确保仅在目标库不存在时执行迁移，防止覆盖现有 `userData` 数据。

## 8. 回退方案
- 回退上述五个文件和对应测试。

## 9. 任务拆解
- 任务 1：补测试，锁定打包版数据库与日志路径行为。
- 任务 2：修复数据库路径和旧安装目录迁移。
- 任务 3：修复默认日志路径与安装器文案。
- 任务 4：验证并重新打包。
