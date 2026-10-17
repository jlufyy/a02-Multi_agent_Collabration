import { describe, expect, it } from 'vitest';
import { bindRequirementPlace, requirementProblems, unresolvedPlaces } from '../lib/requirements';
import { trip } from './fixtures';

describe('location confirmation gate', () => {
  it('covers boundaries, must/avoid locations, fixed meetings and active intents', () => {
    const base = trip();
    const r = { ...base.requirements, startPoint: { query: '起点' }, endPoint: { query: '终点' },
      mustVisit: [{ query: '必去' }], avoidPlaces: [{ query: '避开' }],
      fixedConstraints: [{ id: 'fixed', startAt: '2026-10-20T15:00:00+08:00', reason: '集合', locked: true, place: { query: '集合点' } }],
      intents: [{ id: 'task', type: 'PHOTO' as const, userRequest: '拍照', placeQuery: '任务点', confirmed: false,
        desiredOutputs: [], preparedContentIds: [], status: 'PENDING' as const, locked: false }] };
    const paths = ['mustVisit.0', 'avoidPlaces.0', 'startPoint', 'endPoint', 'fixedConstraints.0.place', 'intents.0'];
    expect(unresolvedPlaces(r).map((p) => p.path)).toEqual(paths);
    expect(paths.every((p) => requirementProblems(r)[p])).toBe(true);
    let ready = r as typeof base.requirements;
    for (const path of paths) ready = bindRequirementPlace(ready, path, base.activities[0].place);
    expect(unresolvedPlaces(ready)).toEqual([]);
    expect(ready.startPoint?.query).toBe('起点');
    expect(ready.endPoint?.query).toBe('终点');
    expect(ready.fixedConstraints[0].locked).toBe(true);
    expect(ready.intents[0].placeId).toBe(base.activities[0].place.poiId);
    expect(unresolvedPlaces(r)).toHaveLength(6); // Original draft is immutable.
  });

  it('ignores cancelled tasks and already chosen POIs', () => {
    const base = trip();
    const r = { ...base.requirements, startPoint: { query: '已有地点', place: base.activities[0].place }, intents: [] };
    expect(unresolvedPlaces(r)).toEqual([]);
    expect(requirementProblems(r).startPoint).toBeUndefined();
  });
});
