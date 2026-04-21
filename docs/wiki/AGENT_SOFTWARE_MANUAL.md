# Dude Accounting 软件使用说明（面向 AGENT）

> 目标读者：AI Agent、自动化脚本、实施/运维人员、需要快速理解软件能力边界的开发者  
> 文档定位：软件功能总览 + 关键业务流程 + CLI 操作入口摘要  
> 配套文档：同目录 `CLI_命令大全.md` 提供完整命令清单；本手册负责解释“软件能做什么、应该怎么用”

## 1. 产品定位

Dude Accounting 是一套面向代理记账企业内部人员的本地单机财务软件。

它同时提供两种入口：

- 桌面 UI：用于日常账务处理、查询、打印、导出和系统维护。
- 本机 CLI：用于脚本调用、Python subprocess、运维自动化和 AI Agent 编排。

软件默认运行在本地设备上，核心数据存放在本地 SQLite 数据库，不依赖云端。

## 2. 账套范围与非目标

当前只支持两类账套：

- `enterprise`：一般企业账套
- `npo`：民间非营利组织账套

明确不支持：

- 政府会计
- 事业单位会计
- 云端多端同步
- 完整内置电子档案库

## 3. 软件核心对象

理解本软件时，建议先把以下对象当成主线：

- 用户：负责登录、权限校验、账套访问授权。
- 账套：对应一个委托单位，是所有会计数据的边界。
- 会计期间：驱动凭证、期初、结账、报表和账簿查询。
- 科目：用于记录会计业务，支持科目模板、自定义一级科目和现金流量标记。
- 辅助核算项：如客户、供应商、项目等，用于更细粒度核算。
- 凭证：软件最核心的业务记录，包含分录、审核、记账、批量处理和换位。
- 报表快照：按指定口径生成的资产负债表、利润表、现金流量表等报表结果。
- 账簿查询结果：科目余额表、明细账、序时账、辅助账等查询与导出结果。
- 备份包：账套当前状态的可导入备份。
- 电子会计档案包：按年度导出的归档产物。
- 电子凭证记录：电子发票、电子凭证原件及其校验、解析、转换结果。

## 4. 桌面端主要能力

### 4.1 身份与权限

- 用户登录与退出
- 管理员创建、修改、删除用户
- 功能权限控制
- 账套访问权限控制

### 4.2 账套与初始化

- 创建、更新、删除账套
- 查看账套可用期间
- 应用标准账套模板
- 维护企业/民非账套初始化规则

### 4.3 基础资料维护

- 科目列表、搜索、新增、更新、删除
- 辅助核算类别和辅助项维护
- 现金流量项目与映射规则维护
- 期初余额维护

### 4.4 凭证业务

- 新建凭证、更新凭证
- 查看凭证列表与凭证明细
- 获取下一个凭证号
- 审核、记账、反记账、删除、恢复删除、彻底删除
- 同一账套同一期间内的凭证换位

### 4.5 期间与期末处理

- 查看期间状态
- 结账与反结账
- 维护损益结转规则
- 预览并执行损益结转

### 4.6 报表、账簿、打印

- 生成报表快照
- 查询、删除、导出报表快照
- 账簿查询与导出
- 打印任务创建、预览、导出 PDF、系统打印

### 4.7 合规配套能力

- 操作日志查询与导出
- 账套当前状态备份、校验、导入、删除
- 整库恢复入口
- 电子会计档案导出、校验、删除、清单查看
- 电子凭证导入、校验、解析、转凭证草稿

## 5. 建议的日常业务顺序

对于一个新账套，推荐按下面的顺序理解和使用：

1. 登录用户并确认有目标账套访问权。
2. 创建账套或选择已有账套。
3. 确认会计期间。
4. 维护科目、辅助项、现金流量映射和期初余额。
5. 录入或导入凭证。
6. 审核、记账，并在需要时执行损益结转。
7. 生成报表快照和账簿查询结果。
8. 导出报表、账簿、电子档案，或执行账套备份。

## 6. CLI 的定位

CLI 不是单独的一套业务系统，而是桌面软件的正式接口形态之一。

它遵循固定分层：

```text
CLI -> src/main/commands -> src/main/services -> core/database
```

这意味着：

- CLI 和桌面 UI 共用同一套业务规则。
- CLI 不允许直接绕过服务层访问数据库。
- CLI 会复用权限校验、账套访问校验和操作日志链路。

## 7. CLI 两种入口

### 7.1 `dudeacc`

用于人工交互式操作。

特点：

- 默认进入交互式命令壳
- 固定 prompt：`dudeacc>`
- 每轮输入前显示状态栏：账号 / 账套 / 会计期间
- 支持中文别名和缺参补问

### 7.2 `dude-accounting <domain> <action>`

用于批处理、脚本、Agent 和系统集成。

特点：

