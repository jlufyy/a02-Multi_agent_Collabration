import { useEffect, useState } from 'react';
import type { GeoPoint, ItineraryActivity, NearbyCandidate, SelectedContext, TripState } from '@tripflow/contracts';
import { jobs } from '../api/client';
import { useJob } from '../lib/useJob';
import { useTrips, execCtx } from '../store/tripStore';
import { AgentProgress } from './AgentProgress';
import { MapView } from './MapView';
import { PlaceThumb } from './Illustrations';
import { ErrorBox, Spinner, fmtDateTime, fmtMin } from './ui';
import { Icon } from './Icon';
import { safeSourceUrl } from '../lib/validationMessages';

type NearbyData = { candidates: NearbyCandidate[]; notes?: string[]; searchedRadiusMeters?: number };
type Anchor = { location: GeoPoint; label: string; activityId?: string };
const meters = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)} 公里` : `${Math.round(n)} 米`;

export function FoodPanel({ tripId, plan, ctx, me, initialRequest, onClose, onChoose, chooseError, simulated }: {
  tripId: string; plan: TripState; ctx: SelectedContext; me?: GeoPoint; initialRequest?: string;
  onClose: () => void; onChoose: (candidate: NearbyCandidate, anchorId?: string) => Promise<boolean>;
  chooseError?: unknown; simulated?: boolean;
}) {
  const day = plan.activities.filter((a) => a.dayIndex === ctx.activeDay).sort((a, b) => a.orderIndex - b.orderIndex);
  const selected = day.find((a) => a.id === ctx.selectedActivityId) ?? day.find((a) => ['ARRIVED', 'VISITING'].includes(a.progress)) ?? day[0];
  const [anchor, setAnchor] = useState<Anchor | undefined>(() => me ? { location: me, label: simulated ? '演示模拟位置' : '当前位置' }
    : selected ? { location: selected.place.location, label: selected.place.name, activityId: selected.id } : undefined);
  const [query, setQuery] = useState(initialRequest ?? plan.preferences.filter((p) => /美食|餐|辣|菜|小吃|火锅|清真|素食/.test(p)).join('，'));
  const [radius, setRadius] = useState(2000);
  const [walk, setWalk] = useState(30);
  const [budget, setBudget] = useState('');
  const [data, setData] = useState<NearbyData>();
  const [picked, setPicked] = useState<string>();
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [adding, setAdding] = useState(false);
  const job = useJob<NearbyData>(tripId);

  async function search(point = anchor) {
    if (!point) return;
    setPicked(undefined); setData(undefined);
    const trip = useTrips.getState().trips[tripId];
    const context = { ...ctx, selectedActivityId: point.activityId, selectedPoiId: plan.activities.find((a) => a.id === point.activityId)?.place.poiId };
    const out = await job.run((handlers) => jobs.nearby({ ...execCtx(trip), tripId, baseRevision: plan.revision,
      tripState: plan, selectedContext: context, location: point.location, category: 'FOOD', preferences: query.trim() ? [query] : [],
      radiusMeters: radius, maxWalkMinutes: walk, maxAverageCostCny: budget ? Number(budget) : undefined, includeReviews: true }, handlers));
    if (out?.result) setData(out.result);
  }
  useEffect(() => { void search(); return job.cancel; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function locate() {
    setLocationError('');
    if (!navigator.geolocation) { setLocationError('定位暂不可用，可以选择一个景点作为参考点。'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition((pos) => {
      setLocating(false);
      if (pos.coords.accuracy > 150) { setLocationError('当前位置精度不足，请稍后重试或选择景点。'); return; }
      const point: Anchor = { location: { lat: pos.coords.latitude, lng: pos.coords.longitude, coordinateSystem: 'WGS84' }, label: '当前位置' };
      setAnchor(point); void search(point);
    }, () => { setLocating(false); setLocationError('没有取得当前位置。可以继续围绕选中的景点查找，不影响行程。'); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }

  return <div className="animate-rise fixed inset-0 z-[58] mx-auto flex max-w-[560px] flex-col bg-paper" role="dialog" aria-modal="true" aria-label="附近美食推荐">
    <header className="flex items-center gap-3 bg-white px-4 pb-3 pt-[calc(14px+var(--safe-t))]">
      <button className="icon-btn !shadow-none" onClick={onClose} aria-label="关闭"><Icon name="back" size={20} /></button>
      <div className="flex-1"><h2 className="text-[20px] font-bold">附近吃什么</h2><p className="mt-0.5 text-[12px] text-ink-faint">到了再选 · 看清位置与评价再决定</p></div>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(24px+var(--safe-b))]">
      <section className="mt-3 rounded-[18px] bg-white p-4">
        <div className="flex items-start gap-2"><Icon name="pin" size={18} className="mt-0.5 shrink-0 text-brand" /><div className="min-w-0 flex-1"><p className="text-[12px] text-ink-faint">所有距离均从这里出发</p><p className="mt-1 text-[15px] font-semibold">{anchor?.label ?? '请选择参考位置'}</p></div>
          <button className="shrink-0 text-[13px] font-medium text-brand disabled:opacity-50" onClick={locate} disabled={locating || job.running}>{locating ? '正在定位…' : '用当前位置'}</button></div>
        <label className="mt-3 block text-[12px] text-ink-soft">也可以围绕一个行程地点查找
          <select className="field mt-1" aria-label="美食推荐参考地点" value={anchor?.activityId ?? ''} disabled={job.running} onChange={(e) => {
            const a = day.find((v) => v.id === e.target.value); if (!a) return;
            const point = { location: a.place.location, label: a.place.name, activityId: a.id }; setAnchor(point); void search(point);
          }}><option value="" disabled>{anchor?.activityId ? '选择地点' : anchor?.label ?? '选择地点'}</option>{day.map((a) => <option key={a.id} value={a.id}>{a.place.name}</option>)}</select>
        </label>
        {locationError && <p role="status" className="mt-2 text-[12px] text-warn">{locationError}</p>}
        <form className="mt-3" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <label className="label" htmlFor="food-preference">这顿想吃什么</label>
          <input id="food-preference" className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例如：湘菜、微辣、清真、当地小吃" />
          <div className="mt-2 flex flex-wrap gap-1.5">{['当地特色', '湘菜', '川菜', '火锅', '清真'].map((p) => <button key={p} type="button" className="chip bg-brand-mist !px-3 !py-1.5 text-brand" onClick={() => setQuery(p)}>{p}</button>)}</div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <label className="text-[12px] text-ink-soft">范围<select className="field mt-1 !px-2" aria-label="餐馆搜索范围" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>{[1000, 2000, 3000, 5000].map((r) => <option key={r} value={r}>{r / 1000} 公里内</option>)}</select></label>
            <label className="text-[12px] text-ink-soft">步行<select className="field mt-1 !px-2" aria-label="最长步行时间" value={walk} onChange={(e) => setWalk(Number(e.target.value))}>{[15, 30, 45, 60].map((w) => <option key={w} value={w}>{w} 分钟内</option>)}</select></label>
            <label className="text-[12px] text-ink-soft">人均<select className="field mt-1 !px-2" aria-label="餐馆人均预算" value={budget} onChange={(e) => setBudget(e.target.value)}><option value="">不限</option>{[50, 100, 200].map((b) => <option key={b} value={b}>约 ¥{b} 内</option>)}</select></label>
          </div>
          <button className="btn-primary mt-3 w-full" disabled={!anchor || job.running}>{job.running ? <><Spinner />正在核验餐馆、路线与评价…</> : '按这些偏好推荐'}</button>
        </form>
      </section>
      {job.running && <div className="mt-3"><AgentProgress events={job.progress} running /></div>}
      {job.error != null && <div className="mt-3"><ErrorBox error={job.error} onRetry={() => void search()} /></div>}
      {chooseError != null && <div className="mt-3"><ErrorBox error={chooseError} compact /></div>}
      {data && <>
        <div className="mb-3 mt-5 flex items-center justify-between"><h3 className="text-[16px] font-semibold">为你找到 {data.candidates.length} 家</h3><span className="text-[12px] text-ink-faint">参考点周围 {(data.searchedRadiusMeters ?? 2000) / 1000} 公里</span></div>
        {data.notes?.map((note, i) => <p key={i} className="mb-2 text-[12px] leading-relaxed text-ink-soft">{note}</p>)}
        {!data.candidates.length && <div className="card mt-3 p-5 text-[14px] text-ink-soft">当前范围里没有符合条件的餐馆。试试扩大到 3 公里，或放宽口味、步行时间条件。</div>}
        <div className="mt-3 space-y-3">{data.candidates.map((candidate) => <RestaurantCard key={candidate.place.poiId} candidate={candidate} expanded={picked === candidate.place.poiId}
          anchor={anchor} plan={plan} onExpand={() => setPicked(picked === candidate.place.poiId ? undefined : candidate.place.poiId)} busy={adding}
          onChoose={async () => { setAdding(true); try { if (await onChoose(candidate, anchor?.activityId)) onClose(); } finally { setAdding(false); } }} />)}</div>
      </>}
    </div>
  </div>;
}

export function RestaurantCard({ candidate: c, expanded, anchor, plan, onExpand, onChoose, busy }: {
  candidate: NearbyCandidate; expanded: boolean; anchor?: Anchor; plan: TripState; onExpand: () => void; onChoose: () => void; busy: boolean;
}) {
  const p = c.place;
  const routeVerified = c.route?.evidence.status === 'VERIFIED' && c.route.durationMin !== undefined;
  return <article className="overflow-hidden rounded-[18px] bg-white p-4">
    <div className="flex gap-3"><PlaceThumb name={p.name} place={p} size={76} rounded={12} /><div className="min-w-0 flex-1"><h4 className="text-[16px] font-semibold leading-snug">{p.name}</h4>
      <p className="mt-1 text-[12px] text-ink-soft">{p.rating?.value !== undefined ? `高德评分 ${p.rating.value}` : '高德暂无评分'}<span className="mx-1.5">·</span>{p.averageCostCny?.value !== undefined ? `人均约 ¥${p.averageCostCny.value}` : '人均消费待确认'}</p>
      <p className={`mt-1 text-[13px] font-medium ${routeVerified ? 'text-brand' : 'text-warn'}`}>{routeVerified ? `步行约 ${fmtMin(c.route!.durationMin!)}${c.route?.distanceMeters !== undefined ? ` · 路程 ${meters(c.route.distanceMeters)}` : ''}` : '步行路线暂未核验'}</p>
      {!routeVerified && c.distanceMeters !== undefined && <p className="text-[11px] text-ink-faint">直线约 {meters(c.distanceMeters)}，不代表实际路程</p>}
    </div></div>
    <p className="mt-3 flex items-start gap-1.5 text-[12px] text-ink-soft"><Icon name="pin" size={14} className="mt-0.5 shrink-0" />{p.address ?? '地址暂未取得，请先查看地图位置'}</p>
    {c.preferenceMatches.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{c.preferenceMatches.map((m) => <span key={m} className="chip bg-brand-mist text-brand">{m}</span>)}</div>}
    <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">{c.relevanceReason}</p>
    <button className="btn-soft mt-3 w-full" onClick={onExpand}>{expanded ? '收起详情' : '查看位置、路线与评价'}<Icon name="chevron" size={15} className={expanded ? '-rotate-90' : 'rotate-90'} /></button>
    {expanded && <div className="mt-3 space-y-3">
      {anchor && <RestaurantMap candidate={c} anchor={anchor} plan={plan} />}
      <p className="text-[12px] leading-relaxed text-ink-soft">从「{anchor?.label}」出发到「{p.name}」。{!c.route?.routeGeometry?.length && '地图仅标出两处位置；尚未获取实际道路轨迹。'}</p>
      {p.openingHours?.value && <p className="text-[12px] text-ink-soft">营业时间：{p.openingHours.value}（商家信息，以到店为准）</p>}
      <ReviewReferences research={c.reviewResearch} />
      <button className="btn-primary w-full" onClick={onChoose} disabled={busy}>{busy ? <Spinner /> : '加入当天行程并核验时间'}</button>
      <p className="text-center text-[11px] text-ink-faint">先预览交通和时间变化，确认后才会改动行程</p>
    </div>}
  </article>;
}

function RestaurantMap({ candidate, anchor, plan }: { candidate: NearbyCandidate; anchor: Anchor; plan: TripState }) {
  const startAt = `${plan.startDate}T12:00:00+08:00`, endAt = `${plan.startDate}T13:00:00+08:00`;
  const common = { dayIndex: 0, startAt, endAt, costStatus: 'UNKNOWN' as const, locked: false, mandatory: false, progress: 'NOT_STARTED' as const, intentIds: [] };
  const activities: ItineraryActivity[] = [{ ...common, id: 'food-anchor', orderIndex: 0, place: { poiId: 'food-reference', name: anchor.label, location: anchor.location, evidence: [] } },
    { ...common, id: 'food-restaurant', orderIndex: 1, place: candidate.place }];
  const route = candidate.route;
  return <div><div className="relative h-[240px] overflow-hidden rounded-[14px] border border-sand"><MapView activities={activities}
    segments={route?.routeGeometry?.length ? [{ ...route, fromActivityId: 'food-anchor', toActivityId: 'food-restaurant' }] : []}
    boundary={[]} bottomInset={0} onSelect={() => undefined} /></div><p className="mt-1.5 text-[11px] text-ink-faint">地图 1：{anchor.label} · 2：{candidate.place.name} · 蓝线为取得的实际步行轨迹</p></div>;
}

function ReviewReferences({ research }: { research: NearbyCandidate['reviewResearch'] }) {
  return <section className="rounded-[14px] bg-[#F6F8FB] p-3.5"><h5 className="text-[14px] font-semibold">公开评价参考</h5>
    <p className="mb-2 mt-1 text-[11px] leading-relaxed text-ink-faint">高德评分来自平台商家信息；以下摘要保留原始来源，不生成虚构用户、评价条数或到店经历。</p>
    {research?.references.length ? research.references.map((r, i) => { const url = safeSourceUrl(r.url); return url ? <div key={i} className="mt-2 border-t border-sand pt-2">
      <p className="whitespace-pre-line text-[12px] leading-relaxed text-ink-soft">{r.snippet}</p>
      <a href={url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-[12px] text-brand underline">{r.title} · 查看原文</a>
      <p className="mt-1 text-[10.5px] text-ink-faint">{new URL(url).hostname} · 查询于 {fmtDateTime(research.checkedAt)}</p>
    </div> : null; }) : <p className="text-[12px] text-ink-soft">暂无能确认属于这家店的公开评价。你可以先根据位置、路程和高德评分判断。</p>}
  </section>;
}
