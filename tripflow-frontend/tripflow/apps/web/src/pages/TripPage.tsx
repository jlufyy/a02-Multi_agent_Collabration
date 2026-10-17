import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import type { NotificationAction, SelectedContext, EditOperation, ActivityProgress, GeoPoint } from '@tripflow/contracts';
import { distanceMeters } from '@tripflow/context-engine';
import { MODE_LABEL } from '../lib/requirements';
import { useTrips, activeWs } from '../store/tripStore';
import { daysOf } from '../store/planOps';
import { useEditFlow } from '../lib/useEditFlow';
import { useTravel, type LocStatus } from '../lib/useTravel';
import { MapView } from '../components/MapView';
import { BottomSheet } from '../components/BottomSheet';
import { Timeline, PROGRESS_LABEL } from '../components/Timeline';
import { PreviewPanel } from '../components/PreviewPanel';
import { ActivityDetail } from '../components/ActivityDetail';
import { AIPanel } from '../components/AIPanel';
import { ProactiveCard } from '../components/ProactiveCard';
import { ContentModal } from '../components/ContentViewer';
import { DemoConsole } from '../components/DemoConsole';
import { Icon } from '../components/Icon';
import { Modal, ErrorBox, Spinner, fmtTime, fmtMin, todayInTz, toast } from '../components/ui';
import { AgentProgress } from '../components/AgentProgress';

