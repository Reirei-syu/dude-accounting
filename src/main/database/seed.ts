import Database from 'better-sqlite3'

export function seedAdminUser(db: Database.Database): void {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin')
  if (existing) return

  db.prepare(
    `INSERT INTO users (username, real_name, password_hash, permissions, is_admin)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    'admin',
    '超级管理员',
    '',
    JSON.stringify({
      voucher_entry: true,
      audit: true,
      bookkeeping: true,
      system_settings: true,
      ledger_settings: true
    }),
    1
  )
}

interface SubjectDef {
  code: string
  name: string
  category: 'asset' | 'liability' | 'common' | 'equity' | 'cost' | 'profit_loss'
  balance_direction: number // 1=debit, -1=credit
  is_cash_flow?: boolean
}

type AccountingStandardType = 'enterprise' | 'npo'

const ENTERPRISE_SUBJECTS: SubjectDef[] = [
  // ===== 一、资产类（78个）=====
  { code: '1001', name: '库存现金', category: 'asset', balance_direction: 1, is_cash_flow: true },
  { code: '1002', name: '银行存款', category: 'asset', balance_direction: 1, is_cash_flow: true },
  { code: '1003', name: '存放中央银行款项', category: 'asset', balance_direction: 1 },
  { code: '1011', name: '存放同业', category: 'asset', balance_direction: 1 },
  {
    code: '1012',
    name: '其他货币资金',
    category: 'asset',
    balance_direction: 1,
    is_cash_flow: true
  },
  { code: '1021', name: '结算备付金', category: 'asset', balance_direction: 1 },
  { code: '1031', name: '存出保证金', category: 'asset', balance_direction: 1 },
  { code: '1101', name: '交易性金融资产', category: 'asset', balance_direction: 1 },
  { code: '1111', name: '买入返售金融资产', category: 'asset', balance_direction: 1 },
  { code: '1121', name: '应收票据', category: 'asset', balance_direction: 1 },
  { code: '1122', name: '应收账款', category: 'asset', balance_direction: 1 },
  { code: '1123', name: '预付账款', category: 'asset', balance_direction: 1 },
  { code: '1131', name: '应收股利', category: 'asset', balance_direction: 1 },
  { code: '1132', name: '应收利息', category: 'asset', balance_direction: 1 },
  { code: '1201', name: '应收代位追偿款', category: 'asset', balance_direction: 1 },
  { code: '1211', name: '应收分保账款', category: 'asset', balance_direction: 1 },
  { code: '1212', name: '应收分保合同准备金', category: 'asset', balance_direction: 1 },
  { code: '1221', name: '其他应收款', category: 'asset', balance_direction: 1 },
  { code: '1231', name: '坏账准备', category: 'asset', balance_direction: -1 },
  { code: '1301', name: '贴现资产', category: 'asset', balance_direction: 1 },
  { code: '1302', name: '拆出资金', category: 'asset', balance_direction: 1 },
  { code: '1303', name: '贷款', category: 'asset', balance_direction: 1 },
  { code: '1304', name: '贷款损失准备', category: 'asset', balance_direction: -1 },
  { code: '1311', name: '代理兑付证券', category: 'asset', balance_direction: 1 },
  { code: '1321', name: '代理业务资产', category: 'asset', balance_direction: 1 },
  { code: '1401', name: '材料采购', category: 'asset', balance_direction: 1 },
  { code: '1402', name: '在途物资', category: 'asset', balance_direction: 1 },
  { code: '1403', name: '原材料', category: 'asset', balance_direction: 1 },
  { code: '1404', name: '材料成本差异', category: 'asset', balance_direction: 1 },
  { code: '1405', name: '库存商品', category: 'asset', balance_direction: 1 },
  { code: '1406', name: '发出商品', category: 'asset', balance_direction: 1 },
  { code: '1407', name: '商品进销差价', category: 'asset', balance_direction: -1 },
  { code: '1408', name: '委托加工物资', category: 'asset', balance_direction: 1 },
  { code: '1411', name: '周转材料', category: 'asset', balance_direction: 1 },
  { code: '1421', name: '消耗性生物资产', category: 'asset', balance_direction: 1 },
  { code: '1431', name: '贵金属', category: 'asset', balance_direction: 1 },
  { code: '1441', name: '抵债资产', category: 'asset', balance_direction: 1 },
  { code: '1451', name: '损余物资', category: 'asset', balance_direction: 1 },
  { code: '1461', name: '融资租赁资产', category: 'asset', balance_direction: 1 },
  { code: '1471', name: '存货跌价准备', category: 'asset', balance_direction: -1 },
  { code: '1501', name: '持有至到期投资', category: 'asset', balance_direction: 1 },
  { code: '1502', name: '持有至到期投资减值准备', category: 'asset', balance_direction: -1 },
  { code: '1503', name: '可供出售金融资产', category: 'asset', balance_direction: 1 },
  { code: '1511', name: '长期股权投资', category: 'asset', balance_direction: 1 },
  { code: '1512', name: '长期股权投资减值准备', category: 'asset', balance_direction: -1 },
  { code: '1521', name: '投资性房地产', category: 'asset', balance_direction: 1 },
  { code: '1531', name: '长期应收款', category: 'asset', balance_direction: 1 },
  { code: '1532', name: '未实现融资收益', category: 'asset', balance_direction: -1 },
  { code: '1541', name: '存出资本保证金', category: 'asset', balance_direction: 1 },
  { code: '1601', name: '固定资产', category: 'asset', balance_direction: 1 },
  { code: '1602', name: '累计折旧', category: 'asset', balance_direction: -1 },
  { code: '1603', name: '固定资产减值准备', category: 'asset', balance_direction: -1 },
  { code: '1604', name: '在建工程', category: 'asset', balance_direction: 1 },
  { code: '1605', name: '工程物资', category: 'asset', balance_direction: 1 },
  { code: '1606', name: '固定资产清理', category: 'asset', balance_direction: 1 },
  { code: '1611', name: '未担保余值', category: 'asset', balance_direction: 1 },
  { code: '1621', name: '生产性生物资产', category: 'asset', balance_direction: 1 },
  { code: '1622', name: '生产性生物资产累计折旧', category: 'asset', balance_direction: -1 },
  { code: '1623', name: '公益性生物资产', category: 'asset', balance_direction: 1 },
  { code: '1631', name: '油气资产', category: 'asset', balance_direction: 1 },
  { code: '1632', name: '累计折耗', category: 'asset', balance_direction: -1 },
  { code: '1701', name: '无形资产', category: 'asset', balance_direction: 1 },
  { code: '1702', name: '累计摊销', category: 'asset', balance_direction: -1 },
  { code: '1703', name: '无形资产减值准备', category: 'asset', balance_direction: -1 },
  { code: '1711', name: '商誉', category: 'asset', balance_direction: 1 },
  { code: '1801', name: '长期待摊费用', category: 'asset', balance_direction: 1 },
  { code: '1811', name: '递延所得税资产', category: 'asset', balance_direction: 1 },
  { code: '1821', name: '独立账户资产', category: 'asset', balance_direction: 1 },
  { code: '1901', name: '待处理财产损溢', category: 'asset', balance_direction: 1 },

  // ===== 二、负债类（38个）=====
  { code: '2001', name: '短期借款', category: 'liability', balance_direction: -1 },
  { code: '2002', name: '存入保证金', category: 'liability', balance_direction: -1 },
  { code: '2003', name: '拆入资金', category: 'liability', balance_direction: -1 },
  { code: '2004', name: '向中央银行借款', category: 'liability', balance_direction: -1 },
  { code: '2011', name: '吸收存款', category: 'liability', balance_direction: -1 },
  { code: '2012', name: '同业存放', category: 'liability', balance_direction: -1 },
  { code: '2021', name: '贴现负债', category: 'liability', balance_direction: -1 },
  { code: '2101', name: '交易性金融负债', category: 'liability', balance_direction: -1 },
  { code: '2111', name: '卖出回购金融资产款', category: 'liability', balance_direction: -1 },
  { code: '2201', name: '应付票据', category: 'liability', balance_direction: -1 },
  { code: '2202', name: '应付账款', category: 'liability', balance_direction: -1 },
  { code: '2203', name: '预收账款', category: 'liability', balance_direction: -1 },
  { code: '2211', name: '应付职工薪酬', category: 'liability', balance_direction: -1 },
  { code: '2221', name: '应交税费', category: 'liability', balance_direction: -1 },
  { code: '2231', name: '应付利息', category: 'liability', balance_direction: -1 },
  { code: '2232', name: '应付股利', category: 'liability', balance_direction: -1 },
  { code: '2241', name: '其他应付款', category: 'liability', balance_direction: -1 },
  { code: '2251', name: '应付保单红利', category: 'liability', balance_direction: -1 },
  { code: '2261', name: '应付分保账款', category: 'liability', balance_direction: -1 },
  { code: '2311', name: '代理买卖证券款', category: 'liability', balance_direction: -1 },
  { code: '2312', name: '代理承销证券款', category: 'liability', balance_direction: -1 },
  { code: '2313', name: '代理兑付证券款', category: 'liability', balance_direction: -1 },
  { code: '2314', name: '代理业务负债', category: 'liability', balance_direction: -1 },
  { code: '2401', name: '递延收益', category: 'liability', balance_direction: -1 },
  { code: '2501', name: '长期借款', category: 'liability', balance_direction: -1 },
  { code: '2502', name: '应付债券', category: 'liability', balance_direction: -1 },
  { code: '2601', name: '未到期责任准备金', category: 'liability', balance_direction: -1 },
  { code: '2602', name: '保险责任准备金', category: 'liability', balance_direction: -1 },
  { code: '2611', name: '保户储金', category: 'liability', balance_direction: -1 },
  { code: '2621', name: '独立账户负债', category: 'liability', balance_direction: -1 },
  { code: '2701', name: '长期应付款', category: 'liability', balance_direction: -1 },
  { code: '2702', name: '未确认融资费用', category: 'liability', balance_direction: 1 },
  { code: '2711', name: '专项应付款', category: 'liability', balance_direction: -1 },
  { code: '2801', name: '预计负债', category: 'liability', balance_direction: -1 },
  { code: '2901', name: '递延所得税负债', category: 'liability', balance_direction: -1 },

  // ===== 三、共同类（5个）=====
  { code: '3001', name: '清算资金往来', category: 'common', balance_direction: 1 },
  { code: '3002', name: '货币兑换', category: 'common', balance_direction: 1 },
  { code: '3101', name: '衍生工具', category: 'common', balance_direction: 1 },
  { code: '3201', name: '套期工具', category: 'common', balance_direction: 1 },
  { code: '3202', name: '被套期项目', category: 'common', balance_direction: 1 },

  // ===== 四、所有者权益类（7个）=====
  { code: '4001', name: '实收资本', category: 'equity', balance_direction: -1 },
  { code: '4002', name: '资本公积', category: 'equity', balance_direction: -1 },
  { code: '4101', name: '盈余公积', category: 'equity', balance_direction: -1 },
  { code: '4102', name: '一般风险准备', category: 'equity', balance_direction: -1 },
  { code: '4103', name: '本年利润', category: 'equity', balance_direction: -1 },
  { code: '4104', name: '利润分配', category: 'equity', balance_direction: -1 },
  { code: '4201', name: '库存股', category: 'equity', balance_direction: 1 },

  // ===== 五、成本类（7个）=====
  { code: '5001', name: '生产成本', category: 'cost', balance_direction: 1 },
  { code: '5101', name: '制造费用', category: 'cost', balance_direction: 1 },
  { code: '5201', name: '劳务成本', category: 'cost', balance_direction: 1 },
  { code: '5301', name: '研发支出', category: 'cost', balance_direction: 1 },
  { code: '5401', name: '工程施工', category: 'cost', balance_direction: 1 },
  { code: '5402', name: '工程结算', category: 'cost', balance_direction: -1 },
  { code: '5403', name: '机械作业', category: 'cost', balance_direction: 1 },

  // ===== 六、损益类（33个）=====
  { code: '6001', name: '主营业务收入', category: 'profit_loss', balance_direction: -1 },
  { code: '6011', name: '利息收入', category: 'profit_loss', balance_direction: -1 },
  { code: '6021', name: '手续费及佣金收入', category: 'profit_loss', balance_direction: -1 },
  { code: '6031', name: '保费收入', category: 'profit_loss', balance_direction: -1 },
  { code: '6041', name: '租赁收入', category: 'profit_loss', balance_direction: -1 },
  { code: '6051', name: '其他业务收入', category: 'profit_loss', balance_direction: -1 },
  { code: '6061', name: '汇兑损益', category: 'profit_loss', balance_direction: -1 },
  { code: '6101', name: '公允价值变动损益', category: 'profit_loss', balance_direction: -1 },
  { code: '6111', name: '投资收益', category: 'profit_loss', balance_direction: -1 },
  { code: '6201', name: '摊回保险责任准备金', category: 'profit_loss', balance_direction: -1 },
  { code: '6202', name: '摊回赔付支出', category: 'profit_loss', balance_direction: -1 },
  { code: '6203', name: '摊回分保费用', category: 'profit_loss', balance_direction: -1 },
  { code: '6301', name: '营业外收入', category: 'profit_loss', balance_direction: -1 },
  { code: '6401', name: '主营业务成本', category: 'profit_loss', balance_direction: 1 },
  { code: '6402', name: '其他业务成本', category: 'profit_loss', balance_direction: 1 },
  { code: '6403', name: '营业税金及附加', category: 'profit_loss', balance_direction: 1 },
  { code: '6411', name: '利息支出', category: 'profit_loss', balance_direction: 1 },
  { code: '6421', name: '手续费及佣金支出', category: 'profit_loss', balance_direction: 1 },
  { code: '6501', name: '提取未到期责任准备金', category: 'profit_loss', balance_direction: 1 },
  { code: '6502', name: '提取保险责任准备金', category: 'profit_loss', balance_direction: 1 },
  { code: '6511', name: '赔付支出', category: 'profit_loss', balance_direction: 1 },
  { code: '6521', name: '保单红利支出', category: 'profit_loss', balance_direction: 1 },
  { code: '6531', name: '退保金', category: 'profit_loss', balance_direction: 1 },
  { code: '6541', name: '分出保费', category: 'profit_loss', balance_direction: 1 },
  { code: '6542', name: '分保费用', category: 'profit_loss', balance_direction: 1 },
  { code: '6601', name: '销售费用', category: 'profit_loss', balance_direction: 1 },
  { code: '6602', name: '管理费用', category: 'profit_loss', balance_direction: 1 },
  { code: '6603', name: '财务费用', category: 'profit_loss', balance_direction: 1 },
  { code: '6604', name: '勘探费用', category: 'profit_loss', balance_direction: 1 },
  { code: '6701', name: '资产减值损失', category: 'profit_loss', balance_direction: 1 },
  { code: '6711', name: '营业外支出', category: 'profit_loss', balance_direction: 1 },
  { code: '6801', name: '所得税费用', category: 'profit_loss', balance_direction: 1 },
  { code: '6901', name: '以前年度损益调整', category: 'profit_loss', balance_direction: 1 }
]

const NPO_SUBJECTS: SubjectDef[] = [
  { code: '1001', name: '库存现金', category: 'asset', balance_direction: 1, is_cash_flow: true },
  { code: '1002', name: '银行存款', category: 'asset', balance_direction: 1, is_cash_flow: true },
  { code: '1101', name: '应收账款', category: 'asset', balance_direction: 1 },
  { code: '1102', name: '其他应收款', category: 'asset', balance_direction: 1 },
  { code: '1201', name: '存货', category: 'asset', balance_direction: 1 },
  { code: '1501', name: '固定资产', category: 'asset', balance_direction: 1 },
  { code: '1502', name: '累计折旧', category: 'asset', balance_direction: -1 },
  { code: '1701', name: '无形资产', category: 'asset', balance_direction: 1 },
  { code: '1702', name: '累计摊销', category: 'asset', balance_direction: -1 },
  { code: '2001', name: '短期借款', category: 'liability', balance_direction: -1 },
  { code: '2201', name: '应付账款', category: 'liability', balance_direction: -1 },
  { code: '2202', name: '其他应付款', category: 'liability', balance_direction: -1 },
  { code: '2301', name: '受托代理负债', category: 'liability', balance_direction: -1 },
  { code: '4001', name: '非限定性净资产', category: 'equity', balance_direction: -1 },
  { code: '4002', name: '限定性净资产', category: 'equity', balance_direction: -1 },
  { code: '5001', name: '提供服务收入', category: 'profit_loss', balance_direction: -1 },
  { code: '5002', name: '会费收入', category: 'profit_loss', balance_direction: -1 },
  { code: '5003', name: '捐赠收入', category: 'profit_loss', balance_direction: -1 },
  { code: '5201', name: '业务活动成本', category: 'profit_loss', balance_direction: 1 },
  { code: '5202', name: '管理费用', category: 'profit_loss', balance_direction: 1 },
  { code: '5203', name: '筹资费用', category: 'profit_loss', balance_direction: 1 },
  { code: '5301', name: '其他费用', category: 'profit_loss', balance_direction: 1 },
  { code: '5401', name: '投资收益', category: 'profit_loss', balance_direction: -1 },
  { code: '5402', name: '其他收益', category: 'profit_loss', balance_direction: -1 }
]

function getStandardSubjects(standardType: AccountingStandardType): SubjectDef[] {
  return standardType === 'npo' ? NPO_SUBJECTS : ENTERPRISE_SUBJECTS
}

/**
 * Seed subjects for a given ledger. Called when creating a new ledger.
 * Also called during init to ensure the data definition exists.
 */
export function seedSubjectsForLedger(
  db: Database.Database,
  ledgerId: number,
  standardType: AccountingStandardType = 'enterprise'
): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO subjects (ledger_id, code, name, parent_code, category, balance_direction, is_cash_flow, level, is_system)
     VALUES (?, ?, ?, NULL, ?, ?, ?, 1, 1)`
  )

  const insertMany = db.transaction(() => {
    const subjectDefs = getStandardSubjects(standardType)
    for (const s of subjectDefs) {
      insert.run(ledgerId, s.code, s.name, s.category, s.balance_direction, s.is_cash_flow ? 1 : 0)
    }
  })
  insertMany()
}

