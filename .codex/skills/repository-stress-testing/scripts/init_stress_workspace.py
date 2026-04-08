#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sys
from datetime import date
from pathlib import Path


def slugify(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    if not normalized:
        raise ValueError("slug 不能为空，且需至少包含一个字母或数字")
    return normalized


def write_text(path: Path, content: str, force: bool) -> None:
    if path.exists() and not force:
        raise FileExistsError(f"文件已存在：{path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def build_readme(repo_name: str, slug: str, workspace_name: str) -> str:
    return f"""# {repo_name} 压测工作区

## 1. 任务标识

- 标识：`{workspace_name}`
- 主题：`{slug}`

## 2. 目标

- 识别关键模块的数据链路、循环点和最终稳定态。
- 验证高频 burst、数据累积、长时间运行和恢复路径是否收敛。
- 发现会在规模放大或运行一段时间后才显现的隐蔽高风险缺陷。

## 3. 最小交付物

- `module-matrix.md`
- `invariants.md`
- `runbook.md`
- `findings.md`
- `soak-log.md`
- `artifacts/`

## 4. 建议顺序

1. 先填写模块矩阵与不变量。
2. 再补 runbook 和具体命令。
3. 先跑基线，再跑 burst / ramp / soak / recovery。
4. 每次执行后把证据放入 `artifacts/`，并把观察写入 `soak-log.md`。

## 5. 退出条件

- 每条高风险链路都存在明确收敛条件与实际执行证据。
- 所有 P0 / P1 问题都已有复现路径与止血建议。
- 验证命令、样本量、运行时长、环境信息均已记录。
"""


def build_module_matrix() -> str:
    return """# 模块与数据链路矩阵

| 模块 | 入口动作 | 主要读取 | 主要写入 | 下游触发 | 循环点 | 收敛条件 | 放大量级 | 观测信号 | 证据位置 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |

## 补充说明

- 先覆盖最核心的写路径和派生路径。
- 如果某条链路无法定义“停止输入后多久恢复稳定”，按高风险标记。
"""


def build_invariants() -> str:
    return """# 不变量与收敛条件

## 1. 全局不变量

- [ ] 停止输入后，关键任务/队列会在约定窗口内归零或回到稳定平台。
- [ ] 同一输入重复执行不会无界地产生重复记录、重复文件或重复快照。
- [ ] 派生快照、缓存或汇总结果在测试窗口结束后可与源数据对账。
- [ ] 内存、CPU、句柄、数据库/WAL、日志与临时目录体积没有持续失控斜率。
- [ ] 重启、恢复、重试不会把原有积压进一步放大。

## 2. 关键链路专用不变量

### 链路 A

- 触发：
- 期望稳定态：
- 失败阈值：

### 链路 B

- 触发：
- 期望稳定态：
- 失败阈值：
"""


def build_runbook() -> str:
    return """# 执行 Runbook

## 1. 环境信息

- 仓库版本：
- 数据集来源：
- 运行环境：
- 观察工具：

## 2. 基线

- 命令：
- 预期：
- 结果：

## 3. 高频 burst

- 命令：
- 样本量：
- 观察点：
- 结果：

## 4. 数据累积 ramp

- 级别 1：
- 级别 2：
- 级别 3：

## 5. 长时间 soak

- 时长：
- 节奏：
- 采样频率：
- 停止条件：

## 6. 恢复 / 重启

- 命令：
- 中间态：
- 恢复后检查项：

## 7. 收尾对账

- 关键表计数：
- 快照/汇总对账：
- 资源回落检查：
"""


def build_findings() -> str:
    return """# Findings

## P0 / P1

### [风险标题]

- 风险等级：
- 现象：
- 触发条件：
- 开始出现的规模 / 时长：
- 非收敛信号：
- 实际证据：
- 最小复现：
- 可能根因：
- 临时止血：
- 后续修复验证：

## P2 / P3

### [风险标题]

- 风险等级：
- 现象：
- 建议：
"""


def build_soak_log() -> str:
    return """# Soak Log

| 时间 | 阶段 | 样本量 / 时长 | 队列 / 积压 | 资源信号 | 业务信号 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |
"""


def create_workspace(root: Path, slug: str, output: Path | None, run_date: str, force: bool) -> Path:
    repo_root = root.resolve()
    workspace_name = f"{run_date}-{slug}"
    target = output.resolve() if output else repo_root / "docs" / "stress" / workspace_name
    target.mkdir(parents=True, exist_ok=True)
    (target / "artifacts").mkdir(exist_ok=True)
    (target / "notes").mkdir(exist_ok=True)

    write_text(target / "README.md", build_readme(repo_root.name, slug, workspace_name), force)
    write_text(target / "module-matrix.md", build_module_matrix(), force)
    write_text(target / "invariants.md", build_invariants(), force)
    write_text(target / "runbook.md", build_runbook(), force)
    write_text(target / "findings.md", build_findings(), force)
    write_text(target / "soak-log.md", build_soak_log(), force)
    write_text(target / "artifacts" / ".gitkeep", "", force)
    write_text(target / "notes" / ".gitkeep", "", force)

    return target


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="初始化一次仓库压力测试的工作区骨架")
    parser.add_argument("slug", help="本轮压测主题，例如 import-loop 或 ledger-soak")
    parser.add_argument("--root", default=".", help="仓库根目录，默认当前目录")
    parser.add_argument("--output", help="显式输出目录；不传则输出到 <root>/docs/stress/<date>-<slug>")
    parser.add_argument("--date", dest="run_date", default=date.today().isoformat(), help="日期前缀，默认今天，格式 YYYY-MM-DD")
    parser.add_argument("--force", action="store_true", help="允许覆盖已存在的模板文件")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        slug = slugify(args.slug)
        root = Path(args.root)
        output = Path(args.output) if args.output else None
        target = create_workspace(root, slug, output, args.run_date, args.force)
    except Exception as exc:  # pragma: no cover - CLI error path
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1

    print(f"[OK] Workspace created: {target}")
    print("[OK] Files:")
    for name in [
        "README.md",
        "module-matrix.md",
        "invariants.md",
        "runbook.md",
        "findings.md",
        "soak-log.md",
        "artifacts/.gitkeep",
        "notes/.gitkeep",
    ]:
        print(f"  - {target / name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
