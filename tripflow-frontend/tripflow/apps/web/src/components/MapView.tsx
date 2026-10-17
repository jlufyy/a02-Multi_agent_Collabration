/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import AMapLoader from '@amap/amap-jsapi-loader';
import type { ItineraryActivity, TravelSegment, BoundarySegment, GeoPoint } from '@tripflow/contracts';
import { toSystem } from '@tripflow/context-engine';
import { Icon } from './Icon';

type MapLoad = 'loading' | 'ready' | 'failed' | 'unconfigured';
const KEY = import.meta.env.VITE_AMAP_KEY as string | undefined;

let loaderPromise: Promise<any> | null = null;
function loadAMap(): Promise<any> {
  if (!KEY) return Promise.reject(new Error('unconfigured'));
  if (!loaderPromise) {
    const host = import.meta.env.VITE_AMAP_SERVICE_HOST as string | undefined;
    const code = import.meta.env.VITE_AMAP_SECURITY_CODE as string | undefined;
    if (host) (window as any)._AMapSecurityConfig = { serviceHost: host };
    else if (code) (window as any)._AMapSecurityConfig = { securityJsCode: code };
    loaderPromise = AMapLoader.load({ key: KEY, version: '2.0', plugins: ['AMap.Scale'] }).catch((e: unknown) => { loaderPromise = null; throw e; });
  }
  return loaderPromise;
}

const ll = (p: GeoPoint) => { const g = toSystem(p, 'GCJ02'); return [g.lng, g.lat] as [number, number]; };

export type MapProps = {
  activities: ItineraryActivity[];
  segments: TravelSegment[];
  boundary: BoundarySegment[];
  preview?: { activities: ItineraryActivity[]; segments: TravelSegment[] };
  selectedId?: string;
  onSelect: (id: string) => void;
  me?: { location: GeoPoint; accuracy?: number; simulated: boolean };
  bottomInset: number;
  /** 外部请求把地图移到某点（如“定位下一站”），key 变化即触发 */
  focus?: { point: GeoPoint; key: number };
};

