/** Browser-safe, deterministic context engine. No network, GPS, clocks, or storage side effects. */
export const CONTRACT_VERSION = 'TripFlow-Split-v1';

export function validatePolicy(p) {
  const fields = ['arrivalRadiusMeters', 'departureRadiusMeters', 'maxAccuracyMeters', 'arrivalDwellSeconds',
    'departureDwellSeconds', 'minValidSamples', 'maxSpeedMetersPerSecond', 'maxSampleGapSeconds'];
  if (!p?.policyVersion || fields.some(k => !Number.isFinite(p[k]) || p[k] <= 0) ||
      !Number.isInteger(p.minValidSamples) || p.departureRadiusMeters <= p.arrivalRadiusMeters) {
    throw new TypeError('Invalid GeoPolicy');
  }
  return p;
}

function validPoint(p) {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 ||
      Math.abs(p.lng) > 180 || !['WGS84', 'GCJ02'].includes(p.coordinateSystem)) {
    throw new TypeError('Tagged finite GeoPoint required');
  }
}
const rad = d => d * Math.PI / 180;
const outsideChina = p => p.lng < 72.004 || p.lng > 137.8347 || p.lat < 0.8293 || p.lat > 55.8271;
function transformLat(x, y) {
  let r = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*Math.sqrt(Math.abs(x));
  r += (20*Math.sin(6*x*Math.PI) + 20*Math.sin(2*x*Math.PI))*2/3;
  r += (20*Math.sin(y*Math.PI) + 40*Math.sin(y/3*Math.PI))*2/3;
  return r + (160*Math.sin(y/12*Math.PI) + 320*Math.sin(y*Math.PI/30))*2/3;
}
function transformLng(x, y) {
  let r = 300 + x + 2*y + .1*x*x + .1*x*y + .1*Math.sqrt(Math.abs(x));
  r += (20*Math.sin(6*x*Math.PI) + 20*Math.sin(2*x*Math.PI))*2/3;
  r += (20*Math.sin(x*Math.PI) + 40*Math.sin(x/3*Math.PI))*2/3;
  return r + (150*Math.sin(x/12*Math.PI) + 300*Math.sin(x/30*Math.PI))*2/3;
}

/** Conventional GCJ adapter for local geofences, not a survey-grade conversion. */
export function wgs84ToGcj02(point) {
  validPoint(point);
  if (point.coordinateSystem !== 'WGS84') throw new TypeError('WGS84 input required');
  if (outsideChina(point)) return {...point, coordinateSystem:'GCJ02'};
  const a = 6378245, ee = .00669342162296594323, lat = rad(point.lat);
  const magic = 1-ee*Math.sin(lat)**2, root = Math.sqrt(magic);
  const dy = transformLat(point.lng-105, point.lat-35)*180 / ((a*(1-ee))/(magic*root)*Math.PI);
  const dx = transformLng(point.lng-105, point.lat-35)*180 / (a/root*Math.cos(lat)*Math.PI);
  return {lat:point.lat+dy, lng:point.lng+dx, coordinateSystem:'GCJ02'};
}

export function gcj02ToWgs84(point) {
  validPoint(point);
  if (point.coordinateSystem !== 'GCJ02') throw new TypeError('GCJ02 input required');
  if (outsideChina(point)) return {...point, coordinateSystem:'WGS84'};
  let p = {...point, coordinateSystem:'WGS84'};
  for (let i=0; i<8; i++) {
    const c = wgs84ToGcj02(p);
    p = {lat:p.lat-(c.lat-point.lat), lng:p.lng-(c.lng-point.lng), coordinateSystem:'WGS84'};
  }
  return p;
}

export function convertPoint(point, targetSystem) {
  validPoint(point);
  if (!['WGS84','GCJ02'].includes(targetSystem)) throw new TypeError('Unknown coordinate system');
  if (point.coordinateSystem === targetSystem) return {...point};
  return targetSystem === 'WGS84' ? gcj02ToWgs84(point) : wgs84ToGcj02(point);
}

