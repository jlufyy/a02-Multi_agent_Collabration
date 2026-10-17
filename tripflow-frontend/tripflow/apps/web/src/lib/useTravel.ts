import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  NormalizedLocationEvent, ProactiveEvent, NotificationRecord, EventLogEntry, GeoPoint, TripState, NotificationAction, Evidence,
} from '@tripflow/contracts';
import {
  stepGeo, initialEngineState, INTERIM_GEO_POLICY, checkShow, sortQueue, relevantRecords, type EngineState, type QueuedCard,
} from '@tripflow/context-engine';
import { useTrips, activeWs, execCtx } from '../store/tripStore';
import { projectPlan } from '../store/planOps';
import { jobs, describeError } from '../api/client';
import { uid, nowIso } from './id';
import { toast } from '../components/ui';

const EMPTY_QUEUE: QueuedCard[] = [];

export type LocStatus = 'off' | 'requesting' | 'active' | 'denied' | 'unsupported' | 'low_accuracy' | 'hidden' | 'error' | 'simulated';

/** 合并同一 notificationId 的多条事实日志，得到当前通知记录。 */
export function notificationRecords(log: EventLogEntry[]): NotificationRecord[] {
  const m = new Map<string, NotificationRecord>();
  for (const e of log) if (e.notification) m.set(e.notification.notificationId, { ...m.get(e.notification.notificationId), ...e.notification });
  return [...m.values()];
}

/**
 * 旅行模式运行时（P08/P09）：前台定位 → 共享状态机 → 事实日志 → 轻量过滤 → A6 评估 → 本地队列 → 显示前最终检查。
 * 真实 GPS 与模拟输入互斥；模拟样本带 SIMULATED + demoRunId，写入演示副本。
 */
