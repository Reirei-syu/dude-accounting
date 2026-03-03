import {
  useUIStore,
  getModuleSubMenus,
  type TabItem,
  type AccountingStandardType
} from '../stores/uiStore'
import type { JSX } from 'react'
import { useLedgerStore } from '../stores/ledgerStore'

type MainModule = 'ledger-settings' | 'accounting' | 'ledger-query' | 'reports' | 'system-settings'

export default function SuspendedOverlay(): JSX.Element {
  const { suspendedModule, setSuspended, openTab } = useUIStore()
  const currentLedger = useLedgerStore((s) => s.currentLedger)

  if (!suspendedModule) return <></>

  const standardType: AccountingStandardType =
    currentLedger?.standard_type === 'npo' ? 'npo' : 'enterprise'
  const subMenus = getModuleSubMenus(suspendedModule as MainModule, standardType)

  const handleSubClick = (item: (typeof subMenus)[0]): void => {
    const tab: TabItem = {
      id: item.id,
      title: item.title,
      componentType: item.componentType
    }
    openTab(tab)
  }

  const getTitleSizeClass = (title: string): string => {
    const length = Array.from(title).length
    if (length >= 11) return 'feature-btn-size-3'
    if (length >= 9) return 'feature-btn-size-2'
    if (length >= 7) return 'feature-btn-size-1'
    return 'feature-btn-size-0'
  }

  return (
    <div
      className="feature-overlay"
      onClick={() => setSuspended(null)}
      role="dialog"
      aria-modal="true"
      aria-label="功能菜单"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setSuspended(null)
        }
      }}
      tabIndex={0}
    >
      <div className="feature-panel" onClick={(e) => e.stopPropagation()}>
        {subMenus.map((item) => (
          <button
            key={item.id}
            className={`feature-btn ${getTitleSizeClass(item.title)}`}
            onClick={() => handleSubClick(item)}
            type="button"
          >
            {item.title}
          </button>
        ))}
      </div>
    </div>
  )
}
