"""TripFlow-Split-v1 canonical contracts. JSON names are deliberately camelCase."""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Annotated, Any, Generic, Literal, TypeVar, Union

from pydantic import BaseModel, RootModel, ConfigDict, Field, AfterValidator, TypeAdapter, create_model, model_validator


def _timestamp(v: str) -> str:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", v):
        raise ValueError("ISO 8601 timestamp with timezone required")
    datetime.fromisoformat(v.replace("Z", "+00:00"))
    return v


def _plan_time(v: str) -> str:
    _timestamp(v)
    if not v.endswith("+08:00"):
        raise ValueError("plan time must have +08:00 offset")
    return v


def _date(v: str) -> str:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        raise ValueError("date must be YYYY-MM-DD")
    date.fromisoformat(v)
    return v


def _clock(v: str) -> str:
    if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", v):
        raise ValueError("clock must be HH:mm")
    return v


Id = Annotated[str, Field(min_length=1, strict=True)]
Timestamp = Annotated[str, AfterValidator(_timestamp)]
PlanTime = Annotated[str, AfterValidator(_plan_time)]
DateString = Annotated[str, AfterValidator(_date)]
Clock = Annotated[str, AfterValidator(_clock)]
NonNegativeInt = Annotated[int, Field(ge=0, strict=True)]
PositiveInt = Annotated[int, Field(gt=0, strict=True)]
NonNegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Positive = Annotated[float, Field(gt=0, allow_inf_nan=False)]
JobStatus = Literal['PENDING', 'RUNNING', 'PARTIAL', 'SUCCEEDED', 'FAILED', 'CANCELLED']
DataStatus = Literal['VERIFIED', 'ESTIMATED', 'UNKNOWN', 'FAILED']
ValidationStatus = Literal['FEASIBLE', 'PARTIALLY_VERIFIED', 'INFEASIBLE']
EventSource = Literal['REAL', 'SIMULATED', 'USER_CORRECTION']
TripMode = Literal['PLANNING', 'TRAVELING']
ExecutionMode = Literal['REAL', 'DEMO']
Lifecycle = Literal['DRAFT_INPUT', 'PLANNING', 'PLAN_READY', 'TRAVELING', 'TRIP_ENDED']
TravelMode = Literal['WALK', 'TRANSIT', 'DRIVE']
ActivityProgress = Literal['NOT_STARTED', 'APPROACHING', 'ARRIVED', 'VISITING', 'INFERRED_COMPLETE', 'LOCATION_UNKNOWN']
IntentType = Literal['KNOWLEDGE', 'PHOTO', 'VIDEO_SHOOT', 'SPEECH', 'CHECK_IN', 'FOOD', 'OTHER']
ServiceModule = Literal['KNOWLEDGE', 'PERSONAL_GOAL', 'TRIP_RISK', 'NEARBY']
AgentId = Literal['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']
WalkingTolerance = Literal['LOW', 'MEDIUM', 'HIGH']
BudgetScope = Literal['PER_PERSON', 'TOTAL']
NotificationAction = Literal['VIEW_CONTENT', 'VIEW_SCRIPT', 'VIEW_SHOOTING_CHECKLIST', 'REMIND_LATER', 'IGNORE', 'VIEW_REVISION', 'VIEW_NEARBY', 'ADD_TO_PLAN']
T = TypeVar('T')


class ContractModel(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, validate_assignment=True, allow_inf_nan=False)


class ApiError(ContractModel):
    code: Id
    message: Id
    retryable: bool
    fieldPath: str | None = None


class ApiResponse(ContractModel, Generic[T]):
    request_id: Id
    status: JobStatus
    data: T | None
    errors: list[ApiError]
    trace_id: Id


class GeoPoint(ContractModel):
    lat: Annotated[float, Field(ge=-90, le=90)]
    lng: Annotated[float, Field(ge=-180, le=180)]
    coordinateSystem: Literal['GCJ02', 'WGS84']


class Evidence(ContractModel):
    provider: Id
    externalId: Id | None = None
    fetchedAt: Timestamp | None = None
    status: DataStatus
    sourceUrl: str | None = None
    note: str | None = None


class Fact(ContractModel, Generic[T]):
    value: T | None = None
    evidence: Evidence

    @model_validator(mode='after')
    def fact_status(self):
        if self.evidence.status in ('UNKNOWN', 'FAILED') and self.value is not None:
            raise ValueError('unknown/failed fact cannot carry a value')
        if self.evidence.status in ('VERIFIED', 'ESTIMATED') and self.value is None:
            raise ValueError('verified/estimated fact requires value')
        return self


