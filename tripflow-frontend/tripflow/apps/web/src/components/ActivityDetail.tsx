import { useEffect, useState } from 'react';
import type { ItineraryActivity, TripState, DataStatus } from '@tripflow/contracts';
import { EvidenceList, DATA_LABEL, fmtTime, fmtMin, fmtCny, minutesBetween } from './ui';
import { Icon } from './Icon';
import { PlaceHero } from './Illustrations';
import { INTENT_LABEL, MODE_LABEL } from '../lib/requirements';
import { PROGRESS_LABEL } from './Timeline';
import { WebResearchPanel } from './WebResearchPanel';

/** P06 活动详情（设计稿 06）。所有字段按来源状态显示；没有的数据写“未获取”，不编造。 */
export function ActivityDetail({ a, plan, onClose, onToggleLock, onAskAI, onExplain, onShowOnMap, busy }: {
  a: ItineraryActivity; plan: TripState; onClose: () => void; onToggleLock: () => void; onAskAI: () => void; onExplain: () => void; onShowOnMap: () => void; busy: boolean;
}) {
  const [showSrc, setShowSrc] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const inSeg = plan.segments.find((s) => s.toActivityId === a.id);
  const outSeg = plan.segments.find((s) => s.fromActivityId === a.id);
  const its = plan.intents.filter((i) => a.intentIds.includes(i.id));
  const nameOf = (id: string) => plan.activities.find((x) => x.id === id)?.place.name ?? '相关活动';
  const p = a.place;
  const rows: { icon: string; label: string; value?: string; status?: DataStatus }[] = [
    { icon: 'clock', label: '开放时间', value: p.openingHours?.value, status: p.openingHours?.evidence.status },
    { icon: 'calendar', label: '计划时间', value: `${fmtTime(a.startAt)}–${fmtTime(a.endAt)}（${fmtMin(minutesBetween(a.startAt, a.endAt))}）`, status: 'VERIFIED' },
    p.category === 'RESTAURANT'
      ? { icon: 'wallet', label: '人均消费', value: p.averageCostCny?.value !== undefined ? `约 ${fmtCny(p.averageCostCny.value)}` : undefined, status: p.averageCostCny?.evidence.status }
      : { icon: 'wallet', label: '门票', value: p.ticketPriceCny?.value !== undefined ? fmtCny(p.ticketPriceCny.value) : undefined, status: p.ticketPriceCny?.evidence.status },
    { icon: 'users', label: '排队', value: p.queueMinutes?.value !== undefined ? `约${fmtMin(p.queueMinutes.value)}` : undefined, status: p.queueMinutes?.evidence.status },
    { icon: 'pin', label: '地址', value: p.address, status: p.evidence[0]?.status },
  ];
  const tags = [
    ...(a.mandatory ? ['必去'] : []),
    ...its.filter((i) => i.status !== 'CANCELLED').map((i) => `${INTENT_LABEL[i.type]}任务`),
    ...(a.bookingStatus === 'REQUIRED' ? ['需预约'] : a.bookingStatus === 'BOOKED' ? ['已预约'] : []),
    ...(plan.mode === 'TRAVELING' ? [PROGRESS_LABEL[a.progress]] : []),
  ];

  return (
    <div className="animate-rise fixed inset-0 z-[60] mx-auto flex max-w-[560px] flex-col bg-white" role="dialog" aria-modal="true" aria-label={`${p.name} 详情`}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative">
          <PlaceHero name={p.name} place={p} />
          <button className="glass-btn absolute left-3 top-[calc(10px+var(--safe-t))]" onClick={onClose} aria-label="关闭"><Icon name="back" size={19} /></button>
        </div>
        <div className="-mt-4 rounded-t-[22px] bg-white px-5 pt-5">
          <div className="flex items-start gap-3">
            <h2 className="flex-1 text-[22px] font-bold leading-tight">{p.name}</h2>
            <button className={`flex h-10 w-10 items-center justify-center rounded-full ${a.locked ? 'bg-accent-soft text-accent' : 'bg-[#F2F4F7] text-ink-soft'}`}
              disabled={busy} onClick={onToggleLock} aria-label={a.locked ? '解锁' : '锁定'}><Icon name={a.locked ? 'lock' : 'unlock'} size={18} /></button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-[6px] bg-brand-mist px-2 py-0.5 text-[12px] text-brand">第{a.dayIndex + 1}天 · 第{a.orderIndex + 1}站</span>
            {tags.map((t) => <span key={t} className="rounded-[6px] bg-accent-soft px-2 py-0.5 text-[12px] text-accent">{t}</span>)}
          </div>
          {its.filter((i) => i.status !== 'CANCELLED').map((i) => (
            <p key={i.id} className="mt-3 text-[13.5px] leading-relaxed text-ink-soft">你的计划：{i.userRequest}</p>
          ))}

          <ul className="mt-4 divide-y divide-sand/70">
            {rows.map((r) => (
              <li key={r.label} className="flex items-center gap-3 py-3 text-[14px]">
                <Icon name={r.icon} size={17} className="shrink-0 text-ink-faint" />
                <span className="w-16 shrink-0 text-ink-soft">{r.label}</span>
                <span className={`min-w-0 flex-1 ${r.value ? '' : 'text-ink-faint'}`}>{r.value ?? '未获取（不假设）'}</span>
                {r.value && r.status && r.status !== 'VERIFIED' && <span className="shrink-0 text-[11.5px] text-warn">{DATA_LABEL[r.status]}</span>}
              </li>
            ))}
            <li className="flex items-start gap-3 py-3 text-[14px]">
              <Icon name="route" size={17} className="mt-0.5 shrink-0 text-ink-faint" />
              <span className="w-16 shrink-0 text-ink-soft">交通</span>
              <span className="min-w-0 flex-1 space-y-0.5 text-[13.5px]">
                {inSeg ? <span className="block">从 {nameOf(inSeg.fromActivityId)}：{MODE_LABEL[inSeg.mode]} {fmtMin(inSeg.durationMin)} <span className="text-[11.5px] text-warn">{inSeg.evidence.status !== 'VERIFIED' && DATA_LABEL[inSeg.evidence.status]}</span></span> : <span className="block text-ink-faint">当天第一站</span>}
                {outSeg && <span className="block">到 {nameOf(outSeg.toActivityId)}：{MODE_LABEL[outSeg.mode]} {fmtMin(outSeg.durationMin)} <span className="text-[11.5px] text-warn">{outSeg.evidence.status !== 'VERIFIED' && DATA_LABEL[outSeg.evidence.status]}</span></span>}
              </span>
            </li>
          </ul>

          <button className="relative mt-3 flex h-[110px] w-full items-end overflow-hidden rounded-[16px] bg-[#E9EEF5] p-3 text-left" onClick={onShowOnMap} aria-label="在地图中查看位置">
            <svg viewBox="0 0 300 110" className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 70 C60 60 90 90 150 75 S250 40 300 55" stroke="#C9D7EA" strokeWidth="10" fill="none" />
              <path d="M120 0 L135 110 M220 0 L200 110" stroke="#fff" strokeWidth="6" />
            </svg>
            <span className="absolute left-1/2 top-[40%] flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-brand ring-4 ring-brand/25" />
            <span className="relative rounded-full bg-white/90 px-2.5 py-1 font-mono text-[11px] text-ink-soft">{p.location.lat.toFixed(5)}, {p.location.lng.toFixed(5)} · {p.location.coordinateSystem}</span>
          </button>

          <WebResearchPanel key={p.poiId} initial={p.webResearch} poiId={p.poiId} city={plan.destinationCity} visitDate={a.startAt.slice(0, 10)} />
          <button className="mt-4 text-[13px] text-brand" onClick={() => setShowSrc(!showSrc)}>{showSrc ? '收起数据来源' : '查看数据来源'}</button>
          {showSrc && <div className="mt-2 pb-2"><EvidenceList items={[...p.evidence, ...[p.openingHours, p.ticketPriceCny, p.bookingNote].flatMap((f) => f ? [f.evidence] : [])]} /></div>}
          <p className="mb-6 mt-2 text-[12px] text-ink-faint">{p.category === 'RESTAURANT' ? '人均消费为商家公开参考值，实际价格、排队和营业状态以到店为准。' : '门票按成人普通大门票核算，优惠票、园中园及索道另计。开放政策以到访日景区公告为准。'}</p>
        </div>
      </div>
      <div className="flex gap-2.5 border-t border-sand/70 px-5 pb-[calc(12px+var(--safe-b))] pt-3">
        <button className="btn-soft flex-1 !px-2 !text-[14px]" onClick={onExplain}><Icon name="book" size={16} />讲解这里</button>
        <button className="btn-soft flex-1 !px-2 !text-[14px]" onClick={onShowOnMap}><Icon name="map" size={16} />看地图</button>
        <button className="btn-primary flex-1 !px-2 !text-[14px]" onClick={onAskAI}>修改安排</button>
      </div>
    </div>
  );
}
