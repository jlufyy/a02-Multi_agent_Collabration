import { describe, it, expect } from 'vitest';
import type { NormalizedLocationEvent, GeoPoint, NotificationRecord, NotificationPolicy } from '@tripflow/contracts';
import {
  INTERIM_GEO_POLICY as P, stepGeo, initialEngineState, offsetPoint, wgs84ToGcj02, gcj02ToWgs84, distanceMeters,
  checkShow, sortQueue, type QueuedCard, type EngineState,
} from '@tripflow/context-engine';

const target: GeoPoint = { lat: 39.8822, lng: 116.4066, coordinateSystem: 'GCJ02' };
let n = 0;
const at = (sec: number) => new Date(Date.UTC(2026, 9, 20, 1, 0, 0) + sec * 1000).toISOString();
const sample = (p: GeoPoint, sec: number, extra: Partial<NormalizedLocationEvent> = {}): NormalizedLocationEvent => ({
  sampleId: 's' + n++, tripId: 't', source: 'SIMULATED', demoRunId: 'd', location: p, accuracyMeters: 20, timestamp: at(sec), pageVisible: true, ...extra,
});
function run(points: [GeoPoint, number, Partial<NormalizedLocationEvent>?][], init?: EngineState) {
  let s = init ?? initialEngineState('t', 'act', 'SIMULATED', 'd');
  const events: string[] = []; const notes: string[] = [];
  let k = 0;
  for (const [p, t, x] of points) {
    const r = stepGeo(s, sample(p, t, x), { activityId: 'act', location: target }, P, () => 'arr' + k++);
    s = r.state; events.push(...r.events.map((e) => e.type)); if (r.note) notes.push(r.note);
  }
  return { s, events, notes };
}

describe('GeoStateMachine（AC-08 / E06 / E07）', () => {
  it('逐步进入 + 驻留 → ARRIVED；持续离开 → INFERRED_COMPLETE', () => {
    const inside = offsetPoint(target, 50, 90);
    const outside = offsetPoint(target, 700, 0);
    const { s, events } = run([
      [offsetPoint(target, 900, 90), 0], [offsetPoint(target, 500, 90), 20], [inside, 40], [inside, 70], [inside, 100], [inside, 135],
      [outside, 300], [outside, 360], [outside, 430],
    ]);
    expect(events).toEqual(['APPROACH', 'ARRIVE', 'LEAVE']);
    expect(s.progress).toBe('INFERRED_COMPLETE');
  });
  it('坐车短暂经过不触发到达', () => {
    const { events } = run([[offsetPoint(target, 100, 0), 0], [offsetPoint(target, 20, 0), 10], [offsetPoint(target, 600, 180), 30]]);
    expect(events).not.toContain('ARRIVE');
  });
  it('600m 精度与数公里跳点被丢弃', () => {
    const inside = offsetPoint(target, 40, 0);
    const r = run([[inside, 0], [inside, 30, { accuracyMeters: 600 }], [offsetPoint(target, 5000, 0), 40], [inside, 60]]);
    expect(r.notes).toEqual(['LOW_ACCURACY', 'JUMP_DISCARDED']);
    expect(r.events).not.toContain('ARRIVE');
  });
  it('页面隐藏 → LOCATION_UNKNOWN，不补造轨迹；恢复后核验仍在景点 → VISITING', () => {
    const inside = offsetPoint(target, 40, 0);
    const a = run([[inside, 0], [inside, 40], [inside, 80], [inside, 120], [inside, 150]]);
    expect(a.s.progress).toBe('VISITING');
    const b = run([[inside, 160, { pageVisible: false }], [inside, 600]], a.s);
    expect(b.notes).toContain('PAGE_HIDDEN');
    expect(b.events).toContain('RESUME');
    expect(b.s.progress).toBe('VISITING');
  });
});