class WebReference(ContractModel):
    title: Id
    url: Id
    snippet: str
    evidence: Evidence


class WebResearch(ContractModel):
    status: Literal['AVAILABLE', 'EMPTY', 'UNAVAILABLE', 'NOT_CONFIGURED']
    query: str
    checkedAt: Timestamp
    references: list[WebReference]
    message: str


class Place(ContractModel):
    poiId: Id
    name: Id
    address: str | None = None
    location: GeoPoint
    evidence: list[Evidence]
    openingHours: Fact[str] | None = None
    ticketPriceCny: Fact[NonNegative] | None = None
    queueMinutes: Fact[NonNegative] | None = None
    rating: Fact[NonNegative] | None = None
    bookingNote: Fact[str] | None = None
    parentPoiId: Fact[Id] | None = None
    webResearch: WebResearch | None = None
    photoUrls: list[str] | None = None
    category: Literal['ATTRACTION', 'RESTAURANT', 'OTHER'] | None = None
    averageCostCny: Fact[NonNegative] | None = None


class CompanionPreference(ContractModel):
    id: Id
    label: Id
    interests: list[str]
    walkingTolerance: WalkingTolerance | None = None
    personalBudgetCny: NonNegative | None = None
    specialNeeds: list[str]


class TravelIntent(ContractModel):
    id: Id
    activityId: Id | None = None
    placeId: Id | None = None
    placeQuery: Id | None = None
    type: IntentType
    userRequest: Id
    desiredOutputs: list[str]
    confirmed: bool
    status: Literal['PENDING', 'READY', 'TRIGGERED', 'CANCELLED']
    preparedContentIds: list[Id]
    locked: bool


class PlaceReference(ContractModel):
    query: Id
    place: Place | None = None


class FixedConstraint(ContractModel):
    id: Id
    activityId: Id | None = None
    place: PlaceReference | None = None
    startAt: PlanTime
    endAt: PlanTime | None = None
    reason: Id
    locked: bool

    @model_validator(mode='after')
    def window(self):
        if self.endAt and datetime.fromisoformat(self.endAt) <= datetime.fromisoformat(self.startAt):
            raise ValueError('endAt must follow startAt')
        return self


class TripRequirements(ContractModel):
    requirementsId: Id
    version: NonNegativeInt
    confirmed: bool
    destinationCity: Id | None = None
    startDate: DateString | None = None
    endDate: DateString | None = None
    timezone: Literal['Asia/Shanghai']
    travelerCount: PositiveInt | None = None
    budgetCny: NonNegative | None = None
    budgetScope: BudgetScope | None = None
    budgetIsHardLimit: bool
    includesAccommodation: bool | None = None
    includesIntercityTransport: bool | None = None
    arrivalAt: PlanTime | None = None
    departureAt: PlanTime | None = None
    startPoint: PlaceReference | None = None
    endPoint: PlaceReference | None = None
    transportModes: list[TravelMode]
    mustVisit: list[PlaceReference]
    avoidPlaces: list[PlaceReference]
    preferences: list[str]
    companions: list[CompanionPreference]
    walkingTolerance: WalkingTolerance | None = None
    specialNeeds: list[str]
    dailyStartTime: Clock | None = None
    dailyEndTime: Clock | None = None
    fixedConstraints: list[FixedConstraint]
    intents: list[TravelIntent]

    @model_validator(mode='after')
    def dates(self):
        if self.startDate and self.endDate:
            days = (date.fromisoformat(self.endDate) - date.fromisoformat(self.startDate)).days + 1
            if days not in (1, 2, 3):
                raise ValueError('trip must span 1–3 inclusive days')
        if self.arrivalAt and self.departureAt and self.arrivalAt >= self.departureAt:
            raise ValueError('departure must follow arrival')
        if self.dailyStartTime and self.dailyEndTime and self.dailyStartTime >= self.dailyEndTime:
            raise ValueError('dailyEndTime must follow dailyStartTime')
        return self

    def require_confirmed(self):
        if not self.confirmed or any(getattr(self, k) is None for k in ('destinationCity', 'startDate', 'endDate', 'travelerCount')):
            raise ValueError('confirmed city, dates and travelerCount required')


class NotificationPolicy(ContractModel):
    enableL1: bool
    enableL2: bool
    enableL3: bool
    paused: bool
    cooldownMinutes: NonNegative


