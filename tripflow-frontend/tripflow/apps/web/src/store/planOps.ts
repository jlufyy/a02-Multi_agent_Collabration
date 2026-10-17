/**
 * 计划提交 / 撤销 / 重做的纯函数（附录 A.7）。
 * - revision 单调递增；undo/redo 也产生新的 revision。
 * - 计划快照包含意图、锁定、路线、提醒策略；事实日志与地理状态不回滚，而是重新投影。
 * - 模式/提醒设置变更递增 revision 但不进入撤销单元。
 */
import type { TripState, RevisionProposal } from '@tripflow/contracts';
import { UNDO_LIMIT, type Workspace } from './types';
import { nowIso } from '../lib/id';

export class StaleRevisionError extends Error {
  code = 'STALE_REVISION';
  constructor(msg = '行程已更新，请重新预览') { super(msg); }
}
export class NotCommittableError extends Error {
  code = 'NOT_COMMITTABLE';
}

/** 首次规划落地：revision=1。 */
export function landInitialPlan(ws: Workspace, plan: TripState, tripId: string): Workspace {
  if (plan.tripId !== tripId) throw new StaleRevisionError('规划结果的 tripId 不匹配，已丢弃');
  if (ws.plan) throw new StaleRevisionError('已存在正式计划，旧规划结果被丢弃');
  const p: TripState = { ...plan, revision: 1, mode: 'PLANNING', lifecycle: 'PLAN_READY', updatedAt: nowIso() };
  return { ...ws, plan: p, undo: [], redo: [], pending: undefined };
}

/** 用户确认后的原子提交（CAS）。 */
export function commitProposal(ws: Workspace, proposal: RevisionProposal, opts: { acceptUnknown: boolean }): Workspace {
  const cur = ws.plan;
  if (!cur) throw new StaleRevisionError('没有正式计划');
  if (!ws.pending || ws.pending.proposal.proposalId !== proposal.proposalId) throw new StaleRevisionError('草稿已被替换或取消');
  if (proposal.tripId !== cur.tripId || proposal.baseRevision !== cur.revision || proposal.candidate.tripId !== cur.tripId) {
    throw new StaleRevisionError();
  }
  const v = ws.pending.finalValidation ?? proposal.validation;
  if (!v.committable || v.status === 'INFEASIBLE' || v.hardViolations.length) throw new NotCommittableError('存在硬约束冲突，不能提交');
  if (v.status === 'PARTIALLY_VERIFIED' && !opts.acceptUnknown) throw new NotCommittableError('请先确认接受未核验项');
  const next: TripState = {
    ...proposal.candidate,
    // 设置类字段保持当前值（不随编辑候选漂移）
    mode: cur.mode, lifecycle: cur.lifecycle,
    revision: cur.revision + 1, updatedAt: nowIso(),
  };
  return {
    ...ws,
    plan: next,
    undo: [...ws.undo, cur].slice(-UNDO_LIMIT),
    redo: [],
    pending: undefined,
  };
}

function restore(ws: Workspace, from: 'undo' | 'redo'): Workspace {
  const cur = ws.plan;
  const stack = ws[from];
  if (!cur || !stack.length) return ws;
  const target = stack[stack.length - 1];
  const next: TripState = {
    ...target,
    mode: cur.mode, lifecycle: cur.lifecycle, notificationPolicy: cur.notificationPolicy,
    revision: cur.revision + 1, updatedAt: nowIso(),
  };
  const other = from === 'undo' ? 'redo' : 'undo';
  return {
    ...ws,
    plan: next,
    [from]: stack.slice(0, -1),
    [other]: [...ws[other], cur].slice(-UNDO_LIMIT),
    pending: undefined, // 旧草稿基于旧 revision，作废
  };
}
export const undoPlan = (ws: Workspace) => restore(ws, 'undo');
export const redoPlan = (ws: Workspace) => restore(ws, 'redo');

/** 模式 / 提醒设置：递增 revision，作废旧请求，但不进入撤销栈。 */
export function updateSettings(ws: Workspace, patch: Partial<Pick<TripState, 'mode' | 'lifecycle' | 'notificationPolicy'>>): Workspace {
  if (!ws.plan) return ws;
  return { ...ws, plan: { ...ws.plan, ...patch, revision: ws.plan.revision + 1, updatedAt: nowIso() }, pending: undefined };
}

/** 把事实日志/地理状态投影到当前计划（progress、意图 TRIGGERED）。只用于展示与发请求，不改变撤销语义。 */
export function projectPlan(plan: TripState, ws: Pick<Workspace, 'geo' | 'eventLog'>): TripState {
  const geoBy = new Map(ws.geo.map((g) => [g.activityId, g]));
  const triggered = new Set(ws.eventLog.filter((e) => e.notification?.shownAt && e.notification.intentId).map((e) => e.notification!.intentId!));
  return {
    ...plan,
    activities: plan.activities.map((a) => ({ ...a, progress: geoBy.get(a.id)?.progress ?? a.progress })),
    intents: plan.intents.map((i) => (triggered.has(i.id) && i.status !== 'CANCELLED' ? { ...i, status: 'TRIGGERED' as const } : i)),
  };
}

/** 按 dayIndex 派生的 ItineraryDay 视图（不形成第二份可写日程）。 */
export function daysOf(plan: TripState) {
  const n = Math.max(1, Math.round((Date.parse(plan.endDate) - Date.parse(plan.startDate)) / 86_400_000) + 1);
  return Array.from({ length: n }, (_, d) => ({
    dayIndex: d,
    activities: plan.activities.filter((a) => a.dayIndex === d).sort((a, b) => a.orderIndex - b.orderIndex),
  }));
}
