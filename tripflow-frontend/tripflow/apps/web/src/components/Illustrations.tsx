/** 原创矢量插画（不使用真实照片，避免把示意图冒充真实地点图片）。 */

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="lg-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5AA2FF" /><stop offset="1" stopColor="#1D63D8" /></linearGradient>
      </defs>
      <path d="M10 6c0-2 2-3.2 3.8-2.2l26 15c1.7 1 1.7 3.4 0 4.4l-26 15C12 39.2 10 38 10 36V6z" fill="url(#lg-a)" />
      <path d="M10 22l14-3-14 13z" fill="#fff" opacity=".35" />
    </svg>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { Place } from '@tripflow/contracts';
import { api } from '../api/client';

const photoRequests = new Map<string, Promise<string[]>>();
let photoQueue = Promise.resolve();
function requestPhotos(poiId: string) {
  let request = photoRequests.get(poiId);
  if (!request) {
    request = photoQueue.then(() => api.placeDetail(poiId).then((r) => r.data?.photoUrls ?? []).catch(() => []));
    photoQueue = request.then(() => undefined);
    if (photoRequests.size >= 200) photoRequests.delete(photoRequests.keys().next().value!);
    photoRequests.set(poiId, request);
  }
  return request;
}

function PlacePhoto({ place, size, rounded = 12, hero = false }: { place: Place; size?: number; rounded?: number; hero?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [loaded, setLoaded] = useState<{ id: string; urls: string[] }>();
  const [failed, setFailed] = useState<string[]>([]);
  const urls = place.photoUrls?.length ? place.photoUrls : loaded?.id === place.poiId ? loaded.urls : [];
  const src = urls.find((url) => !failed.includes(url));
  useEffect(() => {
    if (place.photoUrls?.length) return;
    let active = true;
    const load = () => requestPhotos(place.poiId).then((photos) => { if (active) setLoaded({ id: place.poiId, urls: photos }); });
    if (!('IntersectionObserver' in window)) { void load(); return () => { active = false; }; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { observer.disconnect(); void load(); } }, { rootMargin: '100px' });
    if (ref.current) observer.observe(ref.current);
    return () => { active = false; observer.disconnect(); };
  }, [place.poiId, place.photoUrls]);
  return <span ref={ref} className={`relative block shrink-0 overflow-hidden bg-[#E7EEF5] ${hero ? 'h-[210px] w-full' : ''}`} style={hero ? undefined : { width: size, height: size, borderRadius: rounded }}>
    {src ? <img src={src} alt={`${place.name} 景点照片`} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setFailed((old) => [...old, src])} />
      : <><PavilionScene className="h-full w-full opacity-75" />{hero && <span className="absolute bottom-3 left-4 rounded-full bg-white/85 px-2.5 py-1 text-[11px] text-ink-soft">暂未取得照片 · 景观示意</span>}</>}
    {hero && src && <span className="absolute bottom-3 left-4 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white">高德地点照片 · {place.name}</span>}
  </span>;
}

export function LandscapeHero({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 390 300" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F4F8FE" /><stop offset="1" stopColor="#DCE9FB" /></linearGradient>
        <linearGradient id="m1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9CBBE2" /><stop offset="1" stopColor="#C9DBF2" /></linearGradient>
        <linearGradient id="m2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5C88C2" /><stop offset="1" stopColor="#8FB1DD" /></linearGradient>
        <linearGradient id="m3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2E5E9C" /><stop offset="1" stopColor="#5D86BF" /></linearGradient>
        <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#BFD5F2" /><stop offset="1" stopColor="#F4F8FE" /></linearGradient>
      </defs>
      <rect width="390" height="300" fill="url(#sky)" />
      <path d="M0 150 L60 92 L110 128 L170 70 L230 120 L290 84 L390 140 V190 H0Z" fill="url(#m1)" opacity=".8" />
      <path d="M0 175 L50 140 L95 160 L150 118 L205 162 L260 132 L320 158 L390 128 V200 H0Z" fill="url(#m2)" opacity=".85" />
      <path d="M0 196 L40 170 L80 188 L120 166 L160 192 L390 188 V206 H0Z" fill="url(#m3)" />
      <rect y="196" width="390" height="104" fill="url(#lake)" />
      <path d="M0 200 L40 214 L80 205 L120 216 L160 203 L390 204 V212 L0 214Z" fill="#7FA3D4" opacity=".25" />
      <g stroke="#fff" strokeOpacity=".7" strokeWidth="1.2"><path d="M40 236h60M150 248h80M260 230h70M90 266h50" /></g>
    </svg>
  );
}

