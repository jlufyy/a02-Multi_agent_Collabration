"""Generate transport schemas and TypeScript from canonical Pydantic models.

Run from any directory: python packages/contracts/generate.py
Use --app-openapi once the complete API is installed to export its real OpenAPI.
"""
from __future__ import annotations

import argparse
import importlib
import json
import sys
from pathlib import Path
from typing import Union, TypeVar, get_args

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'apps' / 'api'))
from app import schemas as s
from pydantic import TypeAdapter

OUT = Path(__file__).resolve().parent / 'generated'


def ts(node):
    if 'x-typescript-type' in node:
        return node['x-typescript-type']
    if '$ref' in node:
        return node['$ref'].rsplit('/', 1)[-1]
    if 'const' in node:
        return json.dumps(node['const'], ensure_ascii=False)
    if 'enum' in node:
        return ' | '.join(json.dumps(v, ensure_ascii=False) for v in node['enum'])
    for name in ('oneOf', 'anyOf'):
        if name in node:
            return '(' + ' | '.join(ts(x) for x in node[name]) + ')'
    if 'allOf' in node:
        return '(' + ' & '.join(ts(x) for x in node['allOf']) + ')'
    kind = node.get('type')
    if kind == 'array':
        return f'Array<{ts(node.get("items", {}))}>'
    if kind == 'object' or 'properties' in node:
        required = node.get('required', [])
        fields = [f'{json.dumps(k)}{"" if k in required else "?"}: {ts(v)};' for k, v in node.get('properties', {}).items()]
        additional = node.get('additionalProperties')
        if isinstance(additional, dict):
            fields.append(f'[key: string]: {ts(additional)};')
        return '{ ' + ' '.join(fields) + ' }'
    return {'string': 'string', 'number': 'number', 'integer': 'number', 'boolean': 'boolean', 'null': 'null'}.get(kind, 'unknown')


def catalog():
    types = dict(s.CONTRACT_TYPES)
    for name in ('JobStatus', 'DataStatus', 'ValidationStatus', 'EventSource', 'TripMode', 'ExecutionMode', 'Lifecycle', 'TravelMode', 'ActivityProgress', 'IntentType', 'ServiceModule', 'AgentId', 'NotificationAction'):
        types[name] = getattr(s, name)
    results = Union[s.ParseRequirementsResult, s.PlanResult, s.RevisionResult, s.ValidateRevisionResult,
                    s.EvaluateProactiveResult, s.PrepareContentResult, s.RefineContentResult, s.NearbySearchResult]
    types['JobResult'] = results
    types['TypedJobSnapshot'] = s.JobSnapshot[results]
    types['JobAcceptedResponse'] = s.ApiResponse[s.JobAccepted]
    types['JobSnapshotResponse'] = s.ApiResponse[s.JobSnapshot[results]]
    definitions = {}
    for name, value in types.items():
        schema = TypeAdapter(value).json_schema(by_alias=True, ref_template='#/$defs/{model}')
        definitions.update(schema.pop('$defs', {}))
        if schema != {'$ref': f'#/$defs/{name}'}:
            definitions[name] = schema
    return {'$schema': 'https://json-schema.org/draft/2020-12/schema', '$id': 'https://tripflow.local/contracts/TripFlow-Split-v1',
            'title': 'TripFlow-Split-v1', '$defs': definitions}


