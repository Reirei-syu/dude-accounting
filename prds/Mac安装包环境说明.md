# Mac 安装包制作环境说明

## 1. 目标

本说明用于把 Dude Accounting 的 macOS 安装包制作环境固定下来。

当前结论：

- 可以为 macOS 准备完整打包脚本和目录约定。
- 但真正的 `.dmg` / `.zip` 打包必须在 macOS 主机上执行。
- 当前仓库已补好脚本：
  - `npm run prepare:mac-env`
  - `npm run build:mac:installer`

## 2. 推荐目录

- 仓库目录：自行放在 macOS 本机任意开发目录
- 推荐安装目录：`~/Applications/Dude Accounting`
- 推荐备份目录：`~/DudeAccountingData/Backups`
- 推荐导出目录：`~/DudeAccountingData/Exports`
- 推荐安装包输出目录：`~/DudeAccountingBuild/release`

## 3. 前置环境

- macOS 主机
- Node.js 22 LTS
- npm 10+
- Xcode Command Line Tools

建议先执行：

```bash
xcode-select --install
```

## 4. 初始化环境

在 macOS 仓库根目录执行：

```bash
npm install
npm run prepare:mac-env
```

这会准备以下目录：

- `~/Applications/Dude Accounting`
- `~/DudeAccountingData/Backups`
- `~/DudeAccountingData/Exports`
- `~/DudeAccountingBuild/release`

## 5. 构建 macOS 安装包

在 macOS 仓库根目录执行：

```bash
npm run build:mac:installer
```

脚本会执行：

1. `npm run build`
2. `electron-builder --mac dmg zip --publish never`
3. 强校验是否真的生成 `.dmg`

## 6. 当前打包策略

- 当前 mac 配置在 [electron-builder.yml](D:/coding/dude accounting/dude-app/electron-builder.yml)
- 当前 `notarize: false`
- 适合本地测试或内部使用
- 如果以后要正式分发给外部用户，需要再补：
  - Apple Developer 证书
  - 签名
  - notarization

## 7. Windows 账套能否在 Mac 导入

如果你说的是“系统备份包”，答案是可以，前提是：

- 使用同版本或更新版本的软件恢复
- 备份包完整，没有损坏

原因：

- 当前备份包本质上是 SQLite 数据库快照 + `manifest.json`
- 创建备份时直接复制数据库文件
- 恢复时直接把备份文件复制回当前平台数据库路径

关键实现：

- [backupRecovery.ts](D:/coding/dude accounting/dude-app/src/main/services/backupRecovery.ts)
- [backup.ts](D:/coding/dude accounting/dude-app/src/main/ipc/backup.ts)
- [init.ts](D:/coding/dude accounting/dude-app/src/main/database/init.ts)

注意区分：

- `backup:create / backup:restore` 是“可恢复账套”的系统备份路径
- `archive:export` 是电子档案导出，不是账套恢复导入路径

也就是说：

- Windows 做的系统备份包，理论上可以在 Mac 版里恢复
- 但 Windows 做的电子档案导出包，不能当成账套导入包来恢复

## 8. 风险提醒

- 如果备份数据里关联了平台本地文件路径，例如某些外部文件引用，在跨平台后这些路径可能失效。
- 账套核心数据本身是 SQLite，跨平台没有问题；但依赖平台文件系统路径的附属资源，需要单独核对。
