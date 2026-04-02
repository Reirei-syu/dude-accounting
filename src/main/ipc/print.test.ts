import { describe, expect, it } from 'vitest'

import {
  buildDefaultPreviewSettings,
  loadPersistedPreviewSettings,
  persistPreviewSettings,
  resolveMeasuredTableRowGroups,
  resolvePrintCommandPayload
} from './print'
import type { PrintTableSegment } from '../services/print'

class PreferenceDbMock {
  private readonly values = new Map<string, string>()

  prepare(sql: string): {
    get: (userId: number, key: string) => { value?: string } | undefined
    run: (userId: number, key: string, value: string) => void
  } {
    if (sql.includes('SELECT value FROM user_preferences')) {
      return {
        get: (userId: number, key: string) => {
          const value = this.values.get(`${userId}:${key}`)
          return value === undefined ? undefined : { value }
        },
        run: () => undefined
      }
    }

    if (sql.includes('INSERT INTO user_preferences')) {
      return {
        get: () => undefined,
        run: (userId: number, key: string, value: string) => {
          this.values.set(`${userId}:${key}`, value)
        }
      }
    }

    throw new Error(`Unexpected SQL: ${sql}`)
  }
}

describe('print ipc helpers', () => {
  it('normalizes command payloads to job ids', () => {
    expect(resolvePrintCommandPayload('job-1')).toEqual({ jobId: 'job-1' })
    expect(resolvePrintCommandPayload({ jobId: 'job-2' })).toEqual({ jobId: 'job-2' })
  })

  it('returns default settings when no preference exists', () => {
    const db = new PreferenceDbMock()
    expect(
      loadPersistedPreviewSettings(
        db as never,
        1,
        'book_print_settings_detail_ledger',
        'landscape'
      )
    ).toEqual(buildDefaultPreviewSettings('landscape'))
  })

  it('loads and saves persisted preview settings by user and key', () => {
    const db = new PreferenceDbMock()
    persistPreviewSettings(db as never, 9, 'book_print_settings_subject_balance', {
      orientation: 'landscape',
      scalePercent: 85,
      marginPreset: 'narrow',
      densityPreset: 'compact'
    })

    expect(
      loadPersistedPreviewSettings(
        db as never,
        9,
        'book_print_settings_subject_balance',
        'portrait'
      )
    ).toEqual({
      orientation: 'landscape',
      scalePercent: 85,
      marginPreset: 'narrow',
      densityPreset: 'compact'
    })
  })

  it('falls back to defaults when persisted json is invalid', () => {
    const db = new PreferenceDbMock()
    db.prepare('INSERT INTO user_preferences').run(
      2,
      'book_print_settings_journal',
      '{invalid-json'
    )

    expect(
      loadPersistedPreviewSettings(db as never, 2, 'book_print_settings_journal', 'portrait')
    ).toEqual(buildDefaultPreviewSettings('portrait'))
  })

  it('falls back to estimated row groups when measured pagination loses rows', () => {
    const segment: PrintTableSegment = {
      kind: 'table',
      title: '科目余额表',
      ledgerName: '测试账套',
      unitLabel: '元',
      columns: [
        { key: 'subject_code', label: '科目编码', align: 'left' },
        { key: 'subject_name', label: '科目名称', align: 'left' }
      ],
      rows: [
        { key: '1001', cells: [{ value: '1001' }, { value: '库存现金' }] },
        { key: '1002', cells: [{ value: '1002' }, { value: '银行存款' }] },
        { key: '1003', cells: [{ value: '1003' }, { value: '其他货币资金' }] }
      ]
    }

    const fallback = {
      rowKeyGroups: [['1001', '1002'], ['1003']],
      oversizeRowKeys: ['1003']
    }

    expect(
      resolveMeasuredTableRowGroups(segment, fallback, {
        rowKeyGroups: [[]],
        oversizeRowKeys: []
      })
    ).toEqual(fallback)

    expect(
      resolveMeasuredTableRowGroups(segment, fallback, {
        rowKeyGroups: [['1001', '1003']],
        oversizeRowKeys: []
      })
    ).toEqual(fallback)
  })

  it('keeps measured row groups when they cover every row in order', () => {
    const segment: PrintTableSegment = {
      kind: 'table',
      title: '科目余额表',
      ledgerName: '测试账套',
      unitLabel: '元',
      columns: [
        { key: 'subject_code', label: '科目编码', align: 'left' },
        { key: 'subject_name', label: '科目名称', align: 'left' }
      ],
      rows: [
        { key: '1001', cells: [{ value: '1001' }, { value: '库存现金' }] },
        { key: '1002', cells: [{ value: '1002' }, { value: '银行存款' }] },
        { key: '1003', cells: [{ value: '1003' }, { value: '其他货币资金' }] }
      ]
    }

    expect(
      resolveMeasuredTableRowGroups(
        segment,
        {
          rowKeyGroups: [['1001', '1002', '1003']],
          oversizeRowKeys: []
        },
        {
          rowKeyGroups: [['1001'], ['1002', '1003']],
          oversizeRowKeys: ['1002']
        }
      )
    ).toEqual({
      rowKeyGroups: [['1001'], ['1002', '1003']],
      oversizeRowKeys: ['1002']
    })
  })
})
