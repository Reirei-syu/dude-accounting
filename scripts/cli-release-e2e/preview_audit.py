from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='CLI print preview audit helper')
    parser.add_argument('--port', type=int, required=True, help='CDP port')
    parser.add_argument('--timeout-seconds', type=int, default=30)
    parser.add_argument('--min-pages', type=int, default=1)
    parser.add_argument('--close-after', action='store_true')
    return parser.parse_args()


def fetch_targets(port: int) -> list[dict]:
    try:
        with urllib.request.urlopen(  # noqa: S310
            f'http://127.0.0.1:{port}/json/list',
            timeout=2
        ) as response:
            return json.loads(response.read().decode('utf-8'))
    except (urllib.error.URLError, TimeoutError):
        return []


def wait_for_targets(port: int, timeout_seconds: int, min_pages: int) -> list[dict]:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        targets = fetch_targets(port)
        page_targets = [target for target in targets if target.get('type') == 'page']
        if len(page_targets) >= min_pages:
            return page_targets
        time.sleep(0.5)
    raise RuntimeError(f'preview targets not ready on port {port}')


def close_pages(port: int) -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
        try:
            for context in browser.contexts:
                for page in list(context.pages):
                    page.close()
        finally:
            browser.close()


def main() -> int:
    args = parse_args()
    targets = wait_for_targets(args.port, args.timeout_seconds, args.min_pages)
    if args.close_after:
        close_pages(args.port)
    print(
        json.dumps(
            {
                'port': args.port,
                'pageCount': len(targets),
                'pages': [
                    {
                        'id': target.get('id'),
                        'title': target.get('title'),
                        'url': target.get('url')
                    }
                    for target in targets
                ]
            },
            ensure_ascii=False
        )
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
