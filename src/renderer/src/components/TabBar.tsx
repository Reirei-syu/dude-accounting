import { useUIStore } from '../stores/uiStore'
import type { JSX } from 'react'

export default function TabBar(): JSX.Element {
  const { tabs, activeTabId, setActiveTab, closeTab, addBlankTab } = useUIStore()

  return (
    <div className="main-tab-row" role="tablist" aria-label="工作标签">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-btn ${activeTabId === tab.id ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setActiveTab(tab.id)
            }
          }}
          role="tab"
          tabIndex={0}
          aria-selected={activeTabId === tab.id}
          aria-controls={`workspace-tab-${tab.id}`}
          id={`workspace-tab-button-${tab.id}`}
        >
          <span className="tab-title">{tab.title}</span>
          <button
            type="button"
            className="tab-close-btn"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(tab.id)
            }}
            aria-label={`关闭${tab.title}`}
          >
            <span className="tab-close-line tab-close-line-a" />
            <span className="tab-close-line tab-close-line-b" />
          </button>
        </div>
      ))}

      <button
        type="button"
        className="tab-add-btn"
        aria-label="新增空白标签"
        onClick={() => addBlankTab()}
      >
        +
      </button>
    </div>
  )
}
