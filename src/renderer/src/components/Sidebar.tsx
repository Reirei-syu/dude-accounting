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
    <aside className="main-sidebar glass-panel">
      <div className="main-brand-wrap">
        <span className="main-brand">Dude Accounting</span>
      </div>

      <div className="main-sidebar-nav">
        {MODULES.map((mod) => (
          <button
            key={mod.id}
            className={`sidebar-btn ${suspendedModule === mod.id ? 'active' : ''}`}
            onClick={() => handleModuleClick(mod.id)}
          >
            {mod.label}
          </button>
        ))}
      </div>
    </aside>
  )
}
