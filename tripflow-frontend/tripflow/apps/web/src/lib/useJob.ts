import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProgressEvent, JobStatus, ApiError } from '@tripflow/contracts';
import type { JobHandle } from '../api/client';
import { ApiClientError } from '../api/client';
import { useTrips } from '../store/tripStore';

export type JobOutcome<R> = { status: JobStatus; result?: R; traceId: string; errors: ApiError[] };

/**
 * 运行一个后端长任务：
 * - 进度只来自后端真实 ProgressEvent，不做定时动画；
 * - 记录启动时的请求代次，晚到结果代次不符即丢弃（不写入状态）。
 */
export function useJob<R>(tripId: string) {
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>();
  const handle = useRef<JobHandle<R>>();
  const localGen = useRef(0);
  const limits = useTrips((s) => s.capabilities?.limits);

  const run = useCallback(async (
    start: (hooks: { onProgress: (e: ProgressEvent[]) => void; limits?: typeof limits }) => JobHandle<R>,
  ): Promise<JobOutcome<R> | undefined> => {
    handle.current?.cancel();
    const myLocal = ++localGen.current;
    const storeGen = useTrips.getState().gen[tripId] ?? 0;
    const stale = () => myLocal !== localGen.current || (useTrips.getState().gen[tripId] ?? 0) !== storeGen;
    setProgress([]); setError(undefined); setRunning(true);
    const h = start({ onProgress: (ev) => setProgress((p) => [...p, ...ev]), limits });
    handle.current = h;
    try {
      const out = await h.promise;
      if (stale()) return undefined; // 过期结果（计划已变化或已有更新请求）：丢弃
      if (out.status === 'CANCELLED') return undefined;
      return out;
    } catch (e) {
      if (e instanceof ApiClientError && e.kind === 'ABORTED') return undefined;
      if (!stale()) setError(e);
      return undefined;
    } finally {
      if (handle.current === h) { setRunning(false); handle.current = undefined; }
    }
  }, [tripId, limits]);

  const cancel = useCallback(() => {
    handle.current?.cancel();
    handle.current = undefined;
    localGen.current++; // 废弃该请求代次
    setRunning(false);
  }, []);

  useEffect(() => () => handle.current?.cancel(), []);
  return { run, cancel, progress, running, error, setError };
}
