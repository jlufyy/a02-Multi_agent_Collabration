/**
 * TripFlow-Split-v1 共享契约（共同附录 A 的机器可读版本）。
 *
 * 这是前端先行落地的 Zod 源；后端 B 应以同一份字段定义生成 Pydantic/JSON Schema，
 * 任何改名都必须同步修改本文件、Fixtures 和两份研发文档。不要在前后端各手抄一份。
 * 业务字段 camelCase；响应信封保留 request_id / trace_id。
 */
import { z } from 'zod';

export const CONTRACT_VERSION = 'TripFlow-Split-v1';

// ---------- 枚举 ----------
export const JobStatus = z.enum(['PENDING', 'RUNNING', 'PARTIAL', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
export const DataStatus = z.enum(['VERIFIED', 'ESTIMATED', 'UNKNOWN', 'FAILED']);
export const ValidationStatus = z.enum(['FEASIBLE', 'PARTIALLY_VERIFIED', 'INFEASIBLE']);
export const EventSource = z.enum(['REAL', 'SIMULATED', 'USER_CORRECTION']);
export const TripMode = z.enum(['PLANNING', 'TRAVELING']);
export const ExecutionMode = z.enum(['REAL', 'DEMO']);
export const Lifecycle = z.enum(['DRAFT_INPUT', 'PLANNING', 'PLAN_READY', 'TRAVELING', 'TRIP_ENDED']);
export const TravelMode = z.enum(['WALK', 'TRANSIT', 'DRIVE']);
export const ActivityProgress = z.enum(['NOT_STARTED', 'APPROACHING', 'ARRIVED', 'VISITING', 'INFERRED_COMPLETE', 'LOCATION_UNKNOWN']);
export const IntentType = z.enum(['KNOWLEDGE', 'PHOTO', 'VIDEO_SHOOT', 'SPEECH', 'CHECK_IN', 'FOOD', 'OTHER']);
export const ServiceModule = z.enum(['KNOWLEDGE', 'PERSONAL_GOAL', 'TRIP_RISK', 'NEARBY']);
export const WalkingTolerance = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const BudgetScope = z.enum(['PER_PERSON', 'TOTAL']);
export const AgentId = z.enum(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']);
export const NotificationLevel = z.enum(['L1', 'L2', 'L3']);

// ---------- 通用 ----------
export const ApiError = z.object({
  code: z.string(), message: z.string(), retryable: z.boolean(), fieldPath: z.string().optional(),
});
export const apiResponse = <T extends z.ZodTypeAny>(data: T) => z.object({
  request_id: z.string(), status: JobStatus, data: data.nullable(), errors: z.array(ApiError), trace_id: z.string(),
});

export const GeoPoint = z.object({ lat: z.number(), lng: z.number(), coordinateSystem: z.enum(['GCJ02', 'WGS84']) });
export const Evidence = z.object({
  provider: z.string(), externalId: z.string().optional(), fetchedAt: z.string().optional(),
  status: DataStatus, sourceUrl: z.string().optional(), note: z.string().optional(),
});
const fact = <T extends z.ZodTypeAny>(v: T) => z.object({ value: v.optional(), evidence: Evidence });

export const Place = z.object({
  poiId: z.string(), name: z.string(), address: z.string().optional(), location: GeoPoint, evidence: z.array(Evidence),
  openingHours: fact(z.string()).optional(), ticketPriceCny: fact(z.number()).optional(),
  queueMinutes: fact(z.number()).optional(), rating: fact(z.number()).optional(), bookingNote: fact(z.string()).optional(),
});
export const CompanionPreference = z.object({
  id: z.string(), label: z.string(), interests: z.array(z.string()),
  walkingTolerance: WalkingTolerance.optional(), personalBudgetCny: z.number().optional(), specialNeeds: z.array(z.string()),
});
export const TravelIntent = z.object({
  id: z.string(), activityId: z.string().optional(), placeId: z.string().optional(), placeQuery: z.string().optional(),
  type: IntentType, userRequest: z.string(), desiredOutputs: z.array(z.string()), confirmed: z.boolean(),
  status: z.enum(['PENDING', 'READY', 'TRIGGERED', 'CANCELLED']), preparedContentIds: z.array(z.string()), locked: z.boolean(),
});
export const PlaceReference = z.object({ query: z.string(), place: Place.optional() });
export const FixedConstraint = z.object({
  id: z.string(), activityId: z.string().optional(), place: PlaceReference.optional(),
  startAt: z.string(), endAt: z.string().optional(), reason: z.string(), locked: z.boolean(),
});
export const TripRequirements = z.object({
  requirementsId: z.string(), version: z.number().int(), confirmed: z.boolean(),
  destinationCity: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional(),
  timezone: z.literal('Asia/Shanghai'),
  travelerCount: z.number().int().optional(), budgetCny: z.number().optional(), budgetScope: BudgetScope.optional(),
  budgetIsHardLimit: z.boolean(), includesAccommodation: z.boolean().optional(), includesIntercityTransport: z.boolean().optional(),
  arrivalAt: z.string().optional(), departureAt: z.string().optional(),
  startPoint: PlaceReference.optional(), endPoint: PlaceReference.optional(),
  transportModes: z.array(TravelMode), mustVisit: z.array(PlaceReference), avoidPlaces: z.array(PlaceReference),
  preferences: z.array(z.string()), companions: z.array(CompanionPreference),
  walkingTolerance: WalkingTolerance.optional(), specialNeeds: z.array(z.string()),
  dailyStartTime: z.string().optional(), dailyEndTime: z.string().optional(),
  fixedConstraints: z.array(FixedConstraint), intents: z.array(TravelIntent),
});
export const NotificationPolicy = z.object({
  enableL1: z.boolean(), enableL2: z.boolean(), enableL3: z.boolean(), paused: z.boolean(), cooldownMinutes: z.number(),
});
export const TravelSegment = z.object({
  fromActivityId: z.string(), toActivityId: z.string(), mode: TravelMode,
  durationMin: z.number().optional(), distanceMeters: z.number().optional(), routeGeometry: z.array(GeoPoint).optional(), evidence: Evidence,
});
export const RouteEndpoint = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ACTIVITY'), activityId: z.string(), place: Place }),
  z.object({ kind: z.literal('START_POINT'), place: Place }),
  z.object({ kind: z.literal('END_POINT'), place: Place }),
]);
export const BoundarySegment = z.object({
  dayIndex: z.number().int(), from: RouteEndpoint, to: RouteEndpoint, mode: TravelMode,
  durationMin: z.number().optional(), distanceMeters: z.number().optional(), routeGeometry: z.array(GeoPoint).optional(), evidence: Evidence,
});
export const ItineraryActivity = z.object({
  id: z.string(), place: Place, dayIndex: z.number().int().min(0), orderIndex: z.number().int().min(0),
  startAt: z.string(), endAt: z.string(),
  estimatedCostCny: z.number().optional(), costStatus: DataStatus, locked: z.boolean(), mandatory: z.boolean(),
  progress: ActivityProgress, intentIds: z.array(z.string()),
  bookingStatus: z.enum(['UNSPECIFIED', 'REQUIRED', 'BOOKED']).optional(), bookingEvidence: Evidence.optional(),
});
export const TripState = z.object({
  schemaVersion: z.literal(1), tripId: z.string(), revision: z.number().int().min(0), title: z.string(),
  destinationCity: z.string(), startDate: z.string(), endDate: z.string(), travelerCount: z.number().int().positive(),
  budgetCny: z.number().optional(), budgetScope: BudgetScope.optional(),
  companions: z.array(CompanionPreference), preferences: z.array(z.string()), mode: TripMode,
  lifecycle: Lifecycle, requirements: TripRequirements,
  activities: z.array(ItineraryActivity), segments: z.array(TravelSegment), boundarySegments: z.array(BoundarySegment),
  intents: z.array(TravelIntent), notificationPolicy: NotificationPolicy, updatedAt: z.string(),
});

// ---------- 编辑与校验 ----------
const PlaceRefArr = z.array(PlaceReference);
export const ConstraintChange = z.discriminatedUnion('key', [
  z.object({ key: z.literal('budgetCny'), value: z.number() }),
  z.object({ key: z.literal('budgetScope'), value: BudgetScope }),
  z.object({ key: z.literal('budgetIsHardLimit'), value: z.boolean() }),
  z.object({ key: z.literal('includesAccommodation'), value: z.boolean() }),
  z.object({ key: z.literal('includesIntercityTransport'), value: z.boolean() }),
  z.object({ key: z.literal('transportModes'), value: z.array(TravelMode) }),
  z.object({ key: z.literal('preferences'), value: z.array(z.string()) }),
  z.object({ key: z.literal('companions'), value: z.array(CompanionPreference) }),
  z.object({ key: z.literal('specialNeeds'), value: z.array(z.string()) }),
  z.object({ key: z.literal('walkingTolerance'), value: WalkingTolerance }),
  ...(['startDate', 'endDate', 'arrivalAt', 'departureAt', 'dailyStartTime', 'dailyEndTime'] as const)
    .map((k) => z.object({ key: z.literal(k), value: z.string() })),
  z.object({ key: z.literal('startPoint'), value: PlaceReference }),
  z.object({ key: z.literal('endPoint'), value: PlaceReference }),
  z.object({ key: z.literal('mustVisit'), value: PlaceRefArr }),
  z.object({ key: z.literal('avoidPlaces'), value: PlaceRefArr }),
  z.object({ key: z.literal('fixedConstraints'), value: z.array(FixedConstraint) }),
  z.object({ key: z.literal('intents'), value: z.array(TravelIntent) }),
  z.object({ key: z.literal('activityLocked'), value: z.object({ activityId: z.string(), locked: z.boolean() }) }),
]);
const opBase = {
  ADD: z.object({ type: z.literal('ADD'), activity: ItineraryActivity }),
  REMOVE: z.object({ type: z.literal('REMOVE'), activityId: z.string() }),
  REPLACE: z.object({ type: z.literal('REPLACE'), activityId: z.string(), candidatePlaceId: z.string(), candidatePlace: Place }),
  MOVE: z.object({ type: z.literal('MOVE'), activityId: z.string(), dayIndex: z.number().int(), orderIndex: z.number().int() }),
  UPDATE_TIME: z.object({ type: z.literal('UPDATE_TIME'), activityId: z.string(), startAt: z.string() }),
  UPDATE_DURATION: z.object({ type: z.literal('UPDATE_DURATION'), activityId: z.string(), durationMin: z.number().positive() }),
};
export const UpdateConstraintOp = z.intersection(z.object({ type: z.literal('UPDATE_CONSTRAINT') }), ConstraintChange);
export const EditOperation = z.union([
  opBase.ADD, opBase.REMOVE, opBase.REPLACE, opBase.MOVE, opBase.UPDATE_TIME, opBase.UPDATE_DURATION, UpdateConstraintOp,
]);
export const Violation = z.object({ code: z.string(), activityIds: z.array(z.string()), message: z.string() });
export const ValidationReport = z.object({
  status: ValidationStatus, hardViolations: z.array(Violation), unknownChecks: z.array(z.string()),
  warnings: z.array(z.string()), committable: z.boolean(),
});
export const RevisionProposal = z.object({
  proposalId: z.string(), tripId: z.string(), baseRevision: z.number().int(), operations: z.array(EditOperation),
  candidate: TripState, hardViolations: z.array(Violation), unknownChecks: z.array(z.string()),
  diff: z.object({ added: z.array(z.string()), removed: z.array(z.string()), moved: z.array(z.string()) }),
  estimatedChanges: z.object({ travelMinutesDelta: z.number().optional(), costCnyDelta: z.number().optional() }),
  validation: ValidationReport,
  activityChanges: z.array(z.object({
    activityId: z.string(), oldStartAt: z.string().optional(), newStartAt: z.string().optional(),
    oldEndAt: z.string().optional(), newEndAt: z.string().optional(), fields: z.array(z.string()),
  })),
});
export const PreparedContent = z.object({
  contentId: z.string(), tripId: z.string(), baseRevision: z.number().int(), activityId: z.string().optional(), intentId: z.string().optional(),
  placeId: z.string(), module: ServiceModule, title: z.string(), body: z.string(),
  version: z.number().int(), generatedAt: z.string(), evidence: z.array(Evidence), scopeNote: z.string(),
});
export const SelectedContext = z.object({
  tripId: z.string(), planRevision: z.number().int(), mode: TripMode,
  selectedActivityId: z.string().optional(), selectedPoiId: z.string().optional(), activeDay: z.number().int(),
});
export const ConversationMessage = z.object({ role: z.enum(['user', 'assistant']), content: z.string() });
export const RevisionResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('REVISION'), proposal: RevisionProposal }),
  z.object({ kind: z.literal('CONTENT'), content: PreparedContent }),
  z.object({ kind: z.literal('CLARIFICATION'), questions: z.array(z.string()), candidates: z.array(Place) }),
]);
export const PlanResult = z.object({
  plan: TripState.optional(), validation: ValidationReport, preparedContents: z.array(PreparedContent),
});

