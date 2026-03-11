import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  getDetailLedger,
  getJournal,
  listSubjectBalances,
  type DetailLedgerQuery,
  type JournalQuery,
  type SubjectBalanceQuery
} from '../services/bookQuery'
import { requireAuth } from './session'

export function registerBookQueryHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('bookQuery:listSubjectBalances', (event, query: SubjectBalanceQuery) => {
    requireAuth(event)
    return listSubjectBalances(db, query)
  })

  ipcMain.handle('bookQuery:getDetailLedger', (event, query: DetailLedgerQuery) => {
    requireAuth(event)
    return getDetailLedger(db, query)
  })

  ipcMain.handle('bookQuery:getJournal', (event, query: JournalQuery) => {
    requireAuth(event)
    return getJournal(db, query)
  })
}
