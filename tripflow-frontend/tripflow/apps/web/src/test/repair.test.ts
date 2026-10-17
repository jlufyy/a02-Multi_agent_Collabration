import { describe, it, expect, beforeEach } from 'vitest';
import { schemas } from '@tripflow/contracts';
import { stepGeo, initialEngineState, INTERIM_GEO_POLICY as P, checkShow, stepLocations } from '@tripflow/context-engine';
import type { QueuedCard } from '@tripflow/context-engine';
import type { NormalizedLocationEvent } from '@tripflow/contracts';
import { planTime, planDate, displayMinutes } from '../lib/time';
import { useTrips } from '../store/tripStore';
import { loadAllTrips } from '../store/storage';
import { act, trip, proposal } from './fixtures';

const point = act('a', 0, 39.9, 116.4).place.location;
const at = (sec: number) => new Date(Date.UTC(2026, 9, 20, 1) + sec * 1000).toISOString();
const sample = (sec: number, id: string, accuracyMeters = 20): NormalizedLocationEvent => ({ sampleId: id, tripId: 't', source: 'SIMULATED', demoRunId: 'd', timestamp: at(sec), pageVisible: true, accuracyMeters, location: point });
const policy = { enableL1: true, enableL2: true, enableL3: true, paused: false, cooldownMinutes: 15 };
const q: QueuedCard = { decision: { decisionId: 'd', eventId: 'e', tripId: 't', baseRevision: 1, shouldNotify: true, reasonCode: 'ARRIVAL', card: { cardId: 'c', level: 'L1', module: 'KNOWLEDGE', activityId: 'a', title: 'test', actions: [], contentIds: [], evidence: { source: 'SIMULATED', eventId: 'e', facts: [] } } }, eventSource: 'SIMULATED', demoRunId: 'd', arrivalId: 'arr', enqueuedAt: at(0) };
const ctx = { now: new Date(at(100)), uiBusy: false, currentRevision: 1, tripId: 't', executionMode: 'DEMO' as const, demoRunId: 'd', activityExists: () => true, arrivalCurrent: () => true };

describe('TF定位和提醒回归（合成样本）', () => {
  it('重复、乱序和同时间不同ID不增加有效驻留数', () => {
    let s = initialEngineState('t', 'a', 'SIMULATED', 'd');
    const events = [];
    for (const p of [sample(0, 'one'), sample(90, 'two'), sample(90, 'two'), sample(60, 'late'), sample(90, 'same-time')]) {
      const r = stepGeo(s, p, { activityId: 'a', location: point }, P, () => 'arr'); s = r.state; events.push(...r.events);
    }
    expect(events.some((e) => e.type === 'ARRIVE')).toBe(false);
    expect(stepGeo(s, sample(120, 'three'), { activityId: 'a', location: point }, P, () => 'arr').events.some((e) => e.type === 'ARRIVE')).toBe(true);
  });
  it('低精度中断到达驻留；不能回放低精度之前的乱序样本', () => {
    let s = initialEngineState('t', 'a', 'SIMULATED', 'd');
    const events = [];
    for (const p of [sample(0, 'one'), sample(30, 'bad', 600), sample(20, 'late'), sample(60, 'two'), sample(90, 'three')]) {
      const r = stepGeo(s, p, { activityId: 'a', location: point }, P, () => 'arr'); s = r.state; events.push(...r.events);
    }
    expect(events.some((e) => e.type === 'ARRIVE')).toBe(false);
  });
  it('实际多活动适配器只为一个重叠围栏累计到达', () => {
    const activities = [act('a', 0, point.lat, point.lng), act('b', 1, point.lat, point.lng)];
    let states = [] as ReturnType<typeof stepLocations>['states'];
    const events = [];
    for (const sec of [0, 45, 90]) { const r = stepLocations(states, sample(sec, String(sec)), activities, P); states = r.states; events.push(...r.events); }
    expect(events.filter((e) => e.type === 'ARRIVE')).toHaveLength(1);
    expect(states.filter((g) => g.progress === 'ARRIVED')).toHaveLength(1);
  });
  it('版本、时效、工作区和已离开状态均在最终显示前拒绝', () => {
    expect(checkShow(q, [], policy, ctx).ok).toBe(true);
    for (const patch of [{ currentRevision: 2 }, { now: new Date(at(3600)) }, { demoRunId: 'new' }, { tripId: 'other' }, { arrivalCurrent: () => false }]) expect(checkShow(q, [], policy, { ...ctx, ...patch }).ok).toBe(false);
  });
});