class TravelSegment(ContractModel):
    fromActivityId: Id
    toActivityId: Id
    mode: TravelMode
    durationMin: NonNegative | None = None
    distanceMeters: NonNegative | None = None
    routeGeometry: list[GeoPoint] | None = None
    evidence: Evidence

    @model_validator(mode='after')
    def no_fake_route(self):
        if self.evidence.status in ('UNKNOWN', 'FAILED') and any(v is not None for v in (self.durationMin, self.distanceMeters, self.routeGeometry)):
            raise ValueError('unknown/failed route cannot carry invented geometry or duration')
        return self


class ActivityEndpoint(ContractModel):
    kind: Literal['ACTIVITY']
    activityId: Id
    place: Place


class BoundaryEndpoint(ContractModel):
    kind: Literal['START_POINT', 'END_POINT']
    place: Place


RouteEndpoint = Annotated[Union[ActivityEndpoint, BoundaryEndpoint], Field(discriminator='kind')]


class BoundarySegment(ContractModel):
    dayIndex: NonNegativeInt
    from_: RouteEndpoint = Field(alias='from')
    to: RouteEndpoint
    mode: TravelMode
    durationMin: NonNegative | None = None
    distanceMeters: NonNegative | None = None
    routeGeometry: list[GeoPoint] | None = None
    evidence: Evidence

    @model_validator(mode='after')
    def boundary(self):
        if (self.from_.kind == 'ACTIVITY') == (self.to.kind == 'ACTIVITY'):
            raise ValueError('boundary route requires exactly one activity endpoint')
        if self.from_.kind == 'END_POINT' or self.to.kind == 'START_POINT':
            raise ValueError('boundary route direction invalid')
        return self


class ItineraryActivity(ContractModel):
    id: Id
    place: Place
    dayIndex: NonNegativeInt
    orderIndex: NonNegativeInt
    startAt: PlanTime
    endAt: PlanTime
    estimatedCostCny: NonNegative | None = None
    costStatus: DataStatus
    locked: bool
    mandatory: bool
    progress: ActivityProgress
    intentIds: list[Id]
    bookingStatus: Literal['UNSPECIFIED', 'REQUIRED', 'BOOKED'] | None = None
    bookingEvidence: Evidence | None = None

    @model_validator(mode='after')
    def window(self):
        if datetime.fromisoformat(self.endAt) <= datetime.fromisoformat(self.startAt):
            raise ValueError('activity endAt must follow startAt')
        if self.costStatus in ('UNKNOWN', 'FAILED') and self.estimatedCostCny is not None:
            raise ValueError('unknown cost cannot be replaced by a number')
        return self


class TripState(ContractModel):
    schemaVersion: Literal[1]
    tripId: Id
    revision: NonNegativeInt
    title: Id
    destinationCity: Id
    startDate: DateString
    endDate: DateString
    travelerCount: PositiveInt
    budgetCny: NonNegative | None = None
    budgetScope: BudgetScope | None = None
    companions: list[CompanionPreference]
    preferences: list[str]
    mode: TripMode
    lifecycle: Lifecycle
    requirements: TripRequirements
    activities: list[ItineraryActivity]
    segments: list[TravelSegment]
    boundarySegments: list[BoundarySegment]
    intents: list[TravelIntent]
    notificationPolicy: NotificationPolicy
    updatedAt: Timestamp

    @model_validator(mode='after')
    def consistent(self):
        self.requirements.require_confirmed()
        for key in ('destinationCity', 'startDate', 'endDate', 'travelerCount', 'budgetCny', 'budgetScope', 'companions', 'preferences', 'intents'):
            if getattr(self, key) != getattr(self.requirements, key):
                raise ValueError(f'requirements projection mismatch: {key}')
        ids = [a.id for a in self.activities]
        if len(ids) != len(set(ids)):
            raise ValueError('duplicate activity IDs')
        days = (date.fromisoformat(self.endDate) - date.fromisoformat(self.startDate)).days + 1
        for a in self.activities:
            if a.dayIndex >= days or a.startAt[:10] != (date.fromisoformat(self.startDate) + timedelta(days=a.dayIndex)).isoformat():
                raise ValueError('activity dayIndex/date mismatch')
        for s in self.segments:
            by_id = {a.id: a for a in self.activities}
            if s.fromActivityId not in by_id or s.toActivityId not in by_id:
                raise ValueError('route references missing activity')
            if by_id[s.fromActivityId].dayIndex != by_id[s.toActivityId].dayIndex:
                raise ValueError('ordinary route cannot cross travel days')
        return self


class AddOperation(ContractModel):
    type: Literal['ADD']
    activity: ItineraryActivity


class RemoveOperation(ContractModel):
    type: Literal['REMOVE']
    activityId: Id


