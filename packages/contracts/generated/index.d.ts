// Generated from apps/api/app/schemas.py. DO NOT EDIT.
// Regenerate: python packages/contracts/generate.py
export declare const contractVersion: "TripFlow-Split-v1";

export type ActivityChange = { "activityId": string; "oldStartAt"?: (string | null); "newStartAt"?: (string | null); "oldEndAt"?: (string | null); "newEndAt"?: (string | null); "fields": Array<string>; };

export type ActivityEndpoint = { "kind": "ACTIVITY"; "activityId": string; "place": Place; };

export type ActivityLockChange = { "activityId": string; "locked": boolean; };

export type ActivityProgress = "NOT_STARTED" | "APPROACHING" | "ARRIVED" | "VISITING" | "INFERRED_COMPLETE" | "LOCATION_UNKNOWN";

export type AddOperation = { "type": "ADD"; "activity": ItineraryActivity; };

export type AgentId = "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7";

export type ApiError = { "code": string; "message": string; "retryable": boolean; "fieldPath"?: (string | null); };

export type ApiResponse<T = unknown> = { "request_id": string; "status": "PENDING" | "RUNNING" | "PARTIAL" | "SUCCEEDED" | "FAILED" | "CANCELLED"; "data": (T | null); "errors": Array<ApiError>; "trace_id": string; };

export type BoundaryEndpoint = { "kind": "START_POINT" | "END_POINT"; "place": Place; };

export type BoundarySegment = { "dayIndex": number; "from": (ActivityEndpoint | BoundaryEndpoint); "to": (ActivityEndpoint | BoundaryEndpoint); "mode": "WALK" | "TRANSIT" | "DRIVE"; "durationMin"?: (number | null); "distanceMeters"?: (number | null); "routeGeometry"?: (Array<GeoPoint> | null); "evidence": Evidence; };

export type CancelJobResult = { "jobId": string; "status": "PENDING" | "RUNNING" | "PARTIAL" | "SUCCEEDED" | "FAILED" | "CANCELLED"; };

export type CapabilityLimits = { "pollIntervalMs": number; "maxPollIntervalMs": number; "jobTtlSeconds": number; "requestTimeoutSeconds": number; "maxJobSeconds": number; "maxBodyBytes": number; };

export type CapabilitySet = { "planning": boolean; "poiSearch": boolean; "routes": Array<"WALK" | "TRANSIT" | "DRIVE">; "content": boolean; "nearby": boolean; "demo": boolean; "tools": Array<ToolCapability>; "modelRoutes": Array<ModelRouteCapability>; "limits": CapabilityLimits; "geoPolicy": GeoPolicy; };

export type CardEvidence = { "source": "REAL" | "SIMULATED" | "USER_CORRECTION"; "eventId": string; "facts": Array<Evidence>; };

export type ClarificationOutcome = { "kind": "CLARIFICATION"; "questions": Array<string>; "candidates": Array<Place>; };

export type CompanionPreference = { "id": string; "label": string; "interests": Array<string>; "walkingTolerance"?: ("LOW" | "MEDIUM" | "HIGH" | null); "personalBudgetCny"?: (number | null); "specialNeeds": Array<string>; };

export type ConstraintChange = (Constraint_budgetCny | Constraint_budgetScope | Constraint_budgetIsHardLimit | Constraint_includesAccommodation | Constraint_includesIntercityTransport | Constraint_transportModes | Constraint_preferences | Constraint_companions | Constraint_specialNeeds | Constraint_walkingTolerance | Constraint_startDate | Constraint_endDate | Constraint_arrivalAt | Constraint_departureAt | Constraint_dailyStartTime | Constraint_dailyEndTime | Constraint_startPoint | Constraint_endPoint | Constraint_mustVisit | Constraint_avoidPlaces | Constraint_fixedConstraints | Constraint_intents | Constraint_activityLocked);

export type Constraint_activityLocked = { "key": "activityLocked"; "value": ActivityLockChange; };

export type Constraint_arrivalAt = { "key": "arrivalAt"; "value": string; };

export type Constraint_avoidPlaces = { "key": "avoidPlaces"; "value": Array<PlaceReference>; };

