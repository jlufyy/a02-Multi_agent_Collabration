import { useEffect, useState } from 'react';
import type { PreparedContent, TripState, SelectedContext } from '@tripflow/contracts';
import { Modal, EvidenceList, ErrorBox, fmtDateTime } from './ui';
import { AgentProgress } from './AgentProgress';
import { Icon } from './Icon';
import { jobs } from '../api/client';
import { useJob } from '../lib/useJob';
import { useTrips, execCtx } from '../store/tripStore';
import { useNarration } from '../lib/useNarration';
import { Logo } from './Illustrations';

export function GuideMessage({ c, stale }: { c: PreparedContent; stale?: boolean }) {
  const voice = useNarration();
  const active = voice.contentId === c.contentId;
  const status = active ? voice.status : 'idle';
  return <div className="flex items-start gap-2" aria-label="AI 导游讲解">
    <span className="mt-1 shrink-0"><Logo size={22} /></span>
    <div className="min-w-0 flex-1 space-y-3 rounded-[18px] rounded-tl-[6px] bg-[#F3F5F8] p-4">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-brand">
        <span className="font-medium">AI 导游</span>
        <span role="status">{status === 'playing' ? '正在讲解' : status === 'paused' ? '已暂停' : status === 'loading' ? '正在准备语音…' : '语音讲解'}</span>
        {stale && <span className="text-warn">来自旧版行程</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {status === 'playing' ? <button className="btn-soft !h-9 !px-3 !text-[13px]" onClick={voice.pause}><Icon name="pause" size={15} />暂停讲解</button>
          : status === 'paused' ? <button className="btn-soft !h-9 !px-3 !text-[13px]" onClick={voice.resume}><Icon name="play" size={15} />继续讲解</button>
          : <button className="btn-soft !h-9 !px-3 !text-[13px]" disabled={status === 'loading'} onClick={() => voice.start(c.contentId, c.body)}><Icon name="play" size={15} />播放讲解</button>}
        {['playing', 'paused', 'loading'].includes(status) && <button className="text-[13px] text-ink-soft" onClick={voice.stop}>停止讲解</button>}
      </div>
      {active && voice.error && <p className="text-[12px] text-warn">{voice.error}</p>}
      <div className="whitespace-pre-wrap text-[14.5px] leading-relaxed">{c.body}</div>
      <details className="text-[12px] text-ink-faint"><summary className="cursor-pointer text-brand">查看讲解来源</summary>
        <div className="mt-2"><EvidenceList items={c.evidence} /></div>
        <p className="mt-2">{c.scopeNote} · {fmtDateTime(c.generatedAt)}</p>
      </details>
    </div>
  </div>;
}

const MODULE_LABEL = { KNOWLEDGE: '知识讲解', PERSONAL_GOAL: '我的任务', TRIP_RISK: '行程风险', NEARBY: '附近推荐' } as const;

export function ContentCard({ c, stale }: { c: PreparedContent; stale?: boolean }) {
  const [more, setMore] = useState(false);
  if (c.deliveryMode === 'GUIDE') return <GuideMessage c={c} stale={stale} />;
  return (
    <article className="rounded-card bg-card p-4 shadow-card">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <span className="chip bg-brand-mist text-brand">{MODULE_LABEL[c.module]}</span>
        {c.module !== 'TRIP_RISK' && <span className="chip bg-sand text-ink-soft">AI 创作辅助</span>}
        {stale && <span className="chip bg-warn-soft text-warn">基于旧版本行程生成</span>}
      </div>
      <h4 className="text-[16px] font-semibold">{c.title}</h4>
      {/* 纯文本渲染，不执行任何 HTML/脚本 */}
      <div className="mt-2 whitespace-pre-wrap text-[14.5px] leading-relaxed">{c.body}</div>
      <p className="mt-3 text-[12px] text-ink-faint">v{c.version} · 生成于 {fmtDateTime(c.generatedAt)} · {c.scopeNote}</p>
      {c.generationProvider && <p className="mt-1 text-[12px] text-ink-faint">生成服务：{c.generationProvider} / {c.generationModel ?? '型号未返回'}</p>}
      <button className="mt-1 text-[12.5px] text-brand" onClick={() => setMore(!more)}>{more ? '收起来源' : `查看来源（${c.evidence.length}）`}</button>
      {more && <div className="mt-2"><EvidenceList items={c.evidence} /></div>}
    </article>
  );
}

/** 打开主动卡片内容：先显示已预准备内容，再按用户要求调用 A7 实时完善（I11）。 */
export function ContentModal({ tripId, plan, ctx, contents, intentId, title, onClose }: {
  tripId: string; plan: TripState; ctx: SelectedContext; contents: PreparedContent[]; intentId?: string; title: string; onClose: () => void;
}) {
  const [list, setList] = useState(contents);
  const [req, setReq] = useState('');
  const job = useJob<{ content: PreparedContent }>(tripId);
  const putContents = useTrips((s) => s.putContents);
  const latest = list[list.length - 1];
  const voice = useNarration();
  const stopVoice = voice.stop;
  useEffect(() => stopVoice, [stopVoice]);

  async function refine(q: string) {
    const t = useTrips.getState().trips[tripId];
    const out = await job.run((h) => jobs.refineContent({
      ...execCtx(t), tripId, baseRevision: plan.revision, tripState: plan, intentId, preparedContent: latest, userRequest: q, context: ctx,
    }, h));
    if (!out?.result) return;
    const c = out.result.content;
    setList((l) => [...l, c]); setReq('');
    if (c.deliveryMode === 'GUIDE') voice.start(c.contentId, c.body);
    await putContents(tripId, [c]).catch(() => undefined);
  }

  const presets = intentId ? ['把讲稿改得更口语、控制在 1 分钟', '给我一份拍摄清单', '结合我现在的位置给些建议'] : ['讲得再简短一点', '多讲讲建筑细节'];
  return (
    <Modal open onClose={onClose} title={title} tall
      footer={
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (req.trim()) refine(req.trim()); }}>
          <input className="field flex-1" value={req} onChange={(e) => setReq(e.target.value)} placeholder="补充要求，实时完善…" disabled={job.running} />
          <button className="btn-primary !px-4" disabled={!req.trim() || job.running}><Icon name="spark" size={16} /></button>
        </form>
      }>
      <div className="space-y-3">
        {list.length === 0 && <p className="rounded-card bg-sand/50 p-4 text-[14px] text-ink-soft">还没有预准备内容。输入你的要求，或点下面的建议开始生成。</p>}
        {list.map((c) => <ContentCard key={c.contentId + c.version} c={c} stale={c.baseRevision !== plan.revision} />)}
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => <button key={p} disabled={job.running} className="chip border border-sand bg-card !px-3 !py-1.5 text-ink-soft" onClick={() => refine(p)}>{p}</button>)}
        </div>
        {(job.running || job.progress.length > 0) && <AgentProgress events={job.progress} running={job.running} />}
        {job.error != null && <ErrorBox error={job.error} onRetry={() => latest && refine(req || '重新生成')} compact />}
        {latest?.deliveryMode !== 'GUIDE' && <p className="text-[11.5px] leading-snug text-ink-faint">讲稿等为创作辅助，拍摄规定请以景区最新信息为准。</p>}
      </div>
    </Modal>
  );
}
