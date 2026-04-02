from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from playwright.sync_api import Page, Playwright, sync_playwright


APP_TITLE = "Dude Accounting"
DEFAULT_CDP_PORT = 9222
DEFAULT_LEDGER_PERIOD = "2026-03"
RUN_SUFFIX = datetime.now().strftime("%Y%m%d%H%M%S")
ENTERPRISE_LEDGER_NAME = f"自动测试-企业账套-{RUN_SUFFIX}"
NPO_LEDGER_NAME = f"自动测试-民非账套-{RUN_SUFFIX}"
LONG_SUBJECT_CODE = "660201"
LONG_SUBJECT_NAME = "自动化测试超长科目名称用于打印预览溢出与自动适配验证请勿删除请勿正式入账仅用于界面与打印链路专项检查"
ARTIFACT_DIR_NAME = "electron-breakpoint-audit"


@dataclass
class Finding:
    code: str
    module: str
    severity: str
    blocked: bool
    scene_path: str
    symptom: str
    root_cause: str
    ui_fix: str
    service_fix: str
    core_fix: str
    config_fix: str
    recommendation: str
    impact: str
    test_case: str


class AuditRunner:
    def __init__(self, repo_root: Path, output_dir: Path, cdp_port: int, start_app: bool) -> None:
        self.repo_root = repo_root
        self.output_dir = output_dir
        self.cdp_port = cdp_port
        self.start_app = start_app
        self.logs_dir = output_dir / "logs"
        self.screenshots_dir = output_dir / "screenshots"
        self.exports_dir = output_dir / "exports"
        self.runtime_logs_dir = output_dir / "runtime-logs"
        self.log_file = self.logs_dir / "audit.log"
        self.app_process: subprocess.Popen[str] | None = None
        self.playwright: Playwright | None = None
        self.browser = None
        self.context = None
        self.page: Page | None = None
        self._bound_page_ids: set[int] = set()
        self.findings: list[Finding] = []
        self.summary: dict[str, Any] = {
            "startedAt": datetime.now().isoformat(timespec="seconds"),
            "appStarted": False,
            "ledgers": {},
            "normalPrint": {},
            "longPrint": {},
            "boundaryPrint": {},
            "reportReflection": {},
            "reportExports": {},
            "npoSmoke": {},
            "errors": []
        }
        self._current_log_handle = None

    def setup(self) -> None:
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.screenshots_dir.mkdir(parents=True, exist_ok=True)
        self.exports_dir.mkdir(parents=True, exist_ok=True)
        self.runtime_logs_dir.mkdir(parents=True, exist_ok=True)
        self._current_log_handle = self.log_file.open("w", encoding="utf-8")
        self.log(f"输出目录：{self.output_dir}")

    def cleanup(self) -> None:
        if self.browser is not None:
            try:
                self.browser.close()
            except Exception as error:  # noqa: BLE001
                self.log(f"关闭浏览器失败：{error}")
        if self.playwright is not None:
            try:
                self.playwright.stop()
            except Exception as error:  # noqa: BLE001
                self.log(f"停止 Playwright 失败：{error}")
        if self.app_process is not None and self.app_process.poll() is None:
            self.log("关闭 Electron 开发进程")
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(self.app_process.pid)],
                cwd=self.repo_root,
                check=False,
                capture_output=True,
                text=True
            )
        if self._current_log_handle is not None:
            self._current_log_handle.close()

    def log(self, message: str) -> None:
        text = f"[{datetime.now().strftime('%H:%M:%S')}] {message}"
        print(text)
        if self._current_log_handle is not None and not self._current_log_handle.closed:
            self._current_log_handle.write(text + "\n")
            self._current_log_handle.flush()

    def run(self) -> None:
        self.setup()
        try:
            self.start_or_connect_app()
            self.login()
            self.create_ledgers_via_ui()
            self.prepare_enterprise_fixtures()
            self.run_subject_balance_audit()
            self.run_report_reflection_audit()
            self.run_report_export_audit()
            self.run_npo_smoke()
            self.copy_runtime_logs()
            self.write_outputs()
        finally:
            self.cleanup()

    def start_or_connect_app(self) -> None:
        if self.start_app:
            self.log("启动 Electron 开发环境")
            command = [
                "cmd.exe",
                "/d",
                "/s",
                "/c",
                "npm run dev -- --remoteDebuggingPort " + str(self.cdp_port)
            ]
            self.app_process = subprocess.Popen(
                command,
                cwd=self.repo_root,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace"
            )

            def _tee_output(process: subprocess.Popen[str], log_path: Path) -> None:
                with log_path.open("w", encoding="utf-8") as handle:
                    assert process.stdout is not None
                    for line in process.stdout:
                        handle.write(line)
                        handle.flush()

            threading.Thread(
                target=_tee_output,
                args=(self.app_process, self.logs_dir / "electron-dev.log"),
                daemon=True
            ).start()

        self.wait_for_cdp()
        self.connect_playwright()
        self.summary["appStarted"] = True

    def wait_for_cdp(self, timeout_seconds: int = 120) -> None:
        deadline = time.time() + timeout_seconds
        version_url = f"http://127.0.0.1:{self.cdp_port}/json/version"
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(version_url, timeout=2) as response:  # noqa: S310
                    payload = json.loads(response.read().decode("utf-8"))
                    self.log(f"CDP 已就绪：{payload.get('Browser', 'unknown')}")
                    return
            except (urllib.error.URLError, TimeoutError, ConnectionResetError):
                time.sleep(1)
        raise RuntimeError(f"等待 CDP 端口 {self.cdp_port} 超时")

    def connect_playwright(self) -> None:
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{self.cdp_port}")
        self.context = self.browser.contexts[0] if self.browser.contexts else self.browser.new_context()
        self.attach_page_listeners()
        self.page = self.wait_for_main_page()
        self.page.bring_to_front()
        self.page.set_default_timeout(15000)
        self.screenshot("00-connected")

    def attach_page_listeners(self) -> None:
        assert self.browser is not None
        for context in self.browser.contexts:
            self._attach_context_listeners(context)

    def _attach_context_listeners(self, context: Any) -> None:
        for page in context.pages:
            self._bind_page(page)
        context.on("page", self._bind_page)

    def _bind_page(self, page: Page) -> None:
        try:
            page_id = id(page)
        except Exception:  # noqa: BLE001
            page_id = None
        if page_id is not None and page_id in self._bound_page_ids:
            return
        if page_id is not None:
            self._bound_page_ids.add(page_id)

        def _on_console(message: Any) -> None:
            self.log(f"[console:{page.url}] {message.type}: {message.text}")

        def _on_error(error: Any) -> None:
            self.log(f"[pageerror:{page.url}] {error}")

        page.on("console", _on_console)
        page.on("pageerror", _on_error)

    def iter_all_pages(self) -> list[Page]:
        assert self.browser is not None
        pages: list[Page] = []
        for context in self.browser.contexts:
            self._attach_context_listeners(context)
            pages.extend(context.pages)
        return pages

    def wait_for_main_page(self, timeout_seconds: int = 120) -> Page:
        assert self.browser is not None
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            for context in self.browser.contexts:
                self._attach_context_listeners(context)
                for page in context.pages:
                    try:
                        title = page.title()
                    except Exception:  # noqa: BLE001
                        continue
                    if APP_TITLE in title or "localhost" in page.url:
                        self.log(f"命中主页面：title={title} url={page.url}")
                        return page
            time.sleep(1)
        raise RuntimeError("未找到 Electron 主页面")

    def screenshot(self, name: str, page: Page | None = None) -> None:
        target = page or self.page
        if target is None:
            return
        path = self.screenshots_dir / f"{name}.png"
        try:
            target.screenshot(path=str(path), full_page=True)
        except Exception as error:  # noqa: BLE001
            self.log(f"截图失败 {name}: {error}")

    def click_button(self, text: str, page: Page | None = None) -> None:
        target = page or self.page
        assert target is not None
        target.get_by_role("button", name=text, exact=True).first.click()

    def ensure_main_layout(self) -> None:
        assert self.page is not None
        self.page.locator(".main-shell").wait_for()

    def login(self) -> None:
        assert self.page is not None
        self.log("执行登录")
        if self.page.locator("#username-input").count() == 0:
            self.log("当前已处于登录后主界面，跳过登录")
            self.ensure_main_layout()
            return
        self.page.locator("#username-input").fill("admin")
        self.page.locator("#password-input").fill("")
        self.click_button("登录")
        self.ensure_main_layout()
        self.screenshot("01-main-layout")

    def create_ledgers_via_ui(self) -> None:
        assert self.page is not None
        self.log("创建企业与民非测试账套")
        self.create_ledger(ENTERPRISE_LEDGER_NAME, "enterprise")
        self.create_ledger(NPO_LEDGER_NAME, "npo")
        ledgers = self.page.evaluate("() => window.api.ledger.getAll()")
        self.summary["ledgers"] = {ledger["name"]: ledger for ledger in ledgers}
        self.screenshot("02-ledgers-created")

    def create_ledger(self, ledger_name: str, standard_type: str) -> None:
        assert self.page is not None
        existing = self.page.evaluate("() => window.api.ledger.getAll()")
        if any(item["name"] == ledger_name for item in existing):
            self.log(f"账套已存在，跳过创建：{ledger_name}")
            self.select_ledger(ledger_name)
            return

        self.page.get_by_role("button", name="新建账套").click()
        self.page.get_by_placeholder("例如：杜小德科技有限公司").fill(ledger_name)
        self.page.locator("input[type='month']").last.fill(DEFAULT_LEDGER_PERIOD)
        self.page.locator("select.glass-input").last.select_option(
            "npo" if standard_type == "npo" else "enterprise"
        )
        self.page.get_by_role("button", name="确认创建").click()
        self.page.locator("#ledger-selector").wait_for()
        self.page.wait_for_timeout(500)
        self.select_ledger(ledger_name)

    def select_ledger(self, ledger_name: str) -> None:
        assert self.page is not None
        selector = self.page.locator("#ledger-selector")
        options = selector.locator("option")
        matched_value = None
        for index in range(options.count()):
            option = options.nth(index)
            text = option.inner_text().strip()
            value = option.get_attribute("value") or ""
            if text.startswith(ledger_name):
                matched_value = value
                break
        if matched_value is None:
            raise RuntimeError(f"未找到账套选项：{ledger_name}")
        selector.select_option(matched_value)
        self.page.wait_for_timeout(400)

    def get_current_ledger(self) -> dict[str, Any]:
        assert self.page is not None
        ledgers = self.page.evaluate("() => window.api.ledger.getAll()")
        selected_value = self.page.locator("#ledger-selector").input_value()
        for ledger in ledgers:
            if str(ledger["id"]) == selected_value:
                return ledger
        raise RuntimeError("未获取到当前账套")

    def open_module(self, module_label: str, submenu_label: str) -> None:
        assert self.page is not None
        self.log(f"打开模块：{module_label} -> {submenu_label}")
        overlay_button = self.page.locator(".feature-panel").get_by_role("button", name=submenu_label)
        self.page.get_by_role("button", name=module_label, exact=True).click(force=True)
        self.page.wait_for_timeout(200)
        if overlay_button.count() == 0:
            self.page.get_by_role("button", name=module_label, exact=True).click(force=True)
            self.page.wait_for_timeout(200)
        overlay_button.wait_for()
        overlay_button.click(force=True)
        self.page.wait_for_timeout(500)

    def activate_tab(self, title: str) -> None:
        assert self.page is not None
        self.page.locator(".tab-btn").filter(has_text=title).first.click()
        self.page.wait_for_timeout(300)

    def prepare_enterprise_fixtures(self) -> None:
        assert self.page is not None
        self.log("准备企业账套测试数据")
        self.select_ledger(ENTERPRISE_LEDGER_NAME)
        ledger = self.get_current_ledger()
        self.ensure_long_subject(ledger["id"])
        self.open_module("账务处理", "凭证录入")
        self.create_voucher_via_ui("测试费用暂估", "6601", "2202", "1000.00")
        self.create_vouchers_via_api(
            ledger["id"],
            [
                ("打印科目1", "6603", "2202", "120.00"),
                ("打印科目2", "6401", "2202", "130.00"),
                ("打印科目3", "6402", "2202", "140.00"),
                ("打印科目4", "6403", "2202", "150.00"),
                ("打印科目5", "6711", "2202", "160.00"),
                ("打印科目6", "6801", "2202", "170.00"),
                ("打印科目7", LONG_SUBJECT_CODE, "2202", "180.00")
            ]
        )
        self.screenshot("03-enterprise-fixtures")

    def ensure_long_subject(self, ledger_id: int) -> None:
        assert self.page is not None
        subjects = self.page.evaluate(f"() => window.api.subject.getAll({ledger_id})")
        if any(subject["code"] == LONG_SUBJECT_CODE for subject in subjects):
            self.log("长名称科目已存在，跳过创建")
            return
        self.log("创建长名称测试科目")
        result = self.page.evaluate(
            """async (payload) => window.api.subject.create(payload)""",
            {
                "ledgerId": ledger_id,
                "parentCode": "6602",
                "code": LONG_SUBJECT_CODE,
                "name": LONG_SUBJECT_NAME,
                "auxiliaryCategories": [],
                "customAuxiliaryItemIds": [],
                "isCashFlow": False
            }
        )
        if not result.get("success"):
            raise RuntimeError(f"创建长名称科目失败：{result.get('error')}")

    def create_vouchers_via_api(
        self, ledger_id: int, specs: Iterable[tuple[str, str, str, str]]
    ) -> None:
        assert self.page is not None
        for summary, debit_subject, credit_subject, amount in specs:
            result = self.page.evaluate(
                """async (payload) => window.api.voucher.save(payload)""",
                {
                    "ledgerId": ledger_id,
                    "voucherDate": f"{DEFAULT_LEDGER_PERIOD}-01",
                    "entries": [
                        {
                            "summary": summary,
                            "subjectCode": debit_subject,
                            "debitAmount": amount,
                            "creditAmount": "0.00",
                            "cashFlowItemId": None
                        },
                        {
                            "summary": summary,
                            "subjectCode": credit_subject,
                            "debitAmount": "0.00",
                            "creditAmount": amount,
                            "cashFlowItemId": None
                        }
                    ]
                }
            )
            if not result.get("success"):
                raise RuntimeError(f"通过 IPC 创建凭证失败：{summary} / {result.get('error')}")

    def create_voucher_via_ui(
        self, summary: str, debit_subject: str, credit_subject: str, amount: str
    ) -> None:
        assert self.page is not None
        self.log("通过 UI 创建首张测试凭证")
        ledger = self.get_current_ledger()
        count_before = len(
            self.page.evaluate(
                """async (payload) => window.api.voucher.list(payload)""",
                {"ledgerId": ledger["id"], "period": ledger["current_period"], "status": "all"}
            )
        )
        self.page.locator("input[aria-label='voucher-row-summary']").nth(0).fill(summary)
        self.fill_subject_row(0, debit_subject)
        self.page.locator("input[aria-label='voucher-row-debit']").nth(0).fill(amount)
        self.page.locator("input[aria-label='voucher-row-summary']").nth(1).fill(summary)
        self.fill_subject_row(1, credit_subject)
        self.page.locator("input[aria-label='voucher-row-credit']").nth(1).fill(amount)
        self.screenshot("04a-voucher-before-save")
        self.click_button("保存")
        self.page.wait_for_timeout(1200)
        count_after = len(
            self.page.evaluate(
                """async (payload) => window.api.voucher.list(payload)""",
                {"ledgerId": ledger["id"], "period": ledger["current_period"], "status": "all"}
            )
        )
        if self.page.get_by_text("凭证已保存").count() == 0 and count_after <= count_before:
            self.screenshot("04b-voucher-save-failed")
            body_excerpt = self.page.locator("body").inner_text()[:1200]
            raise RuntimeError(f"UI 保存凭证后未出现成功提示，页面摘录：{body_excerpt}")
        self.screenshot("04-voucher-saved-ui")

    def fill_subject_row(self, row_index: int, subject_code: str) -> None:
        assert self.page is not None
        locator = self.page.locator("input[aria-label='voucher-row-subject']").nth(row_index)
        locator.fill(subject_code)
        self.page.wait_for_timeout(300)
        suggestion_panel = self.page.locator(".absolute.z-30")
        if suggestion_panel.count() > 0 and suggestion_panel.locator("button").count() > 0:
            suggestion_panel.locator("button").first.click()
        else:
            locator.press("Enter")
        self.page.wait_for_timeout(200)
        current_value = locator.input_value().strip()
        if subject_code not in current_value:
            raise RuntimeError(
                f"第 {row_index + 1} 行科目未正确选中，期望包含 {subject_code}，实际为 {current_value!r}"
            )

    def run_subject_balance_audit(self) -> None:
        assert self.page is not None
        self.log("执行科目余额表打印链路")
        self.select_ledger(ENTERPRISE_LEDGER_NAME)
        self.open_module("账簿查询", "科目余额表")
        self.activate_tab("科目余额表")

        self.page.get_by_role("checkbox", name="未记账凭证").first.check()
        self.click_button("查询")
        self.page.wait_for_timeout(800)
        normal_row_count = self.page.locator(".glass-panel.flex-1 .grid.cursor-context-menu").count()
        if normal_row_count == 0:
            raise RuntimeError("科目余额表查询后仍无可打印数据")
        self.summary["normalPrint"]["rowCount"] = normal_row_count
        self.click_button("全屏查看")
        self.page.get_by_role("button", name="关闭").click()
        normal_preview = self.open_print_preview_and_capture("subject-balance-normal")
        self.summary["normalPrint"].update(normal_preview)

        self.page.get_by_role("checkbox", name="显示无余额科目").first.check()
        self.click_button("查询")
        self.page.wait_for_timeout(800)
        multi_page_preview = self.open_print_preview_and_capture("subject-balance-multipage")
        multi_page_model = self.collect_subject_balance_preview_model()
        boundary = self.find_print_boundary()
        boundary["multiPagePreview"] = multi_page_preview
        boundary["multiPageModel"] = multi_page_model
        self.summary["boundaryPrint"] = boundary
        if multi_page_model.get("pageCount", 0) < 2:
            self.summary["errors"].append("账簿多页预览未形成至少 2 页，无法验证第 2 页页眉重复")
        if multi_page_model.get("pageCount", 0) >= 2 and not multi_page_model.get(
            "secondPageHasRepeatedHeader"
        ):
            self.summary["errors"].append("账簿多页预览第 2 页缺少完整页眉")
        if multi_page_model.get("pageCount", 0) >= 2 and not multi_page_model.get(
            "secondPageHasColumnHeader"
        ):
            self.summary["errors"].append("账簿多页预览第 2 页缺少列表列头")
        if boundary.get("overflowWarning") and not boundary.get("overflowPreview", {}).get(
            "hasRecoveryControls", False
        ):
            self.add_finding(
                Finding(
                    code="PRINT-001",
                    module="账簿查询 / 打印预览",
                    severity="P1",
                    blocked=True,
                    scene_path="科目余额表 -> 查询 -> 打印预览 -> 预览页",
                    symptom="打印预览出现“当前打印内容已超出纸张范围，请减小两联间距或调整内容后重试”，但账簿打印链路没有任何页面设置、缩放或间距入口。",
                    root_cause="UI 层只给账簿打印暴露了‘打印预览’入口；`printUtils` 只轮询状态；`print:*` 与 `services/print.ts` 仅在预览 HTML 内给出错误文本，不返回任何可操作配置面板。",
                    ui_fix="在账簿与报表页面补统一打印设置面板，至少提供缩放、页边距/列宽适配、自动分页策略说明。",
                    service_fix="为 `print:prepare` / `print:getJobStatus` 增加可消费的布局诊断信息，如溢出方向、建议缩放比、建议分页策略。",
                    core_fix="在打印文档生成层增加列宽收缩、自动分页和长文本折行后的再测量逻辑，避免直接把失败留给用户。",
                    config_fix="新增账簿/报表打印偏好配置，不再把‘减小两联间距’这类仅凭证打印适用的提示复用于账簿/报表。",
                    recommendation="引入统一 PrintConfig，让账簿、报表、凭证三条打印链路共用同一套可调布局参数与诊断返回结构。",
                    impact="账簿与报表打印链路；预览、系统打印、PDF 导出同样受影响。",
                    test_case="步骤：打开科目余额表，勾选显示无余额科目，查询后点打印预览。预期：系统提供可调整入口或自动适配。实际：仅提示超出纸张范围，用户无法处理。"
                )
            )

        self.click_button("全屏查看")
        modal = self.page.locator("[role='dialog']").last
        has_print_button = modal.get_by_role("button", name="打印预览").count() > 0
        modal.get_by_role("button", name="关闭").click()
        if not has_print_button:
            self.add_finding(
                Finding(
                    code="BOOK-001",
                    module="账簿查询 / 科目余额表",
                    severity="P2",
                    blocked=False,
                    scene_path="科目余额表 -> 查询 -> 全屏查看",
                    symptom="全屏查看弹层内没有继续打印的入口，用户必须退出全屏后回到原页面再点打印预览。",
                    root_cause="全屏查看与打印预览被实现为两条完全独立的 UI 分支，弹层只保留关闭操作，没有桥接到打印任务。",
                    ui_fix="在全屏查看弹层直接提供打印预览入口，并保留当前筛选条件。",
                    service_fix="无新增服务能力要求，复用现有 `prepareAndOpenPrintPreview` 即可。",
                    core_fix="无核心算法变更，属于页面流程编排缺口。",
                    config_fix="无。",
                    recommendation="把全屏查看弹层升级为打印前预览容器，支持直接进入打印任务。",
                    impact="账簿查询所有依赖全屏查看的大表页。",
                    test_case="步骤：打开科目余额表，查询后点全屏查看。预期：可在弹层内继续打印。实际：只有关闭，没有打印入口。"
                )
            )

        long_case = self.run_long_subject_print_case()
        self.summary["longPrint"] = long_case

    def open_print_preview_and_capture(self, screenshot_prefix: str) -> dict[str, Any]:
        before_pages = set(self.iter_all_pages())
        self.click_button("打印预览")
        preview_page = self.wait_for_new_page(before_pages)
        preview_page.wait_for_load_state("domcontentloaded")
        preview_page.wait_for_timeout(800)
        self.screenshot(f"{screenshot_prefix}-preview", preview_page)
        preview = self.collect_preview_state(preview_page)
        try:
            preview_page.close()
        except Exception:  # noqa: BLE001
            pass
        assert self.page is not None
        self.page.bring_to_front()
        return preview

    def wait_for_new_page(self, existing_pages: set[Page], timeout_seconds: int = 60) -> Page:
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            for page in self.iter_all_pages():
                if page is self.page or page in existing_pages:
                    continue
                try:
                    url = page.url
                except Exception:  # noqa: BLE001
                    continue
                if url.startswith("data:text/html") and "print-measure" not in url:
                    return page
                try:
                    page.wait_for_load_state("domcontentloaded", timeout=300)
                    title = page.title()
                except Exception:  # noqa: BLE001
                    continue
                if title in {"Electron", "print-measure", ""}:
                    continue
                return page
            assert self.page is not None
            self.page.wait_for_timeout(200)
        for page in reversed(self.iter_all_pages()):
            if page is not self.page and page not in existing_pages:
                return page
        raise RuntimeError("等待打印预览窗口超时")

    def collect_preview_state(self, preview_page: Page) -> dict[str, Any]:
        preview_model = preview_page.evaluate("() => window.__PRINT_PREVIEW_MODEL__ ?? null")
        if not preview_model:
            if preview_page.locator(".preview-page-card").count() == 0:
                preview_page.locator(".preview-page-card").first.wait_for(timeout=5000)
            preview_model = preview_page.evaluate("() => window.__PRINT_PREVIEW_MODEL__ ?? null")
        buttons = [text.strip() for text in preview_page.locator(".preview-toolbar button").all_inner_texts()]
        status_text = preview_page.locator("#preview-status").inner_text().strip()
        has_scale_control = preview_page.locator("text=缩放").count() > 0
        has_margin_control = preview_page.locator("text=页边距").count() > 0 or preview_page.locator("text=间距").count() > 0
        has_auto_fit_hint = preview_page.locator("text=自动适配").count() > 0
        page_count = int(preview_model.get("pageCount", 0)) if isinstance(preview_model, dict) else 0
        second_page_html = (
            preview_model.get("pages", [])[1].get("pageHtml", "")
            if isinstance(preview_model, dict) and page_count > 1
            else ""
        )
        return {
            "title": preview_page.title(),
            "buttons": buttons,
            "statusText": status_text,
            "pageCount": page_count,
            "overflowWarning": "超出纸张范围" in status_text or "减小两联间距" in status_text,
            "hasScaleControl": has_scale_control,
            "hasMarginControl": has_margin_control,
            "hasAutoFitHint": has_auto_fit_hint,
            "hasCompactModeControl": preview_page.locator("#preview-compact-toggle").count() > 0,
            "hasRecoveryControls": has_scale_control
            or preview_page.locator("#preview-compact-toggle").count() > 0,
            "secondPageHasRepeatedHeader": (
                "编制单位：" in second_page_html
                and "会计期间：" in second_page_html
                and "单位：" in second_page_html
            ),
            "secondPageHasColumnHeader": "科目编码" in second_page_html or "日期" in second_page_html
        }

    def find_print_boundary(self) -> dict[str, Any]:
        assert self.page is not None
        ledger = self.get_current_ledger()
        subject_codes = self.page.evaluate(
            """async (ledgerId) => {
                const subjects = await window.api.subject.getAll(ledgerId)
                return subjects.map((item) => item.code).sort((left, right) => left.localeCompare(right))
            }""",
            ledger["id"]
        )
        low = 0
        high = len(subject_codes) - 1
        best_fit_index = -1
        overflow_state: dict[str, Any] | None = None
        while low <= high:
            mid = (low + high) // 2
            candidate = subject_codes[mid]
            self.page.locator("#subject-balance-range-end-compact").select_option(candidate)
            self.click_button("查询")
            self.page.wait_for_timeout(600)
            result = self.open_print_preview_and_capture(f"subject-balance-boundary-{mid}")
            if result.get("overflowWarning"):
                overflow_state = result
                high = mid - 1
            else:
                best_fit_index = mid
                low = mid + 1
        boundary_code = subject_codes[best_fit_index] if best_fit_index >= 0 else None
        overflow_code = subject_codes[best_fit_index + 1] if best_fit_index + 1 < len(subject_codes) else None
        return {
            "bestFitEndCode": boundary_code,
            "firstOverflowEndCode": overflow_code,
            "overflowWarning": bool(overflow_state and overflow_state.get("overflowWarning")),
            "overflowPreview": overflow_state or {}
        }

    def run_long_subject_print_case(self) -> dict[str, Any]:
        assert self.page is not None
        self.log("执行长文本打印用例")
        self.page.locator("#subject-balance-range-start-compact").select_option(LONG_SUBJECT_CODE)
        self.page.locator("#subject-balance-range-end-compact").select_option(LONG_SUBJECT_CODE)
        self.page.get_by_role("checkbox", name="显示无余额科目").first.uncheck()
        self.click_button("查询")
        self.page.wait_for_timeout(600)
        return self.open_print_preview_and_capture("subject-balance-long")

    def collect_subject_balance_preview_model(self) -> dict[str, Any]:
        assert self.page is not None
        ledger = self.get_current_ledger()
        result = self.page.evaluate(
            """async (payload) => {
                const rows = await window.api.bookQuery.listSubjectBalances({
                    ledgerId: payload.ledgerId,
                    startDate: payload.startDate,
                    endDate: payload.endDate,
                    includeUnpostedVouchers: true,
                    includeZeroBalance: true
                });

                const prepared = await window.api.print.prepare({
                    type: 'book',
                    ledgerId: payload.ledgerId,
                    bookType: 'subject_balance',
                    title: '科目余额表',
                    ledgerName: payload.ledgerName,
                    periodLabel: `${payload.startDate} 至 ${payload.endDate}`,
                    columns: [
                        { key: 'subject_code', label: '科目编码', align: 'left' },
                        { key: 'subject_name', label: '科目名称', align: 'left' },
                        { key: 'opening_debit', label: '期初借方', align: 'right' },
                        { key: 'opening_credit', label: '期初贷方', align: 'right' },
                        { key: 'period_debit', label: '本期借方', align: 'right' },
                        { key: 'period_credit', label: '本期贷方', align: 'right' },
                        { key: 'ending_debit', label: '期末借方', align: 'right' },
                        { key: 'ending_credit', label: '期末贷方', align: 'right' }
                    ],
                    rows: rows.map((row) => ({
                        key: row.subject_code,
                        cells: [
                            { value: row.subject_code },
                            { value: row.subject_name },
                            { value: row.opening_debit_amount / 100, isAmount: true },
                            { value: row.opening_credit_amount / 100, isAmount: true },
                            { value: row.period_debit_amount / 100, isAmount: true },
                            { value: row.period_credit_amount / 100, isAmount: true },
                            { value: row.ending_debit_amount / 100, isAmount: true },
                            { value: row.ending_credit_amount / 100, isAmount: true }
                        ]
                    }))
                });
                if (!prepared.success || !prepared.jobId) {
                    return { success: false, error: prepared.error || 'prepare failed' };
                }

                for (let attempt = 0; attempt < 100; attempt += 1) {
                    const status = await window.api.print.getJobStatus(prepared.jobId);
                    if (!status.success) {
                        await window.api.print.dispose(prepared.jobId);
                        return { success: false, error: status.error || 'status failed' };
                    }
                    if (status.status === 'ready') {
                        const modelResult = await window.api.print.getPreviewModel(prepared.jobId);
                        await window.api.print.dispose(prepared.jobId);
                        if (!modelResult.success || !modelResult.model) {
                            return { success: false, error: modelResult.error || 'model failed' };
                        }
                        return {
                            success: true,
                            pageCount: modelResult.model.pageCount,
                            secondPageHtml:
                                modelResult.model.pageCount > 1
                                    ? modelResult.model.pages[1]?.pageHtml || ''
                                    : '',
                            diagnostics: modelResult.model.diagnostics
                        };
                    }
                    if (status.status === 'failed') {
                        await window.api.print.dispose(prepared.jobId);
                        return { success: false, error: status.error || 'layout failed' };
                    }
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }

                await window.api.print.dispose(prepared.jobId);
                return { success: false, error: 'layout timeout' };
            }""",
            {
                "ledgerId": ledger["id"],
                "ledgerName": ledger["name"],
                "startDate": "2026-01-01",
                "endDate": "2026-04-02"
            }
        )

        if not result.get("success"):
            return {
                "success": False,
                "error": result.get("error", "collect preview model failed"),
                "pageCount": 0,
                "secondPageHasRepeatedHeader": False,
                "secondPageHasColumnHeader": False
            }

        second_page_html = result.get("secondPageHtml", "")
        return {
            "success": True,
            "pageCount": int(result.get("pageCount", 0)),
            "secondPageHasRepeatedHeader": (
                "编制单位：" in second_page_html
                and "会计期间：" in second_page_html
                and "单位：" in second_page_html
            ),
            "secondPageHasColumnHeader": "科目编码" in second_page_html
        }

    def run_report_reflection_audit(self) -> None:
        assert self.page is not None
        self.log("执行凭证到报表反映链路")
        self.select_ledger(ENTERPRISE_LEDGER_NAME)
        self.open_module("报表输出", "利润表")
        self.activate_tab("利润表")

        no_unposted = self.generate_report_via_ui(include_unposted=False)
        self.summary["reportReflection"]["savedButUnposted"] = no_unposted
        if not no_unposted.get("has1000Amount") and not no_unposted.get("hasDefaultScopeHint"):
            self.add_finding(
                Finding(
                    code="REPORT-001",
                    module="凭证录入 / 报表输出",
                    severity="P2",
                    blocked=False,
                    scene_path="凭证录入 -> 保存 -> 利润表 -> 生成并保存",
                    symptom="用户刚保存凭证就去生成利润表，系统默认生成成功，但报表不反映刚保存的数据；页面没有显式说明必须先记账或勾选未记账凭证。",
                    root_cause="报表页默认只统计已记账凭证，但 UI 只提供了一个复选框，没有把默认口径与‘保存后不会立即反映’的业务约束前置提示出来。",
                    ui_fix="在报表页标题区或生成按钮附近显式提示‘默认仅统计已记账凭证’，并在刚保存未记账凭证后给出引导。",
                    service_fix="生成结果为空时返回更细的元信息，例如“当前期间存在未记账凭证 N 张”。",
                    core_fix="无核心算法问题，主要是默认口径缺少可见解释。",
                    config_fix="增加报表页默认口径偏好，让用户显式选择默认是否纳入未记账凭证。",
                    recommendation="把‘未记账凭证’口径从隐式复选框提升为首屏说明 + 可记忆默认值。",
                    impact="所有报表生成入口，不限企业与民非。",
                    test_case="步骤：保存一张未记账凭证后直接生成利润表。预期：系统明确提示默认不包含未记账凭证。实际：生成成功但数据为空，容易误判为保存失败。"
                )
            )

        self.delete_latest_snapshot("income_statement")
        with_unposted = self.generate_report_via_ui(include_unposted=True)
        self.summary["reportReflection"]["includeUnposted"] = with_unposted
        self.delete_latest_snapshot("income_statement")

        self.open_module("账务处理", "凭证管理")
        self.activate_tab("凭证管理")
        self.audit_and_bookkeep_all_visible()
        self.screenshot("05-voucher-bookkept")

        self.open_module("报表输出", "利润表")
        self.activate_tab("利润表")
        posted = self.generate_report_via_ui(include_unposted=False)
        self.summary["reportReflection"]["bookkept"] = posted
        if not posted.get("has1000Amount"):
            self.summary["errors"].append("记账后利润表仍未出现 1000.00，需人工复核")

    def generate_report_via_ui(self, include_unposted: bool) -> dict[str, Any]:
        assert self.page is not None
        checkbox = self.page.get_by_role("checkbox", name="未记账凭证").first
        if include_unposted:
            checkbox.check()
        else:
            checkbox.uncheck()
        self.click_button("生成并保存")
        self.page.wait_for_timeout(1200)
        body_text = self.page.locator("body").inner_text()
        has_amount = "1000.00" in body_text or "1,000.00" in body_text
        result = {
            "includeUnposted": include_unposted,
            "has1000Amount": has_amount,
            "successText": "已生成并保存" in body_text,
            "hasDefaultScopeHint": "默认仅统计已记账凭证" in body_text,
            "bodyExcerpt": body_text[:1200]
        }
        self.screenshot(f"report-generate-{'with' if include_unposted else 'without'}-unposted")
        close_buttons = self.page.get_by_role("button", name="关闭")
        if close_buttons.count() > 0:
            close_buttons.last.click()
            self.page.wait_for_timeout(300)
        return result

    def delete_latest_snapshot(self, report_type: str) -> None:
        assert self.page is not None
        ledger = self.get_current_ledger()
        rows = self.page.evaluate(
            """async (payload) => window.api.reporting.list(payload)""",
            {"ledgerId": ledger["id"], "reportTypes": [report_type]}
        )
        if rows:
            self.page.evaluate(
                """async (payload) => window.api.reporting.delete(payload)""",
                {"snapshotId": rows[0]["id"], "ledgerId": ledger["id"]}
            )
            self.page.wait_for_timeout(300)

    def audit_and_bookkeep_all_visible(self) -> None:
        assert self.page is not None
        self.page.get_by_label("全选当前列表凭证").check()
        self.click_button("审核")
        self.page.wait_for_timeout(900)
        self.page.get_by_role("button", name="已审核").click()
        self.page.wait_for_timeout(400)
        self.page.get_by_label("全选当前列表凭证").check()
        self.click_button("记账")
        self.page.wait_for_timeout(1000)

    def run_report_export_audit(self) -> None:
        assert self.page is not None
        self.log("执行报表导出链路")
        self.select_ledger(ENTERPRISE_LEDGER_NAME)
        self.generate_report_via_api("balance_sheet")
        self.generate_report_via_api("cashflow_statement")

        self.open_module("报表输出", "报表查询")
        self.activate_tab("报表查询")
        self.page.wait_for_timeout(800)
        self.screenshot("06-report-query")

        ledger = self.get_current_ledger()
        snapshots = self.page.evaluate(
            """async (payload) => window.api.reporting.list(payload)""",
            {"ledgerId": ledger["id"]}
        )
        if len(snapshots) < 2:
            raise RuntimeError("报表快照不足，无法执行导出审计")

        single_target = snapshots[0]
        single_xlsx = self.exports_dir / "enterprise-single.xlsx"
        single_pdf = self.exports_dir / "enterprise-single.pdf"
        batch_dir = self.exports_dir / "enterprise-batch"
        batch_dir.mkdir(parents=True, exist_ok=True)

        single_export = self.page.evaluate(
            """async (payload) => window.api.reporting.export(payload)""",
            {
                "snapshotId": single_target["id"],
                "ledgerId": ledger["id"],
                "format": "xlsx",
                "filePath": str(single_xlsx)
            }
        )
        single_export_pdf = self.page.evaluate(
            """async (payload) => window.api.reporting.export(payload)""",
            {
                "snapshotId": single_target["id"],
                "ledgerId": ledger["id"],
                "format": "pdf",
                "filePath": str(single_pdf)
            }
        )
        batch_export = self.page.evaluate(
            """async (payload) => window.api.reporting.exportBatch(payload)""",
            {
                "snapshotIds": [snapshots[0]["id"], snapshots[1]["id"]],
                "ledgerId": ledger["id"],
                "format": "xlsx",
                "directoryPath": str(batch_dir)
            }
        )

        self.summary["reportExports"] = {
            "singleXlsx": single_export,
            "singlePdf": single_export_pdf,
            "batchXlsx": batch_export,
            "singleXlsxExists": single_xlsx.exists(),
            "singlePdfExists": single_pdf.exists(),
            "batchFiles": sorted(item.name for item in batch_dir.glob("*"))
        }

    def generate_report_via_api(self, report_type: str) -> None:
        assert self.page is not None
        ledger = self.get_current_ledger()
        payload: dict[str, Any] = {
            "ledgerId": ledger["id"],
            "reportType": report_type,
            "includeUnpostedVouchers": False
        }
        if report_type == "balance_sheet":
            payload["month"] = ledger["current_period"]
        else:
            payload["startPeriod"] = ledger["current_period"]
            payload["endPeriod"] = ledger["current_period"]
        self.page.evaluate(
            """async (payload) => {
                try {
                    return await window.api.reporting.generate(payload)
                } catch (error) {
                    return { success: false, error: String(error) }
                }
            }""",
            payload
        )
        self.page.wait_for_timeout(500)

    def run_npo_smoke(self) -> None:
        assert self.page is not None
        self.log("执行民非账套 smoke")
        self.select_ledger(NPO_LEDGER_NAME)
        ledger = self.get_current_ledger()
        self.create_vouchers_via_api(
            ledger["id"],
            [("民非捐赠收入", "1002", "410101", "2000.00")]
        )
        pending_rows = self.page.evaluate(
            """async (payload) => window.api.voucher.list(payload)""",
            {"ledgerId": ledger["id"], "period": ledger["current_period"], "status": "all"}
        )
        pending_ids = [row["id"] for row in pending_rows]
        self.page.evaluate(
            """async (voucherIds) => {
                const audited = await window.api.voucher.batchAction({ action: 'audit', voucherIds })
                const booked = await window.api.voucher.batchAction({ action: 'bookkeep', voucherIds })
                return { audited, booked }
            }""",
            pending_ids
        )

        self.open_module("账簿查询", "科目余额表")
        self.activate_tab("科目余额表")
        self.click_button("查询")
        self.page.wait_for_timeout(600)
        npo_balance_rows = self.page.locator(".glass-panel.flex-1 .grid.cursor-context-menu").count()

        self.generate_report_via_api("activity_statement")
        self.generate_report_via_api("cashflow_statement")

        snapshots = self.page.evaluate(
            """async (payload) => window.api.reporting.list(payload)""",
            {"ledgerId": ledger["id"]}
        )
        self.summary["npoSmoke"] = {
            "ledgerId": ledger["id"],
            "balanceRowCount": npo_balance_rows,
            "snapshotCount": len(snapshots),
            "reportNames": [row["report_name"] for row in snapshots]
        }
        self.screenshot("07-npo-smoke")

    def copy_runtime_logs(self) -> None:
        source_dir = Path(os.environ["APPDATA"]) / "dude-app-dev" / "logs"
        if not source_dir.exists():
            self.log("未发现运行日志目录，跳过复制")
            return
        for item in source_dir.glob("*"):
            if item.is_file():
                shutil.copy2(item, self.runtime_logs_dir / item.name)
        self.log(f"已复制运行日志到 {self.runtime_logs_dir}")

    def add_finding(self, finding: Finding) -> None:
        if any(item.code == finding.code for item in self.findings):
            return
        self.findings.append(finding)

    def write_outputs(self) -> None:
        self.summary["finishedAt"] = datetime.now().isoformat(timespec="seconds")
        (self.output_dir / "summary.json").write_text(
            json.dumps(
                {"summary": self.summary, "findings": [asdict(item) for item in self.findings]},
                ensure_ascii=False,
                indent=2
            ),
            encoding="utf-8"
        )
        report_path = self.output_dir / "audit-report.md"
        report_path.write_text(self.build_markdown_report(), encoding="utf-8")
        self.log(f"已写出审计报告：{report_path}")

    def build_markdown_report(self) -> str:
        lines: list[str] = []
        lines.append("# Electron 真实用户链路断链审计报告")
        lines.append("")
        lines.append(f"- 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        lines.append(f"- 输出目录：`{self.output_dir}`")
        lines.append("")
        lines.append("## 断链问题总览")
        lines.append("")
        lines.append("| 编号 | 模块 | 严重程度 | 是否阻断流程 |")
        lines.append("| -- | -- | -- | -- |")
        if self.findings:
            for finding in self.findings:
                lines.append(
                    f"| {finding.code} | {finding.module} | {finding.severity} | {'是' if finding.blocked else '否'} |"
                )
        else:
            lines.append("| 无 | 无 | 无 | 否 |")
        lines.append("")
        lines.append("## 高优先级问题（Top 5）")
        lines.append("")
        for finding in self.findings[:5]:
            lines.append(f"### {finding.code} {finding.module}")
            lines.append(f"- 场景路径：{finding.scene_path}")
            lines.append(f"- 问题表现：{finding.symptom}")
            lines.append(f"- 根因分析：{finding.root_cause}")
            lines.append(f"- 推荐方案：{finding.recommendation}")
            lines.append("")
        lines.append("## 详细问题卡")
        lines.append("")
        for finding in self.findings:
            lines.append(f"### 🧨 问题编号：{finding.code}")
            lines.append("")
            lines.append("#### 📍 场景路径")
            lines.append(finding.scene_path)
            lines.append("")
            lines.append("#### ❌ 问题表现")
            lines.append(finding.symptom)
            lines.append("")
            lines.append("#### 🔍 根因分析")
            lines.append(finding.root_cause)
            lines.append("")
            lines.append("#### 🛠️ 修复建议（必须完整）")
            lines.append(f"- UI 层：{finding.ui_fix}")
            lines.append(f"- service 层：{finding.service_fix}")
            lines.append(f"- core 层：{finding.core_fix}")
            lines.append(f"- 参数/配置：{finding.config_fix}")
            lines.append("")
            lines.append("#### ✅ 最优方案（推荐）")
            lines.append(finding.recommendation)
            lines.append("")
            lines.append("#### ⚠️ 影响范围")
            lines.append(finding.impact)
            lines.append("")
            lines.append("### 测试用例")
            lines.append("")
            lines.append(finding.test_case)
            lines.append("")
        lines.append("## 架构问题总结")
        lines.append("")
        if any(item.code == "PRINT-001" for item in self.findings):
            lines.append("- 系统性缺陷：打印提示系统没有和配置系统打通；预览层能发现溢出，但页面层不给用户任何修正入口。")
        if any(item.code == "REPORT-001" for item in self.findings):
            lines.append("- 系统性缺陷：保存态、记账态和报表口径之间缺少显式对齐提示，容易形成“已保存但没反映”的黑洞体验。")
        if any(item.code == "BOOK-001" for item in self.findings):
            lines.append("- 系统性缺陷：同一业务链路被拆成多个互不连通的 UI 分支，全屏查看和打印预览之间没有桥接。")
        lines.append("")
        lines.append("## 关键执行摘要")
        lines.append("")
        lines.append(f"- 正常打印：`{json.dumps(self.summary.get('normalPrint', {}), ensure_ascii=False)}`")
        lines.append(f"- 长文本打印：`{json.dumps(self.summary.get('longPrint', {}), ensure_ascii=False)}`")
        lines.append(f"- 边界打印：`{json.dumps(self.summary.get('boundaryPrint', {}), ensure_ascii=False)}`")
        lines.append(f"- 报表反映：`{json.dumps(self.summary.get('reportReflection', {}), ensure_ascii=False)}`")
        lines.append(f"- 报表导出：`{json.dumps(self.summary.get('reportExports', {}), ensure_ascii=False)}`")
        lines.append(f"- 民非 smoke：`{json.dumps(self.summary.get('npoSmoke', {}), ensure_ascii=False)}`")
        lines.append("")
        return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Electron 真实用户链路断链审计脚本")
    parser.add_argument(
        "--repo-root",
        default=str(Path(__file__).resolve().parents[1]),
        help="项目根目录"
    )
    parser.add_argument(
        "--output-dir",
        default="",
        help="输出目录，默认写入 out/electron-breakpoint-audit/<timestamp>"
    )
    parser.add_argument("--cdp-port", type=int, default=DEFAULT_CDP_PORT, help="Electron 远程调试端口")
    parser.add_argument(
        "--no-start-app",
        action="store_true",
        help="不自动启动 Electron，只连接已有端口"
    )
    return parser.parse_args()


def resolve_output_dir(repo_root: Path, raw_output_dir: str) -> Path:
    if raw_output_dir:
        return Path(raw_output_dir)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return repo_root / "out" / ARTIFACT_DIR_NAME / timestamp


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    output_dir = resolve_output_dir(repo_root, args.output_dir)
    runner = AuditRunner(
        repo_root=repo_root,
        output_dir=output_dir,
        cdp_port=args.cdp_port,
        start_app=not args.no_start_app
    )
    try:
        runner.run()
    except Exception as error:  # noqa: BLE001
        runner.log(f"执行失败：{error}")
        runner.summary["errors"].append(str(error))
        runner.write_outputs()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