export type Constraint_budgetCny = { "key": "budgetCny"; "value": number; };

export type Constraint_budgetIsHardLimit = { "key": "budgetIsHardLimit"; "value": boolean; };

export type Constraint_budgetScope = { "key": "budgetScope"; "value": "PER_PERSON" | "TOTAL"; };

export type Constraint_companions = { "key": "companions"; "value": Array<CompanionPreference>; };

export type Constraint_dailyEndTime = { "key": "dailyEndTime"; "value": string; };

export type Constraint_dailyStartTime = { "key": "dailyStartTime"; "value": string; };

export type Constraint_departureAt = { "key": "departureAt"; "value": string; };

export type Constraint_endDate = { "key": "endDate"; "value": string; };

export type Constraint_endPoint = { "key": "endPoint"; "value": PlaceReference; };

export type Constraint_fixedConstraints = { "key": "fixedConstraints"; "value": Array<FixedConstraint>; };

export type Constraint_includesAccommodation = { "key": "includesAccommodation"; "value": boolean; };

export type Constraint_includesIntercityTransport = { "key": "includesIntercityTransport"; "value": boolean; };

export type Constraint_intents = { "key": "intents"; "value": Array<TravelIntent>; };

export type Constraint_mustVisit = { "key": "mustVisit"; "value": Array<PlaceReference>; };

export type Constraint_preferences = { "key": "preferences"; "value": Array<string>; };

export type Constraint_specialNeeds = { "key": "specialNeeds"; "value": Array<string>; };

export type Constraint_startDate = { "key": "startDate"; "value": string; };

export type Constraint_startPoint = { "key": "startPoint"; "value": PlaceReference; };

export type Constraint_transportModes = { "key": "transportModes"; "value": Array<"WALK" | "TRANSIT" | "DRIVE">; };

export type Constraint_walkingTolerance = { "key": "walkingTolerance"; "value": "LOW" | "MEDIUM" | "HIGH"; };

export type ContentOutcome = { "kind": "CONTENT"; "content": PreparedContent; };

export type ConversationMessage = { "role": "user" | "assistant"; "content": string; };

export type DataStatus = "VERIFIED" | "ESTIMATED" | "UNKNOWN" | "FAILED";

export type EditOperation = (AddOperation | RemoveOperation | ReplaceOperation | MoveOperation | UpdateTimeOperation | UpdateDurationOperation | UpdateConstraintOperation);

export type EstimatedChanges = { "travelMinutesDelta"?: (number | null); "costCnyDelta"?: (number | null); };

export type EvaluateProactiveRequest = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "tripId": string; "baseRevision": number; "tripState": TripState; "currentEvent": ProactiveEvent; "recentNotifications": Array<NotificationRecord>; "uiBusy": boolean; };

export type EvaluateProactiveResult = { "decision": ProactiveDecision; "contents": Array<PreparedContent>; };

export type EventLogEntry = { "logId": string; "tripId": string; "tripRevision": number; "source": "REAL" | "SIMULATED" | "USER_CORRECTION"; "demoRunId"?: (string | null); "occurredAt": string; "event"?: (ProactiveEvent | null); "notification"?: (NotificationRecord | null); "correction"?: (ProgressCorrection | null); };

export type EventSource = "REAL" | "SIMULATED" | "USER_CORRECTION";

export type Evidence = { "provider": string; "externalId"?: (string | null); "fetchedAt"?: (string | null); "status": "VERIFIED" | "ESTIMATED" | "UNKNOWN" | "FAILED"; "sourceUrl"?: (string | null); "note"?: (string | null); };

export type ExecutionContext = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); };

export type ExecutionMode = "REAL" | "DEMO";

export type Fact<T = unknown> = { "value"?: (T | null); "evidence": Evidence; };

export type Fact_Annotated_float__FieldInfo_annotation_NoneType__required_True__metadata__Ge_ge_0___AllowInfNan_allow_inf_nan_False_____ = { "value"?: (number | null); "evidence": Evidence; };

export type Fact_Annotated_str__FieldInfo_annotation_NoneType__required_True__metadata__Strict_strict_True___MinLen_min_length_1_____ = { "value"?: (string | null); "evidence": Evidence; };

