/**
 * 浏览器可运行的定位纯函数（附录 A.4：B 主责编写与测试，A 集成）。
 *
 * 注意：本文件由前端先行起草以打通链路；阈值以 GeoPolicy 传入，运行时优先使用
 * GET /capabilities 返回的 geoPolicy。下方 INTERIM_GEO_POLICY 仅取 PRD §6.2 范围内的
 * 首轮试验值，B 冻结 GeoPolicy 后应替换，前端不另写一套数值。
 */
import type { ActivityProgress, GeoPoint, GeoPolicy, GeoRuntimeState, NormalizedLocationEvent, ProactiveEvent } from '@tripflow/contracts';

export const INTERIM_GEO_POLICY: GeoPolicy = {
  policyVersion: 'interim-frontend-0',
  arrivalRadiusMeters: 280,        // PRD 200–350
  departureRadiusMeters: 400,      // 到达 + 120（PRD +100–150）
  maxAccuracyMeters: 100,          // PRD accuracy<=100 优先
  arrivalDwellSeconds: 90,         // PRD 60–120
  departureDwellSeconds: 120,      // PRD 约 120
  minValidSamples: 3,              // PRD 未给值：待 B 冻结
  maxSpeedMetersPerSecond: 45,     // PRD 未给值：用于识别跳点
  maxSampleGapSeconds: 180,        // PRD 未给值：超过即不跨窗口累计驻留
};

