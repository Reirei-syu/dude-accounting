# 中文 Payload 编码说明

适用范围：CLI `--payload-file`、`--payload-stdin`、`--payload-json`，尤其是 `voucher save`、`voucher update`、`voucher batch` 中的 `description`、`summary`、`reason`、`approvalTag` 等用户输入文本。

## 推荐做法

Windows 下生成包含中文的 JSON payload 时，优先使用 PowerShell 的 UTF-8 输出：

```powershell
$payload = @{
  ledgerId = 5
  period = "2026-01"
  date = "2026-01-03"
  description = "收到基本户利息"
  entries = @(
    @{ subjectCode = "1002"; debit = 3.8; credit = 0; cashflowItemCode = "CF01" },
    @{ subjectCode = "6603"; debit = 0; credit = 3.8 }
  )
}

$payload | ConvertTo-Json -Depth 8 | Out-File -Encoding UTF8 D:\tmp\voucher.json
dude-accounting voucher save --payload-file D:\tmp\voucher.json
```

不要在 Windows cmd、ssh win 或跨 shell 场景下直接用 `echo {...中文...} > payload.json` 生成正式 payload。该方式常受当前代码页影响，文件实际可能是 GBK/GB18030 字节。

## 编码参数

CLI 支持：

- `--encoding auto`：默认值，先按 UTF-8 解析；如果疑似中文乱码，会尝试 GB18030 自动恢复。
- `--encoding utf8`：只按 UTF-8 解析，适合已确认正确的文件。
- `--encoding gbk`：按 GB18030/GBK 解析旧式 Windows payload 文件。

示例：

```powershell
dude-accounting voucher save --payload-file D:\tmp\voucher-gbk.json --encoding gbk
```

自动恢复成功时，CLI 会向 `stderr` 输出提示，但成功 JSON 的 stdout 结构仍保持 `{status,data,error}` 不变。

## 自动恢复边界

CLI 会尽量恢复典型 mojibake，例如 `鏀粯瀵硅处鍗曟墜缁垂` 可恢复为 `支付对账单手续费`。

如果文本已经包含大量 `�`、`锟斤拷` 等替换字符，原始字节通常已经丢失。凭证保存、修改和批量操作会拒绝写入，并提示重新用 UTF-8 或显式 `--encoding gbk` 生成 payload，避免乱码进入正式账套。
