import { useEffect, useState } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { useTrips } from '../store/tripStore';
import { jobs } from '../api/client';
import { useJob } from '../lib/useJob';
import { AgentProgress } from '../components/AgentProgress';
import { ErrorBox } from '../components/ui';
import { Icon } from '../components/Icon';
import { emptyRequirements } from '../lib/requirements';
import type { ParseResult } from '@tripflow/contracts';
import { Logo } from '../components/Illustrations';

const EXAMPLES = [
  '两个人去北京玩 2 天，喜欢历史文化和拍照，想去天坛，在天安门附近拍一段有纪念意义的演讲视频。预算有限，主要坐地铁和步行。',
  '下周六和三个朋友去杭州一日游，一个朋友腿脚不太好，少走路，想吃本地菜，人均 300 以内。',
  '一个人去成都 3 天，想看熊猫和川剧，晚上逛夜市，不想去太商业化的地方。',
];

export function InputPage() {
  const { tripId = '' } = useParams();
  const nav = useNavigate();
  const trip = useTrips((s) => s.trips[tripId]);
  const saveDraft = useTrips((s) => s.saveDraft);
  const [text, setText] = useState(trip?.draft.text ?? '');
  const job = useJob<ParseResult>(tripId);

  // 输入草稿自动保存，刷新不丢
  useEffect(() => {
    if (!trip) return;
    const h = setTimeout(() => { if (text !== trip.draft.text) saveDraft(tripId, { text }).catch(() => undefined); }, 600);
    return () => clearTimeout(h);
  }, [text, trip, tripId, saveDraft]);

  if (!trip) return <Navigate to="/" replace />;

  async function parse() {
    await saveDraft(tripId, { text });
    const out = await job.run((h) => jobs.parseRequirements({ executionMode: 'REAL', tripId, baseRevision: trip.real.plan?.revision ?? 0, text }, h));
    if (!out?.result) {
      if (out) job.setError(new Error(out.errors.map((e) => e.message).join('；') || '解析未返回结果'));
      return;
    }
    const { requirements, intents, missingFields, uncertainFields } = out.result;
    // 模型抽取 ≠ 用户确认：强制 confirmed=false，用户在 P03 确认
    await saveDraft(tripId, {
      requirements: { ...requirements, intents, confirmed: false, timezone: 'Asia/Shanghai' },
      parse: { missingFields, uncertainFields },
    });
    nav(`/trip/${tripId}/confirm`);
  }

  async function manual() {
    await saveDraft(tripId, { text, requirements: trip.draft.requirements ?? emptyRequirements(), parse: undefined });
    nav(`/trip/${tripId}/confirm`);
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="flex items-center gap-2 px-5 pb-2 pt-[calc(14px+var(--safe-t))]">
        <button onClick={() => nav('/')} className="flex items-center gap-1.5" aria-label="返回首页">
          <Logo size={24} /><span className="text-[17px] font-semibold">TripFlow</span>
        </button>
        <button className="ml-auto text-[13px] text-ink-faint" onClick={manual}>手动填写</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <h1 className="mt-6 text-[26px] font-bold">你想去哪里旅行？</h1>
        <p className="mt-6 text-[13px] text-ink-faint">试试这样说：</p>
        <div className="mt-3 space-y-2.5">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => setText(e)} disabled={job.running}
              className={`block w-full rounded-[14px] px-4 py-3 text-left text-[14px] leading-relaxed transition ${text === e ? 'bg-brand-mist text-brand-deep' : 'bg-[#F5F7FA] text-ink-soft'}`}>{e}</button>
          ))}
        </div>
        {(job.running || job.progress.length > 0) && (
          <div className="mt-6"><p className="section-title mb-2">正在理解你的需求</p><AgentProgress events={job.progress} running={job.running} /></div>
        )}
        {job.error != null && <div className="mt-4"><ErrorBox error={job.error} onRetry={parse} /></div>}
      </div>
      <footer className="px-4 pb-[calc(14px+var(--safe-b))] pt-2">
        <div className="flex items-end gap-2 rounded-[22px] bg-white p-2 shadow-[0_6px_24px_-8px_rgba(24,33,47,.22)] ring-1 ring-sand">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-faint"><Icon name="spark" size={20} /></span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={text.length > 40 ? 3 : 1} maxLength={2000}
            placeholder="说说目的地、天数、同行人和想做的事" disabled={job.running} aria-label="旅行需求"
            className="min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15px] leading-relaxed outline-none placeholder:text-ink-faint" />
          {job.running
            ? <button className="h-10 shrink-0 rounded-full bg-sand px-4 text-[14px]" onClick={job.cancel}>取消</button>
            : <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white disabled:opacity-40" disabled={text.trim().length < 4} onClick={parse} aria-label="AI 解析为可编辑表单"><Icon name="send" size={18} /></button>}
        </div>
        <p className="mt-2 text-center text-[11.5px] text-ink-faint">AI 会把描述整理成可编辑的表单，确认后才会规划</p>
      </footer>
    </div>
  );
}
