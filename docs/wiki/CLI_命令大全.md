---
title: "CLI 命令大全"
description: "Dude Accounting CLI 全量命令与中文命令对照表"
---

# CLI 命令大全

本文档以 `src/main/commands/catalog.ts` 和 `src/cli/interactive.ts` 为事实源。英文 canonical 命令是正式批处理契约；中文命令用于交互式输入、完整 help 展示与人工查阅。

- 批处理完整帮助：`dude-accounting --help --all`
- 交互式完整帮助：`help all` / `帮助 all`

## 交互式内建命令

| 命令 | 中文别名 | 功能 |
| --- | --- | --- |
| `help` | 帮助 | 查看交互式命令帮助 |
| `exit` | quit / 退出 | 退出交互式 CLI |
| `clear` | cls / 清屏 | 清空当前终端内容 |
| `mode` | 模式 | 切换输出模式：mode pretty|json |
| `context` | 上下文 | 查看当前交互上下文 |
| `context clear` | 清空上下文 | 清空当前账套和期间上下文 |
| `use ledger` | 选择账套 | 设置当前账套：use ledger <ledgerId> |
| `use period` | 选择期间 | 设置当前期间：use period <YYYY-MM> |
| `unset ledger` | 清除账套 | 清除当前账套并一并清除期间 |
| `unset period` | 清除期间 | 清除当前期间 |

## auth

| 英文命令 | 中文命令 | 功能说明 | 需登录 | 桌面辅助 |
| --- | --- | --- | --- | --- |
| `auth login` | 登录 | 登录当前 CLI 会话 | 否 | 否 |
| `auth logout` | 退出登录 | 退出当前 CLI 会话 | 是 | 否 |
| `auth whoami` | 我是谁 | 查看当前登录用户 | 是 | 否 |
| `auth list-users` | 列出全部用户 | 列出全部用户 | 是 | 否 |
| `auth create-user` | 创建用户 | 创建用户 | 是 | 否 |
| `auth update-user` | 更新用户 | 更新用户 | 是 | 否 |
| `auth delete-user` | 删除用户 | 删除用户 | 是 | 否 |

## audit-log

| 英文命令 | 中文命令 | 功能说明 | 需登录 | 桌面辅助 |
| --- | --- | --- | --- | --- |
| `audit-log list` | 查询操作日志 | 查询操作日志 | 是 | 否 |
| `audit-log export` | 导出操作日志 | 导出操作日志 | 是 | 否 |

## ledger

| 英文命令 | 中文命令 | 功能说明 | 需登录 | 桌面辅助 |
| --- | --- | --- | --- | --- |
| `ledger list` | 账套列表 | 查看账套列表 | 是 | 否 |
| `ledger create` | 创建账套 | 创建账套 | 是 | 否 |
| `ledger update` | 更新账套 | 更新账套 | 是 | 否 |
| `ledger delete` | 删除账套 | 删除账套 | 是 | 否 |
| `ledger risk` | 获取账套删除风险快照 | 获取账套删除风险快照 | 是 | 否 |
| `ledger periods` | 期间列表 | 查看账套期间列表 | 是 | 否 |
| `ledger templates` | 列出标准账套模板 | 列出标准账套模板 | 是 | 否 |
| `ledger apply-template` | 应用账套标准模板 | 应用账套标准模板 | 是 | 否 |

## subject

| 英文命令 | 中文命令 | 功能说明 | 需登录 | 桌面辅助 |
| --- | --- | --- | --- | --- |
| `subject list` | 查看科目列表 | 查看科目列表 | 是 | 否 |
| `subject search` | 搜索末级科目 | 搜索末级科目 | 是 | 否 |
| `subject create` | 创建科目 | 创建科目 | 是 | 否 |
| `subject update` | 更新科目 | 更新科目 | 是 | 否 |
| `subject delete` | 删除科目 | 删除科目 | 是 | 否 |

## auxiliary

| 英文命令 | 中文命令 | 功能说明 | 需登录 | 桌面辅助 |
| --- | --- | --- | --- | --- |
| `auxiliary list` | 查看辅助项 | 查看辅助项 | 是 | 否 |
| `auxiliary create` | 创建辅助项 | 创建辅助项 | 是 | 否 |
| `auxiliary update` | 更新辅助项 | 更新辅助项 | 是 | 否 |
| `auxiliary delete` | 删除辅助项 | 删除辅助项 | 是 | 否 |

## cashflow

| 英文命令 | 中文命令 | 功能说明 | 需登录 | 桌面辅助 |
| --- | --- | --- | --- | --- |
| `cashflow items` | 查看现金流量项目 | 查看现金流量项目 | 是 | 否 |
| `cashflow list` | 查看现金流量映射规则 | 查看现金流量映射规则 | 是 | 否 |
| `cashflow create` | 创建现金流量映射规则 | 创建现金流量映射规则 | 是 | 否 |
| `cashflow update` | 更新现金流量映射规则 | 更新现金流量映射规则 | 是 | 否 |
| `cashflow delete` | 删除现金流量映射规则 | 删除现金流量映射规则 | 是 | 否 |

