# 阶段 02：依赖与供应链风险处置

核验日期：2026-09-07。基线为阶段 01 提交 `172b0d0`，使用 npm 11.6.2 实际查询 registry、解析 lockfile 和检查调用代码；不是历史审计数字的复用。

## 审计口径与版本边界

| 口径 | 更新前 | 更新后 |
| --- | --- | --- |
| `npm audit --omit=dev --json` | 6 个节点：4 high、2 moderate | 4 个节点：2 high、2 moderate |
| `npm audit --json` | 29 个节点：2 critical、22 high、3 moderate、2 low | 4 个节点：2 high、2 moderate |

节点数不等于独立漏洞数：剩余 electron/extract-zip 是同一条传播链，exceljs/uuid 是另一条。Electron 因 toolkit 的 peer 依赖也出现在 omit=dev 口径，不能据此认定安装脚本会在打包应用中执行。

- Electron：39.7.0 → **39.8.10**，精确锁定 39 系列最后稳定补丁。[官方发布记录](https://github.com/electron/electron/releases/tag/v39.8.10)。
- electron-builder：26.8.1 → **26.16.0**。查询时默认 latest 标签是 26.15.3，但 v26 标签及[官方最新稳定 Release](https://github.com/electron-userland/electron-builder/releases/tag/electron-builder%4026.16.0)均为 26.16.0，不采用 27 alpha。
- Vite：7.3.1 → 7.3.6；Vitest：4.0.18 → 4.1.11。React/ReactDOM、TypeScript、better-sqlite3 和其他无关直接依赖未升级。
- 只对 `brace-expansion@^5.0.0` 精确 override 为 5.0.9；1.x、2.x 各自更新到兼容版本，不强行统一主版本。
- 没有增加生产直接依赖，没有运行 `npm audit fix --force`，没有跨 Electron/React/Vite 大版本。builder 上游自身依赖调整包含 node-gyp 等构建工具的主版本变化，通过其正式依赖契约和实际构建验证，而非全局 override。

## 已修复的基线节点

下表路径省略共同根节点 dude-app；完整锁定版本由 package-lock.json 给出。相同节点的多个 advisory 在升级后均不再出现在 audit 中。

| 节点/原路径 | 处置及实际入口 |
| --- | --- |
| electron 39.7.0 | 39.8.10 修复基线 Electron 自身安全公告；剩余仅 extract-zip 传播项，见后文 |
| electron-builder → app-builder-lib / builder-util / dmg-builder / electron-builder-squirrel-windows / electron-publish | 全部对齐 26.16.0；构建、平台打包和发布工具链 |
| electron-builder → builder-util-runtime 9.5.1 | 9.7.0 修复跨源重定向凭据泄漏；本项目无运行时 electron-updater |
| electron-builder → app-builder-lib → tar 7.5.9 | 7.5.22；构建归档解析，消除含 critical 在内的路径穿越、资源耗尽公告 |
| vitest 4.0.18 | 4.1.11 修复 UI server 文件读取/执行漏洞；项目测试继续调用 Electron 包装器的 run 模式，不开放 UI server |
| vite 7.3.1 | 7.3.6 修复 Windows 路径、WebSocket 及开发服务器文件读取问题；不改为公开网络监听 |
| vite → esbuild 0.27.3 | 0.28.2，在 Vite 7.3.6 声明的兼容范围内；electron-vite 自己的 0.25.12 不受该公告影响，保留 |
| @vitejs/plugin-react → @babel/core 7.29.0 | 7.29.7，源码映射读取修复；仅编译项目源码 |
| @babel/core → @babel/helper-compilation-targets → browserslist 4.28.1 | 4.28.9；修复查询缓存耗尽和自定义统计数据问题 |
| eslint → @humanfs/node 0.16.7 | 0.16.8；修复递归复制越界，lint 工具路径 |
| eslint → file-entry-cache → flat-cache → flatted 3.3.4 | 3.4.4；修复解析递归/原型污染，lint 缓存路径 |
| electron-builder → app-builder-lib → plist → @xmldom/xmldom 0.8.11 | 0.8.15；XML 序列化注入和递归修复，构建元数据路径 |
| electron-builder → app-builder-lib → js-yaml 4.1.1 | 4.3.2；配置解析 DoS 修复 |
| electron-builder → app-builder-lib → @malept/flatpak-bundler → lodash 4.17.23 | 4.18.1；代码注入/原型污染修复，构建工具路径 |
| electron-builder → app-builder-lib → electron-publish → form-data 4.0.5 | 4.0.6；multipart CRLF 注入修复 |
| electron-builder → app-builder-lib → @electron/rebuild → node-gyp → make-fetch-happen → @npmcli/agent → socks-proxy-agent → socks → ip-address 10.1.0 | builder/rebuild 上游依赖更新后整条旧节点移除；当前 lockfile 不含 ip-address |
| vite → postcss 8.5.8 | 8.5.28；源映射文件读取及输出注入修复 |
| vite → postcss → nanoid 3.3.11 | 3.3.18；异常长度死循环/溢出修复 |
| vite → picomatch 4.0.3 | 4.0.7；glob ReDoS/匹配注入修复 |
| exceljs → tmp 0.2.5；builder → app-builder-lib → @malept/flatpak-bundler → tmp-promise → tmp | 0.2.7 修复 prefix/postfix 路径穿越。ExcelJS 只有 stream/xlsx/workbook-reader.js 使用默认 `tmp.file(callback)`；项目使用 Workbook.xlsx.readFile/writeFile，不把用户前后缀传给 tmp |
| exceljs → archiver → readdir-glob → minimatch 5 → brace-expansion 2.0.2 | 2.1.4；应用输出 Excel 的传递路径，项目不提供用户控制的 glob 模式入口 |
| exceljs → archiver → archiver-utils → glob 7 → minimatch 3 → brace-expansion 1.1.12；eslint/asar/dir-compare 同类路径 | 1.1.18；消除展开导致的进程挂起和内存耗尽 |
| builder → app-builder-lib → minimatch 10 → brace-expansion 5.0.4；@electron/universal/node-gyp 下 minimatch 9 → brace-expansion 2.0.2 | 分别 5.0.9 / 2.1.4；构建文件匹配模式来自仓库配置，不将财务输入当 glob |

## 剩余风险：extract-zip（high）

- 路径：`dude-app → electron@39.8.10 → extract-zip@2.0.1`；electron 是继承风险，不是另一个未修补的 Electron 39 自身公告。
- 公告：[GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv)。恶意 ZIP 中的符号链接目标未验证，可逃逸解压目录；某些后续使用方式会导致越界读写。
- 实际入口：Electron 的 `install.js` 在安装时调用 `downloadArtifact(...).then(extractFile)`，不是应用业务 ZIP 导入入口。`src` 和业务脚本没有导入 extract-zip。
- 当前缓解：Electron npm 包的 `checksums.json` 默认传给 @electron/get，下载与缓存命中都验证 SHA-256；该校验表又受到 package-lock integrity 的保护。使用固定版本和可信 registry/官方发布源，CI 为只读构建 job，不提供发布写凭据；不以管理员权限解压用户 ZIP。
- 本轮核实远程 checksum 两个开关及 ELECTRON_OVERRIDE_DIST_PATH 均未设置。
- 最终 unpacked 的 app.asar 实查不含 node_modules/extract-zip 或 node_modules/electron 安装包内容；这条 high 风险当前限于依赖安装环境，不存在于交付包的这两个 npm 模块中。
- 缓解边界：`electron_use_remote_checksums` / `npm_config_electron_use_remote_checksums` 能改为远程校验表；构建环境、缓存目录、npm 包或校验表同时被篡改时，现有措施不能保证安全。不得将这些选项作为绕过校验的安装排障手段，也不得把 extract-zip 复用于用户文件导入。
- 上游查询仍只有 2.0.1，无兼容修复版本。audit 建议的 Electron 44 大版本超出本阶段边界；不伪装成已修复，不安装非官方替代依赖。
- 后续条件：出现受维护的兼容修复版时更新并执行 npm ci/打包 smoke；若新增不可信 ZIP 入口、关闭本地 checksum、改变下载源/构建信任边界，应先重新评估并阻止沿用此风险处置。下一次允许 Electron 主版本迁移时移除旧安装链。

## 剩余风险：ExcelJS → uuid（moderate）

- 路径：`dude-app → exceljs@4.4.0 → uuid@8.3.2`；ExcelJS 节点是 uuid 的传播项。
- 公告：[GHSA-w5hq-g745-h8pq](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq)。前提是调用 v3/v5/v6 并提供越界输出缓冲区或偏移；不是所有 UUID API 都有问题。
- 实际调用：`exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js` 仅解构 `v4`，两处均为无参数 `uuidv4()`，生成条件格式标识。项目没有直接导入 uuid，也不暴露缓冲区或 offset 参数。
- 应用确实读取用户提供的科目模板以及税务模板，不能笼统称“ExcelJS 不可达”；但这些读取/写入入口不会把内容转成 v3/v5/v6 调用。现有报表、模板、Excel 导出回归覆盖此依赖。
- 当前措施是限制在已审阅的调用子集并保留原上游依赖契约，而非全局忽略 moderate。8.x 无回补；修复版 11.1.1 跨多个主版本，未为不可达 API 风险强行覆盖 ExcelJS 声明范围；audit 的 ExcelJS 3.4.0 降级也是破坏性方案。
- 后续条件：ExcelJS 发布兼容维护版更新 uuid 时跟进；若新增 uuid 调用、缓冲区参数、插件或更换 ExcelJS 内部实现，必须重新审阅；需提前 override 时应单独验证条件格式序列化及 CJS/API 兼容，不能只检查 audit 数字。

## Electron 39 支持周期与局限

39.8.10 官方发布说明明确该系列已停止支持。本阶段按要求停留 39.x，因此不能宣称消除了未来 Chromium/Electron 漏洞风险。应用主窗口加载本地构建文件、默认 contextIsolation 开启，但 sandbox:false；这些不是替代上游安全更新的保证。不得在该结论下新增不可信远程页面或放宽导航/权限边界。后续必须在获准大版本迁移的阶段选受支持版本并完成原生 ABI、IPC、打印和打包验证。

## 验证与复现

- `npm ci`：成功，postinstall 使用 electron-builder 26.16.0 为 Electron 39.8.10 重建 better-sqlite3。
- `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`git diff --check`：通过；最终完整测试 116 个文件、522 项通过、2 项既有跳过（27.58 秒）。
- `py -3 scripts/dependency-smoke.py`：真实 Electron 执行内存 SQLite 查询，检查版本/ABI、登录页、preload、隔离初始化库、quick_check 和正常退出。复用已有 Python Playwright，不下载依赖。
- Windows unpacked：`node_modules/.bin/electron-builder.cmd --win --dir --publish never --config.directories.output=D:/coding/completed/dude-app/phase02-smoke`，后续用上述 smoke 的 `--executable` 指向其 dude-app.exe。
- Smoke 证据仅写入项目 `.tmp/dependency-smoke`，不使用真实账套；unpacked 使用单独输出子目录，不执行安装器清理脚本，不部署、不发布、不 push。
- 首次实包检查发现旧配置会携带 `.tmp` 测试库及缓存，已显式排除并加入配置回归测试；必须在最终 asar 内容检查中确认无 `.tmp` 条目，不能只依赖 Git ignore。
- 最终实包检查通过：28,152 个 asar 条目中无 `.tmp`、extract-zip 或 electron npm 安装模块。源码版与 unpacked 版均实际显示登录页、暴露 preload auth 接口、创建各自隔离库并以 0 退出；SQLite 原生查询返回 42，Electron ABI=140。证据目录为 `.tmp/dependency-smoke/source-cx6jeioi`、`packaged-y0u1pms9`。
- Review：核对 manifest/lock 一致性、直接生产依赖不变、所有锁定 tarball 均来自 npm 官方 registry、剩余风险调用链、smoke 隔离/退出处理及实包目录。确认成立的 `.tmp` 打包泄漏已修复并复验，无未处置的高风险 finding；本轮为本地自审，未宣称独立第三方审查。
- 已知非阻断提示：npm 的旧传递包弃用提示、构建器重复依赖引用/现有代码签名关闭提示、既有 executor 混合导入提示以及本机已有 Playwright 的 url.parse 弃用提示。没有关闭安全检查、放宽 CSP 或压低测试门槛来掩盖失败。
- 本机 Node 24.12.0/npm 11.6.2；CI 仍使用 Node 22/npm 11.6.2。远程 CI、真实 WSL/macOS/Linux 构建不属于本轮已验证事实。
