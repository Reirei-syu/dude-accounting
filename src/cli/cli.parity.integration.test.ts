import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const loginPayloadPath = path.join(os.tmpdir(), 'dude-cli-parity-login-payload.json')
const preferencesPayloadPath = path.join(os.tmpdir(), 'dude-cli-parity-preferences.json')
const wallpaperAnalyzePayloadPath = path.join(os.tmpdir(), 'dude-cli-parity-wallpaper-analyze.json')
const wallpaperApplyPayloadPath = path.join(os.tmpdir(), 'dude-cli-parity-wallpaper-apply.json')
const initialBalanceSavePayloadPath = path.join(os.tmpdir(), 'dude-cli-parity-initial-balance.json')
const printPreparePayloadPath = path.join(os.tmpdir(), 'dude-cli-parity-print-prepare.json')
const outputPdfPath = path.join(os.tmpdir(), 'dude-cli-parity-print.pdf')
const wallpaperPath = path.resolve(process.cwd(), 'src/renderer/src/assets/wallpaper.png')

function extractCommandResult(output: string): { status: string; data: unknown; error: unknown } {
  const matches: Array<{ status: string; data: unknown; error: unknown }> = []

  for (let startIndex = 0; startIndex < output.length; startIndex += 1) {
    if (output[startIndex] !== '{') continue

    let depth = 0
    for (let index = startIndex; index < output.length; index += 1) {
      const current = output[index]
      if (current === '{') depth += 1
      if (current === '}') {
        depth -= 1
        if (depth === 0) {
          try {
            const parsed = JSON.parse(output.slice(startIndex, index + 1)) as Record<string, unknown>
            if (
              typeof parsed.status === 'string' &&
              Object.prototype.hasOwnProperty.call(parsed, 'data') &&
              Object.prototype.hasOwnProperty.call(parsed, 'error')
            ) {
              matches.push(parsed as { status: string; data: unknown; error: unknown })
            }
          } catch {
            // ignore invalid slices
          }
          break
        }
      }
    }
  }

  if (matches.length === 0) {
    throw new Error(`未找到完整 CLI JSON 输出：\n${output}`)
  }

  return matches[matches.length - 1]
}

async function runCli(args: string[]): Promise<{ status: string; data: unknown; error: unknown }> {
  const { stdout, stderr } = await execFileAsync(
    'node',
    ['scripts/run-with-utf8.mjs', 'npx', 'electron-vite', 'preview', '--', '--cli', ...args],
    {
      cwd: process.cwd(),
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024
    }
  )

  return extractCommandResult(`${stdout}\n${stderr}`)
}

