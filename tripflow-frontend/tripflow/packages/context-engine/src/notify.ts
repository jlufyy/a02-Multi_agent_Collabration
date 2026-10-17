/**
 * 提醒去重 / 冷却 / 优先级（PRD §6.3，附录 A.4）。纯函数：
 * - B 定义规则与 A6 决策；前端在“真正显示前”再执行一次本地最终检查。
 * - 去重键至少区分 executionMode/demoRunId/activityId/arrivalId/intentId/风险类型。
 */
import type { NotificationLevel, NotificationPolicy, NotificationRecord, ProactiveDecision } from '@tripflow/contracts';

export type QueuedCard = {
  decision: ProactiveDecision & { card: NonNullable<ProactiveDecision['card']> };
  eventSource: NotificationRecord['source'];
  demoRunId?: string;
  arrivalId?: string;
  riskCode?: string;
  enqueuedAt: string;
  snoozeUntil?: string;
};

export const LEVEL_RANK: Record<NotificationLevel, number> = { L3: 3, L2: 2, L1: 1 };

export function dedupeKey(x: { demoRunId?: string; activityId?: string; arrivalId?: string; intentId?: string; riskCode?: string; level: NotificationLevel }) {
  return [x.demoRunId ? 'DEMO:' + x.demoRunId : 'REAL', x.activityId ?? '-', x.arrivalId ?? '-', x.intentId ?? '-', x.riskCode ?? '-', x.level].join('|');
}

export type ShowCheck = { ok: true } | { ok: false; defer: boolean; reason: string };
export type ShowContext = {
  now: Date; uiBusy: boolean; currentRevision: number; activityExists: (id?: string) => boolean;
  tripId?: string; executionMode?: 'REAL' | 'DEMO'; demoRunId?: string;
  arrivalCurrent?: (activityId?: string, arrivalId?: string) => boolean;
  intentApplicable?: (intentId: string, activityId?: string) => boolean;
};

export function checkCardContext(q: QueuedCard, ctx: ShowContext): ShowCheck {
  const c = q.decision.card;
  const reject = (reason: string): ShowCheck => ({ ok: false, defer: false, reason });
  if (q.decision.baseRevision !== ctx.currentRevision) return reject('STALE_REVISION');
  if (ctx.tripId && q.decision.tripId !== ctx.tripId) return reject('TRIP_MISMATCH');
  if (ctx.executionMode && (q.eventSource !== (ctx.executionMode === 'DEMO' ? 'SIMULATED' : 'REAL') || q.demoRunId !== ctx.demoRunId)) return reject('SOURCE_MISMATCH');
  if (c.evidence.source !== q.eventSource || c.evidence.eventId !== q.decision.eventId) return reject('EVENT_MISMATCH');
  const age = ctx.now.getTime() - Date.parse(q.enqueuedAt);
  const ttl = 10 * 60_000;
  const deadline = Math.min(Date.parse(q.enqueuedAt) + 3600_000, Math.max(Date.parse(q.enqueuedAt), Date.parse(q.snoozeUntil ?? q.enqueuedAt)) + ttl);
  if (!Number.isFinite(age) || age < 0 || ctx.now.getTime() > deadline) return reject('EXPIRED');
  if (c.activityId && !ctx.activityExists(c.activityId)) return reject('ACTIVITY_REMOVED');
  if (c.intentId && ctx.intentApplicable && !ctx.intentApplicable(c.intentId, c.activityId)) return reject('INTENT_CHANGED');
  if (c.level !== 'L3' && ctx.arrivalCurrent && !ctx.arrivalCurrent(c.activityId, q.arrivalId)) return reject('ARRIVAL_ENDED');
  return { ok: true };
}

