import fs from 'node:fs'
import path from 'node:path'
import { app, ipcMain } from 'electron'
import { closeDatabase, getDatabase, getDatabasePath } from '../database/init'
import { appendOperationLog } from '../services/auditLog'
import { createBackupArtifact, validateBackupArtifact } from '../services/backupRecovery'
import { requireAdmin, requirePermission } from './session'

function getBackupRootDir(): string {
  return path.join(app.getPath('userData'), 'backups')
}

export function registerBackupHandlers(): void {
  ipcMain.handle(
    'backup:create',
    (event, payload: { ledgerId: number; fiscalYear?: string | null }) => {
      try {
        const user = requirePermission(event, 'ledger_settings')
        const db = getDatabase()
        const ledger = db.prepare('SELECT id, name FROM ledgers WHERE id = ?').get(payload.ledgerId) as
          | { id: number; name: string }
          | undefined

        if (!ledger) {
          return { success: false, error: '账套不存在' }
        }

        db.pragma('wal_checkpoint(TRUNCATE)')

        const artifact = createBackupArtifact({
          sourcePath: getDatabasePath(),
          backupDir: getBackupRootDir(),
          ledgerId: payload.ledgerId,
          fiscalYear: payload.fiscalYear ?? null
        })

        const result = db
          .prepare(
            `INSERT INTO backup_packages (
               ledger_id,
               fiscal_year,
               backup_path,
               checksum,
               file_size,
               status,
               created_by
             ) VALUES (?, ?, ?, ?, ?, 'generated', ?)`
          )
          .run(
            payload.ledgerId,
            payload.fiscalYear ?? null,
            artifact.backupPath,
            artifact.checksum,
            artifact.fileSize,
            user.id
          )

        appendOperationLog(db, {
          ledgerId: payload.ledgerId,
          userId: user.id,
          username: user.username,
          module: 'backup',
          action: 'create',
          targetType: 'backup_package',
          targetId: Number(result.lastInsertRowid),
          details: {
            fiscalYear: payload.fiscalYear ?? null,
            backupPath: artifact.backupPath,
            fileSize: artifact.fileSize
          }
        })

        return {
          success: true,
          backupId: Number(result.lastInsertRowid),
          backupPath: artifact.backupPath,
          checksum: artifact.checksum,
          fileSize: artifact.fileSize
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '创建备份失败'
        }
      }
    }
  )

  ipcMain.handle('backup:list', (event, ledgerId?: number) => {
    requirePermission(event, 'ledger_settings')
    const db = getDatabase()

    if (typeof ledgerId === 'number') {
      return db
        .prepare(
          `SELECT *
           FROM backup_packages
           WHERE ledger_id = ?
           ORDER BY id DESC`
        )
        .all(ledgerId)
    }

    return db.prepare('SELECT * FROM backup_packages ORDER BY id DESC').all()
  })

  ipcMain.handle('backup:validate', (event, backupId: number) => {
    try {
      const user = requirePermission(event, 'ledger_settings')
      const db = getDatabase()
      const row = db.prepare('SELECT * FROM backup_packages WHERE id = ?').get(backupId) as
        | {
            id: number
            ledger_id: number
            backup_path: string
            checksum: string
          }
        | undefined

      if (!row) {
        return { success: false, error: '备份记录不存在' }
      }

      const validation = validateBackupArtifact(row.backup_path, row.checksum)
      db.prepare(
        `UPDATE backup_packages
         SET status = ?, validated_at = CASE WHEN ? = 'validated' THEN datetime('now') ELSE validated_at END
         WHERE id = ?`
      ).run(validation.valid ? 'validated' : 'failed', validation.valid ? 'validated' : 'failed', backupId)

      appendOperationLog(db, {
        ledgerId: row.ledger_id,
        userId: user.id,
        username: user.username,
        module: 'backup',
        action: 'validate',
        targetType: 'backup_package',
        targetId: row.id,
        details: validation
      })

      return {
        success: validation.valid,
        valid: validation.valid,
        actualChecksum: validation.actualChecksum,
        error: validation.error
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '校验备份失败'
      }
    }
  })

  ipcMain.handle('backup:restore', (event, backupId: number) => {
    try {
      const user = requireAdmin(event)
      const db = getDatabase()
      const row = db.prepare('SELECT * FROM backup_packages WHERE id = ?').get(backupId) as
        | {
            id: number
            ledger_id: number
            backup_path: string
            checksum: string
          }
        | undefined

      if (!row) {
        return { success: false, error: '备份记录不存在' }
      }

      const validation = validateBackupArtifact(row.backup_path, row.checksum)
      if (!validation.valid) {
        return { success: false, error: validation.error ?? '备份文件校验失败' }
      }

      appendOperationLog(db, {
        ledgerId: row.ledger_id,
        userId: user.id,
        username: user.username,
        module: 'backup',
        action: 'restore',
        targetType: 'backup_package',
        targetId: row.id,
        details: {
          backupPath: row.backup_path,
          restartRequired: true
        }
      })

      closeDatabase()
      fs.copyFileSync(row.backup_path, getDatabasePath())

      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 200)

      return {
        success: true,
        restartRequired: true
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '恢复备份失败'
      }
    }
  })
}