/** Mixed systems are deliberately rejected: caller must adapt and retain provenance. */
export function distanceMeters(a, b) {
  validPoint(a); validPoint(b);
  if (a.coordinateSystem !== b.coordinateSystem) throw new TypeError('Coordinate systems must match');
  const h = Math.sin(rad(b.lat-a.lat)/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0,1-h)));
}

function contextKey(source, demoRunId) { return `${source}:${demoRunId ?? ''}`; }
function checkSource(source, demoRunId) {
  if (!['REAL','SIMULATED'].includes(source) || ((source === 'SIMULATED') !== Boolean(demoRunId))) {
    throw new TypeError('REAL must omit demoRunId; SIMULATED requires demoRunId');
  }
}
function stamp(s) {
  if (typeof s !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(s) || !Number.isFinite(Date.parse(s))) {
    throw new TypeError('Timezone-aware timestamp required');
  }
  return Date.parse(s);
}
const localDate = s => new Date(stamp(s)+8*3600000).toISOString().slice(0,10);

export function createGeoEngineState({tripId, source='REAL', demoRunId}) {
  checkSource(source, demoRunId);
  if (!tripId) throw new TypeError('tripId required');
  return {tripId, source, ...(demoRunId ? {demoRunId} : {}), states:{}, tracker:{seenSampleIds:[], counts:{}, arrivals:{}, departed:{}}};
}

function clearCandidate(s) { delete s.candidateSince; delete s.outsideSince; }
function markUnknown(next) {
  for (const s of Object.values(next.states)) { s.progress='LOCATION_UNKNOWN'; clearCandidate(s); }
  next.tracker.counts={};
  delete next.tracker.lastSample;
  next.tracker.needsFresh=true;
}

/** Call on page hide / permission loss without inventing any sample or elapsed dwell. */
export function suspendGeoEngine(state) {
  const next=structuredClone(state); markUnknown(next); return next;
}

/**
 * Returns runtime state, zero-or-more inferred business events and diagnostic evidence.
 * tracker is persisted separately from the GeoRuntimeState contract to preserve pure-function memory.
 * Only the closest eligible geofence may accrue arrival dwell; an active arrival owns overlap.
 */
