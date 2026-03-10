export type AccountingStandardType = 'enterprise' | 'npo'

export type SubjectCategory =
  | 'asset'
  | 'liability'
  | 'common'
  | 'equity'
  | 'cost'
  | 'profit_loss'
  | 'net_assets'
  | 'income'
  | 'expense'

export const ALL_SUBJECT_CATEGORIES: SubjectCategory[] = [
  'asset',
  'liability',
  'common',
  'equity',
  'cost',
  'profit_loss',
  'net_assets',
  'income',
  'expense'
]

export function normalizeSubjectCategoryForLedger(
  standardType: AccountingStandardType,
  category: string,
  balanceDirection: number
): SubjectCategory {
  if (standardType !== 'npo') {
    return category as SubjectCategory
  }

  if (category === 'equity') {
    return 'net_assets'
  }

  if (category === 'profit_loss') {
    return balanceDirection === -1 ? 'income' : 'expense'
  }

  return category as SubjectCategory
}

export function getCarryForwardSourceCategories(
  standardType: AccountingStandardType
): SubjectCategory[] {
  return standardType === 'npo' ? ['income', 'expense'] : ['profit_loss']
}

export function isCarryForwardSourceCategory(
  standardType: AccountingStandardType,
  category: string
): boolean {
  if (standardType === 'npo') {
    return category === 'income' || category === 'expense' || category === 'profit_loss'
  }

  return getCarryForwardSourceCategories(standardType).includes(category as SubjectCategory)
}

export function getCarryForwardTargetCategories(
  standardType: AccountingStandardType
): SubjectCategory[] {
  return standardType === 'npo' ? ['net_assets'] : ['equity']
}

export function isCarryForwardTargetCategory(
  standardType: AccountingStandardType,
  category: string
): boolean {
  if (standardType === 'npo') {
    return category === 'net_assets' || category === 'equity'
  }

  return getCarryForwardTargetCategories(standardType).includes(category as SubjectCategory)
}