## voucher

| 英文命令 | 中文命令 | 功能说明 | 需登录 | 桌面辅助 |
| --- | --- | --- | --- | --- |
| `voucher next-number` | 获取下一个凭证号 | 获取下一个凭证号 | 是 | 否 |
| `voucher save` | 创建凭证 | 创建凭证 | 是 | 否 |
| `voucher update` | 更新凭证 | 更新凭证 | 是 | 否 |
| `voucher list` | 凭证列表 | 查询凭证列表 | 是 | 否 |
| `voucher entries` | 查询凭证明细 | 查询凭证明细 | 是 | 否 |
| `voucher swap` | 交换凭证位置 | 交换凭证位置 | 是 | 否 |
| `voucher batch` | 批量处理凭证 | 批量处理凭证 | 是 | 否 |

## initial-balance

| 英文命令 | 中文命令 | 功能说明 | 需登录 | 桌面辅助 |
| --- | --- | --- | --- | --- |
| `initial-balance list` | 查询期初余额 | 查询期初余额 | 是 | 否 |
| `initial-balance save` | 保存期初余额 | 保存期初余额 | 是 | 否 |

## period

| 英文命令 | 中文命令 | 功能说明 | 需登录 | 桌面辅助 |
| --- | --- | --- | --- | --- |
| `period status` | 期间状态 | 查看期间状态 | 是 | 否 |
| `period close` | 结账 | 结账 | 是 | 否 |
| `period reopen` | 反结账 | 反结账 | 是 | 否 |

## carry-forward

| 英文命令 | 中文命令 | 功能说明 | 需登录 | 桌面辅助 |
| --- | --- | --- | --- | --- |
| `carry-forward rules` | 查看损益结转规则 | 查看损益结转规则 | 是 | 否 |
| `carry-forward save` | 保存损益结转规则 | 保存损益结转规则 | 是 | 否 |
| `carry-forward preview` | 预览损益结转凭证 | 预览损益结转凭证 | 是 | 否 |
| `carry-forward execute` | 执行损益结转 | 执行损益结转 | 是 | 否 |

## report

| 英文命令 | 中文命令 | 功能说明 | 需登录 | 桌面辅助 |
| --- | --- | --- | --- | --- |
| `report list` | 报表列表 | 查询报表快照列表 | 是 | 否 |
| `report detail` | 查询报表快照详情 | 查询报表快照详情 | 是 | 否 |
| `report generate` | 生成报表快照 | 生成报表快照 | 是 | 否 |
| `report delete` | 删除报表快照 | 删除报表快照 | 是 | 否 |
| `report export` | 导出报表快照 | 导出报表快照 | 是 | 否 |
| `report export-batch` | 批量导出报表快照 | 批量导出报表快照 | 是 | 否 |

## book

| 英文命令 | 中文命令 | 功能说明 | 需登录 | 桌面辅助 |
| --- | --- | --- | --- | --- |
| `book subject-balances` | 科目余额表 | 查询科目余额表 | 是 | 否 |
| `book detail-ledger` | 查询明细账 | 查询明细账 | 是 | 否 |
| `book journal` | 查询序时账 | 查询序时账 | 是 | 否 |
| `book aux-balances` | 查询辅助余额表 | 查询辅助余额表 | 是 | 否 |
| `book aux-detail` | 查询辅助明细账 | 查询辅助明细账 | 是 | 否 |
| `book export` | 导出账簿查询结果 | 导出账簿查询结果 | 是 | 否 |

## backup

| 英文命令 | 中文命令 | 功能说明 | 需登录 | 桌面辅助 |
| --- | --- | --- | --- | --- |
| `backup create` | 创建账套备份包 | 创建账套备份包 | 是 | 否 |
| `backup list` | 查询备份包列表 | 查询备份包列表 | 是 | 否 |
| `backup validate` | 校验备份包 | 校验备份包 | 是 | 否 |
| `backup import` | 导入账套备份包为新账套 | 导入账套备份包为新账套 | 是 | 否 |
| `backup delete` | 删除备份包记录或实体 | 删除备份包记录或实体 | 是 | 否 |
| `backup restore` | 恢复整库备份 | 恢复整库备份 | 是 | 是 |

## archive

| 英文命令 | 中文命令 | 功能说明 | 需登录 | 桌面辅助 |
| --- | --- | --- | --- | --- |
| `archive export` | 导出电子会计档案 | 导出电子会计档案 | 是 | 否 |
| `archive list` | 查询档案导出记录 | 查询档案导出记录 | 是 | 否 |
| `archive validate` | 校验档案导出包 | 校验档案导出包 | 是 | 否 |
| `archive delete` | 删除档案导出记录或实体 | 删除档案导出记录或实体 | 是 | 否 |
| `archive manifest` | 查看档案导出清单 | 查看档案导出清单 | 是 | 否 |

## evoucher