export function processLocation({sample, activities, state, revision, policy}) {
  validatePolicy(policy); checkSource(sample.source, sample.demoRunId); stamp(sample.timestamp); validPoint(sample.location);
  if (!Number.isInteger(revision) || revision < 0 || sample.tripId !== state.tripId ||
      contextKey(sample.source,sample.demoRunId) !== contextKey(state.source,state.demoRunId)) throw new TypeError('Location context mismatch');
  const next=structuredClone(state), events=[], diagnostics=[];
  const result=()=>({state:next, events, diagnostics});
  if (next.tracker.seenSampleIds.includes(sample.sampleId)) { diagnostics.push({code:'DUPLICATE_SAMPLE'}); return result(); }
  next.tracker.seenSampleIds=[...next.tracker.seenSampleIds,sample.sampleId].slice(-512);
  const now=stamp(sample.timestamp), last=next.tracker.lastSample;
  if (next.tracker.lastObservedAt && now <= stamp(next.tracker.lastObservedAt)) { diagnostics.push({code:'OUT_OF_ORDER_SAMPLE'}); return result(); }
  next.tracker.lastObservedAt=sample.timestamp;
  if (!sample.pageVisible || !Number.isFinite(sample.accuracyMeters) || sample.accuracyMeters < 0 || sample.accuracyMeters > policy.maxAccuracyMeters) {
    markUnknown(next); diagnostics.push({code:sample.pageVisible ? 'ACCURACY_UNKNOWN':'PAGE_HIDDEN'}); return result();
  }
  if (last && (now-stamp(last.timestamp))/1000 > policy.maxSampleGapSeconds) {
    markUnknown(next); diagnostics.push({code:'SAMPLE_GAP'});
  }
  const adapted=convertPoint(sample.location,'WGS84');
  const speed=last ? distanceMeters(adapted,convertPoint(last.location,'WGS84'))/((now-stamp(last.timestamp))/1000) : 0;
  if ((Number.isFinite(sample.speedMetersPerSecond) && sample.speedMetersPerSecond > policy.maxSpeedMetersPerSecond) || speed > policy.maxSpeedMetersPerSecond) {
    markUnknown(next); diagnostics.push({code:'SPEED_JUMP', calculatedSpeedMetersPerSecond:speed}); return result();
  }
  const eligible=activities.filter(a=>a.startAt.slice(0,10) === localDate(sample.timestamp));
  const ids=new Set(activities.map(a=>a.id));
  for (const id of Object.keys(next.states)) if (!ids.has(id)) { delete next.states[id]; delete next.tracker.counts[id]; }
  const distances=new Map(eligible.map(a=>[a.id,distanceMeters(adapted,convertPoint(a.place.location,'WGS84'))]));
  for (const a of eligible) {
    next.states[a.id] ??= {tripId:sample.tripId,activityId:a.id,source:sample.source,
      ...(sample.demoRunId ? {demoRunId:sample.demoRunId}:{}),progress:'NOT_STARTED'};
  }
  const active=eligible.find(a=>next.states[a.id].arrivalId && !next.tracker.departed[a.id]);
  const winner=active ?? [...eligible].filter(a=>distances.get(a.id)<=policy.arrivalRadiusMeters)
    .sort((a,b)=>distances.get(a.id)-distances.get(b.id)||a.orderIndex-b.orderIndex||a.id.localeCompare(b.id))[0];
  function event(type,a,s) {
    return {eventId:`geo:${type}:${s.arrivalId ?? a.id}:${sample.sampleId}`,tripId:sample.tripId,revision,source:sample.source,type,
      activityId:a.id,...(s.arrivalId?{arrivalId:s.arrivalId}:{}),...(sample.demoRunId?{demoRunId:sample.demoRunId}:{}),
      location:{...sample.location},accuracyMeters:sample.accuracyMeters,occurredAt:sample.timestamp};
  }
  for (const a of eligible) {
    const s=next.states[a.id], d=distances.get(a.id), counts=next.tracker.counts[a.id]??={inside:0,outside:0};
    s.lastValidSampleAt=sample.timestamp;
    diagnostics.push({code:'DISTANCE',activityId:a.id,distanceMeters:d,originalLocation:{...sample.location},
      normalizedLocation:adapted,conversion:sample.location.coordinateSystem === 'WGS84' ? 'IDENTITY' : 'GCJ02_TO_WGS84',policyVersion:policy.policyVersion});
    const hasArrival=s.arrivalId && !next.tracker.departed[a.id];
    if (hasArrival) {
      if (d > policy.departureRadiusMeters) {
        delete s.candidateSince; counts.inside=0; s.outsideSince ??= sample.timestamp; counts.outside++;
        if ((now-stamp(s.outsideSince))/1000 >= policy.departureDwellSeconds && counts.outside>=policy.minValidSamples) {
          s.progress='INFERRED_COMPLETE'; events.push(event('LEAVE',a,s)); next.tracker.departed[a.id]=true; clearCandidate(s); counts.outside=0;
        } else s.progress='VISITING';
      } else {
        if (s.progress==='LOCATION_UNKNOWN') events.push(event('RESUME',a,s));
        delete s.outsideSince; counts.outside=0; s.progress='VISITING';
      }
      continue;
    }
    if (winner?.id !== a.id || d > policy.arrivalRadiusMeters) {
      delete s.candidateSince; counts.inside=0;
      if (!next.tracker.departed[a.id]) s.progress='NOT_STARTED';
      continue;
    }
    if (!s.candidateSince) {
      s.candidateSince=sample.timestamp; counts.inside=0;
      events.push(event('APPROACH',a,s));
    }
    counts.inside++; s.progress='APPROACHING';
    if ((now-stamp(s.candidateSince))/1000 >= policy.arrivalDwellSeconds && counts.inside>=policy.minValidSamples) {
      const serial=(next.tracker.arrivals[a.id]??0)+1; next.tracker.arrivals[a.id]=serial;
      s.arrivalId=`arrival:${sample.tripId}:${contextKey(sample.source,sample.demoRunId)}:${a.id}:${sample.timestamp}:${serial}`;
      s.progress='ARRIVED'; next.tracker.departed[a.id]=false; clearCandidate(s); counts.inside=0;
      events.push(event('ARRIVE',a,s));
    }
  }
  next.tracker.lastSample={timestamp:sample.timestamp,location:{...sample.location}};
  next.tracker.needsFresh=false;
  return result();
}