// ---------- 定位 / 事实 / 提醒 ----------
export const NormalizedLocationEvent = z.object({
  sampleId: z.string(), tripId: z.string(), source: z.enum(['REAL', 'SIMULATED']), demoRunId: z.string().optional(),
  location: GeoPoint, accuracyMeters: z.number(), timestamp: z.string(), pageVisible: z.boolean(),
  speedMetersPerSecond: z.number().optional(),
});
export const ProactiveEvent = z.object({
  eventId: z.string(), tripId: z.string(), revision: z.number().int(), source: EventSource,
  type: z.enum(['APPROACH', 'ARRIVE', 'LEAVE', 'RISK', 'RESUME']),
  activityId: z.string().optional(), arrivalId: z.string().optional(), demoRunId: z.string().optional(),
  location: GeoPoint.optional(), accuracyMeters: z.number().optional(), occurredAt: z.string(),
  risk: z.object({ code: z.string(), message: z.string(), evidence: z.array(Evidence), activityIds: z.array(z.string()) }).optional(),
});
export const NotificationAction = z.enum(['VIEW_CONTENT', 'VIEW_SCRIPT', 'VIEW_SHOOTING_CHECKLIST', 'REMIND_LATER', 'IGNORE', 'VIEW_REVISION', 'VIEW_NEARBY', 'ADD_TO_PLAN']);
export const ProactiveDecision = z.object({
  decisionId: z.string(), eventId: z.string(), tripId: z.string(), baseRevision: z.number().int(),
  shouldNotify: z.boolean(), reasonCode: z.string(), suppressionReason: z.string().optional(),
  card: z.object({
    cardId: z.string(), level: NotificationLevel, module: ServiceModule, activityId: z.string().optional(),
    intentId: z.string().optional(), title: z.string(), actions: z.array(NotificationAction), contentIds: z.array(z.string()),
    evidence: z.object({ source: EventSource, eventId: z.string(), facts: z.array(Evidence) }),
  }).optional(),
});
export const NotificationRecord = z.object({
  notificationId: z.string(), eventId: z.string(), tripRevision: z.number().int(), source: EventSource,
  demoRunId: z.string().optional(), arrivalId: z.string().optional(), activityId: z.string().optional(),
  intentId: z.string().optional(), riskCode: z.string().optional(), contentId: z.string().optional(),
  level: NotificationLevel, decision: z.string(), suppressionReason: z.string().optional(), shownAt: z.string().optional(),
  actionTaken: NotificationAction.optional(), actionAt: z.string().optional(), snoozeUntil: z.string().optional(),
});
export const GeoRuntimeState = z.object({
  tripId: z.string(), activityId: z.string(), source: z.enum(['REAL', 'SIMULATED']), demoRunId: z.string().optional(),
  progress: ActivityProgress, arrivalId: z.string().optional(), candidateSince: z.string().optional(),
  outsideSince: z.string().optional(), lastValidSampleAt: z.string().optional(),
});
export const GeoPolicy = z.object({
  policyVersion: z.string(), arrivalRadiusMeters: z.number(), departureRadiusMeters: z.number(),
  maxAccuracyMeters: z.number(), arrivalDwellSeconds: z.number(), departureDwellSeconds: z.number(),
  minValidSamples: z.number().int(), maxSpeedMetersPerSecond: z.number(), maxSampleGapSeconds: z.number(),
});