/**
 * Seed subjects — no-op if no ledger exists yet (subjects are seeded per-ledger)
 */
export function seedSubjects(db: Database.Database): void {
  void db
  // Subjects are seeded per-ledger when a ledger is created
  // This is a no-op at init time
}

/**
 * Seed default cash flow items for a ledger
 */
export function seedCashFlowItemsForLedger(db: Database.Database, ledgerId: number): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO cash_flow_items (ledger_id, code, name, category, direction, is_system)
     VALUES (?, ?, ?, ?, ?, 1)`
  )

  const items = [
    // 经营活动
    {
      code: 'CF01',
      name: '销售商品、提供劳务收到的现金',
      category: 'operating',
      direction: 'inflow'
    },
    { code: 'CF02', name: '收到的税费返还', category: 'operating', direction: 'inflow' },
    {
      code: 'CF03',
      name: '收到其他与经营活动有关的现金',
      category: 'operating',
      direction: 'inflow'
    },
    {
      code: 'CF04',
      name: '购买商品、接受劳务支付的现金',
      category: 'operating',
      direction: 'outflow'
    },
    {
      code: 'CF05',
      name: '支付给职工以及为职工支付的现金',
      category: 'operating',
      direction: 'outflow'
    },
    { code: 'CF06', name: '支付的各项税费', category: 'operating', direction: 'outflow' },
    {
      code: 'CF07',
      name: '支付其他与经营活动有关的现金',
      category: 'operating',
      direction: 'outflow'
    },
    // 投资活动
    { code: 'CF08', name: '收回投资收到的现金', category: 'investing', direction: 'inflow' },
    { code: 'CF09', name: '取得投资收益收到的现金', category: 'investing', direction: 'inflow' },
    {
      code: 'CF10',
      name: '处置固定资产等长期资产收回的现金净额',
      category: 'investing',
      direction: 'inflow'
    },
    {
      code: 'CF11',
      name: '收到其他与投资活动有关的现金',
      category: 'investing',
      direction: 'inflow'
    },
    {
      code: 'CF12',
      name: '购建固定资产等长期资产支付的现金',
      category: 'investing',
      direction: 'outflow'
    },
    { code: 'CF13', name: '投资支付的现金', category: 'investing', direction: 'outflow' },
    {
      code: 'CF14',
      name: '支付其他与投资活动有关的现金',
      category: 'investing',
      direction: 'outflow'
    },
    // 筹资活动
    { code: 'CF15', name: '吸收投资收到的现金', category: 'financing', direction: 'inflow' },
    { code: 'CF16', name: '取得借款收到的现金', category: 'financing', direction: 'inflow' },
    {
      code: 'CF17',
      name: '收到其他与筹资活动有关的现金',
      category: 'financing',
      direction: 'inflow'
    },
    { code: 'CF18', name: '偿还债务支付的现金', category: 'financing', direction: 'outflow' },
    {
      code: 'CF19',
      name: '分配股利、利润或偿付利息支付的现金',
      category: 'financing',
      direction: 'outflow'
    },
    {
      code: 'CF20',
      name: '支付其他与筹资活动有关的现金',
      category: 'financing',
      direction: 'outflow'
    }
  ]

  const insertMany = db.transaction(() => {
    for (const item of items) {
      insert.run(ledgerId, item.code, item.name, item.category, item.direction)
    }
  })
  insertMany()
}

export function seedCashFlowItems(db: Database.Database): void {
  void db
  // Cash flow items are seeded per-ledger
}

/**
 * Seed default P&L carry-forward rules for a ledger
 */
export function seedPLCarryForwardRulesForLedger(
  db: Database.Database,
  ledgerId: number,
  standardType: AccountingStandardType = 'enterprise'
): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO pl_carry_forward_rules (ledger_id, from_subject_code, to_subject_code)
     VALUES (?, ?, ?)`
  )

  const subjectDefs = getStandardSubjects(standardType)
  const plCodes = subjectDefs.filter((s) => s.category === 'profit_loss').map((s) => s.code)
  const toSubjectCode = standardType === 'npo' ? '4001' : '4103'

  const insertMany = db.transaction(() => {
    for (const code of plCodes) {
      insert.run(ledgerId, code, toSubjectCode)
    }
  })
  insertMany()
}

export function seedPLCarryForwardRules(db: Database.Database): void {
  void db
  // P&L rules are seeded per-ledger
}

export { ENTERPRISE_SUBJECTS, NPO_SUBJECTS }