export const GeoStateMachine = processLocation;

function matchingRecord(r,event) {
  return (r.demoRunId??null)===(event.demoRunId??null) &&
    (r.activityId??null)===(event.activityId??null) && (r.arrivalId??null)===(event.arrivalId??null);
}

/** Final display-time guard. No shownAt is written here: caller writes it after actual display. */
export function filterNotifications({candidates,tripState,executionMode,demoRunId,recentNotifications,uiBusy=false,now}) {
  const time=stamp(now);
  if ((executionMode==='DEMO')!==Boolean(demoRunId)) throw new TypeError('Execution context mismatch');
  const suppressed=[], accepted=[];
  for (const candidate of candidates) {
    const {decision:d,event}=candidate, card=d.card;
    let reason;
    if (d.tripId!==tripState.tripId || d.baseRevision!==tripState.revision || event.tripId!==tripState.tripId || event.revision!==tripState.revision) reason='STALE_REVISION';
    else if (d.eventId!==event.eventId) reason='EVENT_MISMATCH';
    else if ((executionMode==='DEMO' && (event.source==='REAL'||event.demoRunId!==demoRunId)) ||
      (executionMode==='REAL' && (event.source==='SIMULATED'||event.demoRunId))) reason='EXECUTION_CONTEXT_MISMATCH';
    else if (!d.shouldNotify || !card) reason=d.suppressionReason??'NO_CARD';
    else if (card.evidence.eventId!==event.eventId || card.evidence.source!==event.source) reason='EVIDENCE_MISMATCH';
    else if (card.activityId && event.activityId && card.activityId!==event.activityId) reason='ACTIVITY_MISMATCH';
    else if (card.activityId && !tripState.activities.some(a=>a.id===card.activityId)) reason='ACTIVITY_REMOVED';
    else if (card.level!=='L3' && tripState.activities.some(a=>a.id===event.activityId&&['INFERRED_COMPLETE','LOCATION_UNKNOWN'].includes(a.progress))) reason='ARRIVAL_NO_LONGER_ACTIVE';
    else if (card.intentId && !tripState.intents.some(i=>i.id===card.intentId&&i.status!=='CANCELLED')) reason='INTENT_CANCELLED';
    else if (!tripState.notificationPolicy[`enable${card.level}`]) reason='DISABLED';
    else if (card.level!=='L3'&&(tripState.notificationPolicy.paused||uiBusy)) reason=uiBusy?'UI_BUSY':'PAUSED';
    else if (card.level!=='L3'&&(!event.arrivalId||!event.activityId)) reason='NO_VALID_ARRIVAL';
    else if (card.level==='L3'&&(event.type!=='RISK'||!event.risk?.evidence?.length||
      (event.source==='REAL'&&!event.risk.evidence.some(e=>e.status==='VERIFIED')))) reason='RISK_UNVERIFIED';
    const relevant=recentNotifications.filter(r=>(r.demoRunId??null)===(demoRunId??null)&&
      (executionMode==='DEMO'?r.source!=='REAL':r.source!=='SIMULATED'));
    if (!reason) {
      const same=relevant.filter(r=>card.level==='L3' ? r.level==='L3'&&r.riskCode===event.risk?.code :
        matchingRecord(r,event) && r.level===card.level && (card.level!=='L2'||r.intentId===card.intentId));
      if (same.some(r=>r.snoozeUntil&&stamp(r.snoozeUntil)>time)) reason='SNOOZED';
      else if (same.some(r=>(r.shownAt||r.actionTaken==='IGNORE') &&
        !(r.actionTaken==='REMIND_LATER'&&r.snoozeUntil&&stamp(r.snoozeUntil)<=time))) reason='DUPLICATE';
      else if (card.level!=='L3'&&relevant.some(r=>r.level!=='L3'&&r.shownAt&&time-stamp(r.shownAt)<tripState.notificationPolicy.cooldownMinutes*60000)) reason='COOLDOWN';
    }
    if (reason) suppressed.push({decisionId:d.decisionId,reason}); else accepted.push(candidate);
  }
  const rank={L3:3,L2:2,L1:1};
  accepted.sort((a,b)=>rank[b.decision.card.level]-rank[a.decision.card.level]||a.decision.decisionId.localeCompare(b.decision.decisionId));
  const selected=accepted.shift();
  for (const item of accepted) suppressed.push({decisionId:item.decision.decisionId,reason:'LOWER_PRIORITY'});
  return {selected:selected??null,suppressed};
}

