import { useEffect, type JSX } from 'react'

import { useLedgerStore } from '../stores/ledgerStore'
import { useAuthStore } from '../stores/authStore'
import {
  getVisibleModuleSubMenus,
  useUIStore,
  type AccountingStandardType,
  type MainModule,
  type TabItem
} from '../stores/uiStore'

export default function SuspendedOverlay(): JSX.Element {
  const { suspendedModule, setSuspended, openTab } = useUIStore()
  const currentLedger = useLedgerStore((state) => state.currentLedger)
  const currentUser = useAuthStore((state) => state.user)

  const standardType: AccountingStandardType =
    currentLedger?.standard_type === 'npo' ? 'npo' : 'enterprise'
  const subMenus = suspendedModule
    ? getVisibleModuleSubMenus(suspendedModule as MainModule, standardType, currentUser)
    : []

  useEffect(() => {
    if (suspendedModule && subMenus.length === 0) {
      setSuspended(null)
    }
  }, [setSuspended, subMenus.length, suspendedModule])

  if (!suspendedModule || subMenus.length === 0) {
    return <></>
  }

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
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setSuspended(null)
        }
      }}
      tabIndex={0}
    >
      <div className="feature-panel" onClick={(event) => event.stopPropagation()}>
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
