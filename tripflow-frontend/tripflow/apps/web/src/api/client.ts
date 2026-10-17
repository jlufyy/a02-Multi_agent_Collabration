/**
 * TripFlow API 客户端（附录 A.2 / A.5 / A.6）。
 * - 所有响应必须是 ApiResponse 信封，并用共享 Zod schema 校验；校验失败即视为错误，不写入状态。
 * - 网络错误单独表示为 kind=NETWORK，不伪造服务端信封。
 * - 长任务：202 JobAccepted → 轮询 GET /jobs/{id}?afterSequence= → 终态。
 */
import { z } from 'zod';
import { schemas as S } from '@tripflow/contracts';
import type {
  ApiError, CapabilitySet, ProgressEvent, JobStatus, RequestContext, ExecutionContext,
  TripRequirements, TripState, SelectedContext, ConversationMessage, EditOperation, RevisionProposal,
  ProactiveEvent, NotificationRecord, TravelIntent, PreparedContent, GeoPoint, ItineraryActivity, TravelMode,
} from '@tripflow/contracts';
import { uid } from '../lib/id';
import { cleanMessage } from '../lib/validationMessages';

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '') + '/api/v1';

export class ApiClientError extends Error {
  constructor(
    public kind: 'NETWORK' | 'HTTP' | 'SCHEMA' | 'ABORTED',
    message: string,
    public httpStatus?: number,
    public errors: ApiError[] = [],
    public traceId?: string,
    public requestId?: string,
  ) { super(message); }
  get code() { return this.errors[0]?.code ?? this.kind; }
  get retryable() { return this.kind === 'NETWORK' || this.errors.some((e) => e.retryable) || (this.httpStatus ?? 0) >= 500; }
}

export function describeError(e: unknown): { title: string; detail: string; trace?: string; retryable: boolean } {
  if (e instanceof ApiClientError) {
    const map: Record<string, string> = {
      NETWORK: '无法连接规划服务（可能正在冷启动或网络不可达）',
      SCHEMA: '服务返回的数据未通过契约校验，已拒收',
      ABORTED: '请求已取消',
      STALE_REVISION: '行程已更新，请重新预览',
      JOB_NOT_FOUND: '后端任务已过期或服务重启，请重新发起',
      RATE_LIMITED: '请求过于频繁，已被限流',
      BUDGET_LIMIT: '今日 AI 调用额度已用尽',
      LLM_TIMEOUT: 'AI 服务请求超时，可重试',
      API_UNAVAILABLE: '外部数据服务暂不可用',
      INVALID_MODEL_OUTPUT: '模型输出未通过校验',
      VALIDATION_ERROR: '请求字段不合法',
    };
    const title = map[e.code] ?? (e.httpStatus === 504 ? '请求超时' : e.httpStatus && e.httpStatus >= 500 ? '服务暂不可用' : '请求失败');
    const detail = ['NETWORK', 'SCHEMA', 'VALIDATION_ERROR', 'INVALID_MODEL_OUTPUT'].includes(e.code) ? title
      : e.errors.map((x) => cleanMessage(x.message, [], title)).join('；') || cleanMessage(e.message, [], title);
    return { title, detail, trace: e.traceId, retryable: e.retryable };
  }
  return { title: '暂时无法完成操作', detail: cleanMessage(String((e as Error)?.message ?? e)), retryable: true };
}