/** 高德真实地图。路线只画服务返回的 routeGeometry；没有几何的路段不画直线冒充道路。 */
export function MapView(p: MapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const AM = useRef<any>(null);
  const layers = useRef<any[]>([]);
  const meLayer = useRef<any[]>([]);
  const [state, setState] = useState<MapLoad>(KEY ? 'loading' : 'unconfigured');
  const [err, setErr] = useState<string>();
  const onSelect = useRef(p.onSelect); onSelect.current = p.onSelect;

  useEffect(() => {
    if (!KEY) return;
    let dead = false;
    loadAMap().then((AMap) => {
      if (dead || !el.current) return;
      AM.current = AMap;
      map.current = new AMap.Map(el.current, { zoom: 13, viewMode: '2D', mapStyle: 'amap://styles/whitesmoke', resizeEnable: true });
      map.current.addControl(new AMap.Scale());
      setState('ready');
    }).catch((e: unknown) => { if (!dead) { setState('failed'); setErr(String((e as Error)?.message ?? e)); } });
    return () => { dead = true; map.current?.destroy?.(); map.current = null; };
  }, []);

  // 标记与路线
  useEffect(() => {
    const AMap = AM.current; const m = map.current;
    if (state !== 'ready' || !AMap || !m) return;
    m.remove(layers.current); layers.current = [];
    const addLine = (geo: GeoPoint[], preview: boolean) => {
      const line = new AMap.Polyline({
        path: geo.map(ll), strokeColor: preview ? '#F08A24' : '#2F7CF6', strokeWeight: preview ? 5 : 6, strokeOpacity: preview ? 0.9 : 0.85,
        strokeStyle: preview ? 'dashed' : 'solid', strokeDasharray: preview ? [10, 8] : undefined, lineJoin: 'round', showDir: !preview,
      });
      layers.current.push(line);
    };
    const src = p.preview ?? { activities: p.activities, segments: p.segments };
    if (p.preview) p.segments.forEach((s) => s.routeGeometry?.length && addLine(s.routeGeometry, false));
    src.segments.forEach((s) => s.routeGeometry && s.routeGeometry.length > 1 && addLine(s.routeGeometry, !!p.preview));
    p.boundary.forEach((s) => s.routeGeometry && s.routeGeometry.length > 1 && addLine(s.routeGeometry, false));
    src.activities.forEach((a, i) => {
      const sel = a.id === p.selectedId;
      const done = a.progress === 'INFERRED_COMPLETE';
      const here = a.progress === 'ARRIVED' || a.progress === 'VISITING';
      const html = `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;cursor:pointer">
        <div style="min-width:30px;height:30px;padding:0 8px;border-radius:15px;display:flex;align-items:center;justify-content:center;gap:4px;
          font:600 13px/1 'Noto Sans SC',sans-serif;color:${sel ? '#fff' : done ? '#5B6676' : '#1D3B6E'};
          background:${sel ? '#F08A24' : here ? '#2F7CF6' : done ? '#E7ECF3' : '#FFFFFF'};${here && !sel ? 'color:#FFFFFF;' : ''}
          border:2px solid ${sel ? '#fff' : '#2F7CF6'};box-shadow:0 6px 16px -6px rgba(29,59,110,.55)">
          ${i + 1}${sel ? `<span style="font-weight:500;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(a.place.name)}</span>` : ''}
        </div><div style="width:2px;height:8px;background:${sel ? '#F08A24' : '#2F7CF6'}"></div></div>`;
      const mk = new AMap.Marker({ position: ll(a.place.location), content: html, offset: new AMap.Pixel(0, 0), zIndex: sel ? 200 : 100 + i, title: a.place.name });
      mk.on('click', () => onSelect.current(a.id));
      layers.current.push(mk);
    });
    m.add(layers.current);
    if (!p.selectedId && src.activities.length) m.setFitView(layers.current, false, [80, p.bottomInset + 40, 40, 40]);
  }, [state, p.activities, p.segments, p.boundary, p.preview, p.selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 选中联动：panTo
  useEffect(() => {
    if (state !== 'ready' || !p.selectedId) return;
    const a = (p.preview?.activities ?? p.activities).find((x) => x.id === p.selectedId);
    if (a) {
      map.current?.setZoomAndCenter(Math.max(map.current.getZoom(), 14), ll(a.place.location), false, 300);
      map.current?.panBy(0, -p.bottomInset / 3);
    }
  }, [p.selectedId, state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state !== 'ready' || !p.focus) return;
    map.current?.setZoomAndCenter(15, ll(p.focus.point), false, 300);
    map.current?.panBy(0, -p.bottomInset / 3);
  }, [p.focus?.key, state]); // eslint-disable-line react-hooks/exhaustive-deps

  // 当前位置
  useEffect(() => {
    const AMap = AM.current; const m = map.current;
    if (state !== 'ready' || !AMap || !m) return;
    m.remove(meLayer.current); meLayer.current = [];
    if (!p.me) return;
    const pos = ll(p.me.location);
    if (p.me.accuracy) meLayer.current.push(new AMap.Circle({ center: pos, radius: p.me.accuracy, strokeWeight: 0, fillColor: p.me.simulated ? '#F08A24' : '#2F7CF6', fillOpacity: 0.12 }));
    meLayer.current.push(new AMap.Marker({
      position: pos, zIndex: 300,
      content: `<div style="transform:translate(-50%,-50%);width:18px;height:18px;border-radius:50%;background:${p.me.simulated ? '#F08A24' : '#2F7CF6'};border:3px solid #fff;box-shadow:0 0 0 6px ${p.me.simulated ? 'rgba(240,138,36,.22)' : 'rgba(47,124,246,.22)'}"></div>`,
    }));
    m.add(meLayer.current);
  }, [state, p.me]);

  return (
    <div className="absolute inset-0 bg-[#E9EEF5]">
      <div ref={el} className="absolute inset-0" />
      {state === 'ready' && (
        <div className="glass absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col overflow-hidden rounded-[12px]">
          <button className="glass-stack-btn !h-10 !w-10" aria-label="放大地图" onClick={() => map.current?.zoomIn()}><Icon name="zoomIn" size={18} /></button>
          <button className="glass-stack-btn !h-10 !w-10" aria-label="缩小地图" onClick={() => map.current?.zoomOut()}><Icon name="zoomOut" size={18} /></button>
        </div>
      )}
      {state !== 'ready' && (
        <div className="pointer-events-none absolute inset-x-0 top-[calc(66px+var(--safe-t))] flex justify-center px-16">
          <div className="glass flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-ink-soft" role="status"
            title={state === 'failed' ? err : undefined}>
            <Icon name="map" size={14} className={state === 'loading' ? 'text-ink-faint' : 'text-warn'} />
            {state === 'loading' && '地图加载中…'}
            {state === 'unconfigured' && '地图未配置 · 行程仍可编辑'}
            {state === 'failed' && '地图加载失败 · 行程仍可编辑'}
          </div>
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
