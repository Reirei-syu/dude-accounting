import { BLANK_TAB_COMPONENT, useUIStore } from '../stores/uiStore'
import PlaceholderPage from './PlaceholderPage'
import VoucherEntry from '../pages/VoucherEntry'
import VoucherList from '../pages/VoucherList'
import VoucherQuery from '../pages/VoucherQuery'
import SubjectSettings from '../pages/SubjectSettings'
import AuxiliarySettings from '../pages/AuxiliarySettings'
import InitialBalance from '../pages/InitialBalance'
import CashFlowMapping from '../pages/CashFlowMapping'
import SystemParams from '../pages/SystemParams'
import MyPreferences from '../pages/MyPreferences'
import UserManagement from '../pages/UserManagement'
import AccountingStandard from '../pages/AccountingStandard'
import PeriodClose from '../pages/PeriodClose'
import PLCarryForward from '../pages/PLCarryForward'
import PLSettle from '../pages/PLSettle'
import Backup from '../pages/Backup'
import ReportWorkspacePage from '../pages/ReportWorkspacePage'
import ReportQuery from '../pages/ReportQuery'
import SubjectBalance from '../pages/SubjectBalance'
import DetailLedger from '../pages/DetailLedger'
import Journal from '../pages/Journal'
import AuxiliaryBalance from '../pages/AuxiliaryBalance'
import AuxiliaryDetail from '../pages/AuxiliaryDetail'
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
  AuxiliarySettings: AuxiliarySettings as React.ComponentType<WorkspaceComponentProps>,
  InitialBalance: InitialBalance as React.ComponentType<WorkspaceComponentProps>,
  CashFlowMapping: CashFlowMapping as React.ComponentType<WorkspaceComponentProps>,
  SystemParams: SystemParams as React.ComponentType<WorkspaceComponentProps>,
  MyPreferences: MyPreferences as React.ComponentType<WorkspaceComponentProps>,
  UserManagement: UserManagement as React.ComponentType<WorkspaceComponentProps>,
  AccountingStandard: AccountingStandard as React.ComponentType<WorkspaceComponentProps>,
  PeriodClose: PeriodClose as React.ComponentType<WorkspaceComponentProps>,
  PLCarryForward: PLCarryForward as React.ComponentType<WorkspaceComponentProps>,
  PLSettle: PLSettle as React.ComponentType<WorkspaceComponentProps>,
  Backup: Backup as React.ComponentType<WorkspaceComponentProps>,
  BalanceSheet: ReportWorkspacePage as React.ComponentType<WorkspaceComponentProps>,
  IncomeStatement: ReportWorkspacePage as React.ComponentType<WorkspaceComponentProps>,
  ActivityStatement: ReportWorkspacePage as React.ComponentType<WorkspaceComponentProps>,
  CashFlowStatement: ReportWorkspacePage as React.ComponentType<WorkspaceComponentProps>,
  EquityStatement: ReportWorkspacePage as React.ComponentType<WorkspaceComponentProps>,
  ReportQuery: ReportQuery as React.ComponentType<WorkspaceComponentProps>,
  SubjectBalance: SubjectBalance as React.ComponentType<WorkspaceComponentProps>,
  DetailLedger: DetailLedger as React.ComponentType<WorkspaceComponentProps>,
  Journal: Journal as React.ComponentType<WorkspaceComponentProps>,
  AuxiliaryBalance: AuxiliaryBalance as React.ComponentType<WorkspaceComponentProps>,
  AuxiliaryDetail: AuxiliaryDetail as React.ComponentType<WorkspaceComponentProps>
}

export default function Workspace(): JSX.Element {
  const { tabs, activeTabId } = useUIStore()

  if (tabs.length === 0) {
    return <div className="workspace-empty" />
  }

  return (
    <div className="w-full h-full relative">
      {tabs.map((tab) => {
        const isActive = activeTabId === tab.id

        if (tab.componentType === BLANK_TAB_COMPONENT) {
          return (
            <div
              key={tab.id}
              className="workspace-page absolute inset-0 overflow-y-auto overflow-x-hidden p-4"
              style={{ display: isActive ? 'block' : 'none' }}
              role="tabpanel"
              id={`workspace-tab-${tab.id}`}
              aria-labelledby={`workspace-tab-button-${tab.id}`}
              aria-hidden={!isActive}
            >
              <div className="workspace-empty" />
            </div>
          )
        }

        const Component = componentMap[tab.componentType] || PlaceholderPage
        return (
          <div
            key={tab.id}
            className="workspace-page absolute inset-0 overflow-y-auto overflow-x-hidden p-4"
            style={{ display: isActive ? 'block' : 'none' }}
            role="tabpanel"
            id={`workspace-tab-${tab.id}`}
            aria-labelledby={`workspace-tab-button-${tab.id}`}
            aria-hidden={!isActive}
          >
            <Component title={tab.title} componentType={tab.componentType} {...tab.params} />
          </div>
        )
      })}
    </div>
  )
}
