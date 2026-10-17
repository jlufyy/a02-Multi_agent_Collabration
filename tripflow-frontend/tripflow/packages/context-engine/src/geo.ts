/** Browser adapter over the canonical deterministic engine; old saved states restart dwell. */
import type { GeoPoint, GeoPolicy, GeoRuntimeState, NormalizedLocationEvent, ProactiveEvent, ItineraryActivity } from '@tripflow/contracts';
import { schemas } from '@tripflow/contracts';
import {
  createGeoEngineState, processLocation, convertPoint, distanceMeters as sameSystemDistance,
  type GeoEngineState,
} from '@tripflow/geo-core';
import defaultPolicy from '@tripflow/geo-core/geo-policy.json';
export { createGeoEngineState, processLocation, suspendGeoEngine } from '@tripflow/geo-core';
export type { GeoEngineState } from '@tripflow/geo-core';
export const INTERIM_GEO_POLICY: GeoPolicy = defaultPolicy;
export const toSystem = convertPoint;
export const wgs84ToGcj02 = (p: GeoPoint) => convertPoint(p, 'GCJ02');
export const gcj02ToWgs84 = (p: GeoPoint) => convertPoint(p, 'WGS84');
export const distanceMeters = (a: GeoPoint, b: GeoPoint) => sameSystemDistance(a, convertPoint(b, a.coordinateSystem));

export type EngineState = GeoRuntimeState & {
  insideSamples: number; outsideSamples: number; anomalies: number;
  lastValidLocation?: GeoPoint;
  core?: GeoEngineState; targetKey?: string;
};
export const activityGeoKey = (a: ItineraryActivity) => JSON.stringify([a.id, a.place.poiId, a.place.location, a.dayIndex, a.startAt.slice(0, 10)]);
export type StepTarget = { activityId: string; location: GeoPoint };
export type StepResult = { state: EngineState; events: Omit<ProactiveEvent, 'eventId' | 'revision'>[]; note?: string };
export function initialEngineState(tripId: string, activityId: string, source: 'REAL' | 'SIMULATED', demoRunId?: string): EngineState {
  return { tripId, activityId, source, demoRunId, progress: 'NOT_STARTED', insideSamples: 0, outsideSamples: 0, anomalies: 0 };
}

export function stepLocations(prev: EngineState[], sample: NormalizedLocationEvent, activities: ItineraryActivity[], policy: GeoPolicy) {
  let core = prev.find((g) => g.core)?.core ?? createGeoEngineState(sample);
  core = structuredClone(core);
  const targets = new Map(activities.map((a) => [a.id, activityGeoKey(a)]));
  // Legacy progress/arrival facts survive; unproven candidate counters do not.
  for (const g of prev) {
    if (g.targetKey !== targets.get(g.activityId)) {
      delete core.states[g.activityId]; delete core.tracker.counts[g.activityId]; delete core.tracker.departed[g.activityId];
      continue;
    }
    if (g.tripId === sample.tripId && g.source === sample.source && g.demoRunId === sample.demoRunId) {
      const { core: _core, insideSamples: _in, outsideSamples: _out, anomalies: _an, lastValidLocation: _loc, ...runtime } = g;
      core.states[g.activityId] = { ...runtime };
      if (!g.core) { delete core.states[g.activityId].candidateSince; delete core.states[g.activityId].outsideSince; }
    }
  }
  const result = processLocation({ sample, activities, state: core, revision: 0, policy });
  const states: EngineState[] = Object.values(result.state.states).map((s, i) => ({ ...schemas.GeoRuntimeState.parse(s),
    insideSamples: result.state.tracker.counts[s.activityId]?.inside ?? 0,
    outsideSamples: result.state.tracker.counts[s.activityId]?.outside ?? 0, anomalies: 0,
    targetKey: targets.get(s.activityId),
    ...(i === 0 ? { core: result.state } : {}),
  }));
  return { states, events: result.events.map((e) => schemas.ProactiveEvent.parse(e)), notes: result.diagnostics.filter((d) => d.code !== 'DISTANCE').map((d) => d.code) };
}

/** Compatibility adapter for probes and existing saved single-activity callers. */
export function stepGeo(prev: EngineState, sample: NormalizedLocationEvent, target: StepTarget, policy: GeoPolicy, _newArrivalId: () => string): StepResult {
  if (sample.tripId !== prev.tripId || sample.source !== prev.source || sample.demoRunId !== prev.demoRunId) return { state: prev, events: [], note: 'SOURCE_MISMATCH' };
  const date = new Date(Date.parse(sample.timestamp) + 8 * 3600_000).toISOString().slice(0, 10);
  const activity: ItineraryActivity = { id: target.activityId, dayIndex: 0, orderIndex: 0, startAt: `${date}T09:00:00+08:00`, endAt: `${date}T10:00:00+08:00`,
    place: { poiId: target.activityId, name: target.activityId, location: target.location, evidence: [] },
    locked: false, mandatory: false, progress: prev.progress, intentIds: [], costStatus: 'UNKNOWN' };
  const r = stepLocations([prev], sample, [activity], policy);
  return { state: r.states[0] ?? prev, events: r.events, note: r.notes[0] };
}

export function interpolateTrack(from: GeoPoint, to: GeoPoint, steps: number): GeoPoint[] {
  const f = toSystem(from, 'GCJ02'), g = toSystem(to, 'GCJ02');
  return Array.from({ length: steps }, (_, i) => ({ lat: f.lat + (g.lat - f.lat) * (i + 1) / steps, lng: f.lng + (g.lng - f.lng) * (i + 1) / steps, coordinateSystem: 'GCJ02' }));
}
export function offsetPoint(p: GeoPoint, meters: number, bearingDeg: number): GeoPoint {
  const R = 6371008.8, br = bearingDeg * Math.PI / 180;
  const lat1 = p.lat * Math.PI / 180, lng1 = p.lng * Math.PI / 180, dr = meters / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(lat1), Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 * 180 / Math.PI, lng: lng2 * 180 / Math.PI, coordinateSystem: p.coordinateSystem };
}
