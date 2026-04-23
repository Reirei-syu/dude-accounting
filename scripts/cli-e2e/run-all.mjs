import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runCliE2E } from '../cli-release-e2e/run.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const runId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
const outputRoot = path.join(repoRoot, 'out', 'cli-e2e', runId)

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true })
}

function runCommand(command, args, label) {
  return new Promise((resolve, reject) => {
    const isCmdScript = command.toLowerCase().endsWith('.cmd')
    const child = spawn(isCmdScript ? 'cmd.exe' : command, isCmdScript ? ['/d', '/c', command, ...args] : args, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: false
    })

    child.once('error', (error) => {
      reject(error)
    })
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${label} 执行失败，exit=${code}`))
        return
      }
      resolve()
    })
  })
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

async function main() {
  ensureDir(outputRoot)

  const sourceResult = await runCliE2E({
    surfaceMode: 'source',
    runId,
    outputDir: path.join(outputRoot, 'source')
  })

  await runCommand(
    'powershell.exe',
    ['-ExecutionPolicy', 'Bypass', '-File', path.join(repoRoot, 'scripts', 'prepare-cli-release-e2e.ps1')],
    'prepare-cli-release-e2e'
  )
  await runCommand('npm.cmd', ['run', 'build:cli-host:win'], 'build:cli-host:win')
  await runCommand('npm.cmd', ['run', 'build:unpack'], 'build:unpack')

  const releaseResult = await runCliE2E({
    surfaceMode: 'release',
    runId,
    outputDir: path.join(outputRoot, 'release')
  })

  const combinedReport = {
    status: 'success',
    runId,
    outputDir: outputRoot,
    surfaces: {
      source: {
        ...sourceResult,
        report: readJson(sourceResult.reportPath)
      },
      release: {
        ...releaseResult,
        report: readJson(releaseResult.reportPath)
      }
    }
  }

  const reportPath = path.join(outputRoot, 'report.json')
  const summaryPath = path.join(outputRoot, 'summary.md')
  fs.writeFileSync(reportPath, JSON.stringify(combinedReport, null, 2), 'utf8')
  fs.writeFileSync(
    summaryPath,
    [
      '# CLI 双形态 E2E 汇总',
      '',
      `- runId：${runId}`,
      `- 输出目录：${outputRoot}`,
      `- 源码态报告：${sourceResult.reportPath}`,
      `- 发布态报告：${releaseResult.reportPath}`,
      `- 源码态摘要：${sourceResult.summaryPath}`,
      `- 发布态摘要：${releaseResult.summaryPath}`,
      ''
    ].join('\n'),
    'utf8'
  )

  console.log(
    JSON.stringify(
      {
        status: 'success',
        runId,
        outputDir: outputRoot,
        reportPath,
        summaryPath
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
