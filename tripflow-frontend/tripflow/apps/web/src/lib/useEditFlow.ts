import { useCallback, useState } from 'react';
import type { EditOperation, RevisionResult, SelectedContext, ConversationMessage, ValidateResult } from '@tripflow/contracts';
import { useTrips, activeWs, execCtx } from '../store/tripStore';
import { jobs } from '../api/client';
import { useJob } from './useJob';
import { StaleRevisionError, NotCommittableError } from '../store/planOps';
import type { PendingProposal } from '../store/types';
import { toast } from '../components/ui';

/**
 * propose → preview → validate → 原子提交（附录 A.7）。
 * 拖拽与 AI 批量修改共用这一条事务路径。
 */
export function useEditFlow(tripId: string) {
  const proposeJob = useJob<RevisionResult>(tripId);
  const validateJob = useJob<ValidateResult>(tripId);
  const [commitError, setCommitError] = useState<unknown>();

  const snapshot = useCallback(() => {
    const t = useTrips.getState().trips[tripId];
    const ws = activeWs(t);
    if (!t || !ws?.plan) throw new Error('行程不存在');
    return { t, ws, plan: ws.plan };
  }, [tripId]);

  const propose = useCallback(async (input:
    | { operations: EditOperation[]; origin: PendingProposal['origin']; selectedContext?: SelectedContext }
    | { userRequest: string; origin: PendingProposal['origin']; selectedContext?: SelectedContext; conversation?: ConversationMessage[] },
  ): Promise<RevisionResult | undefined> => {
    setCommitError(undefined);
    const { t, plan } = snapshot();
    // 一次只允许一个待确认草稿：调用方已征得用户同意替换
    if (activeWs(t)?.pending) await useTrips.getState().setPending(tripId, undefined);
    const base = { ...execCtx(t), tripId, baseRevision: plan.revision, tripState: plan, selectedContext: input.selectedContext };
    const out = await proposeJob.run((h) => ('operations' in input
      ? jobs.propose({ ...base, operations: input.operations }, h)
      : jobs.propose({ ...base, userRequest: input.userRequest, conversation: input.conversation }, h)));
    if (!out?.result) {
      if (out) proposeJob.setError(new Error(out.errors.map((e) => e.message).join('；') || '没有返回修改方案'));
      return undefined;
    }
    const r = out.result;
    if (r.kind === 'REVISION') {
      const cur = snapshot().plan;
      if (r.proposal.tripId !== tripId || r.proposal.baseRevision !== cur.revision || r.proposal.candidate.tripId !== tripId) {
        proposeJob.setError(new StaleRevisionError('行程在计算期间已更新，旧方案已丢弃，请重新发起'));
        return undefined;
      }
      await useTrips.getState().setPending(tripId, { proposal: r.proposal, origin: input.origin, createdAt: new Date().toISOString() });
    }
    return r;
  }, [tripId, proposeJob, snapshot]);

  const discard = useCallback(async () => {
    proposeJob.cancel(); validateJob.cancel();
    setCommitError(undefined);
    await useTrips.getState().setPending(tripId, undefined);
  }, [tripId, proposeJob, validateJob]);

  /** 用户点击确认：I06 最终复核 → 本地 CAS → 原子写入。 */
  const confirm = useCallback(async (acceptUnknown: boolean): Promise<boolean> => {
    setCommitError(undefined);
    const { t, ws, plan } = snapshot();
    const pend = ws.pending;
    if (!pend) return false;
    const out = await validateJob.run((h) => jobs.validate({ ...execCtx(t), tripId, baseRevision: plan.revision, tripState: plan, proposal: pend.proposal }, h));
    if (!out?.result) {
      if (out) validateJob.setError(new Error('复核未返回结果'));
      return false;
    }
    const v = out.result;
    const now = snapshot();
    if (v.proposalId !== pend.proposal.proposalId || v.baseRevision !== now.plan.revision || now.ws.pending?.proposal.proposalId !== pend.proposal.proposalId) {
      setCommitError(new StaleRevisionError());
      return false;
    }
    await useTrips.getState().setPending(tripId, { ...pend, finalValidation: v.validation });
    if (!v.validation.committable) {
      setCommitError(new NotCommittableError('最终复核未通过，需要重新生成预览'));
      return false;
    }
    try {
      await useTrips.getState().commit(tripId, pend.proposal, acceptUnknown);
      toast('已应用修改', 'ok');
      return true;
    } catch (e) {
      setCommitError(e);
      if (e instanceof StaleRevisionError) await useTrips.getState().setPending(tripId, undefined).catch(() => undefined);
      return false;
    }
  }, [tripId, validateJob, snapshot]);

  return { propose, discard, confirm, proposeJob, validateJob, commitError };
}
