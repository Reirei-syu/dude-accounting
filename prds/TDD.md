





这是一份为你及后续AI编程工具（如 Vibe Coding 模式下的 Cline、Cursor 等）准备的 \*\*系统技术架构与实现方案文档（Technical Design Document, TDD）\*\*。



该文档将 PRD 和 UI 设计转化为具体的代码架构、数据库结构设计及核心难点解决方案。\*\*在财务软件开发中，精度和状态管理是重中之重，我在文档中加入了防踩坑的技术标准。\*\*



---



\# Dude Accounting - 技术架构与实现文档



\## 1. 技术栈选型 (Technology Stack)

为了保证跨平台兼容性、极佳的渲染性能以及单机版数据的绝对安全，确立以下技术栈：

\*   \*\*前端框架：\*\* React 18 + TypeScript (严格类型校验，防止财务数据类型隐式转换)。

\*   \*\*桌面端框架：\*\* Electron (使用 `electron-vite` 脚手架构建主进程与渲染进程)。

\*   \*\*UI 样式与组件：\*\* Tailwind CSS (高度契合毛玻璃态定制) + Radix UI (无头组件库，用于构建复杂的 Select、Dialog、ContextMenu，不带默认样式，方便毛玻璃覆盖)。

\*   \*\*本地数据库：\*\* SQLite3 (通过 `better-sqlite3` 或 `Prisma` ORM 在 Electron 主进程中调用)。

\*   \*\*全局状态管理：\*\* Zustand (轻量，适合管理多 Tab 和悬浮状态)。

\*   \*\*财务精度计算：\*\* `decimal.js` 或 `big.js`（\*\*绝对禁止使用原生 JavaScript 的 `Number` 浮点数处理金额\*\*，必须用第三方库或统一转为“分”级整数存储）。



\## 2. 核心架构与 IPC 通信设计 (Architecture)



采用 Electron 标准的\*\*主进程 (Main) - 渲染进程 (Renderer) 分离架构\*\*：

\*   \*\*主进程 (Node.js)：\*\* 负责所有 SQLite 数据库的读写、本地文件系统操作（导出 Excel/PDF、本地备份）、网盘 OAuth 验证的回调拦截。

\*   \*\*渲染进程 (React)：\*\* 仅负责 UI 呈现、状态流转、快捷键监听。

\*   \*\*ContextBridge (预加载脚本)：\*\* 封装安全的 IPC API，渲染进程通过 `window.api` 调用，例如：

&nbsp;   ```typescript

&nbsp;   // renderer可以调用的API示例

&nbsp;   window.api.db.queryLedgers()

&nbsp;   window.api.voucher.saveVoucher(voucherData)

&nbsp;   window.api.backup.triggerCloudBackup('gdrive')

&nbsp;   ```



\## 3. 数据库设计 (SQLite Schema 核心表结构)



数据模型必须满足“多账套、跨年查询、强追溯”的要求。



\*   \*\*`users` (用户表)\*\*

&nbsp;   \*   `id`, `username`, `real\_name`, `password\_hash`, `permissions` (JSON字符串或位掩码), `is\_admin` (Boolean)。

\*   \*\*`ledgers` (账套表)\*\*

&nbsp;   \*   `id`, `name`, `standard\_type` (枚举：企业/民非), `current\_period` (YYYY-MM), `created\_at`。

\*   \*\*`subjects` (会计科目表)\*\*

&nbsp;   \*   `id`, `ledger\_id`, `code` (如 1001), `name`, `parent\_code`, `category` (资产/负债/权益/成本/损益), `balance\_direction` (1借 / -1贷)。

\*   \*\*`vouchers` (凭证主表)\*\*

&nbsp;   \*   `id`, `ledger\_id`, `period` (YYYY-MM，用于跨年查询过滤), `voucher\_date` (日期), `voucher\_word` (记字号), `status` (枚举：0未审核, 1已审核, 2已记账), `creator\_id`, `auditor\_id`, `bookkeeper\_id`。

\*   \*\*`voucher\_entries` (凭证分录明细表)\*\*

&nbsp;   \*   `id`, `voucher\_id`, `summary` (摘要), `subject\_code`, `debit\_amount` (借方金额，DECIMAL或整数分), `credit\_amount` (贷方金额), `cash\_flow\_item\_id` (关联现金流映射)。



\## 4. 核心交互与难点技术实现方案



\### 4.1 凭证录入：全键盘操作与自动平衡

\*   \*\*网格焦点管理 (Grid Focus Management)：\*\*

&nbsp;   不要使用普通的 `<input>` 默认行为。使用一个二维数组的 React `useRef` 来管理所有单元格的焦点。

&nbsp;   ```typescript

&nbsp;   // 监听全局或表格的 keydown 事件

&nbsp;   const handleKeyDown = (e, rowIndex, colIndex) => {

&nbsp;       if (e.key === 'Enter') {

&nbsp;           e.preventDefault();

&nbsp;           // 逻辑：向右移动，若已经是最后一列，则移动到下一行的第一列；若是最后一行，则触发新增行并聚焦。

&nbsp;           focusNextCell(rowIndex, colIndex);

&nbsp;       }

&nbsp;       if (e.key === '=' \&\& (isDebit(colIndex) || isCredit(colIndex))) {

&nbsp;           e.preventDefault();

&nbsp;           // 逻辑：计算已输入的所有借方总和与贷方总和的差额，填入当前焦点所在的金额框。

&nbsp;           autoBalanceAmount(rowIndex, colIndex);

&nbsp;       }

&nbsp;   }

&nbsp;   ```



