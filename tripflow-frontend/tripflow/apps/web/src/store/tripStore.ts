import { create } from 'zustand';
import type { TripState, RevisionProposal, PreparedContent, EventLogEntry, CapabilitySet, TripRequirements, ExecutionMode } from '@tripflow/contracts';
import type { EngineState, QueuedCard } from '@tripflow/context-engine';
import { emptyWorkspace, type LocalTrip, type PendingProposal, type Workspace } from './types';
import { loadAllTrips, saveTrip, deleteTrip as rmTrip, StorageError } from './storage';
import { commitProposal, landInitialPlan, redoPlan, undoPlan, updateSettings } from './planOps';
import { nowIso, uid } from '../lib/id';

type State = {
  loaded: boolean;
  trips: Record<string, LocalTrip>;
  rejected: { key: string; reason: string }[];
  saveError?: string;
  capabilities?: CapabilitySet;
  capabilityError?: string;
  /** 每个 trip 的请求代次：新请求或计划变化时递增，晚到结果按代次拒收 */
  gen: Record<string, number>;
  queues: Record<string, QueuedCard[]>;   // 主动卡片队列（内存）
  active: Record<string, QueuedCard | undefined>;
};

type Actions = {
  load: () => Promise<void>;
  setCapabilities: (c?: CapabilitySet, err?: string) => void;
  createTrip: () => Promise<string>;
  removeTrip: (id: string) => Promise<void>;
  saveDraft: (id: string, d: Partial<LocalTrip['draft']>) => Promise<void>;
  landPlan: (id: string, plan: TripState, contents: PreparedContent[], requirements: TripRequirements) => Promise<void>;
  setPending: (id: string, p?: PendingProposal) => Promise<void>;
  commit: (id: string, proposal: RevisionProposal, acceptUnknown: boolean) => Promise<void>;
  undo: (id: string) => Promise<void>;
  redo: (id: string) => Promise<void>;
  settings: (id: string, patch: Parameters<typeof updateSettings>[1]) => Promise<void>;
  putContents: (id: string, c: PreparedContent[]) => Promise<void>;
  appendLog: (id: string, entries: EventLogEntry[]) => void;
  setGeo: (id: string, g: EngineState[]) => void;
  startDemo: (id: string) => Promise<string>;
  stopDemo: (id: string) => Promise<void>;
  advanceSimClock: (id: string, seconds: number) => string;
  clearAll: () => Promise<void>;
  bumpGen: (id: string) => number;
  enqueue: (id: string, q: QueuedCard) => void;
  setQueue: (id: string, qs: QueuedCard[], active?: QueuedCard) => void;
};

const chains: Record<string, Promise<void>> = {};
function persist(t: LocalTrip): Promise<void> {
  const prev = chains[t.tripId] ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(() => saveTrip(t));
  chains[t.tripId] = next.catch(() => undefined);
  return next;
}

export const activeWs = (t?: LocalTrip): Workspace | undefined => (t ? (t.demo ?? t.real) : undefined);
export const execCtx = (t: LocalTrip): { executionMode: ExecutionMode; demoRunId?: string } =>
  t.demo ? { executionMode: 'DEMO', demoRunId: t.demo.demoRunId } : { executionMode: 'REAL' };