class ReplaceOperation(ContractModel):
    type: Literal['REPLACE']
    activityId: Id
    candidatePlaceId: Id
    candidatePlace: Place

    @model_validator(mode='after')
    def candidate_id(self):
        if self.candidatePlaceId != self.candidatePlace.poiId:
            raise ValueError('candidatePlaceId mismatch')
        return self


class MoveOperation(ContractModel):
    type: Literal['MOVE']
    activityId: Id
    dayIndex: NonNegativeInt
    orderIndex: NonNegativeInt


class UpdateTimeOperation(ContractModel):
    type: Literal['UPDATE_TIME']
    activityId: Id
    startAt: PlanTime


class UpdateDurationOperation(ContractModel):
    type: Literal['UPDATE_DURATION']
    activityId: Id
    durationMin: Positive


class ActivityLockChange(ContractModel):
    activityId: Id
    locked: bool


_constraint_types = {
    'budgetCny': NonNegative, 'budgetScope': BudgetScope, 'budgetIsHardLimit': bool,
    'includesAccommodation': bool, 'includesIntercityTransport': bool,
    'transportModes': list[TravelMode], 'preferences': list[str], 'companions': list[CompanionPreference],
    'specialNeeds': list[str], 'walkingTolerance': WalkingTolerance,
    'startDate': DateString, 'endDate': DateString, 'arrivalAt': PlanTime, 'departureAt': PlanTime,
    'dailyStartTime': Clock, 'dailyEndTime': Clock, 'startPoint': PlaceReference, 'endPoint': PlaceReference,
    'mustVisit': list[PlaceReference], 'avoidPlaces': list[PlaceReference],
    'fixedConstraints': list[FixedConstraint], 'intents': list[TravelIntent], 'activityLocked': ActivityLockChange,
}
_constraint_models = [create_model(f'Constraint_{key}', __base__=ContractModel, key=(Literal[key], ...), value=(typ, ...)) for key, typ in _constraint_types.items()]
ConstraintChange = Annotated[Union[tuple(_constraint_models)], Field(discriminator='key')]
_update_constraint_models = [create_model(f'UpdateConstraint_{key}', __base__=model, type=(Literal['UPDATE_CONSTRAINT'], ...)) for key, model in zip(_constraint_types, _constraint_models)]
class UpdateConstraintOperation(RootModel[Annotated[Union[tuple(_update_constraint_models)], Field(discriminator='key')]]):
    """Named flattened union so OpenAPI discriminator mapping always points to a reference."""
    @property
    def type(self):
        return self.root.type

    @property
    def key(self):
        return self.root.key

    @property
    def value(self):
        return self.root.value


EditOperation = Annotated[Union[AddOperation, RemoveOperation, ReplaceOperation, MoveOperation, UpdateTimeOperation, UpdateDurationOperation, UpdateConstraintOperation], Field(discriminator='type')]


class Violation(ContractModel):
    code: Id
    activityIds: list[Id]
    message: Id


class ValidationReport(ContractModel):
    status: ValidationStatus
    hardViolations: list[Violation]
    unknownChecks: list[str]
    warnings: list[str]
    committable: bool

    @model_validator(mode='after')
    def safe_commit(self):
        if self.committable and (self.status == 'INFEASIBLE' or self.hardViolations):
            raise ValueError('hard violations cannot be committed')
        if self.status == 'FEASIBLE' and self.unknownChecks:
            raise ValueError('unknown checks require PARTIALLY_VERIFIED')
        return self


class RevisionDiff(ContractModel):
    added: list[Id]
    removed: list[Id]
    moved: list[Id]


class EstimatedChanges(ContractModel):
    travelMinutesDelta: float | None = None
    costCnyDelta: float | None = None


class ActivityChange(ContractModel):
    activityId: Id
    oldStartAt: PlanTime | None = None
    newStartAt: PlanTime | None = None
    oldEndAt: PlanTime | None = None
    newEndAt: PlanTime | None = None
    fields: list[str]


class RevisionProposal(ContractModel):
    proposalId: Id
    tripId: Id
    baseRevision: NonNegativeInt
    operations: list[EditOperation]
    candidate: TripState
    hardViolations: list[Violation]
    unknownChecks: list[str]
    diff: RevisionDiff
    estimatedChanges: EstimatedChanges
    validation: ValidationReport
    activityChanges: list[ActivityChange]

    @model_validator(mode='after')
    def consistency(self):
        if self.tripId != self.candidate.tripId or self.baseRevision != self.candidate.revision:
            raise ValueError('STALE_REVISION: candidate context mismatch')
        if self.hardViolations != self.validation.hardViolations or self.unknownChecks != self.validation.unknownChecks:
            raise ValueError('proposal validation projection mismatch')
        return self


