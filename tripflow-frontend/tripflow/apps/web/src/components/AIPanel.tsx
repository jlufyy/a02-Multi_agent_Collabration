import { useCallback, useEffect, useRef, useState } from 'react';
import type { TripState, SelectedContext, PreparedContent, Place, NearbyCandidate, GeoPoint, ConversationMessage, ItineraryActivity, ContentsResultLike } from './aiTypes';
import { jobs } from '../api/client';
import { useJob } from '../lib/useJob';
import { useTrips, execCtx, activeWs } from '../store/tripStore';
import type { useEditFlow } from '../lib/useEditFlow';
import { AgentProgress } from './AgentProgress';
import { ErrorBox } from './ui';
import { Logo, PlaceThumb } from './Illustrations';
import { Icon } from './Icon';
import { ContentCard } from './ContentViewer';
import { uid } from '../lib/id';
import { planTime, planDate } from '../lib/time';
import { useNarration } from '../lib/useNarration';

type Msg =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string }
  | { id: string; role: 'content'; content: PreparedContent }
  | { id: string; role: 'clarify'; questions: string[]; candidates: Place[] }
  | { id: string; role: 'nearby'; category: string; candidates: NearbyCandidate[]; partialNote?: string };

/** P10 全局 AI：自动携带当前上下文；修改类结果一律进入预览，内容类直接展示，澄清让用户选择。 */
export function AIPanel({ open, onClose, tripId, plan, ctx, flow, seed, me, onPreview }: {
  open: boolean; onClose: () => void; tripId: string; plan: TripState; ctx: SelectedContext;
  flow: ReturnType<typeof useEditFlow>; seed?: { text?: string; action?: 'EXPLAIN' | 'NEARBY_FOOD' }; me?: GeoPoint; onPreview: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [showQuick, setShowQuick] = useState(false);
  const contentJob = useJob<ContentsResultLike>(tripId);
  const nearbyJob = useJob<{ candidates: NearbyCandidate[] }>(tripId);
  const trip = useTrips((s) => s.trips[tripId]);
  const scroller = useRef<HTMLDivElement>(null);
  const selected = plan.activities.find((a) => a.id === ctx.selectedActivityId);
  const savedContents = (activeWs(trip)?.contents ?? []).filter((c) => !selected || c.activityId === selected.id).slice(-6);
  const running = flow.proposeJob.running || flow.validateJob.running || contentJob.running || nearbyJob.running;
  const lastSeed = useRef<typeof seed>();
  const voice = useNarration();
  const [voiceOn, setVoiceOn] = useState(true);
  const voiceEnabled = useRef(true);
  const guideScope = useRef(0);
  const cancelContent = contentJob.cancel;
  const stopVoice = voice.stop;
  const invalidateGuide = useCallback(() => {
    guideScope.current++;
    cancelContent(); stopVoice();
  }, [cancelContent, stopVoice]);

  useEffect(() => {
    invalidateGuide();
    return invalidateGuide;
  }, [open, tripId, ctx.selectedActivityId, plan.revision, invalidateGuide]);

  useEffect(() => { scroller.current?.scrollTo({ top: 1e6, behavior: 'smooth' }); }, [msgs, running]);
  useEffect(() => {
    if (!open || !seed || seed === lastSeed.current) return;
    let disposed = false;
    queueMicrotask(() => {
      if (disposed || lastSeed.current === seed) return;
      lastSeed.current = seed;
      if (seed.text) setText(seed.text);
      if (seed.action === 'EXPLAIN') explain();
      if (seed.action === 'NEARBY_FOOD') nearby('FOOD');
    });
    return () => { disposed = true; };
  }, [open, seed]); // eslint-disable-line react-hooks/exhaustive-deps

  const push = (m: Msg) => setMsgs((x) => [...x, m]);
  const conversation = (): ConversationMessage[] => msgs.flatMap((m): ConversationMessage[] =>
    m.role === 'user' ? [{ role: 'user', content: m.text }] : m.role === 'assistant' ? [{ role: 'assistant', content: m.text }]
      : m.role === 'content' ? [{ role: 'assistant', content: m.content.body.slice(0, 1800) }] : []).slice(-10);

  async function showContent(c: PreparedContent, scope: number) {
    if (scope !== guideScope.current) return;
    push({ id: uid('m'), role: 'content', content: c });
    if (c.deliveryMode === 'GUIDE' && voiceEnabled.current) voice.start(c.contentId, c.body);
    await useTrips.getState().putContents(tripId, [c]).catch(() => contentJob.setError(new Error('讲解已生成，但未能保存到本机。')));
  }

  async function send(raw?: string) {
    const q = (raw ?? text).trim();
    if (!q || running) return;
    setText('');
    voice.stop();
    const scope = guideScope.current;
    push({ id: uid('m'), role: 'user', text: q });
    const r = await flow.propose({ userRequest: q, origin: 'AI', selectedContext: ctx, conversation: conversation() });
    if (!r) return;
    if (r.kind === 'REVISION') {
      if (activeWs(useTrips.getState().trips[tripId])?.pending?.directApply) {
        if (await flow.confirm(false)) {
          push({ id: uid('m'), role: 'assistant', text: '已按你的明确要求调整时长，校验通过。可在行程页整体撤销本次调整。' });
          return;
        }
      }
      push({ id: uid('m'), role: 'assistant', text: `已生成修改方案（${r.proposal.operations.length} 项操作），请在预览中确认。在确认前，正式行程不会改变。` });
      onPreview();
    } else if (r.kind === 'CONTENT') {
      await showContent(r.content, scope);
    } else {
      push({ id: uid('m'), role: 'clarify', questions: r.questions, candidates: r.candidates });
    }
  }

  async function askGuide(question: string, previous?: PreparedContent) {
    if (running) return;
    if (!selected) { push({ id: uid('m'), role: 'assistant', text: '请先在地图或时间轴上选中一个地点，再让我讲解。' }); return; }
    voice.stop();
    const scope = guideScope.current;
    push({ id: uid('m'), role: 'user', text: previous ? question : `讲解这里：${selected.place.name}` });
    const t = useTrips.getState().trips[tripId];
    const out = await contentJob.run((h) => jobs.refineContent({ ...execCtx(t), tripId, baseRevision: plan.revision, tripState: plan, userRequest: question, preparedContent: previous, context: ctx }, h));
    if (out?.result) {
      await showContent(out.result.content, scope);
    }
  }
  const explain = () => askGuide('讲解这里');

  async function nearby(category: 'FOOD' | 'REST' | 'PHOTO') {
    const anchor = selected ?? plan.activities.find((a) => a.dayIndex === ctx.activeDay);
    const location = me ?? anchor?.place.location;
    const label = { FOOD: '美食', REST: '休息', PHOTO: '拍照' }[category];
    if (!location) { push({ id: uid('m'), role: 'assistant', text: '没有可用的位置：请开启旅行定位或先选中一个地点。' }); return; }
    push({ id: uid('m'), role: 'user', text: `附近${label}${me ? '（当前位置）' : anchor ? `（${anchor.place.name} 周边）` : ''}` });
    const t = useTrips.getState().trips[tripId];
    const out = await nearbyJob.run((h) => jobs.nearby({ ...execCtx(t), tripId, baseRevision: plan.revision, tripState: plan, location, category, preferences: plan.preferences, selectedContext: ctx }, h));
    if (!out?.result) return;
    push({ id: uid('m'), role: 'nearby', category: label, candidates: out.result.candidates,
      partialNote: out.status === 'PARTIAL' ? (out.errors.map((e) => e.message).join('；') || '结果不完整') : undefined });
  }

  async function addNearby(c: NearbyCandidate) {
    const day = plan.activities.filter((a) => a.dayIndex === ctx.activeDay).sort((a, b) => a.orderIndex - b.orderIndex);
    const anchor = selected && selected.dayIndex === ctx.activeDay ? selected : day[day.length - 1];
    const start = anchor ? anchor.endAt : `${planDate(plan.startDate, ctx.activeDay)}T12:00:00+08:00`;
    const end = planTime(Date.parse(start) + 60 * 60_000);
    const activity: ItineraryActivity = {
      id: uid('act'), place: c.place, dayIndex: ctx.activeDay, orderIndex: anchor ? anchor.orderIndex + 1 : 0,
      startAt: start, endAt: end, estimatedCostCny: c.estimatedCostCny, costStatus: c.costStatus,
      locked: false, mandatory: false, progress: 'NOT_STARTED', intentIds: [],
    };
    push({ id: uid('m'), role: 'user', text: `把「${c.place.name}」加入行程` });
    const r = await flow.propose({ operations: [{ type: 'ADD', activity }], origin: 'NEARBY', selectedContext: ctx });
    if (r?.kind === 'REVISION') { push({ id: uid('m'), role: 'assistant', text: '已生成加入方案，请在预览中确认。' }); onPreview(); }
  }

  if (!open) return null;
  const quick = [
    ...(selected ? [{ label: '讲解这里', run: explain }, { label: '修改此站', run: () => setText(`把「${selected.place.name}」`) }] : []),
    { label: '附近美食', run: () => nearby('FOOD') },
    { label: '附近休息', run: () => nearby('REST') },
    { label: '附近拍照点', run: () => nearby('PHOTO') },
    { label: `调整第${ctx.activeDay + 1}天下午`, run: () => setText(`第${ctx.activeDay + 1}天下午`) },
  ];
  const suggestions: { label: string; run: () => void }[] = [
    { label: '附近有什么好吃的？', run: () => nearby('FOOD') },
    { label: `帮我把第${ctx.activeDay + 1}天的行程安排得轻松一些`, run: () => send(`帮我把第${ctx.activeDay + 1}天的行程安排得轻松一些`) },
    ...(selected ? [{ label: `讲讲「${selected.place.name}」`, run: explain }] : []),
  ];
  const err = flow.proposeJob.error ?? contentJob.error ?? nearbyJob.error;

  return (
    <div className="animate-rise fixed inset-0 z-[55] mx-auto flex max-w-[560px] flex-col bg-white" role="dialog" aria-label="AI 助手">
      <header className="flex items-center gap-3 px-4 pb-2 pt-[calc(14px+var(--safe-t))]">
        <button className="flex h-10 w-8 items-center justify-center" onClick={onClose} aria-label="关闭"><Icon name="back" /></button>
        <Logo size={30} />
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold leading-tight">TripFlow AI</p>
          <p className="truncate text-[12px] text-ink-faint">你的旅行助手 · 第{ctx.activeDay + 1}天{selected ? ` · 选中：${selected.place.name}` : ''}{trip?.demo ? ' · 演示' : ''}</p>
        </div>
        <button className="shrink-0 text-[12px] text-brand" aria-label={voiceOn ? '关闭自动语音讲解' : '开启自动语音讲解'} aria-pressed={voiceOn}
          onClick={() => { voiceEnabled.current = !voiceOn; setVoiceOn(!voiceOn); if (voiceOn) voice.stop(); }}>{voiceOn ? '语音开' : '语音关'}</button>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {msgs.length === 0 && (
          <div className="space-y-2.5">
            {suggestions.map((s) => (
              <button key={s.label} disabled={running} onClick={s.run}
                className="block w-fit max-w-full rounded-[16px] bg-[#F3F5F8] px-4 py-2.5 text-left text-[14px] text-ink-soft">{s.label}</button>
            ))}
            <p className="pt-2 text-[12.5px] leading-relaxed text-ink-faint">可以一句话批量修改。明确、可行且只影响本站的小幅时长调整会直接应用并支持撤销；其他变动统一预览后确认一次。</p>
          </div>
        )}
        {msgs.length === 0 && savedContents.length > 0 && <details className="space-y-3" aria-label="已保存材料"><summary className="text-[13px] text-ink-faint">已保存内容（{savedContents.length}）</summary>{savedContents.map((c) => <ContentCard key={c.contentId} c={c} stale={c.baseRevision !== plan.revision} />)}</details>}
        {msgs.map((m) => <Bubble key={m.id} m={m} onPick={(p) => send(`用「${p.name}」`)} onAdd={addNearby} busy={running} />)}
        {msgs.at(-1)?.role === 'content' && (() => {
          const last = msgs.at(-1);
          return last?.role === 'content' && last.content.deliveryMode === 'GUIDE' && last.content.activityId === selected?.id
            ? <div className="flex flex-wrap gap-2 pl-7">{['多讲讲历史', '讲讲建筑细节', '再简短一点'].map((q) => <button key={q} disabled={running} className="chip bg-brand-mist !px-3 !py-2 text-brand" onClick={() => askGuide(q, last.content)}>{q}</button>)}</div> : null;
        })()}
        {running && <AgentProgress events={[...flow.proposeJob.progress, ...contentJob.progress, ...nearbyJob.progress]} running />}
        {err != null && <ErrorBox error={err} compact />}
      </div>
      {showQuick && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-2">
          {quick.map((q) => <button key={q.label} disabled={running} onClick={() => { setShowQuick(false); q.run(); }} className="shrink-0 rounded-full bg-brand-mist px-3.5 py-2 text-[13px] text-brand disabled:opacity-40">{q.label}</button>)}
        </div>
      )}
      <form className="flex items-end gap-2 px-4 pb-[calc(12px+var(--safe-b))] pt-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <div className="flex flex-1 items-end gap-1 rounded-[24px] bg-[#F3F5F8] px-2 py-1.5">
          <button type="button" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${showQuick ? 'rotate-45 text-brand' : 'text-ink-soft'}`}
            onClick={() => setShowQuick(!showQuick)} aria-label="快捷操作"><Icon name="plus" size={20} /></button>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="继续追问，或告诉我想怎么安排行程…" aria-label="向 AI 提问"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-ink-faint" />
        </div>
        {running
          ? <button type="button" className="h-11 shrink-0 rounded-full bg-[#F2F4F7] px-4 text-[14px]" onClick={() => { guideScope.current++; voice.stop(); flow.proposeJob.cancel(); flow.validateJob.cancel(); contentJob.cancel(); nearbyJob.cancel(); }}>停止</button>
          : <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white disabled:opacity-40" disabled={!text.trim()} aria-label="发送"><Icon name="send" size={18} /></button>}
      </form>
    </div>
  );
}

function Bubble({ m, onPick, onAdd, busy }: { m: Msg; onPick: (p: Place) => void; onAdd: (c: NearbyCandidate) => void; busy: boolean }) {
  if (m.role === 'user') return <div className="ml-auto w-fit max-w-[80%] rounded-[18px] rounded-br-[6px] bg-brand px-4 py-2.5 text-[14.5px] text-white">{m.text}</div>;
  if (m.role === 'assistant') return (
    <div className="flex items-start gap-2"><span className="mt-1"><Logo size={20} /></span><div className="max-w-[85%] rounded-[18px] rounded-tl-[6px] bg-[#F3F5F8] px-4 py-2.5 text-[14.5px]">{m.text}</div></div>
  );
  if (m.role === 'content') return <ContentCard c={m.content} />;
  if (m.role === 'clarify') return (
    <div className="rounded-[18px] bg-[#F3F5F8] p-3.5">
      {m.questions.map((q, i) => <p key={i} className="text-[14.5px]">{q}</p>)}
      <div className="mt-2 space-y-1.5">{m.candidates.map((p) => (
        <button key={p.poiId} disabled={busy} onClick={() => onPick(p)} className="flex w-full items-center gap-2 rounded-[12px] bg-white p-2.5 text-left text-[14px]">
          <PlaceThumb name={p.name} size={36} rounded={10} /><span className="flex-1">{p.name}<span className="block text-[12px] text-ink-faint">{p.address}</span></span>
        </button>
      ))}</div>
    </div>
  );
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium"><Logo size={18} /> 为你推荐附近的{m.category}<span className="font-normal text-ink-faint">（{m.candidates.length} 个{m.candidates.length < 2 ? '，数量不足未补凑' : ''}）</span></p>
      {m.partialNote && <p className="mb-2 text-[12.5px] text-warn">{m.partialNote}</p>}
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
        {m.candidates.map((c) => (
          <div key={c.place.poiId} className="w-[150px] shrink-0">
            <PlaceThumb name={c.place.name} size={150} rounded={14} />
            <p className="mt-1.5 truncate text-[14px] font-medium">{c.place.name}</p>
            <p className="truncate text-[12px] text-ink-faint">
              {c.place.rating?.value !== undefined ? `★ ${c.place.rating.value}${c.place.rating.evidence.status !== 'VERIFIED' ? '(未核验)' : ''} · ` : ''}
              {c.distanceMeters !== undefined ? `${c.distanceMeters >= 1000 ? (c.distanceMeters / 1000).toFixed(1) + 'km' : Math.round(c.distanceMeters) + 'm'}${c.distanceEvidence.status !== 'VERIFIED' ? '(估)' : ''}` : '距离未知'}
            </p>
            <p className="line-clamp-2 text-[11.5px] text-ink-faint">{c.relevanceReason}</p>
            <button disabled={busy} className="mt-1.5 h-8 w-full rounded-full bg-brand-mist text-[13px] text-brand" onClick={() => onAdd(c)}>加入行程</button>
          </div>
        ))}
      </div>
    </div>
  );
}