export type Fact_str_ = { "value"?: (string | null); "evidence": Evidence; };

export type FixedConstraint = { "id": string; "activityId"?: (string | null); "place"?: (PlaceReference | null); "startAt": string; "endAt"?: (string | null); "reason": string; "locked": boolean; };

export type GeneratePlanRequest = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "tripId": string; "baseRevision": number; "requirements": TripRequirements; "mode": "PLANNING"; };

export type GeoPoint = { "lat": number; "lng": number; "coordinateSystem": "GCJ02" | "WGS84"; };

export type GeoPolicy = { "policyVersion": string; "arrivalRadiusMeters": number; "departureRadiusMeters": number; "maxAccuracyMeters": number; "arrivalDwellSeconds": number; "departureDwellSeconds": number; "minValidSamples": number; "maxSpeedMetersPerSecond": number; "maxSampleGapSeconds": number; };

export type GeoRuntimeState = { "tripId": string; "activityId": string; "source": "REAL" | "SIMULATED"; "demoRunId"?: (string | null); "progress": "NOT_STARTED" | "APPROACHING" | "ARRIVED" | "VISITING" | "INFERRED_COMPLETE" | "LOCATION_UNKNOWN"; "arrivalId"?: (string | null); "candidateSince"?: (string | null); "outsideSince"?: (string | null); "lastValidSampleAt"?: (string | null); };

export type HealthResult = { "serviceStatus": "OK" | "DEGRADED"; "version": string; "capabilities": CapabilitySet; };

export type IntentType = "KNOWLEDGE" | "PHOTO" | "VIDEO_SHOOT" | "SPEECH" | "CHECK_IN" | "FOOD" | "OTHER";

export type ItineraryActivity = { "id": string; "place": Place; "dayIndex": number; "orderIndex": number; "startAt": string; "endAt": string; "estimatedCostCny"?: (number | null); "costStatus": "VERIFIED" | "ESTIMATED" | "UNKNOWN" | "FAILED"; "locked": boolean; "mandatory": boolean; "progress": "NOT_STARTED" | "APPROACHING" | "ARRIVED" | "VISITING" | "INFERRED_COMPLETE" | "LOCATION_UNKNOWN"; "intentIds": Array<string>; "bookingStatus"?: ("UNSPECIFIED" | "REQUIRED" | "BOOKED" | null); "bookingEvidence"?: (Evidence | null); };

export type JobAccepted = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "tripId": string; "baseRevision": number; "jobId": string; };

export type JobAcceptedResponse = { "request_id": string; "status": "PENDING" | "RUNNING" | "PARTIAL" | "SUCCEEDED" | "FAILED" | "CANCELLED"; "data": (JobAccepted | null); "errors": Array<ApiError>; "trace_id": string; };

export type JobResult = (ParseRequirementsResult | PlanResult | (RevisionOutcome | ContentOutcome | ClarificationOutcome) | ValidateRevisionResult | EvaluateProactiveResult | PrepareContentResult | RefineContentResult | NearbySearchResult);

export type JobSnapshot<T = unknown> = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "tripId": string; "baseRevision": number; "jobId": string; "status": "PENDING" | "RUNNING" | "PARTIAL" | "SUCCEEDED" | "FAILED" | "CANCELLED"; "progressEvents": Array<ProgressEvent>; "nextCursor": number; "result"?: (T | null); };

export type JobSnapshotResponse = { "request_id": string; "status": "PENDING" | "RUNNING" | "PARTIAL" | "SUCCEEDED" | "FAILED" | "CANCELLED"; "data": (JobSnapshot_Union_ParseRequirementsResult__PlanResult__Annotated_Union_RevisionOutcome__ContentOutcome__ClarificationOutcome___FieldInfo_annotation_NoneType__required_True__discriminator__kind_____ValidateRevisionResult__EvaluateProactiveResult__PrepareContentResult__RefineContentResult__NearbySearchResult__ | null); "errors": Array<ApiError>; "trace_id": string; };

