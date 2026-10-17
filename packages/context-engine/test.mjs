/** SYNTHETIC traces only: no real positioning, provider or field-verification evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as geo from './index.mjs';
const json=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const policy=json('./geo-policy.json');
const trip=json('../../fixtures/synthetic-北京-2d.json').tripState;
const center=trip.activities[0].place.location;
const outside={...center,lat:center.lat+.005};
const at=s=>new Date(Date.parse('2026-10-20T10:00:00+08:00')+s*1000).toISOString();
const sample=(s,location=center,extra={})=>({sampleId:`s-${s}`,tripId:trip.tripId,source:'REAL',location,accuracyMeters:10,timestamp:at(s),pageVisible:true,...extra});
function harness(activities=trip.activities) {
  let state=geo.createGeoEngineState({tripId:trip.tripId}), events=[];
  return {step(s,location=center,extra={}) {const r=geo.processLocation({sample:sample(s,location,extra),activities,state,revision:trip.revision,policy});state=r.state;events.push(...r.events);return r;},
    get state(){return state;},get events(){return events;}};
}
function arrive(h){h.step(0);h.step(45);return h.step(90);}

test('SYNTHETIC WGS84/GCJ02 conversion and tagged-distance guard',()=>{
  const converted=geo.wgs84ToGcj02(center), restored=geo.gcj02ToWgs84(converted);
  assert.ok(geo.distanceMeters(center,restored)<.1);
  assert.ok(geo.distanceMeters(center,{...converted,coordinateSystem:'WGS84'})>100);
  assert.throws(()=>geo.distanceMeters(center,converted),/must match/);
  assert.deepEqual(geo.convertPoint(converted,'GCJ02'),converted);
  assert.throws(()=>geo.wgs84ToGcj02(converted),/WGS84/);
});
test('arrival requires dwell and sample count; duplicate does not add count',()=>{
  const h=harness();assert.equal(h.step(0).events[0].type,'APPROACH');
  assert.equal(h.step(0).diagnostics[0].code,'DUPLICATE_SAMPLE');
  assert.ok(!h.step(90).events.some(e=>e.type==='ARRIVE'));
  assert.equal(h.step(100).events[0].type,'ARRIVE');
  assert.equal(h.state.states['syn-activity-0'].progress,'ARRIVED');
});
test('departure requires separate dwell and hysteresis',()=>{
  const h=harness();arrive(h);
  assert.equal(h.step(135,{...center,lat:center.lat+.0027}).events.length,0);
  assert.equal(h.step(180,outside).events.length,0);h.step(240,outside);
  assert.equal(h.step(300,outside).events[0].type,'LEAVE');
  assert.equal(h.state.states['syn-activity-0'].progress,'INFERRED_COMPLETE');
});
test('600m accuracy is unknown and cannot accrue dwell',()=>{
  const h=harness();h.step(0);h.step(45,center,{accuracyMeters:600});h.step(90);h.step(135);
  assert.ok(!h.events.some(e=>e.type==='ARRIVE'));assert.equal(h.step(180).events[0].type,'ARRIVE');
});
test('speed jump resets and cannot create ARRIVE/LEAVE',()=>{
  const h=harness();arrive(h);const result=h.step(91,{...center,lat:center.lat+1});
  assert.equal(result.diagnostics[0].code,'SPEED_JUMP');assert.equal(result.events.length,0);
  assert.equal(h.state.states['syn-activity-0'].progress,'LOCATION_UNKNOWN');
  h.step(135);assert.equal(h.events.filter(e=>e.type==='ARRIVE').length,1);
});
test('hidden/resume samples cannot bridge missing dwell',()=>{
  const h=harness();h.step(0);h.step(45,center,{pageVisible:false});h.step(90);h.step(135);
  assert.equal(h.events.filter(e=>e.type==='ARRIVE').length,0);h.step(180);
  assert.equal(h.events.filter(e=>e.type==='ARRIVE').length,1);
});
test('explicit suspend is pure and resets the next fresh interval',()=>{
  const h=harness();h.step(0);const old=structuredClone(h.state), suspended=geo.suspendGeoEngine(h.state);
  assert.deepEqual(h.state,old);assert.equal(suspended.states['syn-activity-0'].progress,'LOCATION_UNKNOWN');
  assert.equal(suspended.states['syn-activity-0'].candidateSince,undefined);
});
test('long gap starts new interval; out-of-order is ignored',()=>{
  const h=harness();h.step(0);assert.equal(h.step(300).diagnostics[0].code,'SAMPLE_GAP');
  assert.equal(h.step(299).diagnostics[0].code,'OUT_OF_ORDER_SAMPLE');h.step(345);h.step(390);
  assert.equal(h.events.filter(e=>e.type==='ARRIVE').length,1);
});
test('overlapping fences choose exactly one nearest activity',()=>{
  const other={...trip.activities[0],id:'overlap',orderIndex:1};
  const h=harness([trip.activities[0],other]);arrive(h);
  assert.equal(h.events.filter(e=>e.type==='ARRIVE').length,1);
  assert.equal(h.events.find(e=>e.type==='ARRIVE').activityId,'syn-activity-0');
});
test('same-day re-entry produces independent arrivalId',()=>{
  const h=harness();arrive(h);const first=h.events.find(e=>e.type==='ARRIVE').arrivalId;
  h.step(150,outside);h.step(210,outside);h.step(270,outside);h.step(330);h.step(375);h.step(420);
  const arrivals=h.events.filter(e=>e.type==='ARRIVE');assert.equal(arrivals.length,2);assert.notEqual(arrivals[1].arrivalId,first);
});
test('cross-day same POI triggers distinct activity and arrival',()=>{
  const h=harness();arrive(h);h.step(86400);h.step(86445);h.step(86490);
  const arrivals=h.events.filter(e=>e.type==='ARRIVE');assert.equal(arrivals.length,2);
  assert.equal(arrivals[1].activityId,'syn-activity-1');assert.notEqual(arrivals[0].arrivalId,arrivals[1].arrivalId);
});
test('real and simulation isolation enforced',()=>{
  const h=harness();assert.throws(()=>h.step(0,center,{source:'SIMULATED',demoRunId:'run'}),/context mismatch/);
  assert.throws(()=>geo.createGeoEngineState({tripId:'t',source:'REAL',demoRunId:'run'}));
  const traces=json('../../fixtures/synthetic-location-dwell.json').samples;
  let state=geo.createGeoEngineState({tripId:trip.tripId,source:'SIMULATED',demoRunId:'syn-demo-run-1'}), events=[];
  for(const s of traces){const r=geo.processLocation({sample:s,activities:trip.activities,state,revision:0,policy});state=r.state;events.push(...r.events);}
  assert.equal(events.filter(e=>e.type==='ARRIVE').length,1);assert.equal(events.find(e=>e.type==='ARRIVE').source,'SIMULATED');
});

function candidate(level,extra={}) {
  const event={eventId:`e-${level}`,tripId:trip.tripId,revision:0,source:'REAL',type:level==='L3'?'RISK':'ARRIVE',
    activityId:'syn-activity-0',arrivalId:'arrival',occurredAt:at(90),...(level==='L3'?{risk:{code:'RISK_1',message:'Synthetic risk',activityIds:[],evidence:[{provider:'SYNTHETIC',status:'VERIFIED',note:'Test only'}]}}:{})};
  const decision={decisionId:`d-${level}`,eventId:event.eventId,tripId:trip.tripId,baseRevision:0,shouldNotify:true,reasonCode:'TEST',
    card:{cardId:`card-${level}`,level,module:level==='L3'?'TRIP_RISK':'KNOWLEDGE',activityId:'syn-activity-0',title:'SYNTHETIC',actions:[],contentIds:[],evidence:{source:'REAL',eventId:event.eventId,facts:[]},...extra}};
  return {event,decision};
}
function notify(candidates,recentNotifications=[],options={}){
  return geo.filterNotifications({candidates,tripState:trip,executionMode:'REAL',recentNotifications,now:at(120),...options});
}
test('L3>L2>L1 priority emits at most one without writing shownAt',()=>{
  const input=[candidate('L1'),candidate('L2'),candidate('L3')], before=structuredClone(input), result=notify(input);
  assert.equal(result.selected.decision.card.level,'L3');assert.equal(result.suppressed.length,2);assert.deepEqual(input,before);
});
test('pause/busy suppress ordinary cards while enabled credible L3 passes',()=>{
  const paused=structuredClone(trip);paused.notificationPolicy.paused=true;
  assert.equal(notify([candidate('L1'),candidate('L3')],[],{tripState:paused,uiBusy:true}).selected.decision.card.level,'L3');
  paused.notificationPolicy.enableL3=false;assert.equal(notify([candidate('L3')],[],{tripState:paused}).selected,null);
});
test('dedup ignores revision, actual shown/ignore facts matter',()=>{
  const rec={eventId:'old',source:'REAL',activityId:'syn-activity-0',arrivalId:'arrival',level:'L1',tripRevision:99,shownAt:at(100)};
  assert.equal(notify([candidate('L1')],[rec]).suppressed[0].reason,'DUPLICATE');
  assert.equal(notify([candidate('L1')],[{...rec,shownAt:undefined,decision:'SUPPRESSED'}]).selected.decision.card.level,'L1');
  assert.equal(notify([candidate('L1')],[{...rec,shownAt:undefined,actionTaken:'IGNORE'}]).selected,null);
});
test('L2 once per intent per arrival; cooldown applies across activities',()=>{
  const rec={source:'REAL',activityId:'syn-activity-0',arrivalId:'arrival',intentId:'goal',level:'L2',shownAt:at(100)};
  const withGoal=structuredClone(trip);withGoal.intents=[{id:'goal',status:'READY'},{id:'other',status:'READY'}];
  assert.equal(notify([candidate('L2',{intentId:'goal'})],[rec],{tripState:withGoal}).suppressed[0].reason,'DUPLICATE');
  assert.equal(notify([candidate('L2',{intentId:'other'})],[rec],{tripState:withGoal}).suppressed[0].reason,'COOLDOWN');
});
test('snooze and expiry rechecked, stale context rejected',()=>{
  const rec={source:'REAL',activityId:'syn-activity-0',arrivalId:'arrival',level:'L1',actionTaken:'REMIND_LATER',snoozeUntil:at(600),shownAt:at(0)};
  assert.equal(notify([candidate('L1')],[rec]).suppressed[0].reason,'SNOOZED');
  assert.ok(notify([candidate('L1')],[rec],{now:at(1000)}).selected);
  const stale=candidate('L1');stale.decision.baseRevision=1;assert.equal(notify([stale]).suppressed[0].reason,'STALE_REVISION');
});
test('real risks need verified evidence and risk dedup breaks ordinary cooldown',()=>{
  const bad=candidate('L3');bad.event.risk.evidence[0].status='UNKNOWN';assert.equal(notify([bad]).suppressed[0].reason,'RISK_UNVERIFIED');
  const ordinary={source:'REAL',level:'L1',shownAt:at(110)};assert.ok(notify([candidate('L3')],[ordinary]).selected);
  assert.equal(notify([candidate('L3')],[{source:'REAL',level:'L3',riskCode:'RISK_1',shownAt:at(0)}]).suppressed[0].reason,'DUPLICATE');
});
test('fact projection survives undo, correction latest wins and demo never pollutes',()=>{
  const real={logId:'1',tripId:trip.tripId,tripRevision:4,source:'REAL',occurredAt:at(90),event:candidate('L1').event};
  const demo={...real,logId:'2',source:'SIMULATED',demoRunId:'d',occurredAt:at(120),event:{...real.event,type:'LEAVE',source:'SIMULATED',demoRunId:'d'}};
  const projected=geo.projectFacts(trip,[real,demo]);assert.equal(projected.activities[0].progress,'ARRIVED');assert.equal(projected.revision,0);assert.equal(trip.activities[0].progress,'NOT_STARTED');
  const correction={logId:'3',tripId:trip.tripId,source:'USER_CORRECTION',occurredAt:at(130),correction:{activityId:'syn-activity-0',next:'NOT_STARTED'}};
  assert.equal(geo.projectFacts(trip,[real,correction]).activities[0].progress,'NOT_STARTED');
  assert.equal(geo.projectFacts(trip,[real,demo],{executionMode:'DEMO',demoRunId:'d'}).activities[0].progress,'INFERRED_COMPLETE');
});
test('content applicability checks revision, POI and cancellation',()=>{
  const c={tripId:trip.tripId,baseRevision:0,activityId:'syn-activity-0',placeId:trip.activities[0].place.poiId};
  assert.ok(geo.isContentApplicable(c,trip));assert.ok(!geo.isContentApplicable({...c,baseRevision:1},trip));
  assert.ok(!geo.isContentApplicable({...c,placeId:'removed'},trip));
});
test('queued arrival notification is filtered after leaving or losing position',()=>{
  const plan=structuredClone(trip);plan.activities[0].progress='INFERRED_COMPLETE';
  assert.equal(notify([candidate('L1')],[],{tripState:plan}).suppressed[0].reason,'ARRIVAL_NO_LONGER_ACTIVE');
  plan.activities[0].progress='LOCATION_UNKNOWN';
  assert.equal(notify([candidate('L2')],[],{tripState:plan}).selected,null);
});
test('DEMO corrections are replayed only in their own run',()=>{
  const correction={logId:'d-correction',tripId:trip.tripId,source:'USER_CORRECTION',demoRunId:'run',occurredAt:at(130),
    correction:{activityId:'syn-activity-0',next:'INFERRED_COMPLETE'}};
  assert.equal(geo.projectFacts(trip,[correction]).activities[0].progress,'NOT_STARTED');
  assert.equal(geo.projectFacts(trip,[correction],{executionMode:'DEMO',demoRunId:'run'}).activities[0].progress,'INFERRED_COMPLETE');
});

test('changing trip dates does not replay an arrival from the old day',()=>{
  const changed=structuredClone(trip);
  changed.activities[0].startAt='2026-10-21T09:00:00+08:00';
  const old={logId:'old-day',tripId:trip.tripId,tripRevision:0,source:'REAL',occurredAt:at(90),
    event:{eventId:'old-arrival',tripId:trip.tripId,revision:0,source:'REAL',type:'ARRIVE',activityId:'syn-activity-0',arrivalId:'old',occurredAt:at(90)}};
  assert.equal(geo.projectFacts(changed,[old]).activities[0].progress,'NOT_STARTED');
});
