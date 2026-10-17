import { useEffect, useState } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import type { ParseResult, Place, TripRequirements } from '@tripflow/contracts';
import { useTrips } from '../store/tripStore';
import { jobs } from '../api/client';
import { useJob } from '../lib/useJob';
import { AgentProgress } from '../components/AgentProgress';
import { ErrorBox } from '../components/ui';
import { Icon } from '../components/Icon';
import { emptyRequirements, requirementProblems } from '../lib/requirements';
import { Logo } from '../components/Illustrations';
import { RequirementSummary } from '../components/RequirementSummary';
import { PlacePicker } from '../components/PlacePicker';

const EXAMPLES = ['两个人10月24日去北京玩一天，喜欢历史文化，09:00–18:00，主要坐地铁和步行。', '想和朋友去杭州玩两天，轻松一点，少走路，看看风景。', '一个人去成都3天，想看熊猫和川剧，晚上逛夜市。'];

export function InputPage() {
  const { tripId = '' } = useParams();
  const nav = useNavigate();
  const trip = useTrips((s) => s.trips[tripId]);
  const saveDraft = useTrips((s) => s.saveDraft);
  const [text, setText] = useState(trip?.draft.text ?? '');
  const [picker, setPicker] = useState<{ path: string; query: string; candidates?: Place[] }>();
  const [saveError, setSaveError] = useState<unknown>();
  const job = useJob<ParseResult>(tripId);
  const r = trip?.draft.requirements;
  const conversation = trip?.draft.conversation ?? [];
  useEffect(() => {
    if (!trip) return;
    const h = setTimeout(() => { if (text !== trip.draft.text) saveDraft(tripId, { text }).catch(setSaveError); }, 600);
    return () => clearTimeout(h);
  }, [text, trip, tripId, saveDraft]);
  if (!trip) return <Navigate to="/" replace />;
  if (trip.real.plan) return <Navigate to={`/trip/${tripId}`} replace />;

  async function parse(raw = text) {
    const q = raw.trim();
    if (!q || job.running || !trip) return;
    try {
      setSaveError(undefined);
      await saveDraft(tripId, { text: q });
      const out = await job.run((h) => jobs.parseRequirements({ executionMode: 'REAL', tripId, baseRevision: 0, text: q,
        requirements: r, conversation: conversation.slice(-20) }, h));
      if (!out?.result) {
        if (out) job.setError(new Error(out.errors.map((e) => e.message).join('；') || '解析未返回结果'));
        return;
      }
      const result = out.result;
      const changed = new Set(result.changedFields);
      const uncertainFields = [...(trip.draft.parse?.uncertainFields ?? []).filter((u) => !changed.has(u.fieldPath.split('.')[0])), ...result.uncertainFields];
      const reply = result.questions.length ? result.questions.join(' ') : '已更新摘要，可以继续补充，或确认后开始规划。';
      await saveDraft(tripId, { text: '', requirements: { ...result.requirements, confirmed: false },
        parse: { missingFields: result.missingFields, uncertainFields, questions: result.questions,
          fieldSources: { ...trip.draft.parse?.fieldSources, ...result.fieldSources } },
        conversation: [...conversation, { role: 'user', content: q }, { role: 'assistant', content: reply }].slice(-40) as typeof conversation });
      setText('');
    } catch (e) { setSaveError(e); }
  }
  async function advanced() {
    try { await saveDraft(tripId, { text, requirements: r ?? emptyRequirements() }); nav(`/trip/${tripId}/confirm`); } catch (e) { setSaveError(e); }
  }
  async function confirm() {
    if (!r) return;
    try {
      const confirmed: TripRequirements = { ...r, confirmed: true, version: r.version + 1, intents: r.intents.map((i) => ({ ...i, confirmed: i.status !== 'CANCELLED' })) };
      await saveDraft(tripId, { requirements: confirmed });
      nav(`/trip/${tripId}/planning`);
    } catch (e) { setSaveError(e); }
  }
  async function pick(p: Place) {
    if (!r || !picker) return;
    const [key, index] = picker.path.split('.');
    const next = key === 'mustVisit' ? { ...r, mustVisit: r.mustVisit.map((v, i) => i === Number(index) ? { ...v, place: p } : v) }
      : { ...r, intents: r.intents.map((v, i) => i === Number(index) ? { ...v, placeId: p.poiId, placeQuery: p.name } : v) };
    await saveDraft(tripId, { requirements: next, parse: { ...trip!.draft.parse!, uncertainFields: (trip!.draft.parse?.uncertainFields ?? []).filter((u) => u.fieldPath !== picker.path) } });
  }
  const unresolved = r ? [
    ...r.mustVisit.flatMap((v, i) => v.place ? [] : [{ path: `mustVisit.${i}`, query: v.query }]),
    ...r.intents.flatMap((v, i) => v.status === 'CANCELLED' || v.placeId ? [] : [{ path: `intents.${i}`, query: v.placeQuery ?? '请选择地点' }]),
  ] : [];
  const problems = r ? Object.values(requirementProblems(r)) : [];
  const questions = trip.draft.parse?.questions ?? [];
  const quickReplies = r && !r.travelerCount ? ['一个人', '两个人', '三个人']
    : r && !r.transportModes.length ? ['公共交通和步行', '只步行', '请推荐交通方式']
    : r?.budgetCny !== undefined && !r.budgetScope ? ['预算是人均', '预算是总额'] : [];
  return <div className="flex h-full flex-col bg-white">
    <header className="flex items-center gap-2 px-5 pb-3 pt-[calc(14px+var(--safe-t))]"><button onClick={() => nav('/')} className="flex items-center gap-2"><Logo size={24} /><span className="font-semibold">TripFlow</span></button><button className="ml-auto text-[13px] text-brand" onClick={advanced}>高级编辑</button></header>
    <main className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4">
      <h1 className="mt-4 text-[24px] font-bold">一起安排这次旅行</h1>
      {!conversation.length && <><p className="text-[14px] text-ink-soft">说说目的地、时间和想做的事，我会整理好，只追问关键条件。</p>{EXAMPLES.map((e) => <button key={e} className="block w-full rounded-[14px] bg-[#F5F7FA] p-3 text-left text-[14px]" onClick={() => setText(e)}>{e}</button>)}</>}
      {conversation.map((m, i) => <p key={i} className={`w-fit max-w-[92%] whitespace-pre-wrap rounded-[16px] px-4 py-3 text-[14px] ${m.role === 'user' ? 'ml-auto bg-brand text-white' : 'bg-[#F5F7FA] text-ink-soft'}`}>{m.content}</p>)}
      {r && <RequirementSummary r={r} sources={trip.draft.parse?.fieldSources} onEdit={advanced} />}
      {!!questions.length && !conversation.length && <p className="text-[14px] text-brand" role="status">{questions.slice(0, 2).join(' ')}</p>}
      {!!quickReplies.length && <div className="flex flex-wrap gap-2" aria-label="快捷回答">{quickReplies.map((q) => <button key={q} disabled={job.running} className="chip bg-brand-mist text-brand" onClick={() => parse(q)}>{q}</button>)}</div>}
      {(trip.draft.parse?.uncertainFields ?? []).filter((u) => !u.candidates && !u.fieldPath.startsWith('mustVisit.') && !u.fieldPath.startsWith('intents.')).map((u, i) => <p key={i} className="text-[12px] text-warn">待核对：{u.reason}</p>)}
      {unresolved.map((v) => <button key={v.path} disabled={job.running} className="btn-soft w-full text-left" onClick={() => setPicker({ ...v, candidates: trip.draft.parse?.uncertainFields.find((u) => u.fieldPath === v.path)?.candidates })}>选择真实地点：{v.query}</button>)}
      {!!r && !job.running && <div className="space-y-2"><button className="btn-primary w-full disabled:opacity-40" disabled={!!problems.length || !!unresolved.length} onClick={confirm}>确认摘要，开始规划</button>{!!problems.length && <p className="text-[12px] text-ink-faint">还需补充：{problems.slice(0, 2).join('；')}。可以直接回复。</p>}</div>}
      {job.running && <AgentProgress events={job.progress} running />}
      {job.error != null && <ErrorBox error={job.error} onRetry={() => parse()} />}
      {saveError != null && <ErrorBox error={saveError} />}
    </main>
    <form className="flex items-end gap-2 border-t border-sand px-4 pb-[calc(14px+var(--safe-b))] pt-3" onSubmit={(e) => { e.preventDefault(); parse(); }}>
      <textarea className="field min-h-[48px] flex-1 resize-none" rows={2} maxLength={2000} disabled={job.running} value={text} onChange={(e) => setText(e.target.value)} placeholder={r ? '补充或纠正旅行需求…' : '你想去哪里，什么时候出发？'} aria-label="旅行需求" />
      {job.running ? <button type="button" className="btn-soft" onClick={job.cancel}>取消</button> : <button className="btn-primary" disabled={!text.trim()} aria-label="发送旅行需求"><Icon name="send" size={18} /></button>}
    </form>
    {picker && <PlacePicker open onClose={() => setPicker(undefined)} city={r?.destinationCity} initialQuery={picker.query} candidates={picker.candidates} onPick={(p) => { pick(p).catch(setSaveError); }} ctx={{ executionMode: 'REAL' }} />}
  </div>;
}
