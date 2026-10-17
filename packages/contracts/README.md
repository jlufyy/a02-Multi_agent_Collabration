# TripFlow shared contracts

Canonical source: `apps/api/app/schemas.py` (Pydantic v2). Business JSON is camelCase, envelopes preserve request_id / trace_id. Unknown optional values are omitted on the wire using `model_dump(by_alias=True, exclude_none=True)`; numeric zero is a real value, never a substitute for unknown.

Generate with `python packages/contracts/generate.py`; verify freshness with `python packages/contracts/generate.py --check`. No hand-maintained TypeScript business models: `generated/index.d.ts` and `generated/schema.json` derive from the same Python registry, including discriminated edit/constraint unions. OpenAPI defaults to a deterministic schema-only API document (14 endpoints; handlers are never served); `--app-openapi` exports the actual installed API and must be used consistently with `--check`.

JSON Schema captures structure and local type constraints. Pydantic additionally enforces cross-field dates, versions, plan projections, selected context, candidate consistency and execution isolation; browser clients must keep the same CAS / snapshot guards described in Appendix A. A schema pass alone does not authorize a commit.

M0 GeoPolicy is stored once in `packages/context-engine/geo-policy.json`; backend capabilities and browser state-machine callers consume that file. Frozen values are initial experiment settings, not measured optimal thresholds.

Fixtures under `fixtures` explicitly identify synthetic sources. They prove contracts and deterministic behavior only, never a real provider call, actual POI verification, hardware positioning or production acceptance.