describe('坐标转换（E14）', () => {
  it('WGS84↔GCJ02 往返误差 < 2m，未转换偏差显著', () => {
    const w: GeoPoint = { lat: 39.8822, lng: 116.4066, coordinateSystem: 'WGS84' };
    const g = wgs84ToGcj02(w);
    expect(distanceMeters({ ...w, coordinateSystem: 'GCJ02' }, g)).toBeGreaterThan(100);
    expect(distanceMeters(w, gcj02ToWgs84(g))).toBeLessThan(2);
    expect(distanceMeters(g, w)).toBeLessThan(2); // distanceMeters 会先统一坐标系
  });
});

const policy: NotificationPolicy = { enableL1: true, enableL2: true, enableL3: true, paused: false, cooldownMinutes: 15 };
const card = (level: 'L1' | 'L2' | 'L3', extra: Partial<QueuedCard> = {}): QueuedCard => ({
  decision: { decisionId: 'd', eventId: 'e', tripId: 't', baseRevision: 1, shouldNotify: true, reasonCode: 'x',
    card: { cardId: 'c' + level, level, module: 'KNOWLEDGE', activityId: 'act', intentId: level === 'L2' ? 'i1' : undefined, title: '', actions: [], contentIds: [], evidence: { source: 'SIMULATED', eventId: 'e', facts: [] } } },
  eventSource: 'SIMULATED', demoRunId: 'd', arrivalId: 'arr1', riskCode: level === 'L3' ? 'TIME_CONFLICT' : undefined, enqueuedAt: at(0), ...extra,
});
const ctx = { now: new Date(at(100)), uiBusy: false, currentRevision: 1, activityExists: () => true };
const rec = (level: 'L1' | 'L2' | 'L3', r: Partial<NotificationRecord> = {}): NotificationRecord => ({
  notificationId: 'n', eventId: 'e', tripRevision: 1, source: 'SIMULATED', demoRunId: 'd', arrivalId: 'arr1', activityId: 'act',
  intentId: level === 'L2' ? 'i1' : undefined, level, decision: 'SHOWN', shownAt: at(50), ...r,
});

describe('提醒防打扰（AC-25 / E09 / E10）', () => {
  it('L3 > L2 > L1 排序', () => {
    expect(sortQueue([card('L1'), card('L3'), card('L2')]).map((q) => q.decision.card.level)).toEqual(['L3', 'L2', 'L1']);
  });
  it('同一到达已展示或已忽略不再重复', () => {
    expect(checkShow(card('L2'), [rec('L2')], policy, ctx)).toMatchObject({ ok: false, reason: 'DUPLICATE' });
    expect(checkShow(card('L2'), [rec('L2', { actionTaken: 'IGNORE' })], policy, ctx)).toMatchObject({ ok: false });
  });
  it('暂停普通提醒只停 L1/L2，L3 仍按独立开关', () => {
    const p = { ...policy, paused: true };
    expect(checkShow(card('L1'), [], p, ctx).ok).toBe(false);
    expect(checkShow(card('L2'), [], p, ctx).ok).toBe(false);
    expect(checkShow(card('L3'), [], p, ctx).ok).toBe(true);
    expect(checkShow(card('L3'), [], { ...p, enableL3: false }, ctx).ok).toBe(false);
  });
  it('拖拽/确认中暂缓普通卡片，但 L3 可显示', () => {
    expect(checkShow(card('L1'), [], policy, { ...ctx, uiBusy: true })).toMatchObject({ ok: false, defer: true });
    expect(checkShow(card('L3'), [], policy, { ...ctx, uiBusy: true }).ok).toBe(true);
  });
  it('L1 冷却期内被抑制；新到达的不同 L1 也受冷却', () => {
    expect(checkShow(card('L1', { arrivalId: 'arr2' }), [rec('L1', { arrivalId: 'arrX' })], policy, ctx)).toMatchObject({ ok: false, reason: 'COOLDOWN' });
  });
});
