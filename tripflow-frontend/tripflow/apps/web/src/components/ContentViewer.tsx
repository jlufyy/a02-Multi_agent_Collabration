import { useState } from 'react';
import type { PreparedContent, TripState, SelectedContext } from '@tripflow/contracts';
import { Modal, EvidenceList, ErrorBox, fmtDateTime } from './ui';
import { AgentProgress } from './AgentProgress';
import { Icon } from './Icon';
import { jobs } from '../api/client';
import { useJob } from '../lib/useJob';
import { useTrips, execCtx } from '../store/tripStore';

const MODULE_LABEL = { KNOWLEDGE: '知识讲解', PERSONAL_GOAL: '我的任务', TRIP_RISK: '行程风险', NEARBY: '附近推荐' } as const;

export function ContentCard({ c, stale }: { c: PreparedContent; stale?: boolean }) {
  const [more, setMore] = useState(false);
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

  async function refine(q: string) {
    const t = useTrips.getState().trips[tripId];
    const out = await job.run((h) => jobs.refineContent({
      ...execCtx(t), tripId, baseRevision: plan.revision, tripState: plan, intentId, preparedContent: latest, userRequest: q, context: ctx,
    }, h));
    if (!out?.result) return;
    const c = out.result.content;
    setList((l) => [...l, c]); setReq('');
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
        <p className="text-[11.5px] leading-snug text-ink-faint">讲稿等为创作辅助，非官方文稿。拍摄位置、进入及摄影规定请以官方最新信息为准。</p>
      </div>
    </Modal>
  );
}