class PreparedContent(ContractModel):
    contentId: Id
    tripId: Id
    baseRevision: NonNegativeInt
    activityId: Id | None = None
    intentId: Id | None = None
    placeId: Id
    module: ServiceModule
    title: Id
    body: Id
    version: PositiveInt
    generatedAt: Timestamp
    evidence: list[Evidence]
    scopeNote: Id
    generationProvider: str | None = None
    generationModel: str | None = None
    deliveryMode: Literal['GUIDE', 'DOCUMENT'] | None = None


class SelectedContext(ContractModel):
    tripId: Id
    planRevision: NonNegativeInt
    mode: TripMode
    selectedActivityId: Id | None = None
    selectedPoiId: Id | None = None
    activeDay: NonNegativeInt


class ConversationMessage(ContractModel):
    role: Literal['user', 'assistant']
    content: Id


class RevisionOutcome(ContractModel):
    kind: Literal['REVISION']
    proposal: RevisionProposal


class ContentOutcome(ContractModel):
    kind: Literal['CONTENT']
    content: PreparedContent


class ClarificationOutcome(ContractModel):
    kind: Literal['CLARIFICATION']
    questions: list[str]
    candidates: list[Place]


RevisionResult = Annotated[Union[RevisionOutcome, ContentOutcome, ClarificationOutcome], Field(discriminator='kind')]


class PlanResult(ContractModel):
    plan: TripState | None = None
    validation: ValidationReport
    preparedContents: list[PreparedContent]


class ExecutionContext(ContractModel):
    executionMode: ExecutionMode
    demoRunId: Id | None = None

    @model_validator(mode='after')
    def execution(self):
        if (self.executionMode == 'DEMO') != (self.demoRunId is not None):
            raise ValueError('DEMO requires demoRunId; REAL must omit it')
        return self


class RequestContext(ExecutionContext):
    tripId: Id
    baseRevision: NonNegativeInt


class NormalizedLocationEvent(ContractModel):
    sampleId: Id
    tripId: Id
    source: Literal['REAL', 'SIMULATED']
    demoRunId: Id | None = None
    location: GeoPoint
    accuracyMeters: NonNegative
    timestamp: Timestamp
    pageVisible: bool
    speedMetersPerSecond: NonNegative | None = None

    @model_validator(mode='after')
    def source_context(self):
        if (self.source == 'SIMULATED') != (self.demoRunId is not None):
            raise ValueError('simulated source requires isolated demoRunId')
        return self


class RiskDetail(ContractModel):
    code: Id
    message: Id
    evidence: Annotated[list[Evidence], Field(min_length=1)]
    activityIds: list[Id]


class ProactiveEvent(ContractModel):
    eventId: Id
    tripId: Id
    revision: NonNegativeInt
    source: EventSource
    type: Literal['APPROACH', 'ARRIVE', 'LEAVE', 'RISK', 'RESUME']
    activityId: Id | None = None
    arrivalId: Id | None = None
    demoRunId: Id | None = None
    location: GeoPoint | None = None
    accuracyMeters: NonNegative | None = None
    occurredAt: Timestamp
    risk: RiskDetail | None = None

    @model_validator(mode='after')
    def source_risk(self):
        if (self.source == 'SIMULATED' and self.demoRunId is None) or (self.source == 'REAL' and self.demoRunId is not None):
            raise ValueError('simulated event requires demoRunId')
        if self.type == 'RISK' and self.risk is None:
            raise ValueError('risk event requires evidence')
        if self.type in ('ARRIVE', 'LEAVE') and (not self.activityId or not self.arrivalId):
            raise ValueError('arrival/leave requires activityId and arrivalId')
        return self


class CardEvidence(ContractModel):
    source: EventSource
    eventId: Id
    facts: list[Evidence]


class NotificationCard(ContractModel):
    cardId: Id
    level: Literal['L1', 'L2', 'L3']
    module: ServiceModule
    activityId: Id | None = None
    intentId: Id | None = None
    title: Id
    actions: list[NotificationAction]
    contentIds: list[Id]
    evidence: CardEvidence


class ProactiveDecision(ContractModel):
    decisionId: Id
    eventId: Id
    tripId: Id
    baseRevision: NonNegativeInt
    shouldNotify: bool
    reasonCode: Id
    suppressionReason: Id | None = None
    card: NotificationCard | None = None

    @model_validator(mode='after')
    def card_presence(self):
        if self.shouldNotify != (self.card is not None):
            raise ValueError('card required exactly when shouldNotify')
        if not self.shouldNotify and not self.suppressionReason:
            raise ValueError('suppressed decision requires suppressionReason')
        return self


