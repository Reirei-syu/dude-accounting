import type { DudeAPI, ElectronAPI } from '../shared/contracts/desktopApi'
export type { DudeAPI, ElectronAPI } from '../shared/contracts/desktopApi'

declare global {
  interface Window {
    electron: ElectronAPI
    api: DudeAPI
  }
}
