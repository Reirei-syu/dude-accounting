import type { JSX } from 'react'

import { useAuthStore } from '../stores/authStore'
import {
  resolveStartupTabPreset,
  getVisibleMainModules,
  useUIStore,
  type MainModule
} from '../stores/uiStore'

export default function Sidebar(): JSX.Element {
  const { suspendedModule, setSuspended, tabs, activeTabId, openTab } = useUIStore()
  const homeActive =
    !suspendedModule && tabs.some((tab) => tab.id === activeTabId && tab.componentType === 'Home')
  const currentUser = useAuthStore((state) => state.user)
  const visibleModules = getVisibleMainModules(currentUser)

  const handleModuleClick = (moduleId: MainModule): void => {
    if (moduleId === 'home') {
      openTab(resolveStartupTabPreset('home'))
      return
    }
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
        {visibleModules.map((module) => (
          <button
            key={module.id}
            type="button"
            className={`sidebar-btn ${(module.id === 'home' ? homeActive : suspendedModule === module.id) ? 'active' : ''}`}
            onClick={() => handleModuleClick(module.id)}
            aria-pressed={module.id === 'home' ? homeActive : suspendedModule === module.id}
          >
            {module.label}
          </button>
        ))}
      </nav>
    </aside>
  )
}
