import fs from 'node:fs'
import path from 'node:path'

/** 每个窗口独享主进程生成的页面，销毁时只清理本次创建的文件和空目录。 */
export function createPrintLocalResource(
  root: string,
  html: string
): {
  filePath: string
  dispose: () => void
} {
  fs.mkdirSync(root, { recursive: true })
  const directory = fs.mkdtempSync(path.join(root, 'page-'))
  const filePath = path.join(directory, 'index.html')
  const dispose = (): void => {
    fs.rmSync(filePath, { force: true })
    if (fs.existsSync(directory)) fs.rmdirSync(directory)
  }
  try {
    fs.writeFileSync(filePath, html, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  } catch (error) {
    dispose()
    throw error
  }
  return { filePath, dispose }
}
