"""Opt-in live A7 checks using a real plan snapshot; no silent fallback or fixture content."""
import argparse
import json
import sys
import time
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from app.config import Settings
from app.main import create_app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--samples', type=Path, required=True)
    parser.add_argument('--providers', default='deepseek,aiping')
    parser.add_argument('--output', type=Path, default=Path('output/repair/content-routes.json'))
    args = parser.parse_args()
    samples = json.loads(args.samples.read_text())
    plan = next(x['response']['data']['result']['plan'] for x in samples if x.get('schema') == 'PlanResult' and x['response']['data'].get('result', {}).get('plan'))
    a = plan['activities'][0]
    results = []
    settings = Settings.from_env()
    for provider in args.providers.split(','):
        if provider not in settings.provider_configs:
            results.append({'provider': provider, 'status': 'NOT_CONFIGURED'})
            continue
        routes = {**settings.role_routes, 'A7': {'provider': provider, 'model': settings.provider_configs[provider]['model'] if provider != 'aiping' else 'Qwen3.8-27B'}}
        configured_a7 = settings.role_routes.get('A7')
        if isinstance(configured_a7, dict) and configured_a7.get('provider') == provider:
            routes['A7'] = configured_a7
        with TestClient(create_app(replace(settings, role_routes=routes, rate_limit_per_minute=10000))) as client:
            previous = None
            for kind, prompt in [('explain', '请用80字给出游览提示，未知历史不要编造。'), ('speech', '请创作一段约80字的现场口语讲稿，标明创作辅助。'), ('checklist', '请给出5项拍摄准备清单，不假定拍摄许可。'), ('refine', '把上一份清单压缩到3项。')]:
                started = time.monotonic()
                body = {'executionMode': 'REAL', 'tripId': plan['tripId'], 'baseRevision': plan['revision'], 'tripState': plan,
                    'context': {'tripId': plan['tripId'], 'planRevision': plan['revision'], 'mode': plan['mode'], 'activeDay': a['dayIndex'], 'selectedActivityId': a['id']}, 'userRequest': prompt}
                if kind == 'refine' and previous:
                    body['preparedContent'] = previous
                accepted = client.post('/api/v1/content/refine', json=body, headers={'X-Request-Id': uuid4().hex})
                if accepted.status_code != 202:
                    results.append({'provider': provider, 'kind': kind, 'status': 'REJECTED', 'errors': accepted.json().get('errors')})
                    continue
                job_id = accepted.json()['data']['jobId']
                while True:
                    response = client.get('/api/v1/jobs/' + job_id).json()
                    if response['data']['status'] in ('SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'):
                        break
                    time.sleep(.5)
                content = response['data'].get('result', {}).get('content')
                if content:
                    previous = content
                row = {'provider': provider, 'kind': kind, 'status': response['data']['status'], 'seconds': round(time.monotonic()-started, 2), 'traceId': response['trace_id'], 'errors': response['errors'], 'content': content}
                results.append(row)
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps({'evidenceType': 'LIVE_PROVIDERS_SYNTHETIC_TRAVEL_INPUT', 'results': results}, ensure_ascii=False, indent=2))
                print(json.dumps({k: v for k, v in row.items() if k != 'content'}, ensure_ascii=False), flush=True)
                # One measured failure is sufficient to stop this route's remaining paid probes.
                if not content:
                    break


if __name__ == '__main__':
    main()