class NotificationRecord(ContractModel):
    notificationId: Id
    eventId: Id
    tripRevision: NonNegativeInt
    source: EventSource
    demoRunId: Id | None = None
    arrivalId: Id | None = None
    activityId: Id | None = None
    intentId: Id | None = None
    riskCode: Id | None = None
    contentId: Id | None = None
    level: Literal['L1', 'L2', 'L3']
    decision: Id
    suppressionReason: str | None = None
    shownAt: Timestamp | None = None
    actionTaken: NotificationAction | None = None
    actionAt: Timestamp | None = None
    snoozeUntil: Timestamp | None = None

    @model_validator(mode='after')
    def source_context(self):
        if (self.source == 'SIMULATED' and self.demoRunId is None) or (self.source == 'REAL' and self.demoRunId is not None):
            raise ValueError('notification DEMO context mismatch')
        return self


class ProgressCorrection(ContractModel):
    activityId: Id
    previous: ActivityProgress
    next: ActivityProgress
    reason: Id


class EventLogEntry(ContractModel):
    logId: Id
    tripId: Id
    tripRevision: NonNegativeInt
    source: EventSource
    demoRunId: Id | None = None
    occurredAt: Timestamp
    event: ProactiveEvent | None = None
    notification: NotificationRecord | None = None
    correction: ProgressCorrection | None = None

    @model_validator(mode='after')
    def fact_context(self):
        if (self.source == 'SIMULATED' and self.demoRunId is None) or (self.source == 'REAL' and self.demoRunId is not None):
            raise ValueError('fact DEMO context mismatch')
        if self.correction and self.source != 'USER_CORRECTION':
            raise ValueError('correction requires USER_CORRECTION source')
        if self.event and (self.event.tripId, self.event.revision, self.event.source, self.event.demoRunId) != (self.tripId, self.tripRevision, self.source, self.demoRunId):
            raise ValueError('nested event context mismatch')
        if self.notification and (self.notification.tripRevision, self.notification.source, self.notification.demoRunId) != (self.tripRevision, self.source, self.demoRunId):
            raise ValueError('nested notification context mismatch')
        return self


class GeoRuntimeState(ContractModel):
    tripId: Id
    activityId: Id
    source: Literal['REAL', 'SIMULATED']
    demoRunId: Id | None = None
    progress: ActivityProgress
    arrivalId: Id | None = None
    candidateSince: Timestamp | None = None
    outsideSince: Timestamp | None = None
    lastValidSampleAt: Timestamp | None = None

    @model_validator(mode='after')
    def source_context(self):
        if (self.source == 'SIMULATED') != (self.demoRunId is not None):
            raise ValueError('runtime DEMO context mismatch')
        return self


class GeoPolicy(ContractModel):
    policyVersion: Id
    arrivalRadiusMeters: Positive
    departureRadiusMeters: Positive
    maxAccuracyMeters: Positive
    arrivalDwellSeconds: Positive
    departureDwellSeconds: Positive
    minValidSamples: PositiveInt
    maxSpeedMetersPerSecond: Positive
    maxSampleGapSeconds: Positive

    @model_validator(mode='after')
    def hysteresis(self):
        if self.departureRadiusMeters <= self.arrivalRadiusMeters:
            raise ValueError('departure radius must exceed arrival radius')
        return self


class ProgressEvent(ContractModel):
    eventId: Id
    sequence: PositiveInt
    occurredAt: Timestamp
    runId: Id
    agentId: AgentId
    type: Literal['agent_started', 'agent_completed', 'agent_failed', 'tool_call_started', 'tool_call_finished']
    message: Id
    toolName: Id | None = None
    traceId: Id


class JobAccepted(RequestContext):
    jobId: Id


class JobSnapshot(RequestContext, Generic[T]):
    jobId: Id
    status: JobStatus
    progressEvents: list[ProgressEvent]
    nextCursor: NonNegativeInt
    result: T | None = None


class ToolCapability(ContractModel):
    name: Id
    available: bool
    reason: str | None = None


class ModelRouteCapability(ContractModel):
    agentId: AgentId
    provider: Id
    model: Id
    available: bool


class CapabilityLimits(ContractModel):
    pollIntervalMs: PositiveInt
    maxPollIntervalMs: PositiveInt
    jobTtlSeconds: PositiveInt
    requestTimeoutSeconds: PositiveInt
    maxJobSeconds: PositiveInt
    maxBodyBytes: PositiveInt


