/**
 * 本地持久化：IndexedDB（idb-keyval）。每个 tripId 一个键，整份 LocalTrip 作为单一序列化快照写入，
 * 因此“新计划 + undo/redo + 意图/路线/提醒策略”同一次写入要么全部成功要么全部失败。
 */
import { createStore, get, set, del, keys } from 'idb-keyval';
import type { LocalTrip } from './types';

const store = typeof indexedDB !== 'undefined' ? createStore('tripflow', 'trips') : undefined;
const KEY = (id: string) => `trip:${id}`;
export const LOCAL_SCHEMA = 1;

export class StorageError extends Error {}

export async function saveTrip(t: LocalTrip): Promise<void> {
  if (!store) throw new StorageError('当前浏览器不支持 IndexedDB');
  try {
    await set(KEY(t.tripId), JSON.parse(JSON.stringify({ ...t, localSchema: LOCAL_SCHEMA })), store);
    // 写入校验：读回比对修订号，防止静默失败
    const back = (await get(KEY(t.tripId), store)) as LocalTrip | undefined;
    if (!back || back.real.plan?.revision !== t.real.plan?.revision || back.savedSeq !== t.savedSeq) {
      throw new StorageError('写入校验失败');
    }
  } catch (e) {
    throw e instanceof StorageError ? e : new StorageError((e as Error).message || '保存失败');
  }
}

export async function loadAllTrips(): Promise<{ trips: LocalTrip[]; rejected: { key: string; reason: string }[] }> {
  if (!store) return { trips: [], rejected: [] };
  const ks = (await keys(store)).filter((k) => String(k).startsWith('trip:'));
  const trips: LocalTrip[] = [];
  const rejected: { key: string; reason: string }[] = [];
  for (const k of ks) {
    const v = (await get(k, store)) as (LocalTrip & { localSchema?: number }) | undefined;
    if (!v) continue;
    if (v.localSchema !== LOCAL_SCHEMA) { rejected.push({ key: String(k), reason: `未知本地版本 ${v.localSchema}` }); continue; }
    if (v.real.plan && v.real.plan.schemaVersion !== 1) { rejected.push({ key: String(k), reason: '未知 TripState schemaVersion' }); continue; }
    trips.push(v);
  }
  return { trips, rejected };
}

export async function deleteTrip(id: string) { if (store) await del(KEY(id), store); }