/** 规划中插画：一座泛化的东方楼阁剪影 + 远山云气。 */
export function PavilionScene({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 170" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="pv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6E95CC" /><stop offset="1" stopColor="#A9C4E8" /></linearGradient>
        <radialGradient id="glow" cx=".5" cy=".55" r=".55"><stop offset="0" stopColor="#E4EEFC" /><stop offset="1" stopColor="#F4F7FB" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx="150" cy="95" rx="150" ry="80" fill="url(#glow)" />
      <path d="M10 140 L60 100 L95 122 L130 92 L160 118 L200 90 L240 116 L290 98 V150 H10Z" fill="#C9DAF1" />
      <g fill="url(#pv)">
        <rect x="139" y="40" width="22" height="14" />
        <path d="M120 54 Q150 44 180 54 L176 58 Q150 50 124 58Z" />
        <path d="M150 26 L156 38 L144 38Z" />
        <path d="M128 38 Q150 30 172 38 L168 42 Q150 36 132 42Z" />
        <rect x="132" y="58" width="36" height="20" />
        <path d="M110 78 Q150 66 190 78 L184 84 Q150 74 116 84Z" />
        <rect x="124" y="84" width="52" height="28" />
        <path d="M100 112 Q150 98 200 112 L192 118 Q150 106 108 118Z" />
        <rect x="112" y="118" width="76" height="24" />
        <rect x="96" y="142" width="108" height="8" />
      </g>
      <g fill="#fff" opacity=".9"><rect x="143" y="124" width="14" height="18" rx="7" /><rect x="132" y="92" width="8" height="12" rx="4" /><rect x="160" y="92" width="8" height="12" rx="4" /></g>
      <g fill="#fff" opacity=".85"><ellipse cx="60" cy="132" rx="38" ry="7" /><ellipse cx="236" cy="128" rx="44" ry="8" /></g>
    </svg>
  );
}

const THUMB_HUES = [['#DCE9FE', '#2F7CF6'], ['#E3F6EC', '#22A06B'], ['#FFF1E2', '#F08A24'], ['#EEE8FD', '#6D5BD0'], ['#FEE9E9', '#E05A5A']];
/** 地点缩略图：契约中没有图片字段，因此用名称首字的色块，不伪造照片。 */
export function PlaceThumb({ name, place, size = 56, rounded = 12 }: { name: string; place?: Place; size?: number; rounded?: number }) {
  if (place) return <PlacePhoto key={place.poiId} place={place} size={size} rounded={rounded} />;
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = THUMB_HUES[h % THUMB_HUES.length];
  return (
    <span className="flex shrink-0 items-center justify-center font-semibold" aria-hidden="true"
      style={{ width: size, height: size, borderRadius: rounded, background: bg, color: fg, fontSize: size * 0.38 }}>
      <PavilionScene className="h-full w-full" />
    </span>
  );
}

export function PlaceHero({ name, place }: { name: string; place?: Place }) {
  if (place) return <PlacePhoto key={place.poiId} place={place} hero />;
  return (
    <div className="relative h-[210px] w-full overflow-hidden bg-gradient-to-b from-[#DCE9FB] to-[#F4F7FB]">
      <PavilionScene className="absolute inset-x-0 bottom-0 mx-auto h-[170px] w-full opacity-90" />
      <span className="absolute bottom-3 left-4 rounded-full bg-white/80 px-2.5 py-1 text-[11px] text-ink-soft backdrop-blur">示意插画 · {name}</span>
    </div>
  );
}