export function useTravel(tripId: string, travelDay: number) {
  const trip = useTrips((s) => s.trips[tripId]);
  const caps = useTrips((s) => s.capabilities);
  const queue = useTrips((s) => s.queues[tripId] ?? EMPTY_QUEUE);
  const activeCard = useTrips((s) => s.active[tripId]);
  const policy = caps?.geoPolicy ?? INTERIM_GEO_POLICY;
  const ws = activeWs(trip);
  const plan = ws?.plan;
  const traveling = plan?.mode === 'TRAVELING';
  const demo = trip?.demo;
  const [status, setStatus] = useState<LocStatus>('off');
  const [me, setMe] = useState<{ location: GeoPoint; accuracy?: number; simulated: boolean }>();
  const [evalError, setEvalError] = useState<string>();
  const busyRef = useRef(false);
  const [busyTick, setBusyTick] = useState(0);
  const watchId = useRef<number>();
  const lastReal = useRef<NormalizedLocationEvent>();

  const setUiBusy = useCallback((b: boolean) => { if (busyRef.current !== b) { busyRef.current = b; setBusyTick((x) => x + 1); } }, []);

  // ---------- 事件处理 ----------
  const evaluate = useCallback(async (ev: ProactiveEvent, p: TripState) => {
    const st = useTrips.getState();
    const t = st.trips[tripId]; const w = activeWs(t);
    if (!t || !w) return;
    const pol = p.notificationPolicy;
    const ordinaryOn = !pol.paused && (pol.enableL1 || pol.enableL2);
    if (ev.type === 'RISK' ? !pol.enableL3 : !ordinaryOn && !pol.enableL3) return; // 全部关闭：不唤醒 Agent
    const act = p.activities.find((a) => a.id === ev.activityId);
    const recs = notificationRecords(w.eventLog);
    try {
      const h = jobs.evaluate({
        ...execCtx(t), tripId, baseRevision: p.revision, tripState: p, currentEvent: ev, uiBusy: busyRef.current,
        recentNotifications: relevantRecords(recs, { arrivalId: ev.arrivalId, intentIds: act?.intentIds ?? [], now: new Date(), cooldownMinutes: pol.cooldownMinutes }),
      }, { limits: caps?.limits });
      const out = await h.promise;
      const cur = activeWs(useTrips.getState().trips[tripId])?.plan;
      if (!out.result || !cur || cur.revision !== p.revision) return; // 计划已变：丢弃旧决策
      const { decision, contents } = out.result;
      if (decision.tripId !== tripId || decision.eventId !== ev.eventId) return;
      if (contents.length) await useTrips.getState().putContents(tripId, contents).catch(() => undefined);
      if (!decision.shouldNotify || !decision.card) {
        useTrips.getState().appendLog(tripId, [{
          logId: uid('log'), tripId, tripRevision: p.revision, source: ev.source, demoRunId: ev.demoRunId, occurredAt: nowIso(),
          notification: { notificationId: uid('ntf'), eventId: ev.eventId, tripRevision: p.revision, source: ev.source, demoRunId: ev.demoRunId,
            arrivalId: ev.arrivalId, activityId: ev.activityId, riskCode: ev.risk?.code, level: 'L1', decision: 'SUPPRESSED_BY_AGENT', suppressionReason: decision.suppressionReason ?? decision.reasonCode },
        }]);
        return;
      }
      useTrips.getState().enqueue(tripId, {
        decision: decision as QueuedCard['decision'], eventSource: ev.source, demoRunId: ev.demoRunId,
        arrivalId: ev.arrivalId, riskCode: ev.risk?.code, enqueuedAt: nowIso(),
      });
      setEvalError(undefined);
    } catch (e) {
      setEvalError(`主动服务评估失败：${describeError(e).title}`);
    }
  }, [tripId, caps?.limits]);

  const handleEvents = useCallback((raw: Omit<ProactiveEvent, 'eventId' | 'revision'>[], p: TripState) => {
    if (!raw.length) return;
    const events: ProactiveEvent[] = raw.map((e) => ({ ...e, eventId: uid('ev'), revision: p.revision }));
    useTrips.getState().appendLog(tripId, events.map((e) => ({
      logId: uid('log'), tripId, tripRevision: p.revision, source: e.source, demoRunId: e.demoRunId, occurredAt: e.occurredAt, event: e,
    })));
    for (const e of events) {
      const name = p.activities.find((a) => a.id === e.activityId)?.place.name;
      if (e.type === 'ARRIVE') toast(`已到达 ${name ?? ''}`, 'ok');
      if (e.type === 'LEAVE') toast(`推定已离开 ${name ?? ''}（可纠正）`);
      if (e.type === 'ARRIVE' || e.type === 'RISK') evaluate(e, p);
    }
  }, [tripId, evaluate]);

  /** 输入一个归一化样本：只跟踪当前站与下一站（偏离计划时不静默完成无关活动）。 */
  const feed = useCallback((sample: NormalizedLocationEvent) => {
    const t = useTrips.getState().trips[tripId]; const w = activeWs(t);
    if (!t || !w?.plan) return { notes: ['NO_PLAN'] };
    const p = projectPlan(w.plan, w);
    const day = p.activities.filter((a) => a.dayIndex === travelDay).sort((a, b) => a.orderIndex - b.orderIndex);
    const live = day.filter((a) => a.progress !== 'INFERRED_COMPLETE');
    const inProgress = day.filter((a) => ['ARRIVED', 'VISITING', 'LOCATION_UNKNOWN'].includes(a.progress));
    const targets = [...new Map([...inProgress, ...live.slice(0, 2)].map((a) => [a.id, a])).values()];
    const geo = [...w.geo];
    const out: Omit<ProactiveEvent, 'eventId' | 'revision'>[] = [];
    const notes: string[] = [];
    for (const a of targets) {
      const i = geo.findIndex((g) => g.activityId === a.id && g.source === sample.source && g.demoRunId === sample.demoRunId);
      const prev: EngineState = i >= 0 ? geo[i] : initialEngineState(tripId, a.id, sample.source, sample.demoRunId);
      const r = stepGeo(prev, sample, { activityId: a.id, location: a.place.location }, policy, () => uid('arr'));
      if (i >= 0) geo[i] = r.state; else geo.push(r.state);
      out.push(...r.events); if (r.note) notes.push(r.note);
    }
    // 同一时刻若多个候选同时“到达”，只保留顺序靠前的那个（重叠围栏）
    const arrivals = out.filter((e) => e.type === 'ARRIVE');
    const keep = arrivals.length > 1 ? new Set([arrivals[0]]) : null;
    const events = keep ? out.filter((e) => e.type !== 'ARRIVE' || keep.has(e)) : out;
    useTrips.getState().setGeo(tripId, geo);
    setMe({ location: sample.location, accuracy: sample.accuracyMeters, simulated: sample.source === 'SIMULATED' });
    handleEvents(events, p);
    return { notes, events };
  }, [tripId, travelDay, policy, handleEvents]);

  /** 风险事件（演示：带 SIMULATED 标签与证据）。真实模式不接受模拟风险。 */
  const injectRisk = useCallback((risk: { code: string; message: string; activityIds: string[]; evidence: Evidence[] }, occurredAt: string) => {
    const t = useTrips.getState().trips[tripId]; const w = activeWs(t);
    if (!t?.demo || !w?.plan) return;
    handleEvents([{ tripId, source: 'SIMULATED', demoRunId: t.demo.demoRunId, type: 'RISK', activityId: risk.activityIds[0], occurredAt, risk }], w.plan);
  }, [tripId, handleEvents]);

  // ---------- 真实定位（仅前台，用户开启旅行模式后） ----------
  const stopWatch = useCallback(() => {
    if (watchId.current !== undefined) navigator.geolocation?.clearWatch(watchId.current);
    watchId.current = undefined;
  }, []);
  const toSample = useCallback((pos: GeolocationPosition, visible: boolean): NormalizedLocationEvent => ({
    sampleId: uid('smp'), tripId, source: 'REAL',
    location: { lat: pos.coords.latitude, lng: pos.coords.longitude, coordinateSystem: 'WGS84' },
    accuracyMeters: pos.coords.accuracy, timestamp: new Date(pos.timestamp).toISOString(), pageVisible: visible,
    speedMetersPerSecond: pos.coords.speed ?? undefined,
  }), [tripId]);

  const startWatch = useCallback(() => {
    if (!('geolocation' in navigator)) { setStatus('unsupported'); return; }
    if (!window.isSecureContext) { setStatus('unsupported'); return; }
    stopWatch();
    setStatus('requesting');
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const s = toSample(pos, document.visibilityState === 'visible');
        lastReal.current = s;
        setStatus(s.accuracyMeters > policy.maxAccuracyMeters ? 'low_accuracy' : 'active');
        feed(s);
      },
      (err) => { setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'error'); if (err.code === err.PERMISSION_DENIED) stopWatch(); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }, [feed, policy.maxAccuracyMeters, stopWatch, toSample]);

  // 进入/退出演示：清掉上一来源的位置与状态，避免模拟位置残留到真实模式（E16）
  const demoRunId = demo?.demoRunId;
  useEffect(() => {
    setMe(undefined);
    lastReal.current = undefined;
    setStatus(demoRunId ? 'simulated' : 'off');
  }, [demoRunId]);
  useEffect(() => {
    if (traveling && !demo && watchId.current === undefined && status === 'off') startWatch();
    if ((!traveling || demo) && watchId.current !== undefined) { stopWatch(); setStatus(demo ? 'simulated' : 'off'); }
    if (demo) setStatus('simulated');
  }, [traveling, demo, startWatch, stopWatch, status]);
  useEffect(() => () => stopWatch(), [stopWatch]);

  // 页面隐藏：暂停推断（不补造轨迹）；回到前台：重新采样
  useEffect(() => {
    if (!traveling || demo) return;
    const on = () => {
      if (document.visibilityState === 'hidden') {
        setStatus('hidden');
        if (lastReal.current) feed({ ...lastReal.current, sampleId: uid('smp'), pageVisible: false, timestamp: nowIso() });
      } else {
        navigator.geolocation?.getCurrentPosition((pos) => { const s = toSample(pos, true); lastReal.current = s; setStatus('active'); feed(s); }, () => undefined, { enableHighAccuracy: true, timeout: 15000 });
      }
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [traveling, demo, feed, toSample]);

  // ---------- 队列显示（显示前最终检查） ----------
  const [tick, setTick] = useState(0);
  useEffect(() => { const h = setInterval(() => setTick((x) => x + 1), 15000); return () => clearInterval(h); }, []);
  useEffect(() => {
    if (activeCard || !queue.length || !plan) return;
    const recs = notificationRecords(ws?.eventLog ?? []);
    const sorted = sortQueue(queue);
    const keep: QueuedCard[] = [];
    let show: QueuedCard | undefined;
    const logs: EventLogEntry[] = [];
    for (const q of sorted) {
      if (show) { keep.push(q); continue; }
      const r = checkShow(q, recs, plan.notificationPolicy, { now: new Date(), uiBusy: busyRef.current, currentRevision: plan.revision, activityExists: (id) => !!plan.activities.find((a) => a.id === id) });
      if (r.ok) { show = q; continue; }
      if (r.defer) { keep.push(q); continue; }
      const c = q.decision.card;
      logs.push({ logId: uid('log'), tripId, tripRevision: plan.revision, source: q.eventSource, demoRunId: q.demoRunId, occurredAt: nowIso(),
        notification: { notificationId: uid('ntf'), eventId: q.decision.eventId, tripRevision: plan.revision, source: q.eventSource, demoRunId: q.demoRunId,
          arrivalId: q.arrivalId, activityId: c.activityId, intentId: c.intentId, riskCode: q.riskCode, level: c.level, decision: 'SUPPRESSED_LOCAL', suppressionReason: r.reason } });
    }
    if (show) {
      const c = show.decision.card;
      logs.push({ logId: uid('log'), tripId, tripRevision: plan.revision, source: show.eventSource, demoRunId: show.demoRunId, occurredAt: nowIso(),
        notification: { notificationId: c.cardId, eventId: show.decision.eventId, tripRevision: plan.revision, source: show.eventSource, demoRunId: show.demoRunId,
          arrivalId: show.arrivalId, activityId: c.activityId, intentId: c.intentId, riskCode: show.riskCode, contentId: c.contentIds[0], level: c.level, decision: 'SHOWN', shownAt: nowIso() } });
    }
    if (logs.length) useTrips.getState().appendLog(tripId, logs);
    useTrips.getState().setQueue(tripId, keep, show);
  }, [queue, activeCard, plan, ws?.eventLog, tick, busyTick, tripId]);

  const respond = useCallback((action: NotificationAction, snoozeMinutes?: number) => {
    const q = useTrips.getState().active[tripId];
    if (!q || !plan) return;
    const c = q.decision.card;
    const snoozeUntil = action === 'REMIND_LATER' && snoozeMinutes ? new Date(Date.now() + snoozeMinutes * 60_000).toISOString() : undefined;
    useTrips.getState().appendLog(tripId, [{
      logId: uid('log'), tripId, tripRevision: plan.revision, source: q.eventSource, demoRunId: q.demoRunId, occurredAt: nowIso(),
      notification: { notificationId: c.cardId, eventId: q.decision.eventId, tripRevision: plan.revision, source: q.eventSource, demoRunId: q.demoRunId,
        arrivalId: q.arrivalId, activityId: c.activityId, intentId: c.intentId, riskCode: q.riskCode, level: c.level, decision: 'SHOWN',
        actionTaken: action, actionAt: nowIso(), snoozeUntil },
    }]);
    const rest = useTrips.getState().queues[tripId] ?? [];
    useTrips.getState().setQueue(tripId, snoozeUntil ? [...rest, { ...q, snoozeUntil }] : rest, undefined);
  }, [tripId, plan]);

  /** 用户纠正自动推断（记 USER_CORRECTION，重新投影）。 */
  const correct = useCallback((activityId: string, next: EngineState['progress']) => {
    const t = useTrips.getState().trips[tripId]; const w = activeWs(t);
    if (!t || !w?.plan) return;
    const source = t.demo ? 'SIMULATED' as const : 'REAL' as const;
    const geo = [...w.geo];
    const i = geo.findIndex((g) => g.activityId === activityId && g.demoRunId === t.demo?.demoRunId);
    const prev = i >= 0 ? geo[i] : initialEngineState(tripId, activityId, source, t.demo?.demoRunId);
    const ns: EngineState = { ...prev, progress: next, candidateSince: undefined, outsideSince: undefined, insideSamples: 0, outsideSamples: 0 };
    if (i >= 0) geo[i] = ns; else geo.push(ns);
    useTrips.getState().setGeo(tripId, geo);
    useTrips.getState().appendLog(tripId, [{ logId: uid('log'), tripId, tripRevision: w.plan.revision, source: 'USER_CORRECTION', demoRunId: t.demo?.demoRunId, occurredAt: nowIso(),
      correction: { activityId, previous: prev.progress, next, reason: '用户手动纠正' } }]);
  }, [tripId]);

  const projected = useMemo(() => (plan && ws ? projectPlan(plan, ws) : undefined), [plan, ws]);
  return { status, me, feed, injectRisk, activeCard, respond, correct, setUiBusy, evalError, projected, startWatch, stopWatch, policy, execCtx: trip ? execCtx(trip) : undefined };
}
