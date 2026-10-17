import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import type { PlanResult } from '@tripflow/contracts';
import { useTrips } from '../store/tripStore';
import { jobs } from '../api/client';
import { useJob } from '../lib/useJob';
import { PlanSteps } from '../components/AgentProgress';
import { PavilionScene } from '../components/Illustrations';
import { ErrorBox, ValidationBadge, toast } from '../components/ui';
import { Icon } from '../components/Icon';

export function PlanningPage() {
  const { tripId = '' } = useParams();
  const nav = useNavigate();
  const trip = useTrips((s) => s.trips[tripId]);
  const landPlan = useTrips((s) => s.landPlan);
  const job = useJob<PlanResult>(tripId);
  const [result, setResult] = useState<PlanResult>();
  const [saveErr, setSaveErr] = useState<unknown>();
  const started = useRef(false);
  const req = trip?.draft.requirements;

  const start = useCallback(async () => {
    if (!req?.confirmed) return;
    setResult(undefined);
    const out = await job.run((h) => jobs.generatePlan({ executionMode: 'REAL', tripId, baseRevision: 0, requirements: req, mode: 'PLANNING' }, h));
    if (!out) return;
    if (!out.result) { job.setError(new Error(out.errors.map((e) => e.message).join('；') || '规划未返回结果')); return; }
    const r = out.result;
    if (r.plan && (r.plan.tripId !== tripId)) { job.setError(new Error('规划结果与当前行程不匹配，已丢弃')); return; }
    setResult(r);
    if (r.plan && r.validation.status === 'FEASIBLE' && r.validation.committable) await land(r);
  }, [req, tripId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 仅在进入页面时发起一次；离开页面（含 StrictMode 的卸载重挂）会取消并废弃该请求
  useEffect(() => {
    const t = useTrips.getState().trips[tripId];
    if (started.current || !t || t.real.plan) return;
    started.current = true;
    start();
    return () => { started.current = false; job.cancel(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function land(r: PlanResult) {
    if (!r.plan || !req) return;
    try {
      await landPlan(tripId, r.plan, r.preparedContents, req);
      toast('行程已保存到本机', 'ok');
      nav(`/trip/${tripId}`, { replace: true });
    } catch (e) { setSaveErr(e); }
  }

  if (!trip) return <Navigate to="/" replace />;
  if (trip.real.plan && !result) return <Navigate to={`/trip/${tripId}`} replace />;
  if (!req?.confirmed) return <Navigate to={`/trip/${tripId}/confirm`} replace />;
  const v = result?.validation;

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="flex items-center px-3 pt-[calc(12px+var(--safe-t))]">
        <button className="flex h-10 w-10 items-center justify-center" onClick={() => { job.cancel(); nav(`/trip/${tripId}/confirm`); }} aria-label="返回修改需求"><Icon name="back" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <PavilionScene className="mx-auto h-[170px] w-full max-w-[300px]" />
        <h1 className="mt-2 text-center text-[21px] font-bold">{v ? (result?.plan ? `${req.destinationCity}之旅规划好了` : '没能生成可执行的行程') : `正在为你规划${req.destinationCity}之旅`}</h1>
        <p className="mt-1 text-center text-[13px] text-ink-faint">{v ? '请查看下方校验结果' : 'AI 正在搜索景点、规划路线、安排时间…'}</p>
        <div className="mt-6"><PlanSteps events={job.progress} running={job.running} /></div>
        {job.error != null && <div className="mt-4"><ErrorBox error={job.error} onRetry={start} /></div>}
        {saveErr != null && <div className="mt-4"><ErrorBox error={saveErr} /></div>}

        {v && (
          <div className="animate-rise mt-5 space-y-3 rounded-[16px] bg-[#F7F9FC] p-4">
            <div className="flex items-center gap-2"><span className="font-semibold">校验结果</span><ValidationBadge status={v.status} /></div>
            {v.hardViolations.length > 0 && (
              <div><p className="mb-1 text-[13px] font-medium text-danger">硬约束冲突</p>
                <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-ink-soft">{v.hardViolations.map((x, i) => <li key={i}><code className="text-[11px] text-danger">{x.code}</code> {x.message}</li>)}</ul></div>
            )}
            {v.unknownChecks.length > 0 && (
              <div><p className="mb-1 text-[13px] font-medium text-warn">尚未核验</p>
                <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-ink-soft">{v.unknownChecks.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            )}
            {v.warnings.length > 0 && <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-faint">{v.warnings.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            {!result?.plan && <p className="text-[13.5px] text-ink-soft">当前条件下无法生成可执行方案。请返回放宽条件（例如减少必去地点、调整时间或预算）。</p>}
          </div>
        )}
        {!v && (
          <div className="mt-6 rounded-[14px] bg-[#F7F9FC] p-4">
            <p className="flex items-center gap-1.5 text-[13px] font-medium"><Icon name="info" size={15} className="text-brand" />小贴士</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">我们会尽量避开拥挤时段，并标出未核实的营业时间与票价。地点来源会写在每个活动的详情里。</p>
          </div>
        )}
      </div>
      <footer className="space-y-2 px-5 pb-[calc(14px+var(--safe-b))] pt-3">
        {job.running && <button className="btn-ghost w-full text-ink-soft" onClick={job.cancel}>取消规划</button>}
        {!job.running && result?.plan && v && v.status !== 'INFEASIBLE' && v.hardViolations.length === 0 && (
          v.committable ? <button className="btn-primary h-[52px] w-full text-[16px]" onClick={() => land(result)}>{v.status === 'PARTIALLY_VERIFIED' ? '我已了解未核验项，保存行程' : '保存行程'}</button>
            : <p className="text-center text-[13px] text-danger">服务判定该方案不可提交。</p>
        )}
        {!job.running && <button className="btn-soft w-full" onClick={() => nav(`/trip/${tripId}/confirm`)}>返回修改需求</button>}
      </footer>
    </div>
  );
}