export type JobSnapshot_Union_ParseRequirementsResult__PlanResult__Annotated_Union_RevisionOutcome__ContentOutcome__ClarificationOutcome___FieldInfo_annotation_NoneType__required_True__discriminator__kind_____ValidateRevisionResult__EvaluateProactiveResult__PrepareContentResult__RefineContentResult__NearbySearchResult__ = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "tripId": string; "baseRevision": number; "jobId": string; "status": "PENDING" | "RUNNING" | "PARTIAL" | "SUCCEEDED" | "FAILED" | "CANCELLED"; "progressEvents": Array<ProgressEvent>; "nextCursor": number; "result"?: (ParseRequirementsResult | PlanResult | (RevisionOutcome | ContentOutcome | ClarificationOutcome) | ValidateRevisionResult | EvaluateProactiveResult | PrepareContentResult | RefineContentResult | NearbySearchResult | null); };

export type JobStatus = "PENDING" | "RUNNING" | "PARTIAL" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export type Lifecycle = "DRAFT_INPUT" | "PLANNING" | "PLAN_READY" | "TRAVELING" | "TRIP_ENDED";

export type ModelRouteCapability = { "agentId": "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7"; "provider": string; "model": string; "available": boolean; };

export type MoveOperation = { "type": "MOVE"; "activityId": string; "dayIndex": number; "orderIndex": number; };

export type NearbyCandidate = { "place": Place; "distanceMeters"?: (number | null); "distanceEvidence": Evidence; "relevanceReason": string; "estimatedCostCny"?: (number | null); "costStatus": "VERIFIED" | "ESTIMATED" | "UNKNOWN" | "FAILED"; "route"?: (NearbyRoute | null); "reviewResearch"?: (WebResearch | null); "preferenceMatches"?: Array<string>; };

export type NearbyRoute = { "mode": "WALK" | "TRANSIT" | "DRIVE"; "durationMin"?: (number | null); "distanceMeters"?: (number | null); "routeGeometry"?: (Array<GeoPoint> | null); "evidence": Evidence; };

export type NearbySearchRequest = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "tripId": string; "baseRevision": number; "tripState": TripState; "location": GeoPoint; "category": "FOOD" | "REST" | "PHOTO"; "preferences": Array<string>; "selectedContext"?: (SelectedContext | null); "radiusMeters"?: number; "maxWalkMinutes"?: number; "includeReviews"?: boolean; "maxAverageCostCny"?: (number | null); };

export type NearbySearchResult = { "candidates": Array<NearbyCandidate>; "anchorLocation"?: (GeoPoint | null); "searchedRadiusMeters"?: (number | null); "notes"?: Array<string>; };

export type NormalizedLocationEvent = { "sampleId": string; "tripId": string; "source": "REAL" | "SIMULATED"; "demoRunId"?: (string | null); "location": GeoPoint; "accuracyMeters": number; "timestamp": string; "pageVisible": boolean; "speedMetersPerSecond"?: (number | null); };

export type NotificationAction = "VIEW_CONTENT" | "VIEW_SCRIPT" | "VIEW_SHOOTING_CHECKLIST" | "REMIND_LATER" | "IGNORE" | "VIEW_REVISION" | "VIEW_NEARBY" | "ADD_TO_PLAN";

export type NotificationCard = { "cardId": string; "level": "L1" | "L2" | "L3"; "module": "KNOWLEDGE" | "PERSONAL_GOAL" | "TRIP_RISK" | "NEARBY"; "activityId"?: (string | null); "intentId"?: (string | null); "title": string; "actions": Array<"VIEW_CONTENT" | "VIEW_SCRIPT" | "VIEW_SHOOTING_CHECKLIST" | "REMIND_LATER" | "IGNORE" | "VIEW_REVISION" | "VIEW_NEARBY" | "ADD_TO_PLAN">; "contentIds": Array<string>; "evidence": CardEvidence; };

export type NotificationPolicy = { "enableL1": boolean; "enableL2": boolean; "enableL3": boolean; "paused": boolean; "cooldownMinutes": number; };