def contract_openapi():
    from fastapi import FastAPI
    app = FastAPI(title='TripFlow contract API', version='TripFlow-Split-v1')
    mapping = [
        ('get', '/health', None, s.HealthResult, False),
        ('post', '/requirements/parse', s.ParseRequirementsRequest, s.ParseRequirementsResult, True),
        ('post', '/plans/generate', s.GeneratePlanRequest, s.PlanResult, True),
        ('post', '/revisions/propose', s.ProposeRevisionRequest, s.RevisionResult, True),
        ('post', '/revisions/validate', s.ValidateRevisionRequest, s.ValidateRevisionResult, True),
        ('post', '/places/search', s.SearchPlacesRequest, s.SearchPlacesResult, False),
        ('post', '/routes/segments', s.RouteSegmentsRequest, s.RouteSegmentsResult, False),
        ('post', '/proactive/evaluate', s.EvaluateProactiveRequest, s.EvaluateProactiveResult, True),
        ('post', '/content/prepare', s.PrepareContentRequest, s.PrepareContentResult, True),
        ('post', '/content/refine', s.RefineContentRequest, s.RefineContentResult, True),
        ('post', '/nearby/search', s.NearbySearchRequest, s.NearbySearchResult, True),
        ('get', '/capabilities', None, s.CapabilitySet, False),
    ]
    for method, path, request, response, job in mapping:
        def handler():
            raise RuntimeError('Schema-only endpoint; not an implementation')
        if request is not None:
            def handler(body):
                raise RuntimeError('Schema-only endpoint; not an implementation')
            handler.__annotations__ = {'body': request}
        app.add_api_route('/api/v1'+path, handler, methods=[method.upper()], response_model=s.ApiResponse[s.JobAccepted if job else response], status_code=202 if job else 200,
                         name=path.strip('/').replace('/', '_'))

    results = Union[s.ParseRequirementsResult, s.PlanResult, s.RevisionResult, s.ValidateRevisionResult,
                    s.EvaluateProactiveResult, s.PrepareContentResult, s.RefineContentResult, s.NearbySearchResult]
    @app.get('/api/v1/jobs/{jobId}', response_model=s.ApiResponse[s.JobSnapshot[results]])
    def get_job(jobId: str, afterSequence: int = 0):
        raise RuntimeError('Schema only')
    @app.delete('/api/v1/jobs/{jobId}', response_model=s.ApiResponse[s.CancelJobResult])
    def cancel_job(jobId: str):
        raise RuntimeError('Schema only')
    return app.openapi()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--app-openapi', action='store_true', help='Export OpenAPI from implemented app.main:app')
    parser.add_argument('--check', action='store_true', help='Fail if generated artifacts are stale')
    args = parser.parse_args()
    schema = catalog()
    source = ('// Generated from apps/api/app/schemas.py. DO NOT EDIT.\n'
              '// Regenerate: python packages/contracts/generate.py\n'
              'export declare const contractVersion: "TripFlow-Split-v1";\n\n')
    def contains_parameter(annotation):
        return isinstance(annotation, TypeVar) or any(contains_parameter(a) for a in get_args(annotation))
    def replace_empty(value, parameter):
        if isinstance(value, dict):
            if not value:
                return {'x-typescript-type': parameter}
            return {k:replace_empty(v,parameter) for k,v in value.items()}
        if isinstance(value, list):
            return [replace_empty(v,parameter) for v in value]
        return value
    def declaration(name, value):
        model=s.CONTRACT_TYPES.get(name)
        parameters=getattr(model,'__pydantic_generic_metadata__',{}).get('parameters',())
        if parameters:
            value=json.loads(json.dumps(value))
            for key,field in model.model_fields.items():
                if contains_parameter(field.annotation):
                    value['properties'][field.alias or key]=replace_empty(value['properties'][field.alias or key],parameters[0].__name__)
        suffix='<'+', '.join(f'{p.__name__} = unknown' for p in parameters)+'>' if parameters else ''
        return f'export type {name}{suffix} = {ts(value)};'
    source += '\n\n'.join(declaration(name,value) for name,value in sorted(schema['$defs'].items())) + '\n'
    openapi = importlib.import_module('app.main').app.openapi() if args.app_openapi else contract_openapi()
    files = {'schema.json': json.dumps(schema, ensure_ascii=False, indent=2)+'\n',
             'index.d.ts': source, 'index.mjs': '/* Generated; do not edit. */\nexport const contractVersion = "TripFlow-Split-v1";\n',
             'openapi.json': json.dumps(openapi, ensure_ascii=False, indent=2)+'\n'}
    if args.check:
        stale = [name for name, content in files.items() if not (OUT/name).exists() or (OUT/name).read_text(encoding='utf-8') != content]
        if stale:
            raise SystemExit('Generated contracts stale: '+', '.join(stale))
    else:
        OUT.mkdir(parents=True, exist_ok=True)
        for name, content in files.items():
            (OUT/name).write_text(content, encoding='utf-8')
    print(f'{len(schema["$defs"])} definitions; generated artifacts {"verified" if args.check else "written"}')


if __name__ == '__main__':
    main()