class CapabilitySet(ContractModel):
    planning: bool
    poiSearch: bool
    routes: list[TravelMode]
    content: bool
    nearby: bool
    demo: bool
    tools: list[ToolCapability]
    modelRoutes: list[ModelRouteCapability]
    limits: CapabilityLimits
    geoPolicy: GeoPolicy


class HealthResult(ContractModel):
    serviceStatus: Literal['OK', 'DEGRADED']
    version: Id
    capabilities: CapabilitySet


class NearbyRoute(ContractModel):
    mode: TravelMode
    durationMin: NonNegative | None = None
    distanceMeters: NonNegative | None = None
    routeGeometry: list[GeoPoint] | None = None
    evidence: Evidence


class NearbyCandidate(ContractModel):
    place: Place
    distanceMeters: NonNegative | None = None
    distanceEvidence: Evidence
    relevanceReason: Id
    estimatedCostCny: NonNegative | None = None
    costStatus: DataStatus
    route: NearbyRoute | None = None
    reviewResearch: WebResearch | None = None
    preferenceMatches: list[str] = Field(default_factory=list)


class ParseRequirementsRequest(RequestContext):
    text: Id
    requirements: TripRequirements | None = None
    selectedContext: SelectedContext | None = None
    conversation: list[ConversationMessage] | None = None

    @model_validator(mode='after')
    def context(self):
        if self.selectedContext and (self.selectedContext.tripId != self.tripId or self.selectedContext.planRevision != self.baseRevision):
            raise ValueError('STALE_REVISION: selected context mismatch')
        return self


class ResolvePlacesRequest(RequestContext):
    requirements: TripRequirements


class UncertainField(ContractModel):
    fieldPath: Id
    reason: Id
    candidates: list[Place] | None = None


class ParseRequirementsResult(ContractModel):
    requirements: TripRequirements
    intents: list[TravelIntent]
    missingFields: list[str]
    uncertainFields: list[UncertainField]
    questions: list[str] = Field(default_factory=list, max_length=2)
    fieldSources: dict[str, Literal['USER', 'INFERRED', 'SUGGESTED']] = Field(default_factory=dict)
    changedFields: list[str] = Field(default_factory=list)

    @model_validator(mode='after')
    def intents_match(self):
        if self.intents != self.requirements.intents:
            raise ValueError('intents projection mismatch')
        return self


class GeneratePlanRequest(RequestContext):
    requirements: TripRequirements
    mode: Literal['PLANNING']

    @model_validator(mode='after')
    def generation(self):
        self.requirements.require_confirmed()
        if self.baseRevision != 0:
            raise ValueError('initial generation requires baseRevision=0')
        return self


class TripRequest(RequestContext):
    tripState: TripState

    @model_validator(mode='after')
    def validate_trip_context(self):
        if self.tripId != self.tripState.tripId or self.baseRevision != self.tripState.revision:
            raise ValueError('STALE_REVISION: trip snapshot context mismatch')
        selected = getattr(self, 'selectedContext', None) or getattr(self, 'context', None)
        if isinstance(selected, SelectedContext):
            if (selected.tripId, selected.planRevision, selected.mode) != (self.tripId, self.baseRevision, self.tripState.mode):
                raise ValueError('STALE_REVISION: selected context mismatch')
            days = (date.fromisoformat(self.tripState.endDate) - date.fromisoformat(self.tripState.startDate)).days + 1
            if selected.activeDay >= days:
                raise ValueError('selected activeDay outside trip')
            if selected.selectedActivityId and selected.selectedActivityId not in {a.id for a in self.tripState.activities}:
                raise ValueError('selected activity missing')
            if selected.selectedPoiId and selected.selectedPoiId not in {a.place.poiId for a in self.tripState.activities}:
                raise ValueError('selected POI missing')
            if selected.selectedActivityId and selected.selectedPoiId:
                activity = next(a for a in self.tripState.activities if a.id == selected.selectedActivityId)
                if activity.place.poiId != selected.selectedPoiId:
                    raise ValueError('selected POI/activity mismatch')
        return self


class ProposeRevisionRequest(TripRequest):
    selectedContext: SelectedContext | None = None
    conversation: list[ConversationMessage] | None = None
    operations: Annotated[list[EditOperation], Field(min_length=1)] | None = None
    userRequest: Id | None = None

    @model_validator(mode='after')
    def one_input(self):
        if (self.operations is None) == (self.userRequest is None):
            raise ValueError('provide exactly one of operations/userRequest')
        return self


