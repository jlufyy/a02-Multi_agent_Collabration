import type {GeoPoint, GeoPolicy, GeoRuntimeState, NormalizedLocationEvent, ProactiveEvent, ProactiveDecision,
  TripState, ItineraryActivity, NotificationRecord, EventLogEntry, PreparedContent} from '../contracts/generated/index.d.ts';
export const CONTRACT_VERSION: 'TripFlow-Split-v1';
export interface GeoEngineState {
  tripId: string; source: 'REAL' | 'SIMULATED'; demoRunId?: string;
  states: Record<string, GeoRuntimeState>;
  tracker: {seenSampleIds:string[]; counts:Record<string,{inside:number;outside:number}>;
    arrivals:Record<string,number>;departed:Record<string,boolean>;
    lastSample?:{timestamp:string;location:GeoPoint};lastObservedAt?:string;needsFresh?:boolean};
}
export interface Diagnostic {code:string;activityId?:string;distanceMeters?:number;originalLocation?:GeoPoint;
  normalizedLocation?:GeoPoint;conversion?:string;policyVersion?:string;calculatedSpeedMetersPerSecond?:number}
export function validatePolicy(policy:GeoPolicy):GeoPolicy;
export function wgs84ToGcj02(point:GeoPoint):GeoPoint;
export function gcj02ToWgs84(point:GeoPoint):GeoPoint;
export function convertPoint(point:GeoPoint,targetSystem:'WGS84'|'GCJ02'):GeoPoint;
export function distanceMeters(a:GeoPoint,b:GeoPoint):number;
export function createGeoEngineState(context:{tripId:string;source?:'REAL'|'SIMULATED';demoRunId?:string}):GeoEngineState;
export function suspendGeoEngine(state:GeoEngineState):GeoEngineState;
export function processLocation(input:{sample:NormalizedLocationEvent;activities:ItineraryActivity[];state:GeoEngineState;revision:number;policy:GeoPolicy}):
  {state:GeoEngineState;events:ProactiveEvent[];diagnostics:Diagnostic[]};
export const GeoStateMachine: typeof processLocation;
export interface NotificationCandidate {decision:ProactiveDecision;event:ProactiveEvent}
export function filterNotifications(input:{candidates:NotificationCandidate[];tripState:TripState;
  executionMode:'REAL'|'DEMO';demoRunId?:string;recentNotifications:NotificationRecord[];uiBusy?:boolean;now:string}):
  {selected:NotificationCandidate|null;suppressed:Array<{decisionId:string;reason:string}>};
export function projectFacts(tripState:TripState,logs:EventLogEntry[],context?:{executionMode?:'REAL'|'DEMO';demoRunId?:string}):TripState;
export function isContentApplicable(content:PreparedContent,tripState:TripState):boolean;
export function futureReminderTargets(tripState:TripState,logs:EventLogEntry[],context?:{executionMode?:'REAL'|'DEMO';demoRunId?:string}):
  Array<{tripId:string;baseRevision:number;intentId:string;activityId?:string;placeId?:string}>;
