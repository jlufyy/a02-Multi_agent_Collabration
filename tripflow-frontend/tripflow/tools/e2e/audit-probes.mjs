// Deterministic SYNTHETIC regression probes against the current frontend adapter.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../../packages/context-engine/src/index.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const E = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const policy = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const point = {lat:39.9,lng:116.4,coordinateSystem:'GCJ02'};
const at = sec => new Date(Date.UTC(2026,9,20,1)+sec*1000).toISOString();
const sample = (sec,id,accuracyMeters=20) => ({sampleId:id,tripId:'audit',source:'SIMULATED',demoRunId:'audit-demo',location:point,accuracyMeters,timestamp:at(sec),pageVisible:true});
function feed(samples) {
  let state=E.initialEngineState('audit','act','SIMULATED','audit-demo');
  const events=[];
  for(const s of samples) {
    const r=E.stepGeo(state,s,{activityId:'act',location:point},policy,()=> 'arrival');
    state=r.state;events.push(...r.events.map(x=>({type:x.type,at:x.occurredAt})));
  }
  return {progress:state.progress,events};
}
const duplicate=feed([sample(0,'one'),sample(90,'two'),sample(90,'two')]);
const lowAccuracy=feed([sample(0,'one'),sample(30,'bad',600),sample(60,'two'),sample(90,'three')]);
const queue={decision:{decisionId:'decision',eventId:'e',tripId:'audit',baseRevision:1,shouldNotify:true,reasonCode:'ARRIVAL',
  card:{cardId:'card',level:'L1',module:'KNOWLEDGE',activityId:'act',title:'synthetic',actions:['VIEW_CONTENT'],contentIds:[],evidence:{source:'SIMULATED',eventId:'e',facts:[]}}},
  eventSource:'SIMULATED',demoRunId:'audit-demo',arrivalId:'a',enqueuedAt:at(0)};
const stale=E.checkShow(queue,[],{enableL1:true,enableL2:true,enableL3:true,paused:false,cooldownMinutes:15},
  {now:new Date(at(3600)),uiBusy:false,currentRevision:2,activityExists:()=>true});
const result={evidenceType:'SYNTHETIC_CURRENT_FRONTEND',policy,
  duplicateSample:{uniqueSamples:2,expected:'No ARRIVE before three unique samples',actual:duplicate,defectReproduced:duplicate.events.some(e=>e.type==='ARRIVE')},
  lowAccuracyGap:{expected:'Reset dwell at low-accuracy sample; no arrival at t=90',actual:lowAccuracy,defectReproduced:lowAccuracy.events.some(e=>e.type==='ARRIVE')},
  staleQueuedCard:{queuedBaseRevision:1,currentRevision:2,queuedAgeSeconds:3600,expected:'Suppress stale card',actual:stale,defectReproduced:stale.ok}};
writeFileSync(process.argv[3],JSON.stringify(result,null,2));
console.log(JSON.stringify(result));

if ([duplicate.events,lowAccuracy.events].some(events=>events.some(e=>e.type==='ARRIVE')) || stale.ok) process.exitCode=1;
