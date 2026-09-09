import type { JSX } from 'react'
import { useLedgerStore } from '../stores/ledgerStore'
import { useAuthStore } from '../stores/authStore'
import VoucherPrintDialog from '../components/VoucherPrintDialog'
import { useVoucherEntryController } from './voucher-entry/useVoucherEntryController'
import type { VoucherEntryProps } from './voucher-entry/voucherEntryModel'
import VoucherEntryToolbar from './voucher-entry/VoucherEntryToolbar'
import VoucherEntryHeader from './voucher-entry/VoucherEntryHeader'
import VoucherEntryGrid from './voucher-entry/VoucherEntryGrid'
import VoucherSubjectDialog from './voucher-entry/VoucherSubjectDialog'
import VoucherCashFlowDialog from './voucher-entry/VoucherCashFlowDialog'

export default function VoucherEntry(props: VoucherEntryProps): JSX.Element {
  const ledgerId = useLedgerStore((state) => state.currentLedger?.id)
  const userId = useAuthStore((state) => state.user?.id)
  const initialElectronicDraft =
    props.initialElectronicDraft?.ledgerId === ledgerId ? props.initialElectronicDraft : undefined
  return (
    <VoucherEntryScope
      key={`${userId}:${ledgerId}:${initialElectronicDraft?.sourceRecordId ?? ''}:${initialElectronicDraft?.sourceFingerprint ?? ''}`}
      {...props}
      initialElectronicDraft={initialElectronicDraft}
    />
  )
}

function VoucherEntryScope(props: VoucherEntryProps): JSX.Element {
  const controller = useVoucherEntryController(props)
  const {
    auditorDisplayName,
    bookkeeperDisplayName,
    closedPeriodMessage,
    creatorDisplayName,
    editingVoucherId,
    handleConfirmPrint,
    isClosedPeriod,
    message,
    printDialogOpen,
    printSubmitting,
    setPrintDialogOpen,
    setVoucherPrintDoubleGapPx,
    setVoucherPrintLayout,
    voucherPrintDoubleGapPx,
    voucherPrintLayout
  } = controller
  return (
    <div className="h-full flex flex-col p-4 gap-3">
      {/* 顶部操作区 */}
      <VoucherEntryToolbar {...controller} />
      {controller.electronicSource && (
        <div className="glass-panel-light px-4 py-3 text-sm">
          电子凭证来源 #{controller.electronicSource.sourceRecordId} · 人工核验与摘录，非自动验真。
          来源金额：
          {controller.electronicSource.amountCents === null
            ? '未提供'
            : (controller.electronicSource.amountCents / 100).toFixed(2)}{' '}
          元。 请复核日期、摘要、科目和借贷金额；保存成功后才建立来源关联。
        </div>
      )}

      {isClosedPeriod && (
        <div
          className="glass-panel-light mb-3 px-4 py-3 text-sm"
          style={{ color: 'var(--color-danger)' }}
        >
          {closedPeriodMessage}
        </div>
      )}

      {/* 表头区 */}
      <VoucherEntryHeader {...controller} />

      {/* 表格主体 */}
      <VoucherEntryGrid {...controller} />

      <VoucherSubjectDialog {...controller} />

      <VoucherCashFlowDialog {...controller} />

      <VoucherPrintDialog
        open={printDialogOpen}
        voucherCount={editingVoucherId === null ? 0 : 1}
        layout={voucherPrintLayout}
        doubleGapPx={voucherPrintDoubleGapPx}
        submitting={printSubmitting}
        onClose={() => {
          if (!printSubmitting) {
            setPrintDialogOpen(false)
          }
        }}
        onConfirm={() => void handleConfirmPrint()}
        onLayoutChange={setVoucherPrintLayout}
        onGapChange={setVoucherPrintDoubleGapPx}
      />

      {message && (
        <div
          className="mt-2 px-2 text-sm"
          aria-live="polite"
          style={{
            color: message.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)'
          }}
        >
          {message.text}
        </div>
      )}

      {/* 表尾区 */}
      <div className="mt-2 px-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        <div className="flex items-center justify-center gap-[200px]">
          <span>制单：{creatorDisplayName}</span>
          <span>审核：{auditorDisplayName}</span>
          <span>记账：{bookkeeperDisplayName}</span>
        </div>
      </div>
    </div>
  )
}
