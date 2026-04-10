export type CommandPromptHintKey = 'username' | 'password' | 'ledgerId' | 'period'
export type CommandSessionEffect = 'login' | 'logout' | 'none'

export interface CommandMetadata {
  domain: string
  action: string
  description: string
  aliases: string[]
  batchSafe: boolean
  desktopAssisted: boolean
  requiresSession: boolean
  sessionEffect: CommandSessionEffect
  uiMethods: string[]
  promptHints: CommandPromptHintKey[]
}

const commandMetadata: CommandMetadata[] = [
  { domain: 'auth', action: 'login', description: '登录当前 CLI 会话', aliases: ['登录'], batchSafe: true, desktopAssisted: false, requiresSession: false, sessionEffect: 'login', uiMethods: ['window.api.auth.login'], promptHints: ['username', 'password'] },
  { domain: 'auth', action: 'logout', description: '退出当前 CLI 会话', aliases: ['退出登录'], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'logout', uiMethods: ['window.api.auth.logout'], promptHints: [] },
  { domain: 'auth', action: 'whoami', description: '查看当前登录用户', aliases: ['我是谁'], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: [], promptHints: [] },
  { domain: 'auth', action: 'list-users', description: '列出全部用户', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.auth.getUsers'], promptHints: [] },
  { domain: 'auth', action: 'create-user', description: '创建用户', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.auth.createUser'], promptHints: [] },
  { domain: 'auth', action: 'update-user', description: '更新用户', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.auth.updateUser'], promptHints: [] },
  { domain: 'auth', action: 'delete-user', description: '删除用户', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.auth.deleteUser'], promptHints: [] },
  { domain: 'audit-log', action: 'list', description: '查询操作日志', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.auditLog.list'], promptHints: [] },
  { domain: 'audit-log', action: 'export', description: '导出操作日志', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.auditLog.export'], promptHints: [] },
  { domain: 'ledger', action: 'list', description: '查看账套列表', aliases: ['账套列表'], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.ledger.getAll'], promptHints: [] },
  { domain: 'ledger', action: 'create', description: '创建账套', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.ledger.create'], promptHints: [] },
  { domain: 'ledger', action: 'update', description: '更新账套', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.ledger.update'], promptHints: [] },
  { domain: 'ledger', action: 'delete', description: '删除账套', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.ledger.delete'], promptHints: ['ledgerId'] },
  { domain: 'ledger', action: 'risk', description: '获取账套删除风险快照', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.ledger.getDeletionRisk'], promptHints: ['ledgerId'] },
  { domain: 'ledger', action: 'periods', description: '查看账套期间列表', aliases: ['期间列表'], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.ledger.getPeriods'], promptHints: ['ledgerId'] },
  { domain: 'ledger', action: 'templates', description: '列出标准账套模板', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.ledger.getStandardTemplates'], promptHints: [] },
  { domain: 'ledger', action: 'apply-template', description: '应用账套标准模板', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.ledger.applyStandardTemplate'], promptHints: ['ledgerId'] },
  { domain: 'subject', action: 'list', description: '查看科目列表', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.subject.getAll'], promptHints: ['ledgerId'] },
  { domain: 'subject', action: 'search', description: '搜索末级科目', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.subject.search'], promptHints: ['ledgerId'] },
  { domain: 'subject', action: 'create', description: '创建科目', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.subject.create'], promptHints: [] },
  { domain: 'subject', action: 'update', description: '更新科目', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.subject.update'], promptHints: [] },
  { domain: 'subject', action: 'delete', description: '删除科目', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.subject.delete'], promptHints: [] },
  { domain: 'auxiliary', action: 'list', description: '查看辅助项', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.auxiliary.getAll', 'window.api.auxiliary.getByCategory'], promptHints: ['ledgerId'] },
  { domain: 'auxiliary', action: 'create', description: '创建辅助项', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.auxiliary.create'], promptHints: [] },
  { domain: 'auxiliary', action: 'update', description: '更新辅助项', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.auxiliary.update'], promptHints: [] },
  { domain: 'auxiliary', action: 'delete', description: '删除辅助项', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.auxiliary.delete'], promptHints: [] },
  { domain: 'cashflow', action: 'items', description: '查看现金流量项目', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.cashflow.getItems'], promptHints: ['ledgerId'] },
  { domain: 'cashflow', action: 'list', description: '查看现金流量映射规则', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.cashflow.getMappings'], promptHints: ['ledgerId'] },
  { domain: 'cashflow', action: 'create', description: '创建现金流量映射规则', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.cashflow.createMapping'], promptHints: [] },
  { domain: 'cashflow', action: 'update', description: '更新现金流量映射规则', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.cashflow.updateMapping'], promptHints: [] },
  { domain: 'cashflow', action: 'delete', description: '删除现金流量映射规则', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.cashflow.deleteMapping'], promptHints: [] },
  { domain: 'voucher', action: 'next-number', description: '获取下一个凭证号', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.voucher.getNextNumber'], promptHints: ['ledgerId', 'period'] },
  { domain: 'voucher', action: 'save', description: '创建凭证', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.voucher.save'], promptHints: [] },
  { domain: 'voucher', action: 'update', description: '更新凭证', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.voucher.update'], promptHints: [] },
  { domain: 'voucher', action: 'list', description: '查询凭证列表', aliases: ['凭证列表'], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.voucher.list'], promptHints: ['ledgerId'] },
  { domain: 'voucher', action: 'entries', description: '查询凭证明细', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.voucher.getEntries'], promptHints: [] },
  { domain: 'voucher', action: 'swap', description: '交换凭证位置', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.voucher.swapPositions'], promptHints: [] },
  { domain: 'voucher', action: 'batch', description: '批量处理凭证', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.voucher.batchAction'], promptHints: [] },
  { domain: 'initial-balance', action: 'list', description: '查询期初余额', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.initialBalance.list'], promptHints: ['ledgerId', 'period'] },
  { domain: 'initial-balance', action: 'save', description: '保存期初余额', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.initialBalance.save'], promptHints: [] },
  { domain: 'period', action: 'status', description: '查看期间状态', aliases: ['期间状态'], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.period.getStatus'], promptHints: ['ledgerId', 'period'] },
  { domain: 'period', action: 'close', description: '结账', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.period.close'], promptHints: [] },
  { domain: 'period', action: 'reopen', description: '反结账', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.period.reopen'], promptHints: [] },
  { domain: 'carry-forward', action: 'rules', description: '查看损益结转规则', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.plCarryForward.listRules'], promptHints: ['ledgerId'] },
  { domain: 'carry-forward', action: 'save', description: '保存损益结转规则', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.plCarryForward.saveRules'], promptHints: [] },
  { domain: 'carry-forward', action: 'preview', description: '预览损益结转凭证', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.plCarryForward.preview'], promptHints: ['ledgerId', 'period'] },
  { domain: 'carry-forward', action: 'execute', description: '执行损益结转', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.plCarryForward.execute'], promptHints: ['ledgerId', 'period'] },
  { domain: 'report', action: 'list', description: '查询报表快照列表', aliases: ['报表列表'], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.reporting.list'], promptHints: ['ledgerId'] },
  { domain: 'report', action: 'detail', description: '查询报表快照详情', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.reporting.getDetail'], promptHints: [] },
  { domain: 'report', action: 'generate', description: '生成报表快照', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.reporting.generate'], promptHints: [] },
  { domain: 'report', action: 'delete', description: '删除报表快照', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.reporting.delete'], promptHints: [] },
  { domain: 'report', action: 'export', description: '导出报表快照', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.reporting.export'], promptHints: [] },
  { domain: 'report', action: 'export-batch', description: '批量导出报表快照', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.reporting.exportBatch'], promptHints: [] },
  { domain: 'book', action: 'subject-balances', description: '查询科目余额表', aliases: ['科目余额表'], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.bookQuery.listSubjectBalances'], promptHints: ['ledgerId', 'period'] },
  { domain: 'book', action: 'detail-ledger', description: '查询明细账', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.bookQuery.getDetailLedger'], promptHints: [] },
  { domain: 'book', action: 'journal', description: '查询序时账', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.bookQuery.getJournal'], promptHints: [] },
  { domain: 'book', action: 'aux-balances', description: '查询辅助余额表', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.bookQuery.getAuxiliaryBalances'], promptHints: [] },
  { domain: 'book', action: 'aux-detail', description: '查询辅助明细账', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.bookQuery.getAuxiliaryDetail'], promptHints: [] },
  { domain: 'book', action: 'export', description: '导出账簿查询结果', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.bookQuery.export'], promptHints: [] },
  { domain: 'backup', action: 'create', description: '创建账套备份包', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.backup.create'], promptHints: ['ledgerId'] },
  { domain: 'backup', action: 'list', description: '查询备份包列表', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.backup.list'], promptHints: ['ledgerId'] },
  { domain: 'backup', action: 'validate', description: '校验备份包', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.backup.validate'], promptHints: [] },
  { domain: 'backup', action: 'import', description: '导入账套备份包为新账套', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.backup.import'], promptHints: [] },
  { domain: 'backup', action: 'delete', description: '删除备份包记录或实体', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.backup.delete'], promptHints: [] },
  { domain: 'backup', action: 'restore', description: '恢复整库备份', aliases: [], batchSafe: true, desktopAssisted: true, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.backup.restore'], promptHints: [] },
  { domain: 'archive', action: 'export', description: '导出电子会计档案', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.archive.export'], promptHints: ['ledgerId'] },
  { domain: 'archive', action: 'list', description: '查询档案导出记录', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.archive.list'], promptHints: ['ledgerId'] },
  { domain: 'archive', action: 'validate', description: '校验档案导出包', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.archive.validate'], promptHints: [] },
  { domain: 'archive', action: 'delete', description: '删除档案导出记录或实体', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.archive.delete'], promptHints: [] },
  { domain: 'archive', action: 'manifest', description: '查看档案导出清单', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.archive.getManifest'], promptHints: [] },
  { domain: 'evoucher', action: 'import', description: '导入电子凭证原件', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.eVoucher.import'], promptHints: ['ledgerId'] },
  { domain: 'evoucher', action: 'list', description: '查询电子凭证记录', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.eVoucher.list'], promptHints: ['ledgerId'] },
  { domain: 'evoucher', action: 'verify', description: '更新电子凭证校验结果', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.eVoucher.verify'], promptHints: [] },
  { domain: 'evoucher', action: 'parse', description: '解析电子凭证结构化数据', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.eVoucher.parse'], promptHints: [] },
  { domain: 'evoucher', action: 'convert', description: '将电子凭证转换为凭证草稿', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.eVoucher.convert'], promptHints: [] },
  { domain: 'settings', action: 'system-get', description: '读取系统参数', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.getSystemParams'], promptHints: [] },
  { domain: 'settings', action: 'system-set', description: '设置系统参数', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.setSystemParam'], promptHints: [] },
  { domain: 'settings', action: 'runtime-defaults-get', description: '读取运行时默认值', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.getRuntimeDefaults'], promptHints: [] },
  { domain: 'settings', action: 'preferences-get', description: '读取当前用户偏好', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.getUserPreferences'], promptHints: [] },
  { domain: 'settings', action: 'preferences-set', description: '更新当前用户偏好', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.setUserPreferences'], promptHints: [] },
  { domain: 'settings', action: 'diagnostics-status', description: '读取诊断日志状态', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.getErrorLogStatus'], promptHints: [] },
  { domain: 'settings', action: 'diagnostics-set-dir', description: '设置诊断日志目录', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.chooseDiagnosticsLogDirectory'], promptHints: [] },
  { domain: 'settings', action: 'diagnostics-reset-dir', description: '恢复默认诊断日志目录', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.restoreDefaultDiagnosticsLogDirectory'], promptHints: [] },
  { domain: 'settings', action: 'diagnostics-export', description: '导出诊断日志', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.exportDiagnosticsLogs'], promptHints: [] },
  { domain: 'settings', action: 'diagnostics-open-dir', description: '打开诊断日志目录', aliases: [], batchSafe: true, desktopAssisted: true, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.openErrorLogDirectory'], promptHints: [] },
  { domain: 'settings', action: 'wallpaper-status', description: '读取当前用户壁纸状态', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.getWallpaperState'], promptHints: [] },
  { domain: 'settings', action: 'wallpaper-login-status', description: '读取登录页壁纸状态', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.getLoginWallpaperState'], promptHints: [] },
  { domain: 'settings', action: 'wallpaper-analyze', description: '分析壁纸源文件并生成建议视口', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.chooseWallpaper'], promptHints: [] },
  { domain: 'settings', action: 'wallpaper-apply', description: '裁切并应用当前用户壁纸', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.applyWallpaperCrop'], promptHints: [] },
  { domain: 'settings', action: 'wallpaper-restore', description: '恢复默认壁纸', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.restoreDefaultWallpaper'], promptHints: [] },
  { domain: 'settings', action: 'subject-template-get', description: '读取一级科目模板', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.getSubjectTemplate'], promptHints: [] },
  { domain: 'settings', action: 'subject-template-reference', description: '读取一级科目模板参考数据', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.getSubjectTemplateReference'], promptHints: [] },
  { domain: 'settings', action: 'subject-template-parse-import', description: '解析一级科目模板导入文件', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.parseSubjectTemplateImport'], promptHints: [] },
  { domain: 'settings', action: 'subject-template-save', description: '保存一级科目模板', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.saveSubjectTemplate'], promptHints: [] },
  { domain: 'settings', action: 'subject-template-import', description: '导入一级科目模板', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.importSubjectTemplate'], promptHints: [] },
  { domain: 'settings', action: 'subject-template-download', description: '导出一级科目模板 Excel', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.downloadSubjectTemplate'], promptHints: [] },
  { domain: 'settings', action: 'subject-template-clear', description: '清空一级科目模板', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.clearSubjectTemplate'], promptHints: [] },
  { domain: 'settings', action: 'custom-template-list', description: '列出独立自定义模板', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.listIndependentCustomSubjectTemplates'], promptHints: [] },
  { domain: 'settings', action: 'custom-template-get', description: '读取独立自定义模板详情', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.getIndependentCustomSubjectTemplate'], promptHints: [] },
  { domain: 'settings', action: 'custom-template-save', description: '保存独立自定义模板', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.saveIndependentCustomSubjectTemplate'], promptHints: [] },
  { domain: 'settings', action: 'custom-template-import', description: '导入并保存独立自定义模板', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: [], promptHints: [] },
  { domain: 'settings', action: 'custom-template-clear-entries', description: '清空独立自定义模板条目', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.clearIndependentCustomSubjectTemplateEntries'], promptHints: [] },
  { domain: 'settings', action: 'custom-template-delete', description: '删除独立自定义模板', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.settings.deleteIndependentCustomSubjectTemplate'], promptHints: [] },
  { domain: 'print', action: 'prepare', description: '创建打印任务', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.print.prepare'], promptHints: [] },
  { domain: 'print', action: 'status', description: '查询打印任务状态', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.print.getJobStatus'], promptHints: [] },
  { domain: 'print', action: 'model', description: '读取打印预览模型', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.print.getPreviewModel'], promptHints: [] },
  { domain: 'print', action: 'update-settings', description: '更新打印预览设置', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.print.updatePreviewSettings'], promptHints: [] },
  { domain: 'print', action: 'open-preview', description: '打开打印预览窗口', aliases: [], batchSafe: true, desktopAssisted: true, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.print.openPreview'], promptHints: [] },
  { domain: 'print', action: 'print', description: '执行系统打印', aliases: [], batchSafe: true, desktopAssisted: true, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.print.print'], promptHints: [] },
  { domain: 'print', action: 'export-pdf', description: '导出打印版 PDF', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.print.exportPdf'], promptHints: [] },
  { domain: 'print', action: 'dispose', description: '释放打印任务', aliases: [], batchSafe: true, desktopAssisted: false, requiresSession: true, sessionEffect: 'none', uiMethods: ['window.api.print.dispose'], promptHints: [] }
]

export function getCommandMetadata(): CommandMetadata[] {
  return [...commandMetadata]
}

export function findCommandMetadata(domain: string, action: string): CommandMetadata | undefined {
  return commandMetadata.find((item) => item.domain === domain && item.action === action)
}

export function findCommandMetadataByAlias(alias: string): CommandMetadata | undefined {
  const normalizedAlias = alias.trim()
  return commandMetadata.find((item) => item.aliases.includes(normalizedAlias))
}

export function listCommandKeys(): string[] {
  return commandMetadata.map((item) => `${item.domain} ${item.action}`)
}

export function searchCommandMetadata(keyword: string): CommandMetadata[] {
  const normalizedKeyword = keyword.trim().toLowerCase()
  if (!normalizedKeyword) {
    return []
  }

  return commandMetadata.filter((item) =>
    [item.domain, item.action, item.description, ...item.aliases, ...item.uiMethods]
      .join(' ')
      .toLowerCase()
      .includes(normalizedKeyword)
  )
}
