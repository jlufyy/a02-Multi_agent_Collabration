"""Inspect an explicitly ADB-forwarded debug WebView; no mock data or desktop proxy.

adb forward tcp:9224 localabstract:webview_devtools_remote_<app-pid>
python android/scripts/device_inspect.py text
python android/scripts/device_inspect.py screenshot output/android/phone.png
Pipe a JavaScript expression to the `eval` command for interactive device QA.
"""
import argparse
import json
from pathlib import Path
import sys
import urllib.request

from websockets.sync.client import connect


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['text', 'eval', 'screenshot'])
    parser.add_argument('path', nargs='?')
    parser.add_argument('--port', type=int, default=9224)
    args = parser.parse_args()
    targets = json.load(urllib.request.urlopen(f'http://127.0.0.1:{args.port}/json', timeout=5))
    target = next(t for t in targets if t['url'].startswith('http://127.0.0.1:18761'))
    with connect(target['webSocketDebuggerUrl'], open_timeout=5) as ws:
        if args.action == 'screenshot':
            method, params = 'Page.captureScreenshot', {'format': 'png'}
        else:
            expression = sys.stdin.read() if args.action == 'eval' else 'document.body.innerText'
            method, params = 'Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'awaitPromise': True}
        ws.send(json.dumps({'id': 1, 'method': method, 'params': params}))
        while True:
            result = json.loads(ws.recv(timeout=45))
            if result.get('id') == 1:
                break
        if result.get('error'):
            raise RuntimeError(result['error'])
        result = result['result']
        if args.action == 'screenshot':
            import base64
            path = Path(args.path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(base64.b64decode(result['data']))
            print(path.resolve())
        elif result.get('exceptionDetails'):
            print(json.dumps(result['exceptionDetails'], ensure_ascii=False))
            raise SystemExit(1)
        else:
            print(json.dumps(result.get('result', {}).get('value'), ensure_ascii=False))


if __name__ == '__main__':
    main()