describe('时间序列化与显示', () => {
  it('转换同一时刻并正确跨日，UTC计划时间在前端即被拒绝', () => {
    expect(planTime('2026-10-20T16:30:00Z')).toBe('2026-10-21T00:30:00+08:00');
    expect(planTime(Date.parse('2026-10-20T23:30:00+08:00') + 3600_000)).toBe('2026-10-21T00:30:00+08:00');
    expect(planDate('2026-10-20', 2)).toBe('2026-10-22');
    expect(schemas.ItineraryActivity.safeParse({ ...act('a', 0, 0, 0), endAt: '2026-10-20T02:00:00Z' }).success).toBe(false);
  });
  it('向上取整只影响显示，不出现长小数或60分', () => {
    expect([0, .5, 4.7667, 59.9, 60, 85.7667].map(displayMinutes)).toEqual(['0分钟', '1分钟', '5分钟', '1小时', '1小时', '1小时26分']);
  });
});

describe('已解析需求的持久化与编辑闭环', () => {
  beforeEach(async () => { await useTrips.getState().clearAll(); });
  it('原始草稿与已解析计划分开保存，刷新、提交、撤销、重做均保留POI', async () => {
    const store = useTrips.getState(); const id = await store.createTrip();
    const p = { ...trip(), tripId: id };
    p.requirements.mustVisit = [{ query: 'Pa', place: p.activities[0].place }];
    const raw = { ...p.requirements, mustVisit: [{ query: 'Pa' }] };
    await store.landPlan(id, p, [], raw);
    let saved = (await loadAllTrips()).trips.find((t) => t.tripId === id)!;
    expect(saved.real.plan!.requirements.mustVisit[0].place!.poiId).toBe(p.activities[0].place.poiId);
    expect(saved.draft.requirements!.mustVisit[0].place).toBeUndefined();
    const prop = proposal(saved.real.plan!);
    await store.setPending(id, { proposal: prop, origin: 'AI', createdAt: at(0), finalValidation: prop.validation });
    await store.commit(id, prop, false); await store.undo(id); await store.redo(id);
    saved = (await loadAllTrips()).trips.find((t) => t.tripId === id)!;
    expect(saved.real.plan!.revision).toBe(4);
    expect(saved.real.plan!.requirements.mustVisit[0].place!.poiId).toBe(p.activities[0].place.poiId);
  });
});

describe('直接应用的授权边界', () => {
  it('仅明确的小幅时长调整可以通过，其它连锁变化仍预览', async () => {
    const { canDirectApply } = await import('../lib/smallChange');
    const base = trip(); const p = proposal(base);
    p.operations = [{ type: 'UPDATE_DURATION', activityId: 'a', durationMin: 60 }];
    p.candidate = structuredClone(base);
    p.candidate.activities[0].endAt = '2026-10-20T10:00:00+08:00';
    expect(canDirectApply(base, p, '把Pa从50分钟改为60分钟，其余不变')).toBe(true);
    expect(canDirectApply(base, p, '把Pa从999分钟改为60分钟')).toBe(false);
    expect(canDirectApply(base, p, '下午轻松一点')).toBe(false);
    p.candidate.activities[1].startAt = '2026-10-20T10:20:00+08:00';
    expect(canDirectApply(base, p, '把Pa改为60分钟')).toBe(false);
    p.candidate = structuredClone(base); p.candidate.activities[0].endAt = '2026-10-20T10:00:00+08:00';
    p.validation.status = 'PARTIALLY_VERIFIED'; p.validation.unknownChecks = ['new unknown'];
    expect(canDirectApply(base, p, '把Pa改为60分钟')).toBe(false);
  });
});

describe('生成材料的版本持久化', () => {
  it('刷新读回材料，拒收旧版本生成结果', async () => {
    const s = useTrips.getState(); const id = await s.createTrip(); const p = { ...trip(), tripId: id };
    await s.landPlan(id, p, [], p.requirements);
    const content = { contentId: 'saved-content', tripId: id, baseRevision: 1, activityId: 'a', placeId: p.activities[0].place.poiId,
      module: 'KNOWLEDGE' as const, title: '合成测试', body: '合成正文', version: 1, generatedAt: at(0), evidence: [], scopeNote: '仅用于测试' };
    await s.putContents(id, [content]);
    expect((await loadAllTrips()).trips.find((t) => t.tripId === id)!.real.contents).toHaveLength(1);
    await s.settings(id, { mode: 'TRAVELING' });
    await expect(s.putContents(id, [{ ...content, contentId: 'stale' }])).rejects.toThrow('旧内容');
    expect(useTrips.getState().trips[id].real.contents).toHaveLength(1);
  });
});