| 英文命令 | 中文命令 | 功能说明 | 需登录 | 桌面辅助 |
| --- | --- | --- | --- | --- |
| `evoucher import` | 导入电子凭证原件 | 导入电子凭证原件 | 是 | 否 |
| `evoucher list` | 查询电子凭证记录 | 查询电子凭证记录 | 是 | 否 |
| `evoucher verify` | 更新电子凭证校验结果 | 更新电子凭证校验结果 | 是 | 否 |
| `evoucher parse` | 解析电子凭证结构化数据 | 解析电子凭证结构化数据 | 是 | 否 |
| `evoucher convert` | 将电子凭证转换为凭证草稿 | 将电子凭证转换为凭证草稿 | 是 | 否 |

## settings

| 英文命令 | 中文命令 | 功能说明 | 需登录 | 桌面辅助 |
| --- | --- | --- | --- | --- |
| `settings system-get` | 读取系统参数 | 读取系统参数 | 是 | 否 |
| `settings system-set` | 设置系统参数 | 设置系统参数 | 是 | 否 |
| `settings runtime-defaults-get` | 读取运行时默认值 | 读取运行时默认值 | 是 | 否 |
| `settings preferences-get` | 读取当前用户偏好 | 读取当前用户偏好 | 是 | 否 |
| `settings preferences-set` | 更新当前用户偏好 | 更新当前用户偏好 | 是 | 否 |
| `settings diagnostics-status` | 读取诊断日志状态 | 读取诊断日志状态 | 是 | 否 |
| `settings diagnostics-set-dir` | 设置诊断日志目录 | 设置诊断日志目录 | 是 | 否 |
| `settings diagnostics-reset-dir` | 恢复默认诊断日志目录 | 恢复默认诊断日志目录 | 是 | 否 |
| `settings diagnostics-export` | 导出诊断日志 | 导出诊断日志 | 是 | 否 |
| `settings diagnostics-open-dir` | 打开诊断日志目录 | 打开诊断日志目录 | 是 | 是 |
| `settings wallpaper-status` | 读取当前用户壁纸状态 | 读取当前用户壁纸状态 | 是 | 否 |
| `settings wallpaper-login-status` | 读取登录页壁纸状态 | 读取登录页壁纸状态 | 是 | 否 |
| `settings wallpaper-analyze` | 分析壁纸源文件并生成建议视口 | 分析壁纸源文件并生成建议视口 | 是 | 否 |
| `settings wallpaper-apply` | 裁切并应用当前用户壁纸 | 裁切并应用当前用户壁纸 | 是 | 否 |
| `settings wallpaper-restore` | 恢复默认壁纸 | 恢复默认壁纸 | 是 | 否 |
| `settings subject-template-get` | 读取一级科目模板 | 读取一级科目模板 | 是 | 否 |
| `settings subject-template-reference` | 读取一级科目模板参考数据 | 读取一级科目模板参考数据 | 是 | 否 |
| `settings subject-template-parse-import` | 解析一级科目模板导入文件 | 解析一级科目模板导入文件 | 是 | 否 |
| `settings subject-template-save` | 保存一级科目模板 | 保存一级科目模板 | 是 | 否 |
| `settings subject-template-import` | 导入一级科目模板 | 导入一级科目模板 | 是 | 否 |
| `settings subject-template-download` | 导出一级科目模板 Excel | 导出一级科目模板 Excel | 是 | 否 |
| `settings subject-template-clear` | 清空一级科目模板 | 清空一级科目模板 | 是 | 否 |
| `settings custom-template-list` | 列出独立自定义模板 | 列出独立自定义模板 | 是 | 否 |
| `settings custom-template-get` | 读取独立自定义模板详情 | 读取独立自定义模板详情 | 是 | 否 |
| `settings custom-template-save` | 保存独立自定义模板 | 保存独立自定义模板 | 是 | 否 |
| `settings custom-template-import` | 导入并保存独立自定义模板 | 导入并保存独立自定义模板 | 是 | 否 |
| `settings custom-template-clear-entries` | 清空独立自定义模板条目 | 清空独立自定义模板条目 | 是 | 否 |
| `settings custom-template-delete` | 删除独立自定义模板 | 删除独立自定义模板 | 是 | 否 |

## print

| 英文命令 | 中文命令 | 功能说明 | 需登录 | 桌面辅助 |
| --- | --- | --- | --- | --- |
| `print prepare` | 创建打印任务 | 创建打印任务 | 是 | 否 |
| `print status` | 查询打印任务状态 | 查询打印任务状态 | 是 | 否 |
| `print model` | 读取打印预览模型 | 读取打印预览模型 | 是 | 否 |
| `print update-settings` | 更新打印预览设置 | 更新打印预览设置 | 是 | 否 |
| `print open-preview` | 打开打印预览窗口 | 打开打印预览窗口 | 是 | 是 |
| `print print` | 执行系统打印 | 执行系统打印 | 是 | 是 |
| `print export-pdf` | 导出打印版 PDF | 导出打印版 PDF | 是 | 否 |
| `print dispose` | 释放打印任务 | 释放打印任务 | 是 | 否 |