/** 显示前的最终检查。records = 当前工作区的通知事实记录（含已展示/忽略/稍后）。 */
export function checkShow(
  q: QueuedCard, records: NotificationRecord[], policy: NotificationPolicy,
  ctx: ShowContext,
): ShowCheck {
  const c = q.decision.card;
  const applicable = checkCardContext(q, ctx);
  if (!applicable.ok) return applicable;
  if (c.level === 'L3') {
    if (!policy.enableL3) return { ok: false, defer: false, reason: 'L3_DISABLED' };
  } else {
    if (policy.paused) return { ok: false, defer: false, reason: 'PAUSED' };
    if (c.level === 'L1' && !policy.enableL1) return { ok: false, defer: false, reason: 'L1_DISABLED' };
    if (c.level === 'L2' && !policy.enableL2) return { ok: false, defer: false, reason: 'L2_DISABLED' };
    if (ctx.uiBusy) return { ok: false, defer: true, reason: 'UI_BUSY' };
  }
  if (c.activityId && !ctx.activityExists(c.activityId)) return { ok: false, defer: false, reason: 'ACTIVITY_REMOVED' };
  if (q.snoozeUntil && Date.parse(q.snoozeUntil) > ctx.now.getTime()) return { ok: false, defer: true, reason: 'SNOOZED' };

  const key = dedupeKey({ demoRunId: q.demoRunId, activityId: c.activityId, arrivalId: q.arrivalId, intentId: c.intentId, riskCode: q.riskCode, level: c.level });
  const same = records.filter((r) => dedupeKey({ demoRunId: r.demoRunId, activityId: r.activityId, arrivalId: r.arrivalId, intentId: r.intentId, riskCode: r.riskCode, level: r.level }) === key);
  // 同一事实已展示或已忽略 → 不重复（稍后 snooze 的记录允许在到期后再次出现）
  if (same.some((r) => r.shownAt && r.actionTaken !== 'REMIND_LATER')) return { ok: false, defer: false, reason: 'DUPLICATE' };
  const pendingSnooze = same.find((r) => r.actionTaken === 'REMIND_LATER' && r.snoozeUntil && Date.parse(r.snoozeUntil) > ctx.now.getTime());
  if (pendingSnooze) return { ok: false, defer: true, reason: 'SNOOZED' };

  if (c.level !== 'L3') {
    // L1：同一次抵达最多 1 条
    if (c.level === 'L1' && q.arrivalId && records.some((r) => r.level === 'L1' && r.arrivalId === q.arrivalId && r.shownAt)) {
      return { ok: false, defer: false, reason: 'L1_ONCE_PER_ARRIVAL' };
    }
    const cooldownMs = policy.cooldownMinutes * 60_000;
    const recent = records.filter((r) => r.level !== 'L3' && r.shownAt && ctx.now.getTime() - Date.parse(r.shownAt) < cooldownMs);
    // L2 明确任务优先于 L1；L1 受普通冷却约束，L2 只与同任务比较
    if (c.level === 'L1' && recent.length) return { ok: false, defer: false, reason: 'COOLDOWN' };
    if (c.level === 'L2' && recent.some((r) => r.level === 'L2' && r.intentId === c.intentId)) return { ok: false, defer: false, reason: 'COOLDOWN' };
  }
  return { ok: true };
}

/** 队列排序：L3 > L2 > L1，同级先到先显示。 */
export function sortQueue(q: QueuedCard[]): QueuedCard[] {
  return [...q].sort((a, b) => LEVEL_RANK[b.decision.card.level] - LEVEL_RANK[a.decision.card.level] || a.enqueuedAt.localeCompare(b.enqueuedAt));
}

/** 发给后端的 recentNotifications：覆盖同次抵达、仍有效风险、冷却/稍后窗口，而不是任意截取最近几条。 */
export function relevantRecords(records: NotificationRecord[], opts: { arrivalId?: string; intentIds: string[]; now: Date; cooldownMinutes: number }) {
  const win = Math.max(opts.cooldownMinutes, 60) * 60_000;
  return records.filter((r) =>
    (opts.arrivalId && r.arrivalId === opts.arrivalId) ||
    (r.intentId && opts.intentIds.includes(r.intentId)) ||
    r.riskCode ||
    (r.snoozeUntil && Date.parse(r.snoozeUntil) > opts.now.getTime()) ||
    (r.shownAt && opts.now.getTime() - Date.parse(r.shownAt) < win));
}