async function call<T extends z.ZodTypeAny>(
  method: 'GET' | 'POST' | 'DELETE', path: string, dataSchema: T,
  opts: { body?: unknown; signal?: AbortSignal; requestId?: string } = {},
): Promise<{ status: JobStatus; data: z.infer<T> | null; traceId: string; httpStatus: number; errors: ApiError[] }> {
  const requestId = opts.requestId ?? uid('req');
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(method === 'POST' ? { 'X-Request-Id': requestId } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new ApiClientError('ABORTED', '已取消');
    throw new ApiClientError('NETWORK', (err as Error).message);
  }
  let json: unknown;
  try { json = await res.json(); } catch {
    throw new ApiClientError(res.ok ? 'SCHEMA' : 'HTTP', `HTTP ${res.status}：响应不是 JSON`, res.status);
  }
  const env = S.apiResponse(dataSchema).safeParse(json);
  if (!env.success) {
    // 失败响应的 data 可能为 null 且信封合法；这里只在信封本身不合法时报 SCHEMA
    const loose = S.apiResponse(z.unknown()).safeParse(json);
    if (loose.success && !res.ok) {
      throw new ApiClientError('HTTP', `HTTP ${res.status}`, res.status, loose.data.errors, loose.data.trace_id, loose.data.request_id);
    }
    throw new ApiClientError('SCHEMA', env.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), res.status,
      [], loose.success ? loose.data.trace_id : undefined);
  }
  const e = env.data;
  if (!res.ok || e.status === 'FAILED') {
    throw new ApiClientError('HTTP', `HTTP ${res.status}`, res.status, e.errors, e.trace_id, e.request_id);
  }
  return { status: e.status, data: (e as unknown as { data: z.infer<T> | null }).data, traceId: e.trace_id, httpStatus: res.status, errors: e.errors };
}

// ---------------- 同步端点 ----------------
export const api = {
  placeDetail: (poiId: string) => call('GET', `/places/${encodeURIComponent(poiId)}`, S.Place),
  health: (signal?: AbortSignal) => call('GET', '/health', S.HealthData, { signal }),
  capabilities: (signal?: AbortSignal) => call('GET', '/capabilities', S.CapabilitySet, { signal }),
  searchPlaces: (b: ExecutionContext & { city: string; keyword: string; location?: GeoPoint }, signal?: AbortSignal) =>
    call('POST', '/places/search', S.PlacesResult, { body: b, signal }),
  researchPlace: (b: ExecutionContext & { poiId: string; city: string; visitDate: string }, signal?: AbortSignal) =>
    call('POST', '/places/research', S.WebResearch, { body: b, signal }),
  routeSegments: (b: RequestContext & { requirements: TripRequirements; activities: ItineraryActivity[]; mode: TravelMode }, signal?: AbortSignal) =>
    call('POST', '/routes/segments', S.RoutesResult, { body: b, signal }),
  cancelJob: (jobId: string) => call('DELETE', `/jobs/${encodeURIComponent(jobId)}`, S.CancelResult),
};

// ---------------- 异步任务 ----------------
export type JobHandle<R> = {
  jobId?: string;
  promise: Promise<{ status: JobStatus; result?: R; traceId: string; errors: ApiError[] }>;
  cancel: () => void;
};

