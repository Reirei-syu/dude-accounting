import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

describe('报表模块依赖边界', () => {
  it('子模块不依赖 facade，运行时依赖无环且顶层计算没有重复副本', () => {
    const root = path.resolve(__dirname, 'reporting')
    const facade = path.resolve(__dirname, 'reporting.ts')
    const files = fs
      .readdirSync(root)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => path.join(root, file))
    const graph = new Map<string, string[]>()
    const declarations = new Map<string, string>()
    for (const file of [...files, facade]) {
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true
      )
      const dependencies: string[] = []
      for (const node of source.statements) {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const target = path.resolve(path.dirname(file), `${node.moduleSpecifier.text}.ts`)
          if (file !== facade) expect(target, `${file} 不得反向依赖 facade`).not.toBe(facade)
          if (!node.importClause?.isTypeOnly && files.includes(target)) dependencies.push(target)
        }
        if (ts.isFunctionDeclaration(node) && node.name) {
          expect(declarations.has(node.name.text), `${node.name.text} 不得复制到不同模块`).toBe(
            false
          )
          declarations.set(node.name.text, file)
        }
      }
      graph.set(file, dependencies)
    }
    const visited = new Set<string>()
    const visit = (file: string, ancestors: string[]): void => {
      expect(ancestors.includes(file), `循环依赖：${[...ancestors, file].join(' -> ')}`).toBe(false)
      if (visited.has(file)) return
      for (const dependency of graph.get(file) ?? []) visit(dependency, [...ancestors, file])
      visited.add(file)
    }
    for (const file of graph.keys()) visit(file, [])
    expect([...declarations].filter(([, file]) => file === facade).map(([name]) => name)).toEqual([
      'buildSnapshotContent',
      'buildReportSnapshotContentForExport',
      'buildReportName',
      'generateReportSnapshot'
    ])
  })
})
