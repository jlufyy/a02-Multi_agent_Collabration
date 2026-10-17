import { useState } from 'react';
import type { Place, ExecutionContext, GeoPoint } from '@tripflow/contracts';
import { api } from '../api/client';
import { Modal, ErrorBox, Spinner, DataBadge } from './ui';
import { Icon } from './Icon';

/** I07 地点检索与消歧：只展示真实返回的 POI；无结果如实说明，不凑数。 */
export function PlacePicker({ open, onClose, city, initialQuery, onPick, ctx, candidates, near }: {
  open: boolean; onClose: () => void; city?: string; initialQuery?: string; onPick: (p: Place) => void;
  ctx: ExecutionContext; candidates?: Place[]; near?: GeoPoint;
}) {
  const [q, setQ] = useState(initialQuery ?? '');
  const [res, setRes] = useState<Place[] | undefined>(candidates);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<unknown>();

  async function search() {
    if (!city) { setErr(new Error('请先填写目的地城市')); return; }
    setLoading(true); setErr(undefined);
    try {
      const r = await api.searchPlaces({ ...ctx, city, keyword: q.trim(), location: near });
      setRes(r.data?.places ?? []);
    } catch (e) { setErr(e); } finally { setLoading(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="选择真实地点">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input className="field flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`在${city ?? '目的地'}搜索地点`} autoFocus />
        <button className="btn-primary !px-4" disabled={!q.trim() || loading}>{loading ? <Spinner /> : '搜索'}</button>
      </form>
      {err != null && <div className="mt-3"><ErrorBox error={err} compact /></div>}
      {res && res.length === 0 && <p className="mt-4 text-center text-[14px] text-ink-faint">没有找到匹配的地点，换个关键词试试。</p>}
      <ul className="mt-3 space-y-2">
        {res?.map((p) => (
          <li key={p.poiId}>
            <button className="flex w-full items-start gap-3 rounded-btn border border-sand bg-card p-3 text-left hover:border-brand/50" onClick={() => { onPick(p); onClose(); }}>
              <Icon name="pin" className="mt-0.5 shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{p.name}</span>
                {p.address && <span className="block text-[12.5px] text-ink-soft">{p.address}</span>}
                <span className="mt-1 flex flex-wrap gap-1">{p.evidence.slice(0, 1).map((e, i) => <DataBadge key={i} status={e.status} label={e.provider} />)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
