"""依赖升级 smoke：隔离数据、真实 Electron/SQLite、登录页与 preload。

复用项目现有 Python Playwright 环境，不安装浏览器或依赖。
"""
import argparse
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import tempfile
import time

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--executable', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    output = root / '.tmp' / 'dependency-smoke'
    output.mkdir(parents=True, exist_ok=True)
    run_dir = Path(tempfile.mkdtemp(prefix='packaged-' if args.executable else 'source-', dir=output))
    executable = args.executable.resolve() if args.executable else root / 'node_modules/electron/dist/electron.exe'
    env = os.environ.copy()
    env.pop('ELECTRON_RUN_AS_NODE', None)
    env.pop('ELECTRON_RENDERER_URL', None)
    env['DUDEACC_E2E_APPDATA_PATH'] = str(run_dir / 'appdata')
    env['APPDATA'] = env['DUDEACC_E2E_APPDATA_PATH']
    env['XDG_CONFIG_HOME'] = env['DUDEACC_E2E_APPDATA_PATH']
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0

    if not args.executable:
        abi_env = {**env, 'ELECTRON_RUN_AS_NODE': '1'}
        abi = subprocess.run([str(executable), '-e',
            'const D=require("better-sqlite3");const d=new D(":memory:");'
            'console.log(JSON.stringify({electron:process.versions.electron,abi:process.versions.modules,'
            'answer:d.prepare("select 42 as answer").get().answer}));d.close();'],
            cwd=root, env=abi_env, capture_output=True, text=True, timeout=30, creationflags=flags)
        assert abi.returncode == 0, abi.stderr
        result = json.loads(abi.stdout)
        assert result['electron'] == '39.8.10' and result['answer'] == 42, result
        (run_dir / 'abi.json').write_text(json.dumps(result, indent=2), encoding='utf-8')

    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    command = [str(executable)]
    if not args.executable:
        command.append(str(root))
    command.append(f'--remote-debugging-port={port}')
    with (run_dir / 'electron.log').open('w', encoding='utf-8') as log:
        process = subprocess.Popen(command, cwd=root, env=env, stdout=log, stderr=log, creationflags=flags)
        try:
            with sync_playwright() as playwright:
                deadline = time.monotonic() + 40
                browser = None
                while time.monotonic() < deadline:
                    assert process.poll() is None, 'Electron 提前退出，请检查 electron.log'
                    try:
                        browser = playwright.chromium.connect_over_cdp(f'http://127.0.0.1:{port}', timeout=1000)
                        break
                    except Exception:
                        time.sleep(0.2)
                assert browser is not None, 'Electron CDP 启动超时'
                context = browser.contexts[0]
                page = context.pages[0] if context.pages else context.wait_for_event('page', timeout=30000)
                page.get_by_role('button', name='登录', exact=True).wait_for(state='visible', timeout=30000)
                state = page.evaluate('({url:location.href, title:document.title, auth:typeof window.api?.auth?.login})')
                assert state['url'].startswith('file:') and state['auth'] == 'function', state
                page.screenshot(path=str(run_dir / 'login.png'))
                page.close()
                process.wait(timeout=15)
                assert process.returncode == 0, process.returncode
            databases = list((run_dir / 'appdata').rglob('dude-accounting.db'))
            assert len(databases) == 1, databases
            with sqlite3.connect(databases[0].as_uri() + '?mode=ro', uri=True) as db:
                assert db.execute('pragma quick_check').fetchone()[0] == 'ok'
                assert db.execute('select count(*) from users').fetchone()[0] > 0
            result = {**state, 'executable': str(executable), 'database': str(databases[0]), 'exitCode': process.returncode}
            (run_dir / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps({'success': True, 'artifacts': str(run_dir), **result}, ensure_ascii=False))
        finally:
            if process.poll() is None:
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True, timeout=10)
                else:
                    process.terminate()
                process.wait(timeout=10)


if __name__ == '__main__':
    main()
