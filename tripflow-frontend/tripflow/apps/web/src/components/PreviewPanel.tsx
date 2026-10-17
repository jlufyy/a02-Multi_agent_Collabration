import { useState } from 'react';
import type { TripState, ItineraryActivity, EditOperation } from '@tripflow/contracts';
import type { PendingProposal } from '../store/types';
import { ValidationBadge, ErrorBox, Spinner, fmtMin, fmtCny, fmtTime } from './ui';
import { Icon } from './Icon';
import { AgentProgress } from './AgentProgress';
import type { useEditFlow } from '../lib/useEditFlow';
import { validationMessages } from '../lib/validationMessages';
import { planDate } from '../lib/time';

/** P07 变更预览（设计稿 07）：前后对比 + 影响说明；确认前不改正式计划。 */
export function PreviewPanel({ pending, current, flow, onClosed }: {
  pending: PendingProposal; current: TripState; flow: ReturnType<typeof useEditFlow>; onClosed: () => void;
}) {
  const p = pending.proposal;
  const v = pending.finalValidation ?? p.validation;
  const [acceptedProposal, setAcceptedProposal] = useState<string>();
  const accept = acceptedProposal === p.proposalId;
  const stale = p.baseRevision !== current.revision;
  const blocked = stale || !v.committable || v.status === 'INFEASIBLE' || v.hardViolations.length > 0;
  const needAccept = v.status === 'PARTIALLY_VERIFIED' || v.unknownChecks.length > 0;
  const busy = flow.validateJob.running || flow.proposeJob.running;
  const name = (id: string) => p.candidate.activities.find((a) => a.id === id)?.place.name ?? current.activities.find((a) => a.id === id)?.place.name ?? '相关活动';
  const messages = validationMessages(v, [...p.candidate.activities, ...current.activities]);
  const close = () => { if (!busy) { flow.discard(); onClosed(); } };
  const timeChanges = p.activityChanges.filter((c) => c.oldStartAt !== c.newStartAt || c.oldEndAt !== c.newEndAt);

  // 只对比发生变化的日子
  const changedIds = new Set([...p.diff.added, ...p.diff.removed, ...p.diff.moved, ...timeChanges.map((c) => c.activityId)]);
  const dayOf = (id: string) => (p.candidate.activities.find((a) => a.id === id) ?? current.activities.find((a) => a.id === id))?.dayIndex ?? 0;
  const days = [...new Set([...changedIds].map(dayOf))].sort();
  const list = (t: TripState, d: number) => t.activities.filter((a) => a.dayIndex === d).sort((a, b) => a.orderIndex - b.orderIndex);

  const summary = [
    ...p.diff.removed.map((id) => `移除「${name(id)}」`),
    ...p.diff.added.map((id) => `新增「${name(id)}」`),
    ...p.diff.moved.map((id) => `调整「${name(id)}」的顺序`),
  ];
  if (!summary.length && timeChanges.length) summary.push(`调整 ${timeChanges.length} 个活动的时间`);
  if (!summary.length && p.activityChanges.length) summary.push('更新景点资料与核验结果');
  if (!summary.length) summary.push('修改行程约束');

  const t = p.estimatedChanges.travelMinutesDelta;
  const c = p.estimatedChanges.costCnyDelta;
  const impacts: { tone: 'ok' | 'warn' | 'bad'; text: string }[] = [
    ...messages.hard.map((text) => ({ tone: 'bad' as const, text })),
    ...(t === undefined ? [{ tone: 'warn' as const, text: '交通时间变化不确定' }]
      : [{ tone: t <= 0 ? 'ok' as const : 'warn' as const, text: t === 0 ? '交通时间基本不变' : `预计交通时间${t < 0 ? '减少' : '增加'} ${fmtMin(Math.abs(t))}` }]),
    ...(c === undefined ? [{ tone: 'warn' as const, text: '费用变化不确定' }]
      : [{ tone: c <= 0 ? 'ok' as const : 'warn' as const, text: c === 0 ? '费用不变' : `预计费用${c < 0 ? '减少' : '增加'} ${fmtCny(Math.abs(c))}` }]),
    ...messages.unknown.map((text) => ({ tone: 'warn' as const, text })),
    ...messages.warnings.map((text) => ({ tone: 'warn' as const, text })),
    ...(!blocked && v.status === 'FEASIBLE' ? [{ tone: 'ok' as const, text: '不影响其他已锁定安排' }] : []),
  ];

  return (
    <div className="animate-rise fixed inset-0 z-[60] mx-auto flex max-w-[560px] flex-col bg-white" role="dialog" aria-modal="true" aria-label="确认行程变更">
      <header className="relative flex items-center justify-center px-4 pb-3 pt-[calc(14px+var(--safe-t))]">
        <button className="absolute left-3 flex h-10 w-10 items-center justify-center" onClick={close} aria-label="关闭"><Icon name="back" /></button>
        <h1 className="text-[17px] font-semibold">确认行程变更</h1>
        <span className="absolute right-4"><ValidationBadge status={v.status} /></span>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-6">
        {stale && <div role="alert" className="rounded-[12px] bg-danger-soft p-3 text-[13.5px] text-danger">行程已更新，这个预览已过期。请取消后重新发起修改。</div>}
        {!stale && <details open={blocked} className="rounded-[16px] bg-brand-mist p-4">
          <summary className="min-h-7 cursor-pointer text-[14px] font-semibold">{blocked ? '调整冲突后继续' : '微调这份方案'}</summary>
          <p className="mb-3 mt-1 text-[12px] text-ink-soft">可修改日期、开始时间和游览时长，或移除活动。重新计算后再确认，当前已保存的行程不会改变。</p>
          <div className="space-y-3">{p.candidate.activities.map((a) => <DraftActivityEditor key={`${p.proposalId}:${a.id}`} a={a} plan={p.candidate} busy={busy}
            onChange={(ops) => flow.propose({ operations: [...p.operations, ...ops], origin: pending.origin })} />)}</div>
        </details>}
        <section className="rounded-[16px] bg-[#F7F9FC] p-4">
          <p className="text-[12px] text-ink-faint">变更内容</p>
          {summary.map((s) => <p key={s} className="mt-1 text-[15px] font-medium">{s}</p>)}
        </section>

        {days.map((d) => (
          <section key={d} className="rounded-[16px] bg-[#F7F9FC] p-4">
            <p className="mb-2 text-[12px] text-ink-faint">第{d + 1}天</p>
            <div className="grid grid-cols-2 gap-3">
              <Column title="变更前" acts={list(current, d)} highlight={changedIds} />
              <Column title="变更后" acts={list(p.candidate, d)} highlight={changedIds} after added={new Set(p.diff.added)} />
            </div>
          </section>
        ))}

        <section className="rounded-[16px] bg-[#F7F9FC] p-4">
          <p className="mb-2 text-[14px] font-semibold">影响说明</p>
          <ul className="space-y-2">
            {impacts.map((x, i) => (
              <li key={i} className="flex items-start gap-2 text-[13.5px]">
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white ${x.tone === 'ok' ? 'bg-ok' : x.tone === 'warn' ? 'bg-warn' : 'bg-danger'}`}>
                  <Icon name={x.tone === 'ok' ? 'check' : x.tone === 'bad' ? 'close' : 'info'} size={10} stroke={3} />
                </span>
                <span className={x.tone === 'bad' ? 'text-danger' : 'text-ink-soft'}>{x.text}</span>
              </li>
            ))}
          </ul>
          {timeChanges.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-sand pt-3 text-[12.5px] text-ink-soft">
              {timeChanges.map((c2) => (
                <li key={c2.activityId}>{name(c2.activityId)}：{c2.oldStartAt ? fmtTime(c2.oldStartAt) : '—'} → <b className="text-ink">{c2.newStartAt ? fmtTime(c2.newStartAt) : '—'}</b></li>
              ))}
            </ul>
          )}
        </section>
        {busy && <AgentProgress events={flow.proposeJob.running ? flow.proposeJob.progress : flow.validateJob.progress} running />}
        {flow.validateJob.error != null && <ErrorBox error={flow.validateJob.error} />}
        {flow.commitError != null && <ErrorBox error={flow.commitError} />}
        {flow.proposeJob.error != null && <ErrorBox error={flow.proposeJob.error} />}
      </div>
      <footer className="space-y-2 px-5 pb-[calc(14px+var(--safe-b))] pt-2">
        {needAccept && !blocked && (
          <label className="flex items-start gap-2 pb-1 text-[13px] text-ink-soft">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#2F7CF6]" checked={accept} onChange={(e) => setAcceptedProposal(e.target.checked ? p.proposalId : undefined)} />
            我了解上方“未核验”的内容不保证准确，仍要应用此修改
          </label>
        )}
        {blocked && !stale && <button className="btn-soft w-full" disabled={busy} onClick={() => flow.propose({ operations: p.operations, origin: pending.origin })}>重新核验并排程</button>}
        <button className="btn-primary h-[50px] w-full text-[16px]" disabled={blocked || busy || (needAccept && !accept)}
          onClick={async () => { if (await flow.confirm(accept)) onClosed(); }}>
          {busy ? <><Spinner />{flow.proposeJob.running ? '正在重新计算…' : '正在最终复核…'}</> : blocked ? '无法应用（存在冲突）' : '确认修改'}
        </button>
        <button className="h-11 w-full rounded-full bg-[#F2F4F7] text-[15px] text-ink-soft" disabled={busy} onClick={close}>取消</button>
        {blocked && pending.finalValidation?.unknownChecks.some((x) => x.startsWith('REPROPOSE_REQUIRED')) && <button className="btn-soft w-full" disabled={busy} onClick={() => flow.propose({ operations: p.operations, origin: pending.origin })}>按最新资料重新计算此修改</button>}
      </footer>
    </div>
  );
}

function DraftActivityEditor({ a, plan, busy, onChange }: { a: ItineraryActivity; plan: TripState; busy: boolean; onChange: (ops: EditOperation[]) => unknown }) {
  const [day, setDay] = useState(a.dayIndex);
  const [clock, setClock] = useState(a.startAt.slice(11, 16));
  const [duration, setDuration] = useState(Math.round((Date.parse(a.endAt)-Date.parse(a.startAt))/60000));
  const days = Math.round((Date.parse(plan.endDate)-Date.parse(plan.startDate))/86400000)+1;
  const protectedActivity = a.locked || a.bookingStatus === 'BOOKED' || ['ARRIVED', 'VISITING', 'INFERRED_COMPLETE'].includes(a.progress)
    || plan.requirements.fixedConstraints.some((f) => f.activityId === a.id || f.place?.place?.poiId === a.place.poiId)
    || plan.intents.some((i) => i.locked && i.activityId === a.id);
  const valid = /^\d{2}:\d{2}$/.test(clock) && duration >= 15 && duration <= 720;
  return <div className="border-t border-brand/10 pt-3">
    <p className="mb-2 text-[13px] font-medium">{a.place.name}{protectedActivity && <span className="ml-2 text-[11px] text-ink-soft">固定安排，请先在行程中解锁或修改约束</span>}</p>
    {!protectedActivity && <>
      <div className="grid grid-cols-3 gap-2 text-[12px]">
        <label>日期<select aria-label={`${a.place.name} 日期`} className="field mt-1 w-full !px-2" value={day} disabled={busy} onChange={(e) => setDay(Number(e.target.value))}>{Array.from({ length: days }, (_, i) => <option key={i} value={i}>第{i+1}天</option>)}</select></label>
        <label>开始<input aria-label={`${a.place.name} 开始时间`} className="field mt-1 w-full !px-2" type="time" value={clock} disabled={busy} onChange={(e) => setClock(e.target.value)} /></label>
        <label>游览分钟<input aria-label={`${a.place.name} 游览分钟`} className="field mt-1 w-full !px-2" type="number" min={15} max={720} step={15} value={duration} disabled={busy} onChange={(e) => setDuration(Number(e.target.value))} /></label>
      </div>
      <div className="mt-2 flex gap-3 text-[12px]">
        <button className="min-h-10 text-brand disabled:opacity-40" disabled={busy || !valid} onClick={() => {
          const ops: EditOperation[] = [];
          if (day !== a.dayIndex) ops.push({ type: 'MOVE', activityId: a.id, dayIndex: day, orderIndex: plan.activities.filter((x) => x.dayIndex === day && x.id !== a.id).length });
          if (duration !== Math.round((Date.parse(a.endAt)-Date.parse(a.startAt))/60000)) ops.push({ type: 'UPDATE_DURATION', activityId: a.id, durationMin: duration });
          // A new explicit date supersedes any earlier UPDATE_TIME operation.
          if (day !== a.dayIndex || clock !== a.startAt.slice(11, 16)) ops.push({ type: 'UPDATE_TIME', activityId: a.id, startAt: `${planDate(plan.startDate, day)}T${clock}:00+08:00` });
          if (ops.length) onChange(ops);
        }}>按此调整重新计算</button>
        <button className="ml-auto min-h-10 text-danger disabled:opacity-40" disabled={busy || a.mandatory || plan.intents.some((i) => i.confirmed && i.activityId === a.id)} onClick={() => onChange([{ type: 'REMOVE', activityId: a.id }])}>移除此活动</button>
      </div>
    </>}
  </div>;
}

function Column({ title, acts, highlight, after, added }: { title: string; acts: ItineraryActivity[]; highlight: Set<string>; after?: boolean; added?: Set<string> }) {
  return (
    <div>
      <p className="mb-2 text-[12px] text-ink-faint">{title}</p>
      <ol className="space-y-2">
        {acts.map((a, i) => {
          const hl = after && highlight.has(a.id);
          return (
            <li key={a.id} className="flex items-center gap-2 text-[13.5px]">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${hl ? 'border border-brand text-brand' : 'text-ink-soft'}`}>{i + 1}</span>
              <span className={`truncate ${hl ? 'font-medium text-brand' : ''}`}>{a.place.name}</span>
              {after && added?.has(a.id) && <span className="shrink-0 text-[11px] text-ok">新</span>}
            </li>
          );
        })}
        {acts.length === 0 && <li className="text-[12.5px] text-ink-faint">无安排</li>}
      </ol>
    </div>
  );
}