async function waitForPrintReady(jobId: string): Promise<{ status: string; data: any; error: unknown }> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await runCli(['print', 'status', '--jobId', jobId])
    if (result.status === 'success' && (result.data as { status: string }).status === 'ready') {
      return result as { status: string; data: any; error: unknown }
    }
    if (result.status === 'success' && (result.data as { status: string }).status === 'failed') {
      throw new Error(`打印任务失败：${JSON.stringify(result.data)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(`打印任务 ${jobId} 在预期时间内未进入 ready`)
}

describe('cli parity integration', () => {
  afterAll(() => {
    for (const filePath of [
      loginPayloadPath,
      preferencesPayloadPath,
      wallpaperAnalyzePayloadPath,
      wallpaperApplyPayloadPath,
      initialBalanceSavePayloadPath,
      printPreparePayloadPath,
      outputPdfPath
    ]) {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true })
      }
    }
  })

  it(
    'supports settings, wallpaper, initial-balance and cross-process print commands',
    async () => {
      fs.writeFileSync(loginPayloadPath, JSON.stringify({ username: 'admin', password: '' }), 'utf8')

      const loginResult = await runCli(['auth', 'login', '--payload-file', loginPayloadPath])
      expect(loginResult.status).toBe('success')

      const systemGetResult = await runCli(['settings', 'system-get'])
      expect(systemGetResult.status).toBe('success')
      expect(systemGetResult.data).toMatchObject({
        default_voucher_word: expect.any(String)
      })

      const runtimeDefaultsResult = await runCli(['settings', 'runtime-defaults-get'])
      expect(runtimeDefaultsResult.status).toBe('success')

      const preferenceValue = `cli-parity-${Date.now()}`
      fs.writeFileSync(
        preferencesPayloadPath,
        JSON.stringify({
          preferences: {
            cli_parity_test: preferenceValue
          }
        }),
        'utf8'
      )
      const setPreferencesResult = await runCli([
        'settings',
        'preferences-set',
        '--payload-file',
        preferencesPayloadPath
      ])
      expect(setPreferencesResult.status).toBe('success')

      const getPreferencesResult = await runCli(['settings', 'preferences-get'])
      expect(getPreferencesResult.status).toBe('success')
      expect((getPreferencesResult.data as Record<string, string>).cli_parity_test).toBe(preferenceValue)

      fs.writeFileSync(
        wallpaperAnalyzePayloadPath,
        JSON.stringify({
          sourcePath: wallpaperPath
        }),
        'utf8'
      )
      const wallpaperAnalyzeResult = await runCli([
        'settings',
        'wallpaper-analyze',
        '--payload-file',
        wallpaperAnalyzePayloadPath
      ])
      expect(wallpaperAnalyzeResult.status).toBe('success')
      expect(wallpaperAnalyzeResult.data).toMatchObject({
        sourcePath: wallpaperPath,
        outputWidth: 1920,
        outputHeight: 1080
      })

      fs.writeFileSync(
        wallpaperApplyPayloadPath,
        JSON.stringify({
          sourcePath: wallpaperPath,
          useSuggestedViewport: true
        }),
        'utf8'
      )
      const wallpaperApplyResult = await runCli([
        'settings',
        'wallpaper-apply',
        '--payload-file',
        wallpaperApplyPayloadPath
      ])
      expect(wallpaperApplyResult.status).toBe('success')

      const wallpaperRestoreResult = await runCli(['settings', 'wallpaper-restore'])
      expect(wallpaperRestoreResult.status).toBe('success')

      const ledgersResult = await runCli(['ledger', 'list'])
      expect(ledgersResult.status).toBe('success')
      const ledgers = ledgersResult.data as Array<{
        id: number
        start_period: string
      }>
      expect(ledgers.length).toBeGreaterThan(0)

      const ledgerId = ledgers[0].id
      const startPeriod = ledgers[0].start_period

      const initialBalanceListResult = await runCli([
        'initial-balance',
        'list',
        '--ledgerId',
        String(ledgerId),
        '--period',
        startPeriod
      ])
      expect(initialBalanceListResult.status).toBe('success')
      expect(Array.isArray(initialBalanceListResult.data)).toBe(true)

      fs.writeFileSync(
        initialBalanceSavePayloadPath,
        JSON.stringify({
          ledgerId,
          period: startPeriod,
          entries: []
        }),
        'utf8'
      )
      const initialBalanceSaveResult = await runCli([
        'initial-balance',
        'save',
        '--payload-file',
        initialBalanceSavePayloadPath
      ])
      expect(initialBalanceSaveResult.status).toBe('success')

      fs.writeFileSync(
        printPreparePayloadPath,
        JSON.stringify({
          type: 'book',
          ledgerId,
          bookType: 'cli-parity-book',
          title: 'CLI 打印联调',
          periodLabel: startPeriod,
          columns: [
            { key: 'summary', label: '摘要' },
            { key: 'amount', label: '金额', align: 'right' }
          ],
          rows: [
            {
              key: 'row-1',
              cells: [
                { value: '打印测试' },
                { value: 1234.56, isAmount: true }
              ]
            }
          ]
        }),
        'utf8'
      )
      const prepareResult = await runCli([
        'print',
        'prepare',
        '--payload-file',
        printPreparePayloadPath
      ])
      expect(prepareResult.status).toBe('success')

      const jobId = (prepareResult.data as { jobId: string }).jobId
      const readyResult = await waitForPrintReady(jobId)
      expect(readyResult.data.pageCount).toBeGreaterThan(0)

      const modelResult = await runCli(['print', 'model', '--jobId', jobId])
      expect(modelResult.status).toBe('success')
      expect(modelResult.data).toMatchObject({
        title: 'CLI 打印联调'
      })

      const exportPdfResult = await runCli([
        'print',
        'export-pdf',
        '--jobId',
        jobId,
        '--outputPath',
        outputPdfPath
      ])
      expect(exportPdfResult.status).toBe('success')
      expect(fs.existsSync(outputPdfPath)).toBe(true)

      const disposeResult = await runCli(['print', 'dispose', '--jobId', jobId])
      expect(disposeResult.status).toBe('success')
    },
    480_000
  )
})
