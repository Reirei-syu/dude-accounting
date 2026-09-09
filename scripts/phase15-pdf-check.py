"""只读核对 Phase 15 每轮真实 PDF；渲染检查由独立 Poppler 步骤完成。"""

import json
from pathlib import Path
import re
import sys

from pypdf import PdfReader


def main():
    root = Path(sys.argv[1]).resolve(strict=True)
    checked = []
    timeline = [json.loads(line) for line in (root / "timeline.jsonl").read_text(encoding="utf8").splitlines()]
    cycles = [row["cycle"] for row in timeline if row["event"] == "cycle-complete"]
    assert cycles == list(range(1, len(cycles) + 1)), "完成循环不连续或重复"
    if (root / "summary.json").exists():
        summary = json.loads((root / "summary.json").read_text(encoding="utf8"))
        assert summary["success"] and summary["cycles"] == len(cycles), "summary与完成循环不一致"
    for cycle in cycles:
        file = root / f"cycle-{cycle:03d}" / "voucher.pdf"
        assert file.is_file(), f"已完成循环缺少整份PDF: {file}"
        reader = PdfReader(file)
        assert len(reader.pages) == 26, (file, len(reader.pages))
        first_number = ((cycle - 1) // 2) * 26 + 1
        ledger = "enterprise" if cycle % 2 else "npo"
        for index, page in enumerate(reader.pages):
            text = page.extract_text()
            for required in [
                "记账凭证", f"长稳-{ledger}", "2026-01-01",
                f"记-{first_number + index:04d}", "摘要", "会计科目",
                "借方金额", "贷方金额", "合计", "制单", "审核", "记账",
                "1001", "1002", "1.00",
            ]:
                assert required in text, (str(file), index + 1, required)
            summary_text = f"循环{cycle}" if index == 0 else f"累计循环{cycle}-{index - 1}"
            assert len(re.findall(r"(?m)^\s*" + re.escape(summary_text) + r"(?=\s)", text)) == 2, (file, index + 1, summary_text)
            assert re.search(r"记-" + f"{first_number + index:04d}" + r"(?![0-9])", text), (file, index + 1)
        checked.append({"cycle": cycle, "pages": 26, "firstVoucher": first_number,
                        "lastVoucher": first_number + 25})
    assert checked, "没有找到已导出的 PDF"
    print(json.dumps({"success": True, "root": str(root), "checked": checked}, ensure_ascii=True))


if __name__ == "__main__":
    main()
