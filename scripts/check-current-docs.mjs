import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 当前规划文档按仓库约定为本地文件，本检查显式运行，不让干净 CI 依赖忽略文件。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const current = ['prds/PROJECT_SPEC.md', 'PROGRESS.md', 'prds/合规整改计划.md']
const decoder = new TextDecoder('utf-8', { fatal: true })
let links = 0
for (const relative of [...current, 'prds/开发日志.md']) {
  const file = path.join(root, relative)
  const text = decoder.decode(fs.readFileSync(file))
  if (text.includes(String.fromCharCode(0)) || /\uFFFD|锟斤拷|烫烫烫/.test(text)) {
    throw new Error(`文档含损坏文本：${relative}`)
  }
  if (!current.includes(relative)) continue // 开发日志历史链接不冒充当前规范。
  if (text.includes('END OF SPEC')) throw new Error(`当前规格仍有尾部追加标识：${relative}`)
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0]
    if (!target || /^https?:\/\//.test(target)) continue
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target))
    const inside = path.relative(root, resolved)
    if (inside.startsWith('..') || path.isAbsolute(inside) || !fs.existsSync(resolved)) {
      throw new Error(`本地链接无效：${relative} -> ${target}`)
    }
    links += 1
  }
}
console.log(
  `当前文档 UTF-8/损坏文本检查通过：4 文件；本地链接存在性检查通过：${links} 个。历史 snapshot 不作为当前文档。`
)