export type NotificationRecord = { "notificationId": string; "eventId": string; "tripRevision": number; "source": "REAL" | "SIMULATED" | "USER_CORRECTION"; "demoRunId"?: (string | null); "arrivalId"?: (string | null); "activityId"?: (string | null); "intentId"?: (string | null); "riskCode"?: (string | null); "contentId"?: (string | null); "level": "L1" | "L2" | "L3"; "decision": string; "suppressionReason"?: (string | null); "shownAt"?: (string | null); "actionTaken"?: ("VIEW_CONTENT" | "VIEW_SCRIPT" | "VIEW_SHOOTING_CHECKLIST" | "REMIND_LATER" | "IGNORE" | "VIEW_REVISION" | "VIEW_NEARBY" | "ADD_TO_PLAN" | null); "actionAt"?: (string | null); "snoozeUntil"?: (string | null); };

export type ParseRequirementsRequest = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "tripId": string; "baseRevision": number; "text": string; "requirements"?: (TripRequirements | null); "selectedContext"?: (SelectedContext | null); "conversation"?: (Array<ConversationMessage> | null); };

export type ParseRequirementsResult = { "requirements": TripRequirements; "intents": Array<TravelIntent>; "missingFields": Array<string>; "uncertainFields": Array<UncertainField>; "questions"?: Array<string>; "fieldSources"?: { [key: string]: "USER" | "INFERRED" | "SUGGESTED"; }; "changedFields"?: Array<string>; };

export type Place = { "poiId": string; "name": string; "address"?: (string | null); "location": GeoPoint; "evidence": Array<Evidence>; "openingHours"?: (Fact_str_ | null); "ticketPriceCny"?: (Fact_Annotated_float__FieldInfo_annotation_NoneType__required_True__metadata__Ge_ge_0___AllowInfNan_allow_inf_nan_False_____ | null); "queueMinutes"?: (Fact_Annotated_float__FieldInfo_annotation_NoneType__required_True__metadata__Ge_ge_0___AllowInfNan_allow_inf_nan_False_____ | null); "rating"?: (Fact_Annotated_float__FieldInfo_annotation_NoneType__required_True__metadata__Ge_ge_0___AllowInfNan_allow_inf_nan_False_____ | null); "bookingNote"?: (Fact_str_ | null); "parentPoiId"?: (Fact_Annotated_str__FieldInfo_annotation_NoneType__required_True__metadata__Strict_strict_True___MinLen_min_length_1_____ | null); "webResearch"?: (WebResearch | null); "photoUrls"?: (Array<string> | null); "category"?: ("ATTRACTION" | "RESTAURANT" | "OTHER" | null); "averageCostCny"?: (Fact_Annotated_float__FieldInfo_annotation_NoneType__required_True__metadata__Ge_ge_0___AllowInfNan_allow_inf_nan_False_____ | null); };

export type PlaceReference = { "query": string; "place"?: (Place | null); };

export type PlanResult = { "plan"?: (TripState | null); "validation": ValidationReport; "preparedContents": Array<PreparedContent>; };

export type PrepareContentRequest = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "tripId": string; "baseRevision": number; "tripState": TripState; "intents": Array<TravelIntent>; "selectedContext"?: (SelectedContext | null); };

export type PrepareContentResult = { "contents": Array<PreparedContent>; };

export type PreparedContent = { "contentId": string; "tripId": string; "baseRevision": number; "activityId"?: (string | null); "intentId"?: (string | null); "placeId": string; "module": "KNOWLEDGE" | "PERSONAL_GOAL" | "TRIP_RISK" | "NEARBY"; "title": string; "body": string; "version": number; "generatedAt": string; "evidence": Array<Evidence>; "scopeNote": string; "generationProvider"?: (string | null); "generationModel"?: (string | null); "deliveryMode"?: ("GUIDE" | "DOCUMENT" | null); };

export type ProactiveDecision = { "decisionId": string; "eventId": string; "tripId": string; "baseRevision": number; "shouldNotify": boolean; "reasonCode": string; "suppressionReason"?: (string | null); "card"?: (NotificationCard | null); };

