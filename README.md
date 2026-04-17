# Dude Accounting

基于 Electron + React + TypeScript 的单机版代理记账财务软件。

## 下载

- [Windows安装包](https://github.com/Reirei-syu/dude-accounting/releases/download/v1.1.3/dude-app-1.1.3-setup.exe)

本软件面向代理记账企业内部人员，服务对象为委托单位账套。当前支持两类账套：

- `enterprise`
- `npo`

明确不支持：

- 政府会计
- 事业单位会计
- 云端多端同步
- 完整内置电子档案库

## 软件介绍

Dude Accounting 的目标不是做“泛用型会计平台”，而是做一套**本地单机、可合规落地、可持续维护**的代理记账软件。当前产品形态同时提供：

- 桌面 UI：日常账务处理、凭证录入、报表与设置操作
- 本机 CLI：供脚本、运维流程、Python subprocess、AI Agent 调用

当前已覆盖的核心能力包括：

- 本地账号登录与权限控制
- 多账套管理
- 企业 / 民非账套模板初始化
- 会计科目、辅助项、现金流量项目与匹配规则维护
- 凭证录入、审核、记账、批量处理、位置交换
- 期初余额、损益结转、结账 / 反结账
- 财务报表快照生成、查询、删除、导出
- 账簿查询与导出
- 账套级备份包、电子档案导出、电子凭证处理底座
- 关键操作日志

## 推荐环境

- Windows 10 / 11
- macOS 13+
- Node.js 22 LTS
- npm 10+
- Git

由于项目包含 `better-sqlite3` 等原生依赖，首次安装时如果本机缺少构建环境，可能会失败。

### Windows 建议预装

- Visual Studio Build Tools
- C++ build tools
- Windows SDK
- Python（供 `node-gyp` 使用）

### macOS 建议预装

- Xcode Command Line Tools
- Python 3

```bash
xcode-select --install
```

## 数据存储位置

- 开发模式：数据库默认存放在当前用户开发隔离目录，例如 `AppData\Roaming\dude-app-dev\dude-accounting.db`
- 打包安装版：主数据库默认存放在稳定的 `userData\data` 目录，例如 `AppData\Roaming\dude-app\data\dude-accounting.db`
- 若新版首次启动时 `userData\data` 下尚无数据库，但旧安装目录或旧 `AppData\Roaming\dude-app` 下存在数据库，程序会自动迁移到新的 `userData\data`
- 安装版与开发版默认不共用数据库

## 安装

```bash
npm install
```

说明：

- `postinstall` 会自动执行 `electron-builder install-app-deps`
- 如果安装失败，优先检查原生依赖构建环境是否完整

## 使用方法

### 1. 安装版快速开始

适合日常记账、报表导出和备份归档使用。

1. 下载上方的 `Windows安装包`
2. 双击安装包并完成安装
3. 启动 `dude-app`
4. 登录账号
5. 选择账套或新建账套
6. 完成科目、辅助项、现金流量项目等基础设置
7. 开始录入凭证、审核、记账、结账、查询账簿和导出报表

典型日常流程：

1. 登录账号
2. 选择账套
3. 维护科目 / 辅助项 / 现金流配置
4. 录入或导入凭证
5. 审核、记账、结账
6. 查询账簿和报表
7. 导出报表、执行备份或电子档案导出

### 2. 开发运行

```bash
npm run dev
```

说明：

- 项目已为 Windows 终端包了一层 UTF-8 启动脚本
- 请优先使用 `npm run dev` / `npm run start`
- 不建议直接手动执行 `electron-vite dev`，否则终端中的中文错误可能乱码

### 3. 预览运行

```bash
npm run start
```

### 4. 开发者常用命令

```bash
# 安装依赖
npm install

# 桌面开发模式
npm run dev

# 预览模式
npm run start

# CLI
npm run cli -- --help

# 类型检查
npm run typecheck

# 全量测试
npm test
```

## CLI 使用方法

CLI 的长期架构规则以 `prds/CLI架构设计规范.md` 为准；README 只保留使用说明，不重复维护整套设计规范。

当前已提供两种 CLI 入口：

```bash
dudeacc
dude-accounting <domain> <action>
```

定位区别：

- `dudeacc`：面向人工体验，默认无参数进入交互式命令壳
- `dude-accounting`：面向脚本、Python subprocess、运维流程和 Agent，保持稳定批处理语法

批处理命令形态仍为：

```bash
dude-accounting <domain> <action>
```

特点：

- 默认输出 JSON
- 可追加 `--pretty` 切换为人类可读模式
- 复杂参数建议使用 `--payload-file` 或 `--payload-json`
- CLI 与桌面 UI 共用同一份本机数据目录，不会分裂出第二套运行时
- 无参数且当前终端为 TTY 时，`dudeacc` / `dude-accounting` 都会进入交互式命令壳

### 源码仓调试

源码调试入口：

```bash
npm run cli -- --help
npm run cli --
```

常见示例：

```bash
npm run cli -- auth login --payload-json "{\"username\":\"admin\",\"password\":\"\"}"
npm run cli -- auth whoami
npm run cli -- ledger list
npm run cli -- report list --ledgerId 1
npm run cli -- book subject-balances --ledgerId 1 --period 2026-03 --pretty
```

进入交互态：

```bash
npm run cli --
```

交互态常见示例：

```text
dudeacc> help
dudeacc> 登录
dudeacc> 账套列表
dudeacc> 选择账套 1
dudeacc[ledger:1]> 选择期间 2026-04
dudeacc[ledger:1|period:2026-04]> 科目余额表
```

使用 `payload file` 的示例：

```bash
npm run cli -- voucher save --payload-file ./examples/voucher-save.json
```

返回结构示例：

```json
{
  "status": "success",
  "data": {},
  "error": null
}
```

错误时：

```json
{
  "status": "error",
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "导出标题不能为空",
    "details": null
  }
}
```

### 安装版使用

安装版通过包装脚本调用现有可执行文件的嵌入式 `--cli` 模式：

- Windows：`dudeacc.cmd`
- Windows：`dude-accounting.cmd`
- macOS / Linux：`dudeacc`
- macOS / Linux：`dude-accounting`

等价底层形式为：

```bash
dude-app.exe --cli <domain> <action> ...
```

说明：

- 当前源码调试和安装版都优先走嵌入式 Electron CLI，而不是纯 Node 直接连库
- 原因是仓库内 `better-sqlite3` 当前按 Electron ABI 构建，纯 Node 路径不是主支持方式
- `backup restore` 目前仍保留为安装版 Electron 生命周期能力，不支持纯命令行热恢复
- 推荐人工操作时优先使用 `dudeacc`；脚本和 Agent 继续优先使用 `dude-accounting <domain> <action>`

## CLI 覆盖说明

当前 CLI 已补齐以下原本只在 UI 中可做的能力：

- `initial-balance list/save`
- `settings system-get/system-set`
- `settings runtime-defaults-get`
- `settings preferences-get/preferences-set`
- `settings diagnostics-status/diagnostics-set-dir/diagnostics-reset-dir/diagnostics-export/diagnostics-open-dir`
- `settings wallpaper-status/wallpaper-login-status/wallpaper-analyze/wallpaper-apply/wallpaper-restore`
- `settings subject-template-*`
- `settings custom-template-*`
- `print prepare/status/model/update-settings/open-preview/print/export-pdf/dispose`
- `backup restore`

说明：

- 复杂输入优先推荐 `--payload-file <path>`。
- `print open-preview`、`print print`、`settings diagnostics-open-dir`、`backup restore` 属于 `desktop-assisted` 命令，依赖本机 Electron 桌面环境。
- `print export-pdf` 支持显式 `--outputPath`，不再依赖先打开预览窗口。

## 构建与打包

### Windows 打包

```bash
npm run build:win
```

实际会执行：

1. `npm run build`
2. `electron-builder --win`
3. 构建前自动清理旧版 Windows 安装包产物

### macOS 打包

```bash
npm run prepare:mac-env
npm run build:mac:installer
```

实际会执行：

1. `npm run build`
2. `electron-builder --mac dmg zip --publish never`
3. 构建前自动清理旧版 macOS 安装包产物

注意：

- 必须在 macOS 上执行
- 当前配置中 `notarize: false`，适合本地测试或内部使用
- 如果要正式分发给外部用户，通常还需要补齐 Apple Developer 签名、公证、证书配置

### 其他构建命令

```bash
# 完整构建（含 typecheck、CLI 编译、Electron 构建）
npm run build

# 单独编译 CLI
npm run build:cli

# 生成 unpacked 目录
npm run build:unpack

# Linux
npm run build:linux
```

## 打包输出位置

默认安装产物输出到：

```text
D:\coding\completed\dude-app\
```

执行 `npm run build:win:installer` 后，脚本会自动清理额外中间产物，最终只保留一个最新的 Windows 安装包 EXE。

### Windows 安装包

命名规则：

```text
dude-app-<version>-setup.exe
```

### macOS 安装包

命名规则：

```text
dude-app-<version>.dmg
```

## 常见问题

### 1. `npm install` 失败

优先检查：

- Node.js 版本是否过旧
- 原生依赖构建环境是否齐全
- Windows 是否安装了 Visual Studio Build Tools
- macOS 是否安装了 Xcode Command Line Tools

### 2. `npm run build:win` 失败

优先检查：

- 是否在 Windows 上执行
- `npm install` 是否完整成功
- 原生模块是否编译完成
- 杀毒软件是否拦截打包输出

### 3. `npm run build:mac:installer` 失败

优先检查：

- 是否在 macOS 上执行
- `npm install` 是否完整成功
- Xcode Command Line Tools 是否已安装
- 原生模块是否编译完成
- 如需正式分发，签名和公证配置是否齐全

### 4. 终端中文报错乱码

优先使用：

```bash
npm run dev
npm run start
npm run cli -- --help
```

这些入口会先把 Windows 控制台切到 UTF-8，再启动对应流程。

### 5. 为什么不推荐直接 `node out/cli/...`

当前仓库内 `better-sqlite3` 依赖按 Electron ABI 构建。源码和安装版都优先走嵌入式 Electron CLI，这样最稳定，也最接近实际交付形态。

## 推荐 IDE

- VS Code
- ESLint
- Prettier
