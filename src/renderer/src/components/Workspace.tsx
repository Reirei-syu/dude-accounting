import { BLANK_TAB_COMPONENT, useUIStore } from '../stores/uiStore'
import PlaceholderPage from './PlaceholderPage'
import VoucherEntry from '../pages/VoucherEntry'
import VoucherList from '../pages/VoucherList'
import VoucherQuery from '../pages/VoucherQuery'
import SubjectSettings from '../pages/SubjectSettings'
import SystemParams from '../pages/SystemParams'
import UserManagement from '../pages/UserManagement'
import type React from 'react'
import type { JSX } from 'react'

type WorkspaceComponentProps = {
  title: string
  componentType: string
} & Record<string, unknown>

const componentMap: Record<string, React.ComponentType<WorkspaceComponentProps>> = {
  VoucherEntry: VoucherEntry as React.ComponentType<WorkspaceComponentProps>,
  VoucherList: VoucherList as React.ComponentType<WorkspaceComponentProps>,
  VoucherQuery: VoucherQuery as React.ComponentType<WorkspaceComponentProps>,
  SubjectSettings: SubjectSettings as React.ComponentType<WorkspaceComponentProps>,
  SystemParams: SystemParams as React.ComponentType<WorkspaceComponentProps>,
  UserManagement: UserManagement as React.ComponentType<WorkspaceComponentProps>
}

export default function Workspace(): JSX.Element {
  const { tabs, activeTabId } = useUIStore()

  if (tabs.length === 0) {
    return <div className="workspace-empty" />
  }

  return (
    <div className="w-full h-full relative">
      {tabs.map((tab) => {
        if (tab.componentType === BLANK_TAB_COMPONENT) {
          return (
            <div
              key={tab.id}
              className="workspace-page absolute inset-0 p-4"
              style={{ display: activeTabId === tab.id ? 'block' : 'none' }}
            >
              <div className="workspace-empty" />
            </div>
          )
        }

        const Component = componentMap[tab.componentType] || PlaceholderPage
        return (
          <div
            key={tab.id}
            className="workspace-page absolute inset-0 p-4"
            style={{ display: activeTabId === tab.id ? 'block' : 'none' }}
          >
            <Component title={tab.title} componentType={tab.componentType} {...tab.params} />
          </div>
        )
      })}
    </div>
  )
}