- 默认输出 JSON
- 参数可显式传入
- 更适合自动化调用和稳定编排

## 8. CLI 输出契约

批处理模式默认返回结构化 JSON：

```json
{
  "status": "success",
  "data": {},
  "error": null
}
```

失败时返回：

```json
{
  "status": "error",
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "错误说明",
    "details": null
  }
}
```

常见约束：

- `--pretty`：切换成人类可读输出
- `--payload-file <path>`：推荐的复杂输入方式
- `--payload-json "<json>"`：适合简单 JSON
- 显式参数优先于交互式上下文

## 9. CLI 会话与数据位置

CLI 登录态会持久化到：

```text
<userData>/cli/session.json
```

桌面 UI 与 CLI 共用同一份运行时数据目录，因此：

- CLI 能读取与桌面端一致的账套数据
- CLI 不是第二套数据库
- 自动化任务应意识到它是在操作真实本机账套

## 10. CLI 命令域总览

下表只给出“能力分组”和典型动作，完整命令请看同目录 `CLI_命令大全.md`。

| 命令域 | 典型动作 | 说明 |
| --- | --- | --- |
| `auth` | `login` / `whoami` / `create-user` | 身份认证与用户管理 |
| `audit-log` | `list` / `export` | 操作日志查询与导出 |
| `ledger` | `list` / `create` / `periods` / `apply-template` | 账套生命周期与模板 |
| `subject` | `list` / `search` / `create` | 科目维护 |
| `auxiliary` | `list` / `create` / `update` | 辅助项维护 |
| `cashflow` | `items` / `list` / `create` | 现金流量项目与映射 |
| `voucher` | `save` / `update` / `list` / `batch` / `swap` | 凭证主业务 |
| `initial-balance` | `list` / `save` | 期初余额维护 |
| `period` | `status` / `close` / `reopen` | 会计期间控制 |
| `carry-forward` | `rules` / `preview` / `execute` | 损益结转 |
| `report` | `generate` / `list` / `export` | 报表快照与导出 |
| `book` | `subject-balances` / `detail-ledger` / `export` | 账簿查询与导出 |
| `backup` | `create` / `validate` / `import` / `restore` | 账套备份与恢复 |
| `archive` | `export` / `validate` / `manifest` | 电子会计档案 |
| `evoucher` | `import` / `verify` / `parse` / `convert` | 电子凭证链路 |
| `settings` | `system-get` / `preferences-set` / `wallpaper-*` | 系统参数与用户偏好 |
| `print` | `prepare` / `model` / `export-pdf` / `print` | 打印与 PDF 输出 |

## 11. AGENT 需要特别注意的高风险动作

以下命令可能改变账务状态、删除数据或依赖桌面环境，AGENT 调用前应先确认范围和参数：

- `voucher batch`
- `ledger delete`
- `period close`
- `period reopen`
- `carry-forward execute`
- `backup delete`
- `backup restore`
- `archive delete`
- `print open-preview`
- `print print`

建议：

- 优先使用 `--payload-file`
- 对删除、恢复、结账类操作显式传入原因、风险确认或审批字段
- 先查询再修改，不要直接盲写

## 12. 桌面辅助型 CLI 命令

并非所有 CLI 命令都适合无界面环境。

以下类型的命令通常需要本机桌面环境协助：

- 打开目录
- 打开打印预览
- 调用系统打印
- 触发整库恢复后的应用生命周期切换

如果 AGENT 运行环境没有桌面会话，优先使用纯数据型命令替代，例如：

- 用 `print export-pdf` 替代 `print open-preview`
- 用查询命令确认状态，而不是依赖 GUI 打开目录

## 13. 对 AGENT 的推荐调用策略

推荐顺序：

1. `auth login`
2. `auth whoami`
3. `ledger list`
4. `ledger periods`
5. 再进入具体业务命令

复杂写操作的推荐顺序：

1. 查询现状
2. 准备 payload 文件
3. 执行命令
4. 检查返回值中的 `status`
5. 如涉及导出或打印，再校验目标文件是否存在

## 14. 安装包中的文档位置

从当前版本开始，安装包会将以下说明文件一并放入安装目录的 `docs` 子目录：

- `AGENT_SOFTWARE_MANUAL.md`
- `CLI_命令大全.md`

建议 AGENT 在接管安装版环境时，优先读取：

1. `docs/AGENT_SOFTWARE_MANUAL.md`
2. `docs/CLI_命令大全.md`

## 15. 结论

如果只保留一条理解主线，可以把 Dude Accounting 视为：

> 一套以“账套”为边界、以“凭证”为核心、同时通过桌面 UI 和本机 CLI 对外提供能力的本地单机财务软件。

桌面 UI 适合人工连续操作，CLI 适合自动化和 AGENT 编排；两者共用同一套业务规则与本地数据。