const SNAPS = [0.2, 0.55, 0.85] as const;
const fmtShortDate = (start: string, d: number) => {
  const t = new Date(Date.parse(start + 'T12:00:00+08:00') + d * 86_400_000);
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric' }).format(t);
};
const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`);
const LOC_TEXT: Record<LocStatus, string> = {
  off: '定位未开启', requesting: '正在请求定位权限…', active: '前台定位中', denied: '未获得位置权限', unsupported: '此环境不支持定位（需 HTTPS）',
  low_accuracy: '位置正在确认（精度不足）', hidden: '页面在后台，定位暂停', error: '定位暂不可用', simulated: '模拟位置（演示）',
};

export function TripPage() {
  const { tripId = '' } = useParams();
  const nav = useNavigate();
  const trip = useTrips((s) => s.trips[tripId]);
  const settings = useTrips((s) => s.settings);
  const undo = useTrips((s) => s.undo);
  const redo = useTrips((s) => s.redo);
  const ws = activeWs(trip);
  const rawPlan = ws?.plan;

  const [activeDay, setActiveDay] = useState(() => {
    if (!rawPlan) return 0;
    const d = Math.round((Date.parse(todayInTz()) - Date.parse(rawPlan.startDate)) / 86_400_000);
    return d >= 0 && d < daysOf(rawPlan).length ? d : 0;
  });
  const [selectedId, setSelectedId] = useState<string>();
  const [snap, setSnap] = useState<number>(SNAPS[1]);
  const [detailId, setDetailId] = useState<string>();
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSeed, setAiSeed] = useState<{ text?: string; action?: 'EXPLAIN' | 'NEARBY_FOOD' }>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [tempOrder, setTempOrder] = useState<string[]>();
  const [dragging, setDragging] = useState(false);
  const [replaceAsk, setReplaceAsk] = useState<() => void>();
  const [travelAsk, setTravelAsk] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [contentView, setContentView] = useState<{ ids: string[]; intentId?: string; title: string; activityId?: string }>();
  const [correctId, setCorrectId] = useState<string>();
  const [busySetting, setBusySetting] = useState(false);
  const [focus, setFocus] = useState<{ point: GeoPoint; key: number }>();
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(150);
  useLayoutEffect(() => {
    const el = headerRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el); setHeaderH(el.offsetHeight);
    return () => ro.disconnect();
  }, [rawPlan?.tripId]);

  const flow = useEditFlow(tripId);
  const travel = useTravel(tripId, activeDay);
  const plan = travel.projected;
  const pending = ws?.pending;

  const uiBusy = dragging || previewOpen || !!pending || aiOpen || !!detailId;
  useEffect(() => { travel.setUiBusy(uiBusy); }, [uiBusy]); // eslint-disable-line react-hooks/exhaustive-deps
  // 任务/风险卡出现时把抽屉收起，避免遮挡卡片
  const cardLevel = travel.activeCard?.decision.card.level;
  useEffect(() => { if (cardLevel === 'L2' || cardLevel === 'L3') setSnap((s) => Math.min(s, SNAPS[0])); }, [cardLevel, travel.activeCard?.decision.card.cardId]);
  // 有待确认草稿时自动打开预览
  useEffect(() => { if (pending && !pending.directApply && !flow.proposeJob.running) setPreviewOpen(true); }, [pending?.proposal.proposalId, pending?.directApply]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!pending && !flow.proposeJob.running) setTempOrder(undefined); }, [pending, flow.proposeJob.running]);

  const days = useMemo(() => (plan ? daysOf(plan) : []), [plan]);
  const day = days[activeDay] ?? days[0];
  const dayActs = useMemo(() => {
    const acts = day?.activities ?? [];
    if (!tempOrder) return acts;
    return tempOrder.map((id) => acts.find((a) => a.id === id)!).filter(Boolean);
  }, [day, tempOrder]);
  const daySegs = useMemo(() => plan?.segments.filter((s) => dayActs.some((a) => a.id === s.fromActivityId)) ?? [], [plan, dayActs]);
  const dayBoundary = useMemo(() => plan?.boundarySegments.filter((b) => b.dayIndex === activeDay) ?? [], [plan, activeDay]);
  const previewDay = useMemo(() => {
    if (!pending || !previewOpen) return undefined;
    const c = pending.proposal.candidate;
    return { activities: c.activities.filter((a) => a.dayIndex === activeDay).sort((a, b) => a.orderIndex - b.orderIndex), segments: c.segments };
  }, [pending, previewOpen, activeDay]);

  if (!trip) return <Navigate to="/" replace />;
  if (!rawPlan || !plan) return <Navigate to={`/trip/${tripId}/planning`} replace />;

  const traveling = plan.mode === 'TRAVELING';
  const selected = plan.activities.find((a) => a.id === selectedId);
  const ctx: SelectedContext = { tripId, planRevision: plan.revision, mode: plan.mode, selectedActivityId: selected?.id, selectedPoiId: selected?.place.poiId, activeDay };
  const totalTravel = daySegs.reduce<number | undefined>((s, x) => (s === undefined || x.durationMin === undefined ? undefined : s + x.durationMin), 0);
  const today = todayInTz();
  const suggestTravel = !traveling && !trip.demo && Date.parse(today) >= Date.parse(plan.startDate) - 86_400_000 && Date.parse(today) <= Date.parse(plan.endDate);
  const sheetPx = snap * window.innerHeight;

  /** 若已有待确认草稿，先征求替换。 */
  function guarded(fn: () => void) {
    if (activeWs(useTrips.getState().trips[tripId])?.pending || flow.proposeJob.running) setReplaceAsk(() => fn);
    else fn();
  }
  async function proposeOps(ops: EditOperation[], origin: 'DRAG' | 'DETAIL') {
    const r = await flow.propose({ operations: ops, origin, selectedContext: ctx });
    if (!r) { setTempOrder(undefined); return; }
    if (r.kind === 'REVISION') setPreviewOpen(true);
  }
  function onReorder(activityId: string, toIndex: number) {
    guarded(() => {
      const ids = dayActs.map((a) => a.id);
      const from = ids.indexOf(activityId);
      ids.splice(from, 1); ids.splice(toIndex, 0, activityId);
      setTempOrder(ids); // 临时顺序，仅视觉；正式计划不变
      proposeOps([{ type: 'MOVE', activityId, dayIndex: activeDay, orderIndex: toIndex }], 'DRAG');
    });
  }
  async function toggleTravel(on: boolean, ended = false) {
    setBusySetting(true);
    try {
      await settings(tripId, on ? { mode: 'TRAVELING', lifecycle: 'TRAVELING' } : { mode: 'PLANNING', lifecycle: ended ? 'TRIP_ENDED' : 'PLAN_READY' });
      if (!on) travel.stopWatch(); else setSnap(SNAPS[0]);
    } finally { setBusySetting(false); }
  }
  function onCardAction(a: NotificationAction, snooze?: number) {
    const q = travel.activeCard;
    if (!q) return;
    const c = q.decision.card;
    travel.respond(a, snooze);
    if (a === 'VIEW_CONTENT' || a === 'VIEW_SCRIPT' || a === 'VIEW_SHOOTING_CHECKLIST') {
      setSelectedId(c.activityId);
      setContentView({ ids: c.contentIds, intentId: c.intentId, title: c.title, activityId: c.activityId });
    } else if (a === 'VIEW_REVISION') {
      setAiSeed({ text: `针对风险「${c.title}」帮我调整行程，锁定的任务不要动` }); setAiOpen(true);
    } else if (a === 'VIEW_NEARBY' || a === 'ADD_TO_PLAN') {
      setSelectedId(c.activityId); setAiSeed({ action: 'NEARBY_FOOD' }); setAiOpen(true);
    }
  }

  const current = dayActs.find((a) => a.progress === 'ARRIVED' || a.progress === 'VISITING');
  const next = dayActs.find((a) => a.progress === 'NOT_STARTED' || a.progress === 'APPROACHING');
  const nextSeg = current && next ? daySegs.find((x) => x.fromActivityId === current.id && x.toActivityId === next.id) : undefined;
  const distNext = travel.me && next ? distanceMeters(next.place.location, travel.me.location) : undefined;
  const dayLabel = fmtShortDate(plan.startDate, activeDay);

  return (
    <div className="relative h-full overflow-hidden">
      <MapView activities={dayActs} segments={daySegs} boundary={dayBoundary} preview={previewDay} selectedId={selectedId}
        onSelect={(id) => { setSelectedId(id); if (snap === SNAPS[0]) setSnap(SNAPS[1]); }}
        me={traveling ? travel.me : undefined} bottomInset={sheetPx} focus={focus} />

      {/* 顶部浮层 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[45] space-y-2 px-3 pt-[calc(10px+var(--safe-t))]">
        {traveling ? (
          <>
            <div className="card pointer-events-auto flex items-center gap-3 !rounded-[18px] p-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-white"><Icon name="navigate" size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold">旅行进行中</span>
                <span className="block truncate text-[12.5px] text-ink-faint">第{activeDay + 1}天 · {dayLabel}{trip.demo ? ' · 演示' : ''}</span>
              </span>
              <button className="rounded-full bg-[#F2F4F7] px-4 py-2 text-[14px] text-ink-soft" disabled={busySetting} onClick={() => toggleTravel(false)} aria-label="退出旅行模式">
                {busySetting ? <Spinner /> : '退出'}
              </button>
            </div>
            <div className="flex items-start gap-2">
              <button className="card pointer-events-auto flex min-w-0 flex-1 items-center gap-3 !rounded-[18px] p-3 text-left" onClick={() => (current ?? next) && setSelectedId((current ?? next)!.id)}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-mist text-brand"><Icon name="pin" size={18} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-ink-faint">{current ? '当前' : '下一站'}</span>
                  <span className="block truncate text-[16px] font-semibold">{(current ?? next)?.place.name ?? '今日行程已完成'}</span>
                  <span className="block truncate text-[12.5px] text-ink-soft">
                    {current ? (next ? `下一站 ${next.place.name} ${fmtTime(next.startAt)}` : '这是今天最后一站') : next ? `计划 ${fmtTime(next.startAt)} 到达${distNext !== undefined ? ` · 直线 ${fmtDist(distNext)}` : ''}` : ''}
                  </span>
                </span>
              </button>
              <div className="glass pointer-events-auto flex flex-col overflow-hidden rounded-[14px]">
                <button className="glass-stack-btn" onClick={() => nav(`/trip/${tripId}/settings`)} aria-label="设置"><Icon name="gear" size={19} /></button>
                <button className="glass-stack-btn" onClick={() => travel.me && setFocus({ point: travel.me.location, key: Date.now() })} aria-label="回到当前位置" disabled={!travel.me}><Icon name="locate" size={19} /></button>
                <button className="glass-stack-btn" onClick={() => setDemoOpen(true)} aria-label="演示控制台"><Icon name="flask" size={18} className={trip.demo ? 'text-warn' : ''} /></button>
              </div>
            </div>
            <p className="pointer-events-auto w-fit rounded-full bg-white/90 px-3 py-1 text-[12px] text-ink-soft shadow-card">
              <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${travel.status === 'active' ? 'bg-ok' : travel.status === 'simulated' ? 'bg-warn' : 'bg-ink-faint'}`} />
              {LOC_TEXT[travel.status]}{travel.evalError ? ` · ${travel.evalError}` : ''}
            </p>
          </>
        ) : (
          <div className="flex items-start gap-2">
            <button className="glass-btn pointer-events-auto" onClick={() => nav('/')} aria-label="返回首页"><Icon name="back" size={19} /></button>
            <div className="card pointer-events-auto flex gap-1 !rounded-[16px] p-1" role="tablist" aria-label="选择日期">
              {days.map((d) => (
                <button key={d.dayIndex} role="tab" aria-selected={d.dayIndex === activeDay}
                  onClick={() => { setActiveDay(d.dayIndex); setSelectedId(undefined); setTempOrder(undefined); }}
                  className={`rounded-[12px] px-3.5 py-1.5 text-center leading-tight transition ${d.dayIndex === activeDay ? 'bg-brand-mist text-brand' : 'text-ink-soft'}`}>
                  <span className="block text-[13.5px] font-semibold">第{d.dayIndex + 1}天</span>
                  <span className="block text-[11px] opacity-80">{fmtShortDate(plan.startDate, d.dayIndex)}</span>
                </button>
              ))}
            </div>
            <div className="glass pointer-events-auto ml-auto flex flex-col overflow-hidden rounded-[14px]">
              <button className="glass-stack-btn" onClick={() => nav(`/trip/${tripId}/settings`)} aria-label="设置"><Icon name="gear" size={19} /></button>
            </div>
          </div>
        )}
        {trip.demo && !traveling && (
          <button className="glass pointer-events-auto mx-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium text-warn" onClick={() => setDemoOpen(true)}>
            <Icon name="flask" size={13} /> 演示 · 模拟位置
          </button>
        )}
        {travel.activeCard && (
          <div className="pointer-events-auto">
            <ProactiveCard key={travel.activeCard.decision.card.cardId} q={travel.activeCard} onAction={onCardAction} />
          </div>
        )}
      </div>

      {/* 全局 AI 入口 */}
      <button className="absolute right-3 z-30 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-brand text-white shadow-float transition-[bottom,transform] duration-300 active:scale-95"
        style={{ bottom: sheetPx + 14 }} aria-label="打开 AI 助手" onClick={() => { setAiSeed(undefined); setAiOpen(true); }}>
        <Icon name="spark" size={22} />
      </button>

      <BottomSheet snaps={SNAPS} snap={snap} onSnap={setSnap} label={`第 ${activeDay + 1} 天行程`}>
        <div ref={headerRef} className="space-y-3 px-5 pb-3">
          {traveling && (
            <div className="flex items-center gap-3 rounded-[18px] bg-[#F7F9FC] p-3.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[18px] font-bold">{next ? `距下一站 ${nextSeg?.durationMin !== undefined && current ? fmtMin(nextSeg.durationMin) : distNext !== undefined ? fmtDist(distNext) : '—'}` : '今天的行程都完成了'}</span>
                <span className="block truncate text-[12.5px] text-ink-faint">
                  {next ? (nextSeg && current ? `建议${MODE_LABEL[nextSeg.mode]}前往${nextSeg.evidence.status !== 'VERIFIED' ? '（预计）' : ''}` : distNext !== undefined ? '直线距离，非路线距离' : '等待定位') : '可以在 AI 助手里加一站'}
                </span>
              </span>
              <button className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-float disabled:opacity-40" disabled={!next}
                aria-label="在地图上定位下一站" onClick={() => next && (setSelectedId(next.id), setFocus({ point: next.place.location, key: Date.now() }))}>
                <Icon name="navigate" size={20} />
              </button>
            </div>
          )}
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="min-w-0 flex-1 truncate text-[19px] font-bold">第{activeDay + 1}天 · {dayLabel}</h1>
              <button className="round-btn !h-8 !w-8" aria-label="撤销" disabled={!ws?.undo.length || flow.proposeJob.running} onClick={() => undo(tripId).then(() => toast('已撤销'))}><Icon name="undo" size={16} /></button>
              <button className="round-btn !h-8 !w-8" aria-label="重做" disabled={!ws?.redo.length || flow.proposeJob.running} onClick={() => redo(tripId).then(() => toast('已重做'))}><Icon name="redo" size={16} /></button>
              <button className="round-btn !h-8 !w-8" aria-label={snap >= SNAPS[2] ? '收起面板' : '展开面板'} onClick={() => setSnap(snap >= SNAPS[2] ? SNAPS[1] : SNAPS[2])}><Icon name="expand" size={14} /></button>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[12.5px] text-ink-faint">{plan.destinationCity} · {dayActs.length} 站 · 交通 {totalTravel === undefined ? '部分待核验' : fmtMin(totalTravel)}</p>
              {!traveling && (
                <button className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium ${suggestTravel ? 'bg-brand text-white' : 'bg-brand-mist text-brand'}`} disabled={busySetting} onClick={() => setTravelAsk(true)} aria-label="开启旅行模式">
                  {busySetting ? <Spinner /> : suggestTravel ? '旅行日到了 · 开始旅行' : '开始旅行'}
                </button>
              )}
            </div>
          </div>
          {traveling && days.length > 1 && (
            <div className="flex rounded-[10px] bg-[#F2F4F7] p-0.5" role="tablist" aria-label="选择日期">
              {days.map((d) => (
                <button key={d.dayIndex} role="tab" aria-selected={d.dayIndex === activeDay} onClick={() => { setActiveDay(d.dayIndex); setSelectedId(undefined); }}
                  className={`h-8 flex-1 rounded-[8px] text-[13px] ${d.dayIndex === activeDay ? 'bg-white font-medium shadow-sm' : 'text-ink-soft'}`}>第{d.dayIndex + 1}天</button>
              ))}
            </div>
          )}
          {flow.proposeJob.running && (
            <div className="rounded-[14px] bg-[#F7F9FC] px-3.5 py-2.5">
              <div className="flex items-center gap-2 text-[13px] text-ink-soft"><Spinner className="text-brand" /> 正在计算修改影响…
                <button className="ml-auto text-brand" onClick={() => { flow.discard(); setTempOrder(undefined); }}>取消</button></div>
              {flow.proposeJob.progress.length > 0 && <div className="mt-2"><AgentProgress events={flow.proposeJob.progress} running /></div>}
            </div>
          )}
          {flow.proposeJob.error != null && !aiOpen && <ErrorBox error={flow.proposeJob.error} compact />}
          {pending && !previewOpen && (
            <button className="flex w-full items-center gap-2 rounded-[14px] bg-accent-soft px-3.5 py-2.5 text-[13.5px] text-accent" onClick={() => setPreviewOpen(true)}>
              <Icon name="info" size={16} /> 有一个未确认的修改<span className="ml-auto text-ink-faint">查看</span>
            </button>
          )}
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-[calc(24px+var(--safe-b))]"
          style={{ height: Math.max(0, sheetPx - headerH - 28) }}>
          <Timeline activities={dayActs} segments={daySegs} boundary={dayBoundary} intents={plan.intents} selectedId={selectedId}
            onSelect={setSelectedId} onOpen={setDetailId} onReorder={onReorder} onDragState={setDragging}
            traveling={traveling} onProgressTap={setCorrectId} locked={flow.proposeJob.running || flow.validateJob.running} tempOrder={!!tempOrder} />
        </div>
      </BottomSheet>

      {pending && previewOpen && <PreviewPanel pending={pending} current={rawPlan} flow={flow} onClosed={() => { setPreviewOpen(false); setTempOrder(undefined); }} />}
      {detailId && plan.activities.find((a) => a.id === detailId) && (
        <ActivityDetail a={plan.activities.find((a) => a.id === detailId)!} plan={plan} busy={flow.proposeJob.running}
          onClose={() => setDetailId(undefined)}
          onToggleLock={() => { const a = plan.activities.find((x) => x.id === detailId)!; setDetailId(undefined);
            guarded(() => proposeOps([{ type: 'UPDATE_CONSTRAINT', key: 'activityLocked', value: { activityId: a.id, locked: !a.locked } }], 'DETAIL')); }}
          onAskAI={() => { const a = plan.activities.find((x) => x.id === detailId)!; setSelectedId(a.id); setDetailId(undefined); setAiSeed({ text: `把「${a.place.name}」` }); setAiOpen(true); }}
          onExplain={() => { setSelectedId(detailId); setDetailId(undefined); setAiSeed({ action: 'EXPLAIN' }); setAiOpen(true); }}
          onShowOnMap={() => { const a = plan.activities.find((x) => x.id === detailId)!; setSelectedId(a.id); setDetailId(undefined); setSnap(SNAPS[0]); setFocus({ point: a.place.location, key: Date.now() }); }} />
      )}
      <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} tripId={tripId} plan={plan} ctx={ctx} flow={flow} seed={aiSeed}
        me={traveling ? travel.me?.location : undefined} onPreview={() => { setAiOpen(false); setPreviewOpen(true); }} />
      {contentView && (
        <ContentModal tripId={tripId} plan={plan} title={contentView.title} intentId={contentView.intentId}
          ctx={{ ...ctx, selectedActivityId: contentView.activityId ?? ctx.selectedActivityId, selectedPoiId: plan.activities.find((a) => a.id === contentView.activityId)?.place.poiId ?? ctx.selectedPoiId }}
          contents={(ws?.contents ?? []).filter((c) => contentView.ids.includes(c.contentId) || (!!contentView.intentId && c.intentId === contentView.intentId))}
          onClose={() => setContentView(undefined)} />
      )}
      {demoOpen && <DemoConsole tripId={tripId} plan={plan} travelDay={activeDay} travel={travel} onClose={() => setDemoOpen(false)} />}

      <Modal open={travelAsk} onClose={() => setTravelAsk(false)} title="开启旅行模式"
        footer={<div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => setTravelAsk(false)}>暂不</button>
          <button className="btn-primary flex-[1.5]" onClick={async () => { setTravelAsk(false); await toggleTravel(true); }}>开启并请求定位</button></div>}>
        <div className="space-y-2 text-[14px] leading-relaxed text-ink-soft">
          <p>开启后浏览器会询问位置权限。位置只在<b className="text-ink">页面处于前台时</b>用于判断到达/离开，判断在本机完成，不会持续上传轨迹。</p>
          <p>网页在后台或锁屏时无法保证持续定位；回到页面后会重新测量。你可以随时退出旅行模式停止定位。</p>
          <p>拒绝定位也可以继续查看和编辑行程。</p>
        </div>
      </Modal>
      <Modal open={!!replaceAsk} onClose={() => setReplaceAsk(undefined)} title="替换未确认的修改？"
        footer={<div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => setReplaceAsk(undefined)}>保留原草稿</button>
          <button className="btn-primary flex-1" onClick={async () => { const f = replaceAsk; setReplaceAsk(undefined); await flow.discard(); f?.(); }}>替换</button></div>}>
        <p className="text-[14px] text-ink-soft">同一时间只能有一个待确认的修改。替换后，之前的草稿将被丢弃。</p>
      </Modal>
      <Modal open={!!correctId} onClose={() => setCorrectId(undefined)} title="纠正到达状态">
        <p className="mb-3 text-[13.5px] text-ink-soft">自动推断可能有误。当前：{PROGRESS_LABEL[plan.activities.find((a) => a.id === correctId)?.progress ?? 'NOT_STARTED']}</p>
        <div className="grid gap-2">
          {(['NOT_STARTED', 'VISITING', 'INFERRED_COMPLETE'] as ActivityProgress[]).map((p) => (
            <button key={p} className="btn-soft" onClick={() => { travel.correct(correctId!, p); setCorrectId(undefined); toast('已记录纠正'); }}>{PROGRESS_LABEL[p]}</button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
