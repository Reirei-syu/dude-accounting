# Dude Accounting

基于 Electron + React + TypeScript 的单机版代理记账财务软件。

## 适用范围

- 面向代理记账企业内部人员使用
- 当前支持两类账套：`enterprise`、`npo`
- 本地 SQLite 存储，不依赖云端服务

## 数据存储位置

- 开发模式：数据库仍存放在当前用户的开发隔离目录，例如 `AppData\Roaming\dude-app-dev\dude-accounting.db`
- 打包安装版：主数据库默认存放在安装目录下的 `data` 文件夹，例如 `D:\DudeAcc\dude-app\data\dude-accounting.db`
- 旧版安装用户首次启动新版时，如果安装目录下还没有数据库、但旧的 `AppData\Roaming\dude-app\dude-accounting.db` 存在，程序会自动迁移到安装目录 `data` 下继续使用

## 公开仓库后是否可以直接安装并打包

可以，但有前提。

如果仓库公开，其他人在满足本机环境要求的前提下，通常可以按下面流程完成安装与打包：

### Windows

```bash
git clone <your-public-repo-url>
cd dude-app
npm install
npm run build:win
```

### macOS

```bash
git clone <your-public-repo-url>
cd dude-app
npm install
npm run prepare:mac-env
npm run build:mac:installer
```

成立前提：

- 使用对应平台执行对应打包命令
- 已安装 Node.js 与 npm
- 本机具备 Electron 原生依赖构建条件
- 项目所需资源文件、配置文件、图标等都已经提交到仓库

## 推荐环境

推荐使用以下环境：

- Windows 10 / 11
- macOS 13+
- Node.js 22 LTS
- npm 10+
- Git

由于项目包含 `better-sqlite3` 这类原生依赖，首次安装时如果本机缺少构建环境，可能会失败。

### Windows 建议预装

- Visual Studio Build Tools
- C++ build tools
- Windows SDK
- Python（供 `node-gyp` 使用）

### macOS 建议预装

- Xcode Command Line Tools
- Python 3

可执行：

```bash
xcode-select --install
```

## 安装

```bash
npm install
```

说明：

- `postinstall` 会自动执行 `electron-builder install-app-deps`
- 如果安装失败，优先检查原生依赖构建环境是否完整

## 开发启动

```bash
npm run dev
```

说明：

- 项目已为 Windows 终端包了一层 UTF-8 启动脚本
- 请优先使用 `npm run dev` / `npm run start`
- 不建议直接手动执行 `electron-vite dev`，否则终端里的中文报错可能再次乱码

## 预览启动

```bash
npm run start
```

## Windows 打包

```bash
npm run build:win
```

实际会执行：

1. `npm run build`
2. `electron-builder --win`

## macOS 打包

```bash
npm run prepare:mac-env
npm run build:mac:installer
```

实际会执行：

1. `npm run build`
2. `electron-builder --mac dmg zip --publish never`

注意：

- 必须在 macOS 上执行
- 当前配置中 `notarize: false`，适合本地测试或内部使用
- 如果要正式分发给外部用户，通常还需要补齐 Apple Developer 签名、公证、证书相关配置

## 其他打包命令

```bash
# 仅构建应用，不生成安装包
npm run build

# 生成 unpacked 目录
npm run build:unpack

# Linux
npm run build:linux
```

其中 `npm run build:linux` 也会先执行 `npm run build`，确保打包前完成 typecheck 与前端/主进程构建。

## 打包输出位置

默认情况下，本项目当前配置会把安装产物输出到 `D:\coding\completed\dude-app\`。

### Windows 安装包

当前配置下命名规则为：

```text
dude-app-<version>-setup.exe
```

例如当前版本为 `1.0.4` 时，通常输出为：

```text
D:\coding\completed\dude-app\dude-app-1.0.4-setup.exe
```

### macOS 安装包

当前配置下 DMG 命名规则为：

```text
dude-app-<version>.dmg
```

例如当前版本为 `1.0.4` 时，通常输出为：

```text
D:\coding\completed\dude-app\dude-app-1.0.4.dmg
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

### 3. `npm run build:mac` 失败

优先检查：

- 是否在 macOS 上执行
- `npm install` 是否完整成功
- Xcode Command Line Tools 是否已安装
- 原生模块是否编译完成
- 如果做正式分发，签名和公证配置是否齐全

### 4. 终端中文报错乱码

优先使用：

```bash
npm run dev
npm run start
```

这两个脚本会先把 Windows 控制台切换为 UTF-8，再启动 Electron/Vite。

## 推荐 IDE

- VS Code
- ESLint
- Prettier