export type ProactiveEvent = { "eventId": string; "tripId": string; "revision": number; "source": "REAL" | "SIMULATED" | "USER_CORRECTION"; "type": "APPROACH" | "ARRIVE" | "LEAVE" | "RISK" | "RESUME"; "activityId"?: (string | null); "arrivalId"?: (string | null); "demoRunId"?: (string | null); "location"?: (GeoPoint | null); "accuracyMeters"?: (number | null); "occurredAt": string; "risk"?: (RiskDetail | null); };

export type ProgressCorrection = { "activityId": string; "previous": "NOT_STARTED" | "APPROACHING" | "ARRIVED" | "VISITING" | "INFERRED_COMPLETE" | "LOCATION_UNKNOWN"; "next": "NOT_STARTED" | "APPROACHING" | "ARRIVED" | "VISITING" | "INFERRED_COMPLETE" | "LOCATION_UNKNOWN"; "reason": string; };

export type ProgressEvent = { "eventId": string; "sequence": number; "occurredAt": string; "runId": string; "agentId": "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7"; "type": "agent_started" | "agent_completed" | "agent_failed" | "tool_call_started" | "tool_call_finished"; "message": string; "toolName"?: (string | null); "traceId": string; };

export type ProposeRevisionRequest = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "tripId": string; "baseRevision": number; "tripState": TripState; "selectedContext"?: (SelectedContext | null); "conversation"?: (Array<ConversationMessage> | null); "operations"?: (Array<(AddOperation | RemoveOperation | ReplaceOperation | MoveOperation | UpdateTimeOperation | UpdateDurationOperation | UpdateConstraintOperation)> | null); "userRequest"?: (string | null); };

export type RefineContentRequest = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "tripId": string; "baseRevision": number; "tripState": TripState; "intentId"?: (string | null); "preparedContent"?: (PreparedContent | null); "userRequest": string; "context": SelectedContext; };

export type RefineContentResult = { "content": PreparedContent; };

export type RemoveOperation = { "type": "REMOVE"; "activityId": string; };

export type ReplaceOperation = { "type": "REPLACE"; "activityId": string; "candidatePlaceId": string; "candidatePlace": Place; };

export type RequestContext = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "tripId": string; "baseRevision": number; };

export type ResearchPlaceRequest = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "poiId": string; "city": string; "visitDate": string; };

export type ResolvePlacesRequest = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "tripId": string; "baseRevision": number; "requirements": TripRequirements; };

export type RevisionDiff = { "added": Array<string>; "removed": Array<string>; "moved": Array<string>; };

export type RevisionOutcome = { "kind": "REVISION"; "proposal": RevisionProposal; };

export type RevisionProposal = { "proposalId": string; "tripId": string; "baseRevision": number; "operations": Array<(AddOperation | RemoveOperation | ReplaceOperation | MoveOperation | UpdateTimeOperation | UpdateDurationOperation | UpdateConstraintOperation)>; "candidate": TripState; "hardViolations": Array<Violation>; "unknownChecks": Array<string>; "diff": RevisionDiff; "estimatedChanges": EstimatedChanges; "validation": ValidationReport; "activityChanges": Array<ActivityChange>; };

export type RevisionResult = (RevisionOutcome | ContentOutcome | ClarificationOutcome);

export type RiskDetail = { "code": string; "message": string; "evidence": Array<Evidence>; "activityIds": Array<string>; };

export type RouteEndpoint = (ActivityEndpoint | BoundaryEndpoint);

export type RouteSegmentsRequest = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "tripId": string; "baseRevision": number; "requirements": TripRequirements; "activities": Array<ItineraryActivity>; "mode": "WALK" | "TRANSIT" | "DRIVE"; };

export type RouteSegmentsResult = { "segments": Array<TravelSegment>; "boundarySegments": Array<BoundarySegment>; "warnings": Array<string>; };

export type SearchPlacesRequest = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "city": string; "keyword": string; "location"?: (GeoPoint | null); };

export type SearchPlacesResult = { "places": Array<Place>; };

export type SelectedContext = { "tripId": string; "planRevision": number; "mode": "PLANNING" | "TRAVELING"; "selectedActivityId"?: (string | null); "selectedPoiId"?: (string | null); "activeDay": number; };