// ---------- 任务与能力 ----------
export const ProgressEvent = z.object({
  eventId: z.string(), sequence: z.number().int(), occurredAt: z.string(), runId: z.string(), agentId: AgentId,
  type: z.enum(['agent_started', 'agent_completed', 'agent_failed', 'tool_call_started', 'tool_call_finished']),
  message: z.string(), toolName: z.string().optional(), traceId: z.string(),
});
const RequestContextShape = {
  executionMode: ExecutionMode, demoRunId: z.string().optional(), tripId: z.string(), baseRevision: z.number().int(),
};
export const JobAccepted = z.object({ ...RequestContextShape, jobId: z.string() });
export const jobSnapshot = <T extends z.ZodTypeAny>(result: T) => z.object({
  ...RequestContextShape, jobId: z.string(), status: JobStatus,
  progressEvents: z.array(ProgressEvent), nextCursor: z.number().int(), result: result.optional(),
});
export const CapabilitySet = z.object({
  planning: z.boolean(), poiSearch: z.boolean(), routes: z.array(TravelMode), content: z.boolean(), nearby: z.boolean(), demo: z.boolean(),
  tools: z.array(z.object({ name: z.string(), available: z.boolean(), reason: z.string().optional() })),
  modelRoutes: z.array(z.object({ agentId: AgentId, provider: z.string(), model: z.string(), available: z.boolean() })),
  limits: z.object({
    pollIntervalMs: z.number(), maxPollIntervalMs: z.number(), jobTtlSeconds: z.number(),
    requestTimeoutSeconds: z.number(), maxJobSeconds: z.number(), maxBodyBytes: z.number(),
  }),
  geoPolicy: GeoPolicy,
});
export const HealthData = z.object({ serviceStatus: z.enum(['OK', 'DEGRADED']), version: z.string(), capabilities: CapabilitySet });
export const NearbyCandidate = z.object({
  place: Place, distanceMeters: z.number().optional(), distanceEvidence: Evidence,
  relevanceReason: z.string(), estimatedCostCny: z.number().optional(), costStatus: DataStatus,
});
export const ParseResult = z.object({
  requirements: TripRequirements, intents: z.array(TravelIntent), missingFields: z.array(z.string()),
  uncertainFields: z.array(z.object({ fieldPath: z.string(), reason: z.string(), candidates: z.array(Place).optional() })),
});
export const ValidateResult = z.object({ proposalId: z.string(), baseRevision: z.number().int(), validation: ValidationReport });
export const EvaluateResult = z.object({ decision: ProactiveDecision, contents: z.array(PreparedContent) });
export const ContentsResult = z.object({ contents: z.array(PreparedContent) });
export const ContentResult = z.object({ content: PreparedContent });
export const NearbyResult = z.object({ candidates: z.array(NearbyCandidate) });
export const PlacesResult = z.object({ places: z.array(Place) });
export const RoutesResult = z.object({ segments: z.array(TravelSegment), boundarySegments: z.array(BoundarySegment), warnings: z.array(z.string()) });
export const CancelResult = z.object({ jobId: z.string(), status: JobStatus });
