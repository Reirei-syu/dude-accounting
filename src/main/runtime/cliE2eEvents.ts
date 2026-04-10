import fs from 'node:fs'
import path from 'node:path'

interface CliE2eEventRecord {
  ts: string
  source: 'cli-e2e'
  action: string
  payload: Record<string, unknown> | null
}

function getCliE2eEventsFilePath(): string | null {
  const rawPath = process.env.DUDEACC_E2E_EVENTS_FILE?.trim()
  return rawPath ? rawPath : null
}

export function appendCliE2eEvent(
  action: string,
  payload: Record<string, unknown> | null = null
): void {
  const filePath = getCliE2eEventsFilePath()
  if (!filePath) {
    return
  }

  const record: CliE2eEventRecord = {
    ts: new Date().toISOString(),
    source: 'cli-e2e',
    action,
    payload
  }

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8')
  } catch {
    // Test-only audit should never break production behavior.
  }
}

export function shouldDryRunCliE2eDesktopActions(): boolean {
  return process.env.DUDEACC_E2E_DRY_RUN_DESKTOP_ACTIONS === '1'
}

export function shouldSuppressCliE2eRelaunch(): boolean {
  return process.env.DUDEACC_E2E_SUPPRESS_RELAUNCH === '1'
}