export function startJob<T extends z.ZodTypeAny>(
  path: string, body: RequestContext & Record<string, unknown>, resultSchema: T,
  hooks: { onProgress?: (ev: ProgressEvent[]) => void; limits?: CapabilitySet['limits'] } = {},
): JobHandle<z.infer<T>> {
  const ctrl = new AbortController();
  const handle: JobHandle<z.infer<T>> = {
    promise: undefined as never,
    cancel: () => {
      ctrl.abort();
      if (handle.jobId) api.cancelJob(handle.jobId).catch(() => undefined);
    },
  };
  const limits = hooks.limits ?? { pollIntervalMs: 1200, maxPollIntervalMs: 5000, maxJobSeconds: 180 } as CapabilitySet['limits'];
  handle.promise = (async () => {
    const acc = await call('POST', path, S.JobAccepted, { body, signal: ctrl.signal });
    if (!acc.data) throw new ApiClientError('SCHEMA', '任务未返回 jobId', acc.httpStatus, acc.errors, acc.traceId);
    // 校验回执与请求上下文一致
    if (acc.data.tripId !== body.tripId || acc.data.baseRevision !== body.baseRevision || acc.data.executionMode !== body.executionMode) {
      throw new ApiClientError('SCHEMA', '任务回执的 tripId/baseRevision/executionMode 与请求不一致，已丢弃');
    }
    handle.jobId = acc.data.jobId;
    let cursor = 0;
    let interval = limits.pollIntervalMs;
    const deadline = Date.now() + limits.maxJobSeconds * 1000;
    const snapSchema = S.jobSnapshot(resultSchema);
    for (;;) {
      if (ctrl.signal.aborted) throw new ApiClientError('ABORTED', '已取消');
      await new Promise((r) => setTimeout(r, interval));
      const snap = await call('GET', `/jobs/${encodeURIComponent(acc.data.jobId)}?afterSequence=${cursor}`, snapSchema, { signal: ctrl.signal });
      const d = snap.data;
      if (!d) throw new ApiClientError('SCHEMA', '任务快照为空', snap.httpStatus, snap.errors, snap.traceId);
      if (d.tripId !== body.tripId || d.baseRevision !== body.baseRevision) throw new ApiClientError('SCHEMA', '任务快照上下文不匹配，已丢弃');
      if (d.progressEvents.length) hooks.onProgress?.(d.progressEvents.filter((p) => p.sequence > cursor));
      cursor = Math.max(cursor, d.nextCursor);
      if (['SUCCEEDED', 'PARTIAL', 'CANCELLED'].includes(d.status)) {
        return { status: d.status, result: d.result as z.infer<T> | undefined, traceId: snap.traceId, errors: snap.errors };
      }
      if (Date.now() > deadline) {
        handle.cancel();
        throw new ApiClientError('HTTP', '任务超过最长运行时间', 504, [{ code: 'LLM_TIMEOUT', message: '任务超过最长运行时间', retryable: true }]);
      }
      interval = Math.min(Math.round(interval * 1.25), limits.maxPollIntervalMs);
    }
  })();
  return handle;
}

type H = Parameters<typeof startJob>[3];
export const jobs = {
  resolvePlaces: (b: RequestContext & { requirements: TripRequirements }, h?: H) =>
    startJob('/requirements/resolve-places', b, S.ParseResult, h),
  parseRequirements: (b: RequestContext & { text: string; requirements?: TripRequirements; selectedContext?: SelectedContext; conversation?: ConversationMessage[] }, h?: H) =>
    startJob('/requirements/parse', b, S.ParseResult, h),
  generatePlan: (b: RequestContext & { requirements: TripRequirements; mode: 'PLANNING' }, h?: H) =>
    startJob('/plans/generate', b, S.PlanResult, h),
  propose: (b: RequestContext & { tripState: TripState; selectedContext?: SelectedContext; conversation?: ConversationMessage[] }
    & ({ operations: EditOperation[]; userRequest?: never } | { userRequest: string; operations?: never }), h?: H) =>
    startJob('/revisions/propose', b, S.RevisionResult, h),
  validate: (b: RequestContext & { tripState: TripState; proposal: RevisionProposal }, h?: H) =>
    startJob('/revisions/validate', b, S.ValidateResult, h),
  evaluate: (b: RequestContext & { tripState: TripState; currentEvent: ProactiveEvent; recentNotifications: NotificationRecord[]; uiBusy: boolean }, h?: H) =>
    startJob('/proactive/evaluate', b, S.EvaluateResult, h),
  prepareContent: (b: RequestContext & { tripState: TripState; intents: TravelIntent[]; selectedContext?: SelectedContext }, h?: H) =>
    startJob('/content/prepare', b, S.ContentsResult, h),
  refineContent: (b: RequestContext & { tripState: TripState; intentId?: string; preparedContent?: PreparedContent; userRequest: string; context: SelectedContext }, h?: H) =>
    startJob('/content/refine', b, S.ContentResult, h),
  nearby: (b: RequestContext & { tripState: TripState; location: GeoPoint; category: 'FOOD' | 'REST' | 'PHOTO'; preferences: string[]; selectedContext?: SelectedContext; radiusMeters?: number; maxWalkMinutes?: number; includeReviews?: boolean; maxAverageCostCny?: number }, h?: H) =>
    startJob('/nearby/search', b, S.NearbyResult, h),
};
