import fs from 'node:fs'
import { expect, it } from 'vitest'

it('安装包排除临时测试数据库、日志与审计缓存', () => {
  const config = fs.readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8')
  expect(config).toContain("  - '!.tmp/**'")
})
