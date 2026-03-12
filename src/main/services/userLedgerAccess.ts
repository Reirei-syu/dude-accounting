import type Database from 'better-sqlite3'

function normalizeLedgerIds(ledgerIds: number[]): number[] {
  return Array.from(
    new Set(
      ledgerIds
        .map((ledgerId) => Number(ledgerId))
        .filter((ledgerId) => Number.isInteger(ledgerId) && ledgerId > 0)
    )
  ).sort((left, right) => left - right)
}

export function listUserLedgerIds(db: Database.Database, userId: number): number[] {
  return (
    db
      .prepare(
        'SELECT ledger_id FROM user_ledger_permissions WHERE user_id = ? ORDER BY ledger_id ASC'
      )
      .all(userId) as Array<{ ledger_id: number }>
  ).map((row) => Number(row.ledger_id))
}

export function assertLedgerIdsExist(db: Database.Database, ledgerIds: number[]): number[] {
  const normalizedIds = normalizeLedgerIds(ledgerIds)
  if (normalizedIds.length === 0) {
    return []
  }

  const placeholders = normalizedIds.map(() => '?').join(',')
  const existingIds = (
    db
      .prepare(`SELECT id FROM ledgers WHERE id IN (${placeholders})`)
      .all(...normalizedIds) as Array<{ id: number }>
  ).map((row) => Number(row.id))

  const missingIds = normalizedIds.filter((ledgerId) => !existingIds.includes(ledgerId))
  if (missingIds.length > 0) {
    throw new Error(`存在无效账套授权：${missingIds.join('、')}`)
  }

  return normalizedIds
}

export function replaceUserLedgerIds(
  db: Database.Database,
  userId: number,
  ledgerIds: number[]
): number[] {
  const normalizedIds = assertLedgerIdsExist(db, ledgerIds)
  const replaceTx = db.transaction((nextLedgerIds: number[]) => {
    db.prepare('DELETE FROM user_ledger_permissions WHERE user_id = ?').run(userId)

    if (nextLedgerIds.length === 0) {
      return
    }

    const insertStmt = db.prepare(
      'INSERT INTO user_ledger_permissions (user_id, ledger_id) VALUES (?, ?)'
    )
    for (const ledgerId of nextLedgerIds) {
      insertStmt.run(userId, ledgerId)
    }
  })

  replaceTx(normalizedIds)
  return normalizedIds
}

export function grantUserLedgerAccess(
  db: Database.Database,
  userId: number,
  ledgerId: number
): void {
  db.prepare(
    'INSERT OR IGNORE INTO user_ledger_permissions (user_id, ledger_id) VALUES (?, ?)'
  ).run(userId, ledgerId)
}
