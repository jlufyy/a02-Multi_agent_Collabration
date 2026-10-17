# Browser context engine

Native ECMAScript module, no dependencies. `node --test packages/context-engine/test.mjs` runs synthetic deterministic traces. Import `index.mjs` into the browser. Declarations import all business models from generated contracts, never duplicate them.

Load `geo-policy.json` once and pass the same policy to every call. Backend capabilities reads this same file. M0 settings are configurable initial experiments, not measured optimal thresholds.

`processLocation({sample, activities, state, revision, policy})` returns `{state, events, diagnostics}`. `GeoStateMachine` is its alias. Create state with `createGeoEngineState({tripId,source,demoRunId})`. Persist the entire returned engine state independently of undoable TripState: `states` uses canonical GeoRuntimeState values; `tracker` stores counters, last sample and duplicate IDs needed between calls. `suspendGeoEngine` handles page hiding or permission loss even when the browser produces no sample.

Both real and simulated adapters supply consecutive tagged samples through this same function. Do not emit ARRIVE by button shortcut. Timestamps drive dwell; simulation accelerates its own clock while preserving policy thresholds. Invalid accuracy, hidden pages, jumps and missing intervals reset dwell. A fresh interval must satisfy every threshold. Active arrival owns overlapping fences; otherwise the nearest candidate wins, then orderIndex and stable ID break ties. A travel-day filter prevents tomorrow's duplicate POI from triggering today. LEAVE only infers completion. Same-day and cross-day re-entry produce independent arrival IDs.

Coordinates are explicitly converted once per calculation to WGS84. `distanceMeters` rejects mixed coordinate systems. Diagnostics retain original/normalized point, conversion label and policyVersion. The conventional GCJ conversion is an algorithmic approximation for local geofences, not survey accuracy or a verified map-provider conversion result. When integrating a map SDK, check its applicable license and use its coordinate service if required.

`filterNotifications` rechecks revision, execution isolation, IDs, evidence, snooze, cooldown, policy and L3>L2>L1 priority at actual display time. It chooses at most one candidate and returns suppression reasons. The function does not write shownAt: write a fact only after actual UI display. recentNotifications must be scoped to the trip and include all current-arrival, active-risk, cooldown and snooze records. Retain LOWER_PRIORITY candidates in the local queue and recheck before displaying them; suppression is not proof of display. Pause and busy only defer L1/L2, not enabled credible L3 risks. Duplicate keys omit revision to avoid re-pushing facts after undo/redo.

`projectFacts` re-applies existing arrivals, departures, actual notification display and user corrections to a restored plan without changing its revision or deleting history. `futureReminderTargets` derives remaining intent targets. Call `isContentApplicable` after any revision/place/intent changes. Keep DEMO copies and logs separate; pass matching demoRunId to every operation. Leaving demo means selecting the REAL state/log namespace, never merging synthetic facts.

Tests and fixtures are SYNTHETIC. No browser permission, real device, real route, provider or deployment acceptance is implied.
