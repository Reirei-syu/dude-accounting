import { useUIStore } from '../stores/uiStore'
import type { JSX } from 'react'

type MainModule = 'ledger-settings' | 'accounting' | 'ledger-query' | 'reports' | 'system-settings'

const MODULES: { id: MainModule; label: string }[] = [
  { id: 'ledger-settings', label: '账套设置' },
  { id: 'accounting', label: '账务处理' },
  { id: 'ledger-query', label: '账簿查询' },
  { id: 'reports', label: '报表输出' },
  { id: 'system-settings', label: '系统设置' }
]

export default function Sidebar(): JSX.Element {
  const { suspendedModule, setSuspended } = useUIStore()

  const handleModuleClick = (moduleId: MainModule): void => {
    if (suspendedModule === moduleId) {
      setSuspended(null)
    } else {
      setSuspended(moduleId)
    }
  }

  return (
    <aside className="main-sidebar glass-panel" aria-label="主导航">
      <div className="main-brand-wrap">
        <span className="main-brand">Dude Accounting</span>
        <p className="ui-kicker">Financial Console</p>
      </div>

      <nav className="main-sidebar-nav" aria-label="功能模块">
        {MODULES.map((mod) => (
          <button
            key={mod.id}
            type="button"
            className={`sidebar-btn ${suspendedModule === mod.id ? 'active' : ''}`}
            onClick={() => handleModuleClick(mod.id)}
            aria-pressed={suspendedModule === mod.id}
          >
            {mod.label}
          </button>
        ))}
      </nav>
    </aside>
  )
}