\### 4.2 Z轴图层与悬浮模糊态 (Suspended Blur UI)

\*   \*\*状态树设计：\*\* 在 Zustand 中维护一个 `uiStore`，包含 `isMenuSuspended: boolean`。

\*   \*\*DOM 结构实现：\*\*

&nbsp;   ```jsx

&nbsp;   <div className="app-container layer-0-bg">

&nbsp;      <Sidebar className="layer-1" />

&nbsp;      <div className="main-content layer-1">

&nbsp;          <TopBar />

&nbsp;          <TabBar />

&nbsp;          {/\* 作业区 \*/}

&nbsp;          <div className={`workspace ${isMenuSuspended ? 'blur-md brightness-75 pointer-events-none' : ''}`}>

&nbsp;              <TabContent />

&nbsp;          </div>

&nbsp;          

&nbsp;          {/\* 悬浮遮罩与按钮 (Layer 3) \*/}

&nbsp;          {isMenuSuspended \&\& (

&nbsp;              <div 

&nbsp;                  className="absolute inset-0 z-50 flex items-center justify-center bg-black/10"

&nbsp;                  onClick={() => setMenuSuspended(false)} // 点击外部退出悬浮

&nbsp;              >

&nbsp;                  <SuspendedButtonGroup 

&nbsp;                      onClick={(e) => e.stopPropagation()} // 阻止冒泡

&nbsp;                  />

&nbsp;              </div>

&nbsp;          )}

&nbsp;      </div>

&nbsp;   </div>

&nbsp;   ```



\### 4.3 动态多 Tab 标签页管理

\*   \*\*状态模型：\*\* 路由不可使用传统的 URL 路由（如 react-router 的单纯路径跳转），需采用 \*\*内存路由 + 数组状态\*\* 管理打开的 Tab。

&nbsp;   ```typescript

&nbsp;   interface TabItem {

&nbsp;     id: string; // 唯一标识，如 'voucher-entry', 'ledger-query-1001'

&nbsp;     title: string; // 显示的标签名

&nbsp;     componentType: string; // 映射到具体的 React 组件

&nbsp;     params?: any; // 携带的参数，如下钻查询时的科目代码和日期范围

&nbsp;   }

&nbsp;   ```

\*   \*\*渲染逻辑：\*\* 遍历 `tabs` 数组，将非 active 的 Tab 通过 `display: none` 或保持组件状态的库（如 `react-activation`）隐藏，确保切换 Tab 时输入的数据不丢失。



\### 4.4 网盘 OAuth 授权与过期阻断处理

\*   \*\*OAuth 流程 (主进程处理)：\*\* Electron 启动一个本地不可见的 WebContents 或使用系统默认浏览器打开网盘授权页，设置回调地址为 `http://localhost:端口/callback`。主进程启动一个临时的本地 HTTP Server 接收 Auth Code，换取 Token 并加密存入 SQLite。

\*   \*\*Token 拦截器 (Axios Interceptor)：\*\*

&nbsp;   在执行月末结账自动触发备份时，封装的网络请求必须拦截 `HTTP 401 (Unauthorized)` 状态码。

&nbsp;   ```javascript

&nbsp;   // 伪代码逻辑

&nbsp;   try {

&nbsp;       await cloudStorageApi.upload(backupFile);

&nbsp;   } catch (error) {

&nbsp;       if (error.response \&\& error.response.status === 401) {

&nbsp;           // 触发 IPC 事件通知渲染进程弹出警告

&nbsp;           mainWindow.webContents.send('oauth-expired', 'gdrive');

&nbsp;           // 中止结账/备份流程

&nbsp;           throw new Error('授权过期');

&nbsp;       }

&nbsp;   }

&nbsp;   ```



\### 4.5 自定义壁纸层 (Layer 0 替换机制)

\*   提供一个设置界面允许用户选择本地图片。

\*   Electron 读取图片转换为 Base64，或将图片复制到应用的 `userData` 目录。

\*   前端通过读取本地协议地址（如 `local-file://path/to/image.jpg`）设置到最外层根节点的 `style={{ backgroundImage: ... }}`。



---



\## 5. 给 AI 编程助手的实施建议 (Prompt Instructions for AI)



当使用这段文档让 AI 写代码时，建议按以下顺序拆解任务（优先级从高到低）：



1\.  \*\*Phase 1 (脚手架与 DB)：\*\* 初始化 Electron-Vite (React+TS) 项目。配置好 `better-sqlite3`。实现 `User` 和 `Ledger` 表的创建与 Admin 账号自动注入。

2\.  \*\*Phase 2 (UI 骨架)：\*\* 使用 Tailwind CSS 实现 PRD 和 UI 文档中描述的 Z轴图层逻辑。实现毛玻璃全局 CSS 变量。完成侧边栏、Tab 栏、作业区以及 \*\*悬浮模糊逻辑 (Suspended Blur)\*\*。

3\.  \*\*Phase 3 (凭证核心)：\*\* 建立凭证数据库表。实现高优快捷键表单（Enter移动，=号计算）。接入 `decimal.js` 确保借贷平衡精确到分。

4\.  \*\*Phase 4 (账簿与下钻)：\*\* 实现跨年 SQLite 聚合查询。实现账表 UI 及右键上下文菜单 (Context Menu)，打通“账簿 -> 新建 Tab -> 显示明细”的数据流转。

5\.  \*\*Phase 5 (网盘与结账)：\*\* 实现月末结账的前置条件校验逻辑。编写网盘 OAuth 和 Token 过期阻断弹窗。