export type ServiceModule = "KNOWLEDGE" | "PERSONAL_GOAL" | "TRIP_RISK" | "NEARBY";

export type ToolCapability = { "name": string; "available": boolean; "reason"?: (string | null); };

export type TravelIntent = { "id": string; "activityId"?: (string | null); "placeId"?: (string | null); "placeQuery"?: (string | null); "type": "KNOWLEDGE" | "PHOTO" | "VIDEO_SHOOT" | "SPEECH" | "CHECK_IN" | "FOOD" | "OTHER"; "userRequest": string; "desiredOutputs": Array<string>; "confirmed": boolean; "status": "PENDING" | "READY" | "TRIGGERED" | "CANCELLED"; "preparedContentIds": Array<string>; "locked": boolean; };

export type TravelMode = "WALK" | "TRANSIT" | "DRIVE";

export type TravelSegment = { "fromActivityId": string; "toActivityId": string; "mode": "WALK" | "TRANSIT" | "DRIVE"; "durationMin"?: (number | null); "distanceMeters"?: (number | null); "routeGeometry"?: (Array<GeoPoint> | null); "evidence": Evidence; };

export type TripMode = "PLANNING" | "TRAVELING";

export type TripRequest = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "tripId": string; "baseRevision": number; "tripState": TripState; };

export type TripRequirements = { "requirementsId": string; "version": number; "confirmed": boolean; "destinationCity"?: (string | null); "startDate"?: (string | null); "endDate"?: (string | null); "timezone": "Asia/Shanghai"; "travelerCount"?: (number | null); "budgetCny"?: (number | null); "budgetScope"?: ("PER_PERSON" | "TOTAL" | null); "budgetIsHardLimit": boolean; "includesAccommodation"?: (boolean | null); "includesIntercityTransport"?: (boolean | null); "arrivalAt"?: (string | null); "departureAt"?: (string | null); "startPoint"?: (PlaceReference | null); "endPoint"?: (PlaceReference | null); "transportModes": Array<"WALK" | "TRANSIT" | "DRIVE">; "mustVisit": Array<PlaceReference>; "avoidPlaces": Array<PlaceReference>; "preferences": Array<string>; "companions": Array<CompanionPreference>; "walkingTolerance"?: ("LOW" | "MEDIUM" | "HIGH" | null); "specialNeeds": Array<string>; "dailyStartTime"?: (string | null); "dailyEndTime"?: (string | null); "fixedConstraints": Array<FixedConstraint>; "intents": Array<TravelIntent>; };

export type TripState = { "schemaVersion": 1; "tripId": string; "revision": number; "title": string; "destinationCity": string; "startDate": string; "endDate": string; "travelerCount": number; "budgetCny"?: (number | null); "budgetScope"?: ("PER_PERSON" | "TOTAL" | null); "companions": Array<CompanionPreference>; "preferences": Array<string>; "mode": "PLANNING" | "TRAVELING"; "lifecycle": "DRAFT_INPUT" | "PLANNING" | "PLAN_READY" | "TRAVELING" | "TRIP_ENDED"; "requirements": TripRequirements; "activities": Array<ItineraryActivity>; "segments": Array<TravelSegment>; "boundarySegments": Array<BoundarySegment>; "intents": Array<TravelIntent>; "notificationPolicy": NotificationPolicy; "updatedAt": string; };

export type TypedJobSnapshot = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "tripId": string; "baseRevision": number; "jobId": string; "status": "PENDING" | "RUNNING" | "PARTIAL" | "SUCCEEDED" | "FAILED" | "CANCELLED"; "progressEvents": Array<ProgressEvent>; "nextCursor": number; "result"?: (ParseRequirementsResult | PlanResult | (RevisionOutcome | ContentOutcome | ClarificationOutcome) | ValidateRevisionResult | EvaluateProactiveResult | PrepareContentResult | RefineContentResult | NearbySearchResult | null); };

export type UncertainField = { "fieldPath": string; "reason": string; "candidates"?: (Array<Place> | null); };

