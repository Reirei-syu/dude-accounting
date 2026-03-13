# 账套备份模块 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将现有账套备份入口补齐为可生成带元数据的备份包、可执行完整性校验、并具备更稳妥恢复流程的合规模块。

**Architecture:** 继续沿用 `src/main/services -> src/main/ipc -> src/preload -> src/renderer` 分层。主进程服务负责备份包文件生成、manifest 校验与恢复替换，IPC 负责权限、账套访问校验与操作日志，文档同步描述“系统级快照备份包”与“电子档案导出包”的边界。

**Tech Stack:** Electron、TypeScript、better-sqlite3、Vitest、Node.js fs/path。

---

### Task 1: 备份服务测试先行

**Files:**
- Modify: `src/main/services/backupRecovery.test.ts`

**Step 1: Write the failing test**
- 断言 `createBackupArtifact` 生成备份包目录内的数据库文件与 `manifest.json`
- 断言 `validateBackupArtifact` 会同时校验文件与 manifest
- 断言新增恢复辅助函数能把备份文件恢复到目标数据库路径

**Step 2: Run test to verify it fails**

Run: `npm test -- src/main/services/backupRecovery.test.ts`

**Step 3: Write minimal implementation**
- 扩展备份服务返回 manifest 元数据
- 增加 manifest 读写与恢复辅助函数

**Step 4: Run test to verify it passes**

Run: `npm test -- src/main/services/backupRecovery.test.ts`

### Task 2: 接入 IPC 与数据库记录

**Files:**
- Modify: `src/main/services/backupRecovery.ts`
- Modify: `src/main/ipc/backup.ts`
- Modify: `src/main/database/init.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

**Step 1: Write the failing test**
- 以服务层测试覆盖 manifest 字段与恢复校验逻辑

**Step 2: Write minimal implementation**
- 为 `backup_packages` 补 `manifest_path`
- `backup:create` 写入 manifest 路径与更完整日志
- `backup:restore` 先校验包，再用临时文件替换数据库，并在失败时恢复数据库连接

**Step 3: Run targeted verification**

Run: `npm test -- src/main/services/backupRecovery.test.ts`

### Task 3: 同步 UI 文案与项目文档

**Files:**
- Modify: `src/renderer/src/pages/Backup.tsx`
- Modify: `prds/PROJECT_SPEC.md`
- Modify: `prds/合规整改计划.md`
- Modify: `prds/开发日志.md`

**Step 1: Update UI copy**
- 明确备份是“系统级数据库快照包”，与归档导出分离

**Step 2: Update docs**
- 记录备份包含 manifest 与恢复校验

### Task 4: 完整验证

**Files:**
- No code changes expected

**Step 1: Run typecheck**

Run: `npm run typecheck`

**Step 2: Run full tests**

Run: `npm test`