// ---------- 坐标 ----------
const A = 6378245.0;
const EE = 0.00669342162296594323;
function outOfChina(lat: number, lng: number) { return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271; }
function tLat(x: number, y: number) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  r += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return r;
}
function tLng(x: number, y: number) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  r += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return r;
}
export function wgs84ToGcj02(p: GeoPoint): GeoPoint {
  if (p.coordinateSystem === 'GCJ02' || outOfChina(p.lat, p.lng)) return { ...p, coordinateSystem: p.coordinateSystem === 'GCJ02' ? 'GCJ02' : p.coordinateSystem };
  let dLat = tLat(p.lng - 105, p.lat - 35);
  let dLng = tLng(p.lng - 105, p.lat - 35);
  const radLat = (p.lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lat: p.lat + dLat, lng: p.lng + dLng, coordinateSystem: 'GCJ02' };
}
/** 近似逆变换（迭代），用于把 GCJ02 模拟轨迹还原成浏览器形式的 WGS84 样本。 */
export function gcj02ToWgs84(p: GeoPoint): GeoPoint {
  if (p.coordinateSystem === 'WGS84') return p;
  let g = { lat: p.lat, lng: p.lng, coordinateSystem: 'WGS84' as const };
  for (let i = 0; i < 4; i++) {
    const t = wgs84ToGcj02(g);
    g = { lat: g.lat - (t.lat - p.lat), lng: g.lng - (t.lng - p.lng), coordinateSystem: 'WGS84' };
  }
  return g;
}
/** 统一到指定坐标系后再计算距离；不混用坐标。 */
export function toSystem(p: GeoPoint, target: GeoPoint['coordinateSystem']): GeoPoint {
  if (p.coordinateSystem === target) return p;
  return target === 'GCJ02' ? wgs84ToGcj02(p) : gcj02ToWgs84(p);
}
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const bb = toSystem(b, a.coordinateSystem);
  const R = 6371008.8;
  const dLat = ((bb.lat - a.lat) * Math.PI) / 180;
  const dLng = ((bb.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((bb.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ---------- 状态机 ----------
/** 引擎内部状态 = 契约 GeoRuntimeState + 计数辅助字段（序列化时可一并保存，不进入后端请求）。 */
export type EngineState = GeoRuntimeState & {
  insideSamples: number; outsideSamples: number;
  lastValidLocation?: GeoPoint; anomalies: number;
};
export type StepTarget = { activityId: string; location: GeoPoint };
export type StepResult = { state: EngineState; events: Omit<ProactiveEvent, 'eventId' | 'revision'>[]; note?: string };

export function initialEngineState(tripId: string, activityId: string, source: 'REAL' | 'SIMULATED', demoRunId?: string): EngineState {
  return { tripId, activityId, source, demoRunId, progress: 'NOT_STARTED', insideSamples: 0, outsideSamples: 0, anomalies: 0 };
}

const sec = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 1000;

export function stepGeo(
  prev: EngineState, sample: NormalizedLocationEvent, target: StepTarget, policy: GeoPolicy,
  newArrivalId: () => string,
): StepResult {
  const s: EngineState = { ...prev };
  const events: StepResult['events'] = [];
  const base = { tripId: s.tripId, source: sample.source, demoRunId: sample.demoRunId, activityId: target.activityId } as const;
  const setProgress = (p: ActivityProgress) => { s.progress = p; };
  if (sample.source !== s.source || sample.demoRunId !== s.demoRunId) {
    return { state: prev, events, note: 'SOURCE_MISMATCH' };
  }

  // 1) 页面不可见：暂停推断，不跨窗口累计
  if (!sample.pageVisible) {
    if (s.progress === 'ARRIVED' || s.progress === 'VISITING') setProgress('LOCATION_UNKNOWN');
    s.candidateSince = undefined; s.outsideSince = undefined; s.insideSamples = 0; s.outsideSamples = 0;
    return { state: s, events, note: 'PAGE_HIDDEN' };
  }
  // 2) 精度不足：位置正在确认
  if (sample.accuracyMeters > policy.maxAccuracyMeters) {
    s.anomalies += 1;
    return { state: s, events, note: 'LOW_ACCURACY' };
  }
  const here = toSystem(sample.location, target.location.coordinateSystem);
  // 3) 长间隔：不跨缺失窗口累计驻留
  if (s.lastValidSampleAt && sec(s.lastValidSampleAt, sample.timestamp) > policy.maxSampleGapSeconds) {
    s.candidateSince = undefined; s.outsideSince = undefined; s.insideSamples = 0; s.outsideSamples = 0;
    if (s.progress === 'ARRIVED' || s.progress === 'VISITING') setProgress('LOCATION_UNKNOWN');
  }
  // 4) 跳点：与上一个有效点的隐含速度过大则丢弃
  if (s.lastValidLocation && s.lastValidSampleAt) {
    const dt = Math.max(1, sec(s.lastValidSampleAt, sample.timestamp));
    const v = distanceMeters(s.lastValidLocation, here) / dt;
    if (v > policy.maxSpeedMetersPerSecond || (sample.speedMetersPerSecond ?? 0) > policy.maxSpeedMetersPerSecond) {
      s.anomalies += 1;
      s.candidateSince = undefined; s.insideSamples = 0;
      return { state: s, events, note: 'JUMP_DISCARDED' };
    }
  }
  s.lastValidLocation = here;
  s.lastValidSampleAt = sample.timestamp;
  const d = distanceMeters(target.location, here);
  const t = sample.timestamp;
  const approachRadius = policy.departureRadiusMeters + 300;

  switch (s.progress) {
    case 'NOT_STARTED':
    case 'APPROACHING':
    case 'INFERRED_COMPLETE': {
      const revisiting = s.progress === 'INFERRED_COMPLETE';
      if (d <= policy.arrivalRadiusMeters) {
        s.candidateSince ??= t; s.insideSamples += 1;
        if (!revisiting && s.progress === 'NOT_STARTED') {
          setProgress('APPROACHING');
          events.push({ ...base, type: 'APPROACH', location: here, accuracyMeters: sample.accuracyMeters, occurredAt: t });
        }
        if (sec(s.candidateSince, t) >= policy.arrivalDwellSeconds && s.insideSamples >= policy.minValidSamples) {
          s.arrivalId = newArrivalId();
          setProgress('ARRIVED');
          s.candidateSince = undefined; s.insideSamples = 0; s.outsideSamples = 0; s.outsideSince = undefined;
          events.push({ ...base, type: 'ARRIVE', arrivalId: s.arrivalId, location: here, accuracyMeters: sample.accuracyMeters, occurredAt: t });
        }
      } else {
        s.candidateSince = undefined; s.insideSamples = 0;
        if (!revisiting) {
          if (d <= approachRadius && s.progress === 'NOT_STARTED') {
            setProgress('APPROACHING');
            events.push({ ...base, type: 'APPROACH', location: here, accuracyMeters: sample.accuracyMeters, occurredAt: t });
          } else if (d > approachRadius && s.progress === 'APPROACHING') {
            setProgress('NOT_STARTED');
          }
        }
      }
      break;
    }
    case 'ARRIVED':
    case 'VISITING':
    case 'LOCATION_UNKNOWN': {
      if (d <= policy.departureRadiusMeters) {
        if (s.progress === 'LOCATION_UNKNOWN') {
          events.push({ ...base, type: 'RESUME', arrivalId: s.arrivalId, location: here, accuracyMeters: sample.accuracyMeters, occurredAt: t });
        }
        setProgress('VISITING');
        s.outsideSince = undefined; s.outsideSamples = 0;
      } else {
        s.outsideSince ??= t; s.outsideSamples += 1;
        if (sec(s.outsideSince, t) >= policy.departureDwellSeconds && s.outsideSamples >= policy.minValidSamples) {
          setProgress('INFERRED_COMPLETE');
          s.outsideSince = undefined; s.outsideSamples = 0;
          events.push({ ...base, type: 'LEAVE', arrivalId: s.arrivalId, location: here, accuracyMeters: sample.accuracyMeters, occurredAt: t });
        }
      }
      break;
    }
  }
  return { state: s, events };
}

/** 生成从 from 走向 to 的模拟样本（GCJ02），每 stepSec 一个样本。用于演示控制台，走同一状态机。 */
export function interpolateTrack(from: GeoPoint, to: GeoPoint, steps: number): GeoPoint[] {
  const f = toSystem(from, 'GCJ02'); const g = toSystem(to, 'GCJ02');
  return Array.from({ length: steps }, (_, i) => {
    const k = (i + 1) / steps;
    return { lat: f.lat + (g.lat - f.lat) * k, lng: f.lng + (g.lng - f.lng) * k, coordinateSystem: 'GCJ02' as const };
  });
}
/** 在点 p 的 bearing 方向偏移 meters。 */
export function offsetPoint(p: GeoPoint, meters: number, bearingDeg: number): GeoPoint {
  const R = 6371008.8; const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (p.lat * Math.PI) / 180; const lng1 = (p.lng * Math.PI) / 180; const dr = meters / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(lat1), Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI, coordinateSystem: p.coordinateSystem };
}
