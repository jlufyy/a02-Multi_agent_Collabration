import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTrips } from '../store/tripStore';
import * as storage from '../store/storage';
import { loadAllTrips } from '../store/storage';
import { trip, proposal } from './fixtures';

describe('本地权威状态（AC-17 / E13）', () => {
  beforeEach(async () => { await useTrips.getState().clearAll(); });

  it('落地、提交后刷新可恢复；多 tripId 隔离', async () => {
    const s = useTrips.getState();
    const a = await s.createTrip();
    const b = await s.createTrip();
    await s.landPlan(a, { ...trip(), tripId: a }, [], trip().requirements);
    const plan = useTrips.getState().trips[a].real.plan!;
    const p = { ...proposal(plan), tripId: a, candidate: { ...proposal(plan).candidate, tripId: a } };
    await s.setPending(a, { proposal: p, origin: 'DRAG', createdAt: '' });
    await s.commit(a, p, false);
    const { trips } = await loadAllTrips();
    const ta = trips.find((t) => t.tripId === a)!;
    expect(ta.real.plan!.revision).toBe(2);
    expect(ta.real.undo).toHaveLength(1);
    expect(trips.find((t) => t.tripId === b)!.real.plan).toBeUndefined();
  });

  it('存储失败时不显示成功，正式计划保持旧版本', async () => {
    const s = useTrips.getState();
    const a = await s.createTrip();
    await s.landPlan(a, { ...trip(), tripId: a }, [], trip().requirements);
    const plan = useTrips.getState().trips[a].real.plan!;
    const p = { ...proposal(plan), tripId: a, candidate: { ...proposal(plan).candidate, tripId: a } };
    await s.setPending(a, { proposal: p, origin: 'DRAG', createdAt: '' });
    const spy = vi.spyOn(storage, 'saveTrip').mockRejectedValueOnce(new storage.StorageError('配额已满'));
    await expect(s.commit(a, p, false)).rejects.toThrow();
    expect(useTrips.getState().trips[a].real.plan!.revision).toBe(1);
    expect(useTrips.getState().saveError).toMatch('配额已满');
    spy.mockRestore();
  });

  it('演示副本与真实记录隔离，退出后不遗留模拟事实（E16）', async () => {
    const s = useTrips.getState();
    const a = await s.createTrip();
    await s.landPlan(a, { ...trip(), tripId: a }, [], trip().requirements);
    await s.startDemo(a);
    s.appendLog(a, [{ logId: 'l1', tripId: a, tripRevision: 1, source: 'SIMULATED', occurredAt: '2026-10-20T01:00:00Z' }]);
    expect(useTrips.getState().trips[a].demo!.eventLog).toHaveLength(1);
    expect(useTrips.getState().trips[a].real.eventLog).toHaveLength(0);
    await s.stopDemo(a);
    expect(useTrips.getState().trips[a].demo).toBeUndefined();
    expect(useTrips.getState().trips[a].real.eventLog).toHaveLength(0);
  });
});