/** Re-project immutable facts after undo/redo; never changes revision or deletes historical facts. */
export function projectFacts(tripState,logs,{executionMode='REAL',demoRunId}={}) {
  if ((executionMode==='DEMO')!==Boolean(demoRunId)) throw new TypeError('Execution context mismatch');
  const plan=structuredClone(tripState), activities=new Map(plan.activities.map(a=>[a.id,a]));
  const intents=new Map(plan.intents.map(i=>[i.id,i]));
  const filtered=logs.filter(l=>l.tripId===plan.tripId && (l.demoRunId??null)===(demoRunId??null) &&
    (executionMode==='DEMO'?l.source!=='REAL':l.source!=='SIMULATED'))
    .sort((a,b)=>stamp(a.occurredAt)-stamp(b.occurredAt)||a.logId.localeCompare(b.logId));
  for (const l of filtered) {
    const e=l.event, a=activities.get(l.correction?.activityId??e?.activityId);
    if (l.correction && l.source==='USER_CORRECTION' && a) a.progress=l.correction.next;
    else if (e && a && e.tripId===plan.tripId && e.source===l.source && (e.demoRunId??null)===(l.demoRunId??null) &&
      localDate(e.occurredAt)===localDate(a.startAt) &&
      !(e.type==='ARRIVE'&&e.location&&distanceMeters(convertPoint(e.location,'WGS84'),convertPoint(a.place.location,'WGS84'))>400)) {
      if (e.type==='ARRIVE') a.progress='ARRIVED';
      else if (e.type==='LEAVE') a.progress='INFERRED_COMPLETE';
    }
    const n=l.notification;
    if (n?.level==='L2'&&n.shownAt&&n.source===l.source&&(n.demoRunId??null)===(l.demoRunId??null)&&intents.has(n.intentId)&&intents.get(n.intentId).status!=='CANCELLED' &&
      activities.has(n.activityId)&&localDate(n.shownAt)===localDate(activities.get(n.activityId).startAt)) intents.get(n.intentId).status='TRIGGERED';
  }
  plan.requirements.intents=structuredClone(plan.intents);
  return plan;
}

/** Content applicability and future reminders are derived; old facts remain untouched. */
export function isContentApplicable(content,tripState) {
  if (content.tripId!==tripState.tripId || content.baseRevision!==tripState.revision) return false;
  const a=content.activityId ? tripState.activities.find(a=>a.id===content.activityId) : tripState.activities.find(a=>a.place.poiId===content.placeId);
  if (!a || a.place.poiId!==content.placeId) return false;
  return !content.intentId || tripState.intents.some(i=>i.id===content.intentId&&i.status!=='CANCELLED'&&(!i.activityId||i.activityId===a.id));
}

export function futureReminderTargets(tripState,logs,context={}) {
  const p=projectFacts(tripState,logs,context);
  return p.intents.filter(i=>i.confirmed&&i.status!=='CANCELLED'&&i.status!=='TRIGGERED'&&p.activities.some(a=>a.id===i.activityId&&a.progress!=='INFERRED_COMPLETE'))
    .map(i=>({tripId:p.tripId,baseRevision:p.revision,intentId:i.id,activityId:i.activityId,placeId:i.placeId}));
}
