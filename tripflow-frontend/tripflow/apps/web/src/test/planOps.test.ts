import { describe, it, expect } from 'vitest';
import { commitProposal, undoPlan, redoPlan, updateSettings, projectPlan, StaleRevisionError, NotCommittableError } from '../store/planOps';
import { emptyWorkspace, type Workspace } from '../store/types';
import { trip, proposal } from './fixtures';

const ws = (): Workspace => ({ ...emptyWorkspace(), plan: trip(3) });
const withPending = (w: Workspace, p = proposal(w.plan!)) => ({ ...w, pending: { proposal: p, origin: 'DRAG' as const, createdAt: '' } });

describe('原子提交 / CAS', () => {
  it('确认后 revision+1、旧计划入 undo、redo 清空', () => {
    const w = withPending({ ...ws(), redo: [trip(1)] });
    const n = commitProposal(w, w.pending!.proposal, { acceptUnknown: false });
    expect(n.plan!.revision).toBe(4);
    expect(n.plan!.activities[0].id).toBe('b');
    expect(n.undo.at(-1)!.revision).toBe(3);
    expect(n.redo).toHaveLength(0);
    expect(n.pending).toBeUndefined();
  });
  it('旧 revision 的草稿被拒绝（E02）', () => {
    const w = withPending(ws(), proposal(trip(2)));
    expect(() => commitProposal(w, w.pending!.proposal, { acceptUnknown: true })).toThrow(StaleRevisionError);
  });
  it('被替换的草稿不能提交（E01）', () => {
    const w = withPending(ws());
    const other = { ...proposal(w.plan!), proposalId: 'p2' };
    expect(() => commitProposal(w, other, { acceptUnknown: true })).toThrow(StaleRevisionError);
  });
  it('硬冲突禁止提交；PARTIAL 需显式接受未知', () => {
    const bad = withPending(ws(), proposal(trip(3), { status: 'INFEASIBLE', committable: false, hardViolations: [{ code: 'LOCKED_ACTIVITY_CHANGED', activityIds: ['a'], message: 'x' }] }));
    expect(() => commitProposal(bad, bad.pending!.proposal, { acceptUnknown: true })).toThrow(NotCommittableError);
    const partial = withPending(ws(), proposal(trip(3), { status: 'PARTIALLY_VERIFIED', unknownChecks: ['营业时间未核验'] }));
    expect(() => commitProposal(partial, partial.pending!.proposal, { acceptUnknown: false })).toThrow(NotCommittableError);
    expect(commitProposal(partial, partial.pending!.proposal, { acceptUnknown: true }).plan!.revision).toBe(4);
  });
});

describe('撤销 / 重做', () => {
  it('撤销与重做都递增 revision，新编辑清空 redo（AC-23）', () => {
    const w = withPending(ws());
    const c = commitProposal(w, w.pending!.proposal, { acceptUnknown: false });
    const u = undoPlan(c);
    expect(u.plan!.revision).toBe(5);
    expect(u.plan!.activities[0].id).toBe('a');
    const r = redoPlan(u);
    expect(r.plan!.revision).toBe(6);
    expect(r.plan!.activities[0].id).toBe('b');
    const u2 = undoPlan(r);
    const p2 = withPending(u2, { ...proposal(u2.plan!), proposalId: 'p3' });
    const c2 = commitProposal(p2, p2.pending!.proposal, { acceptUnknown: false });
    expect(c2.redo).toHaveLength(0);
  });
  it('设置变更递增 revision 但不进入撤销栈，撤销后保留当前设置', () => {
    const w = withPending(ws());
    const c = commitProposal(w, w.pending!.proposal, { acceptUnknown: false });
    const s = updateSettings(c, { mode: 'TRAVELING', notificationPolicy: { ...c.plan!.notificationPolicy, paused: true } });
    expect(s.undo).toHaveLength(c.undo.length);
    const u = undoPlan(s);
    expect(u.plan!.mode).toBe('TRAVELING');
    expect(u.plan!.notificationPolicy.paused).toBe(true);
  });
  it('事实日志不随撤销回滚，进度重新投影', () => {
    const w = withPending(ws());
    const c = commitProposal(w, w.pending!.proposal, { acceptUnknown: false });
    const target = c.plan!.activities.find((a) => a.id === 'a')!;
    const targetKey = JSON.stringify([target.id, target.place.poiId, target.place.location, target.dayIndex, target.startAt.slice(0, 10)]);
    const withFacts: Workspace = { ...c, geo: [{ tripId: 'trip_t', activityId: 'a', source: 'REAL', progress: 'ARRIVED', arrivalId: 'arr1', targetKey, insideSamples: 0, outsideSamples: 0, anomalies: 0 }] };
    const u = undoPlan(withFacts);
    expect(u.geo).toHaveLength(1);
    expect(projectPlan(u.plan!, u).activities.find((a) => a.id === 'a')!.progress).toBe('ARRIVED');
  });
});
