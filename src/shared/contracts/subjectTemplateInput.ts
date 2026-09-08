/** 未归一化的模板输入；类别文本由现有业务校验器验证。 */
export interface SubjectTemplateEntryInput {
  code?: string
  name?: string
  category?: string
  balanceDirection?: 1 | -1
  isCashFlow?: boolean
  enabled?: boolean
  sortOrder?: number
  carryForwardTargetCode?: string | null
  note?: string | null
}
