# AUTOMATIONS 巡检结构化提示词

## 1. 推荐自动化名称

- 每周巡检：`Dude 每周巡检`
- 每月巡检：`Dude 每月巡检`

## 2. 推荐工作目录

- 仓库目录：`D:\coding\dude accounting\dude-app`

## 3. 每周巡检 Prompt

```text
你现在执行 Dude Accounting 的每周巡检。

已知固定路径：
- 开发仓库：D:\coding\dude accounting\dude-app
- 推荐安装目录：D:\Apps\Dude Accounting
- 安装包输出目录：D:\coding\completed\dude-app
- 备份目录：D:\DudeAccountingData\Backups
- 导出目录：D:\DudeAccountingData\Exports

执行目标：
1. 检查仓库是否还能正常 typecheck、test、build。
2. 检查安装目录和日志目录是否存在。
3. 检查最近 7 天错误日志和运行日志是否存在明显异常。
4. 检查最近备份是否存在。
5. 输出一个简洁、结构化的巡检结论。

执行规则：
- 如果安装目录不存在，明确写出“未发现安装目录”，不要臆测。
- 如果日志目录被改成自定义路径，以软件当前日志状态为准；如果无法直接获得，则先检查安装目录下 logs，再在结论里说明路径不确定。
- 如果备份目录不存在，明确标记为“未发现备份目录”。
- 如果 typecheck、test、build 任一失败，优先报告失败项，不要掩盖。
- 不要修改代码，不要自动修复，只做巡检和总结。

建议执行项：
- 查看 git status
- 执行 npm run typecheck
- 执行 npm test
- 执行 npm run build
- 统计最近 7 天 error-*.jsonl / runtime-*.jsonl
- 查看最近备份文件时间和大小

输出格式：
1. 巡检摘要
2. 构建结果
3. 安装与日志结果
4. 备份结果
5. 风险与建议

风险判定规则：
- 只要出现错误日志集中爆发、构建失败、备份缺失、安装目录异常其中任意一项，就标记为“需要人工处理”。
- 若全部正常，标记为“本周未发现阻塞性问题”。
```

## 4. 每月巡检 Prompt

```text
你现在执行 Dude Accounting 的每月巡检。

已知固定路径：
- 开发仓库：D:\coding\dude accounting\dude-app
- 推荐安装目录：D:\Apps\Dude Accounting
- 安装包输出目录：D:\coding\completed\dude-app
- 备份目录：D:\DudeAccountingData\Backups
- 导出目录：D:\DudeAccountingData\Exports

执行目标：
1. 完成每周巡检的全部内容。
2. 检查日志留存策略是否生效，确认超过 1 个月的自动日志已清理。
3. 检查安装包是否仍可正常构建。
4. 检查覆盖升级路径是否仍可用。
5. 重点输出“是否需要发布新版本”。

执行规则：
- 不要自动修改代码，不要自动发布。
- 如果无法执行覆盖升级测试，明确写出原因。
- 如果安装目录位于受保护目录，明确提示潜在写权限风险。

输出格式：
1. 月度巡检摘要
2. 构建与打包结果
3. 安装与升级结果
4. 日志与留存结果
5. 备份与恢复结果
6. 发布建议
```

## 5. 如果你要在 AUTOMATIONS 里创建任务

建议频率：

- 每周巡检：每周一上午 9:00
- 每月巡检：每月第一个周一上午 10:00

建议 `cwds`：

- `D:\coding\dude accounting\dude-app`