export type UpdateConstraintOperation = (UpdateConstraint_budgetCny | UpdateConstraint_budgetScope | UpdateConstraint_budgetIsHardLimit | UpdateConstraint_includesAccommodation | UpdateConstraint_includesIntercityTransport | UpdateConstraint_transportModes | UpdateConstraint_preferences | UpdateConstraint_companions | UpdateConstraint_specialNeeds | UpdateConstraint_walkingTolerance | UpdateConstraint_startDate | UpdateConstraint_endDate | UpdateConstraint_arrivalAt | UpdateConstraint_departureAt | UpdateConstraint_dailyStartTime | UpdateConstraint_dailyEndTime | UpdateConstraint_startPoint | UpdateConstraint_endPoint | UpdateConstraint_mustVisit | UpdateConstraint_avoidPlaces | UpdateConstraint_fixedConstraints | UpdateConstraint_intents | UpdateConstraint_activityLocked);

export type UpdateConstraint_activityLocked = { "key": "activityLocked"; "value": ActivityLockChange; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_arrivalAt = { "key": "arrivalAt"; "value": string; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_avoidPlaces = { "key": "avoidPlaces"; "value": Array<PlaceReference>; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_budgetCny = { "key": "budgetCny"; "value": number; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_budgetIsHardLimit = { "key": "budgetIsHardLimit"; "value": boolean; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_budgetScope = { "key": "budgetScope"; "value": "PER_PERSON" | "TOTAL"; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_companions = { "key": "companions"; "value": Array<CompanionPreference>; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_dailyEndTime = { "key": "dailyEndTime"; "value": string; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_dailyStartTime = { "key": "dailyStartTime"; "value": string; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_departureAt = { "key": "departureAt"; "value": string; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_endDate = { "key": "endDate"; "value": string; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_endPoint = { "key": "endPoint"; "value": PlaceReference; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_fixedConstraints = { "key": "fixedConstraints"; "value": Array<FixedConstraint>; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_includesAccommodation = { "key": "includesAccommodation"; "value": boolean; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_includesIntercityTransport = { "key": "includesIntercityTransport"; "value": boolean; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_intents = { "key": "intents"; "value": Array<TravelIntent>; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_mustVisit = { "key": "mustVisit"; "value": Array<PlaceReference>; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_preferences = { "key": "preferences"; "value": Array<string>; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_specialNeeds = { "key": "specialNeeds"; "value": Array<string>; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_startDate = { "key": "startDate"; "value": string; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_startPoint = { "key": "startPoint"; "value": PlaceReference; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_transportModes = { "key": "transportModes"; "value": Array<"WALK" | "TRANSIT" | "DRIVE">; "type": "UPDATE_CONSTRAINT"; };

export type UpdateConstraint_walkingTolerance = { "key": "walkingTolerance"; "value": "LOW" | "MEDIUM" | "HIGH"; "type": "UPDATE_CONSTRAINT"; };

export type UpdateDurationOperation = { "type": "UPDATE_DURATION"; "activityId": string; "durationMin": number; };

export type UpdateTimeOperation = { "type": "UPDATE_TIME"; "activityId": string; "startAt": string; };

export type ValidateRevisionRequest = { "executionMode": "REAL" | "DEMO"; "demoRunId"?: (string | null); "tripId": string; "baseRevision": number; "tripState": TripState; "proposal": RevisionProposal; };

export type ValidateRevisionResult = { "proposalId": string; "baseRevision": number; "validation": ValidationReport; "replacementProposal"?: (RevisionProposal | null); };

export type ValidationReport = { "status": "FEASIBLE" | "PARTIALLY_VERIFIED" | "INFEASIBLE"; "hardViolations": Array<Violation>; "unknownChecks": Array<string>; "warnings": Array<string>; "committable": boolean; };

export type ValidationStatus = "FEASIBLE" | "PARTIALLY_VERIFIED" | "INFEASIBLE";

export type Violation = { "code": string; "activityIds": Array<string>; "message": string; };

export type WebReference = { "title": string; "url": string; "snippet": string; "evidence": Evidence; };

export type WebResearch = { "status": "AVAILABLE" | "EMPTY" | "UNAVAILABLE" | "NOT_CONFIGURED"; "query": string; "checkedAt": string; "references": Array<WebReference>; "message": string; };
