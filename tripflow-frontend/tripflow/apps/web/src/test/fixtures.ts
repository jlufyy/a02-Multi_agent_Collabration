/**
 * 单元测试用的【合成】数据：仅用于验证前端状态逻辑，不是真实 API 结果，不得作为数据来源展示。
 */
import type { TripState, ItineraryActivity, RevisionProposal } from '@tripflow/contracts';

const ev = { provider: 'synthetic-test', status: 'UNKNOWN' as const, note: '单元测试合成数据' };
export function act(id: string, order: number, lat: number, lng: number): ItineraryActivity {
  return {
    id, dayIndex: 0, orderIndex: order,
    startAt: `2026-10-20T0${9 + order}:00:00+08:00`, endAt: `2026-10-20T0${9 + order}:50:00+08:00`,
    place: { poiId: 'poi_' + id, name: 'P' + id, location: { lat, lng, coordinateSystem: 'GCJ02' }, evidence: [ev] },
    costStatus: 'UNKNOWN', locked: false, mandatory: false, progress: 'NOT_STARTED', intentIds: [],
  };
}
export function trip(rev = 1): TripState {
  return {
    schemaVersion: 1, tripId: 'trip_t', revision: rev, title: 't', destinationCity: '测试城', startDate: '2026-10-20', endDate: '2026-10-21',
    travelerCount: 2, companions: [], preferences: [], mode: 'PLANNING', lifecycle: 'PLAN_READY',
    requirements: { requirementsId: 'r', version: 1, confirmed: true, timezone: 'Asia/Shanghai', budgetIsHardLimit: false, transportModes: ['WALK'],
      mustVisit: [], avoidPlaces: [], preferences: [], companions: [], specialNeeds: [], fixedConstraints: [], intents: [] },
    activities: [act('a', 0, 39.88, 116.41), act('b', 1, 39.90, 116.39)], segments: [], boundarySegments: [], intents: [],
    notificationPolicy: { enableL1: true, enableL2: true, enableL3: true, paused: false, cooldownMinutes: 15 }, updatedAt: '2026-10-16T00:00:00Z',
  };
}
export function proposal(base: TripState, over: Partial<RevisionProposal['validation']> = {}): RevisionProposal {
  const candidate: TripState = { ...base, activities: [...base.activities].reverse().map((a, i) => ({ ...a, orderIndex: i })) };
  const validation = { status: 'FEASIBLE' as const, hardViolations: [], unknownChecks: [], warnings: [], committable: true, ...over };
  return { proposalId: 'p1', tripId: base.tripId, baseRevision: base.revision, operations: [{ type: 'MOVE', activityId: 'a', dayIndex: 0, orderIndex: 1 }],
    candidate, hardViolations: validation.hardViolations, unknownChecks: validation.unknownChecks,
    diff: { added: [], removed: [], moved: ['a', 'b'] }, estimatedChanges: {}, validation, activityChanges: [] };
}