export const useTrips = create<State & Actions>((set, get) => {
  /** 先持久化成功，再更新内存（用于正式计划写入：存储失败不得显示成功）。 */
  async function durable(id: string, fn: (t: LocalTrip) => LocalTrip) {
    const t = get().trips[id];
    if (!t) throw new Error('行程不存在');
    const next = fn(t);
    next.savedSeq = t.savedSeq + 1;
    try {
      await persist(next);
    } catch (e) {
      const msg = e instanceof StorageError ? e.message : String(e);
      set({ saveError: `保存失败：${msg}。正式计划保持为上一次成功保存的版本。` });
      throw e;
    }
    const latest = get().trips[id];
    if (latest && latest.savedSeq !== t.savedSeq) {
      // 期间有事实类写入（定位/日志）：在最新状态上重放同一变更，避免丢失事实记录
      let merged: LocalTrip;
      try { merged = { ...fn(latest), savedSeq: latest.savedSeq + 1 }; } catch { merged = { ...next, savedSeq: latest.savedSeq + 1 }; }
      set((s) => ({ trips: { ...s.trips, [id]: merged }, saveError: undefined }));
      persist(merged).catch((e) => set({ saveError: `保存失败：${(e as Error).message}` }));
      return;
    }
    set((s) => ({ trips: { ...s.trips, [id]: next }, saveError: undefined }));
  }
  /** 事实类写入：立即更新内存，异步落盘；失败只提示。 */
  function record(id: string, fn: (t: LocalTrip) => LocalTrip) {
    const t = get().trips[id];
    if (!t) return;
    const next = { ...fn(t), savedSeq: t.savedSeq + 1 };
    set((s) => ({ trips: { ...s.trips, [id]: next } }));
    persist(next).catch((e) => set({ saveError: `事件记录保存失败：${(e as Error).message}` }));
  }
  const onWs = (t: LocalTrip, f: (w: Workspace) => Workspace): LocalTrip =>
    t.demo ? { ...t, demo: { ...t.demo, ...f(t.demo) } } : { ...t, real: f(t.real) };

  return {
    loaded: false, trips: {}, rejected: [], gen: {}, queues: {}, active: {},
    async load() {
      const { trips, rejected } = await loadAllTrips().catch((e) => ({ trips: [] as LocalTrip[], rejected: [{ key: '*', reason: String(e) }] }));
      set({ loaded: true, trips: Object.fromEntries(trips.map((t) => [t.tripId, t])), rejected });
    },
    setCapabilities: (c, err) => set({ capabilities: c, capabilityError: err }),
    async createTrip() {
      const t: LocalTrip = { tripId: uid('trip'), createdAt: nowIso(), savedSeq: 0, draft: { text: '' }, real: emptyWorkspace() };
      await persist(t).catch((e) => { set({ saveError: `无法创建本地行程：${(e as Error).message}` }); throw e; });
      set((s) => ({ trips: { ...s.trips, [t.tripId]: t } }));
      return t.tripId;
    },
    async removeTrip(id) {
      await rmTrip(id);
      set((s) => { const trips = { ...s.trips }; delete trips[id]; return { trips }; });
    },
    saveDraft: (id, d) => durable(id, (t) => ({ ...t, draft: { ...t.draft, ...d } })),
    async landPlan(id, plan, contents, requirements) {
      await durable(id, (t) => {
        const ws = landInitialPlan(t.real, { ...plan, requirements }, id);
        return { ...t, draft: { ...t.draft, requirements }, real: { ...ws, contents } };
      });
      get().bumpGen(id);
    },
    setPending: (id, p) => durable(id, (t) => onWs(t, (w) => ({ ...w, pending: p }))),
    async commit(id, proposal, acceptUnknown) {
      await durable(id, (t) => onWs(t, (w) => commitProposal(w, proposal, { acceptUnknown })));
      get().bumpGen(id);
    },
    async undo(id) { await durable(id, (t) => onWs(t, undoPlan)); get().bumpGen(id); },
    async redo(id) { await durable(id, (t) => onWs(t, redoPlan)); get().bumpGen(id); },
    async settings(id, patch) { await durable(id, (t) => onWs(t, (w) => updateSettings(w, patch))); get().bumpGen(id); },
    putContents: (id, c) => durable(id, (t) => onWs(t, (w) => {
      const ids = new Set(c.map((x) => x.contentId));
      return { ...w, contents: [...w.contents.filter((x) => !ids.has(x.contentId)), ...c] };
    })),
    appendLog: (id, entries) => record(id, (t) => onWs(t, (w) => ({ ...w, eventLog: [...w.eventLog, ...entries].slice(-500) }))),
    setGeo: (id, g) => record(id, (t) => onWs(t, (w) => ({ ...w, geo: g }))),
    async startDemo(id) {
      const demoRunId = uid('demo');
      await durable(id, (t) => {
        if (!t.real.plan) throw new Error('需要先有已确认行程');
        const plan = t.real.plan;
        // 演示副本：独立计划/撤销栈/事实日志；进度清零，不继承真实到达事实
        const copy: TripState = { ...plan, activities: plan.activities.map((a) => ({ ...a, progress: 'NOT_STARTED' as const })) };
        const start = new Date(plan.activities[0]?.startAt ?? nowIso());
        start.setMinutes(start.getMinutes() - 20);
        return { ...t, demo: { ...emptyWorkspace(), plan: copy, contents: t.real.contents, demoRunId, startedAt: nowIso(), simClock: start.toISOString() } };
      });
      set((s) => ({ queues: { ...s.queues, [id]: [] }, active: { ...s.active, [id]: undefined } }));
      get().bumpGen(id);
      return demoRunId;
    },
    async stopDemo(id) {
      await durable(id, (t) => ({ ...t, demo: undefined }));
      set((s) => ({ queues: { ...s.queues, [id]: [] }, active: { ...s.active, [id]: undefined } }));
      get().bumpGen(id);
    },
    advanceSimClock(id, seconds) {
      const t = get().trips[id];
      if (!t?.demo) return nowIso();
      const next = new Date(Date.parse(t.demo.simClock) + seconds * 1000).toISOString();
      record(id, (x) => (x.demo ? { ...x, demo: { ...x.demo, simClock: next } } : x));
      return next;
    },
    async clearAll() {
      for (const id of Object.keys(get().trips)) await rmTrip(id);
      set({ trips: {}, queues: {}, active: {} });
    },
    bumpGen(id) {
      const n = (get().gen[id] ?? 0) + 1;
      set((s) => ({ gen: { ...s.gen, [id]: n } }));
      return n;
    },
    enqueue: (id, q) => set((s) => ({ queues: { ...s.queues, [id]: [...(s.queues[id] ?? []), q] } })),
    setQueue: (id, qs, active) => set((s) => ({ queues: { ...s.queues, [id]: qs }, active: { ...s.active, [id]: active } })),
  };
});