class ValidateRevisionRequest(TripRequest):
    proposal: RevisionProposal

    @model_validator(mode='after')
    def proposal_context(self):
        if (self.proposal.tripId, self.proposal.baseRevision) != (self.tripId, self.baseRevision):
            raise ValueError('STALE_REVISION: proposal mismatch')
        return self


class ValidateRevisionResult(ContractModel):
    proposalId: Id
    baseRevision: NonNegativeInt
    validation: ValidationReport
    replacementProposal: RevisionProposal | None = None


class SearchPlacesRequest(ExecutionContext):
    city: Id
    keyword: Id
    location: GeoPoint | None = None


class SearchPlacesResult(ContractModel):
    places: list[Place]


class ResearchPlaceRequest(ExecutionContext):
    poiId: Id
    city: Annotated[str, Field(min_length=1, max_length=100)]
    visitDate: DateString


class RouteSegmentsRequest(RequestContext):
    requirements: TripRequirements
    activities: list[ItineraryActivity]
    mode: TravelMode


class RouteSegmentsResult(ContractModel):
    segments: list[TravelSegment]
    boundarySegments: list[BoundarySegment]
    warnings: list[str]


class EvaluateProactiveRequest(TripRequest):
    currentEvent: ProactiveEvent
    recentNotifications: list[NotificationRecord]
    uiBusy: bool

    @model_validator(mode='after')
    def event_context(self):
        e = self.currentEvent
        if (e.tripId, e.revision) != (self.tripId, self.baseRevision):
            raise ValueError('STALE_REVISION: event mismatch')
        if self.executionMode == 'REAL' and e.source == 'SIMULATED':
            raise ValueError('REAL cannot accept simulated events')
        if self.executionMode == 'DEMO' and (e.source == 'REAL' or e.demoRunId != self.demoRunId):
            raise ValueError('DEMO event/run mismatch')
        for record in self.recentNotifications:
            if record.demoRunId != self.demoRunId or (self.executionMode == 'REAL' and record.source == 'SIMULATED'):
                raise ValueError('notification execution context mismatch')
        return self


class EvaluateProactiveResult(ContractModel):
    decision: ProactiveDecision
    contents: list[PreparedContent]


class PrepareContentRequest(TripRequest):
    intents: list[TravelIntent]
    selectedContext: SelectedContext | None = None

    @model_validator(mode='after')
    def known_intents(self):
        known = {i.id: i for i in self.tripState.intents}
        if any(known.get(i.id) != i for i in self.intents):
            raise ValueError('requested intent is not current trip intent')
        return self


class PrepareContentResult(ContractModel):
    contents: list[PreparedContent]


class RefineContentRequest(TripRequest):
    intentId: Id | None = None
    preparedContent: PreparedContent | None = None
    userRequest: Id
    context: SelectedContext

    @model_validator(mode='after')
    def content_context(self):
        if self.intentId and self.intentId not in {i.id for i in self.tripState.intents}:
            raise ValueError('unknown intentId')
        if self.preparedContent and (self.preparedContent.tripId, self.preparedContent.baseRevision) != (self.tripId, self.baseRevision):
            raise ValueError('STALE_REVISION: prepared content mismatch')
        return self


class RefineContentResult(ContractModel):
    content: PreparedContent


class NearbySearchRequest(TripRequest):
    location: GeoPoint
    category: Literal['FOOD', 'REST', 'PHOTO']
    preferences: list[str]
    selectedContext: SelectedContext | None = None
    radiusMeters: Annotated[int, Field(ge=500, le=5000)] = 2000
    maxWalkMinutes: Annotated[int, Field(ge=5, le=60)] = 30
    includeReviews: bool = True
    maxAverageCostCny: NonNegative | None = None


class NearbySearchResult(ContractModel):
    candidates: list[NearbyCandidate]
    anchorLocation: GeoPoint | None = None
    searchedRadiusMeters: NonNegative | None = None
    notes: list[str] = Field(default_factory=list)


class CancelJobResult(ContractModel):
    jobId: Id
    status: JobStatus


# Explicit registry drives JSON Schema and generated TypeScript; no second hand-maintained contract.
CONTRACT_TYPES = {name: value for name, value in list(globals().items()) if isinstance(value, type) and issubclass(value, ContractModel) and value is not ContractModel}
CONTRACT_TYPES.update(EditOperation=EditOperation, ConstraintChange=ConstraintChange, RevisionResult=RevisionResult, RouteEndpoint=RouteEndpoint)
__all__ = [name for name in globals() if not name.startswith('_')]
