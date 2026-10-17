/**
 * ⚠️ 仅供前端本地联调与 E2E 的“契约测试桩”，不是产品后端，也不部署。
 *
 * - 所有响应遵循 TripFlow-Split-v1 契约，用于验证前端解析/状态流转/错误处理。
 * - 返回的数据全部标注 provider="contract-stub"、status=UNKNOWN/ESTIMATED，note 写明“测试桩数据，非真实”，
 *   前端会如实显示为“待核验/估算”，不会被当成真实地点或真实路线。
 * - 不提供 routeGeometry，因此地图不会画出任何伪造道路。
 * 用法：node tools/contract-stub/server.mjs   （默认 :8000，vite dev 会把 /api 代理过来）
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8000);
const id = (p) => `${p}_${randomUUID().slice(0, 8)}`;
const now = () => new Date().toISOString();
const ev = (status = 'UNKNOWN') => ({ provider: 'contract-stub', status, fetchedAt: now(), note: '测试桩数据，非真实' });

// 测试桩地点（坐标为大致位置，仅用于驱动前端状态机测试）
const POIS = {
  tiantan: ['天坛公园', '东城区天坛东里甲1号', 39.8822, 116.4066],
  tiananmen: ['天安门广场', '东城区东长安街', 39.9033, 116.3976],
  jingshan: ['景山公园', '西城区景山西街44号', 39.9254, 116.3967],
  gugong: ['故宫博物院', '东城区景山前街4号', 39.9163, 116.3972],
  qianmen: ['前门大街', '东城区前门大街', 39.8957, 116.3982],
  cafe: ['胡同里的咖啡馆（测试）', '东城区某胡同', 39.9241, 116.4012],
};
const place = (k) => { const [name, address, lat, lng] = POIS[k]; return { poiId: 'poi_' + k, name, address, location: { lat, lng, coordinateSystem: 'GCJ02' }, evidence: [ev()] }; };

const jobs = new Map();
function newJob(ctx, result, agents, status = 'SUCCEEDED') {
  const jobId = id('job'); const runId = id('run');
  const events = []; let seq = 0;
  for (const [agentId, msg, tool] of agents) {
    events.push({ eventId: id('pe'), sequence: ++seq, occurredAt: now(), runId, agentId, type: 'agent_started', message: msg, traceId: 'trace_stub' });
    if (tool) events.push({ eventId: id('pe'), sequence: ++seq, occurredAt: now(), runId, agentId, type: 'tool_call_started', message: msg, toolName: tool, traceId: 'trace_stub' });
    if (tool) events.push({ eventId: id('pe'), sequence: ++seq, occurredAt: now(), runId, agentId, type: 'tool_call_finished', message: msg, toolName: tool, traceId: 'trace_stub' });
    events.push({ eventId: id('pe'), sequence: ++seq, occurredAt: now(), runId, agentId, type: 'agent_completed', message: msg.replace('中', '完成'), traceId: 'trace_stub' });
  }
  jobs.set(jobId, { ctx, result, events, status, created: Date.now(), cancelled: false });
  return { ...ctx, jobId };
}

function snapshot(jobId, after) {
  const j = jobs.get(jobId); if (!j) return null;
  const elapsed = Date.now() - j.created;
  const visible = j.events.filter((_, i) => i < Math.ceil((elapsed / 1600) * j.events.length));
  const done = elapsed > 1600 || j.cancelled;
  const status = j.cancelled ? 'CANCELLED' : done ? j.status : 'RUNNING';
  const evs = visible.filter((e) => e.sequence > after);
  return { ...j.ctx, jobId, status, progressEvents: evs, nextCursor: evs.length ? evs[evs.length - 1].sequence : after, result: done && !j.cancelled ? j.result : undefined };
}

const at = (date, hh, mm = 0) => `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+08:00`;
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00+08:00') + n * 86400000).toISOString().slice(0, 10);

function retime(plan) {
  const days = new Map();
  for (const a of plan.activities) { if (!days.has(a.dayIndex)) days.set(a.dayIndex, []); days.get(a.dayIndex).push(a); }
  const segments = [];
  for (const [d, list] of days) {
    list.sort((a, b) => a.orderIndex - b.orderIndex);
    let t = Date.parse(at(addDays(plan.startDate, d), 9));
    list.forEach((a, i) => {
      const dur = Math.max(30, (Date.parse(a.endAt) - Date.parse(a.startAt)) / 60000);
      a.orderIndex = i; a.startAt = new Date(t).toISOString(); a.endAt = new Date(t + dur * 60000).toISOString();
      t += dur * 60000;
      const n = list[i + 1];
      if (n) { segments.push({ fromActivityId: a.id, toActivityId: n.id, mode: 'TRANSIT', durationMin: 25, evidence: ev('ESTIMATED') }); t += 25 * 60000; }
    });
  }
  plan.segments = segments;
  return plan;
}

function makePlan(tripId, req) {
  const start = req.startDate; const end = req.endDate;
  const nDays = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  const keys = [['tiantan', 'qianmen', 'tiananmen'], ['gugong', 'jingshan'], ['qianmen']];
  const intents = (req.intents ?? []).filter((i) => i.status !== 'CANCELLED');
  const activities = [];
  for (let d = 0; d < nDays; d++) keys[d].forEach((k, i) => {
    const pl = place(k);
    const its = intents.filter((x) => x.placeId === pl.poiId);
    activities.push({ id: `act_${k}_${d}`, place: pl, dayIndex: d, orderIndex: i, startAt: at(addDays(start, d), 9 + i * 2), endAt: at(addDays(start, d), 10 + i * 2, 30),
      costStatus: 'UNKNOWN', locked: its.some((x) => x.locked), mandatory: false, progress: 'NOT_STARTED', intentIds: its.map((x) => x.id) });
  });
  const ints = intents.map((i) => ({ ...i, activityId: activities.find((a) => a.place.poiId === i.placeId)?.id, status: 'READY' }));
  return retime({
    schemaVersion: 1, tripId, revision: 0, title: `${req.destinationCity} ${nDays} 日游`, destinationCity: req.destinationCity, startDate: start, endDate: end,
    travelerCount: req.travelerCount, budgetCny: req.budgetCny, budgetScope: req.budgetScope, companions: req.companions, preferences: req.preferences,
    mode: 'PLANNING', lifecycle: 'PLAN_READY', requirements: req, activities, segments: [], boundarySegments: [], intents: ints,
    notificationPolicy: { enableL1: true, enableL2: true, enableL3: true, paused: false, cooldownMinutes: 15 }, updatedAt: now(),
  });
}

function content(tripId, rev, module, title, body, extra = {}) {
  return { contentId: id('ct'), tripId, baseRevision: rev, placeId: extra.placeId ?? 'poi_tiantan', module, title, body, version: 1, generatedAt: now(),
    evidence: [ev()], scopeNote: '测试桩生成的占位文本，仅用于前端联调', ...extra };
}

function proposal(state, ops, over = {}) {
  const cand = structuredClone(state);
  for (const op of ops) {
    if (op.type === 'MOVE') {
      const day = cand.activities.filter((a) => a.dayIndex === op.dayIndex).sort((a, b) => a.orderIndex - b.orderIndex);
      const a = cand.activities.find((x) => x.id === op.activityId);
      const rest = day.filter((x) => x.id !== a.id); rest.splice(op.orderIndex, 0, a);
      rest.forEach((x, i) => { x.orderIndex = i; x.dayIndex = op.dayIndex; });
    } else if (op.type === 'REMOVE') cand.activities = cand.activities.filter((a) => a.id !== op.activityId);
    else if (op.type === 'ADD') cand.activities.push(op.activity);
    else if (op.type === 'UPDATE_CONSTRAINT' && op.key === 'activityLocked') cand.activities.find((a) => a.id === op.value.activityId).locked = op.value.locked;
  }
  retime(cand);
  const locked = ops.some((o) => o.type === 'REMOVE' && state.activities.find((a) => a.id === o.activityId)?.locked);
  const validation = locked
    ? { status: 'INFEASIBLE', hardViolations: [{ code: 'LOCKED_ACTIVITY_CHANGED', activityIds: ops.filter((o) => o.activityId).map((o) => o.activityId), message: '锁定活动（含锁定的拍摄任务）不能被删除' }], unknownChecks: [], warnings: [], committable: false }
    : { status: 'PARTIALLY_VERIFIED', hardViolations: [], unknownChecks: ['测试桩：营业时间与票价未核验'], warnings: [], committable: true, ...over };
  const changes = cand.activities.map((a) => { const o = state.activities.find((x) => x.id === a.id); return o && o.startAt !== a.startAt ? { activityId: a.id, oldStartAt: o.startAt, newStartAt: a.startAt, oldEndAt: o.endAt, newEndAt: a.endAt, fields: ['startAt', 'endAt'] } : null; }).filter(Boolean);
  return { proposalId: id('prop'), tripId: state.tripId, baseRevision: state.revision, operations: ops, candidate: cand,
    hardViolations: validation.hardViolations, unknownChecks: validation.unknownChecks,
    diff: { added: ops.filter((o) => o.type === 'ADD').map((o) => o.activity.id), removed: ops.filter((o) => o.type === 'REMOVE').map((o) => o.activityId), moved: ops.filter((o) => o.type === 'MOVE').map((o) => o.activityId) },
    estimatedChanges: { travelMinutesDelta: ops.some((o) => o.type === 'MOVE') ? 12 : undefined }, validation, activityChanges: changes };
}

const caps = {
  planning: true, poiSearch: true, routes: ['WALK', 'TRANSIT'], content: true, nearby: true, demo: true,
  tools: [{ name: 'contract-stub（非真实服务）', available: true, reason: '本地联调测试桩' }],
  modelRoutes: [{ agentId: 'A1', provider: 'stub', model: 'none', available: true }],
  limits: { pollIntervalMs: 500, maxPollIntervalMs: 1200, jobTtlSeconds: 600, requestTimeoutSeconds: 30, maxJobSeconds: 60, maxBodyBytes: 2_000_000 },
  geoPolicy: { policyVersion: 'stub-1', arrivalRadiusMeters: 280, departureRadiusMeters: 400, maxAccuracyMeters: 100, arrivalDwellSeconds: 90, departureDwellSeconds: 120, minValidSamples: 3, maxSpeedMetersPerSecond: 45, maxSampleGapSeconds: 180 },
};

function handle(method, path, body) {
  const ctx = body && { executionMode: body.executionMode, demoRunId: body.demoRunId, tripId: body.tripId, baseRevision: body.baseRevision };
  if (method === 'GET' && path === '/api/v1/health') return [200, 'SUCCEEDED', { serviceStatus: 'DEGRADED', version: 'stub', capabilities: caps }];
  if (method === 'GET' && path === '/api/v1/capabilities') return [200, 'SUCCEEDED', caps];
  let m;
  if ((m = path.match(/^\/api\/v1\/jobs\/([^?]+)(?:\?afterSequence=(\d+))?$/))) {
    if (method === 'DELETE') { const j = jobs.get(m[1]); if (j) j.cancelled = true; return [200, 'SUCCEEDED', { jobId: m[1], status: 'CANCELLED' }]; }
    const s = snapshot(m[1], Number(m[2] ?? 0));
    if (!s) return [404, 'FAILED', null, [{ code: 'JOB_NOT_FOUND', message: '任务不存在或已过期', retryable: false }]];
    return [200, s.status, s];
  }
  if (path === '/api/v1/places/search') {
    const hits = Object.keys(POIS).filter((k) => POIS[k][0].includes(body.keyword) || body.keyword.includes(POIS[k][0].slice(0, 2))).map(place);
    return [200, 'SUCCEEDED', { places: hits }];
  }
  if (path === '/api/v1/requirements/parse') {
    const start = addDays(new Date().toISOString().slice(0, 10), 0);
    const intents = [{ id: id('it'), placeQuery: '天安门', placeId: 'poi_tiananmen', type: 'VIDEO_SHOOT', userRequest: '在天安门附近拍一段有纪念意义的演讲视频', desiredOutputs: ['演讲稿', '拍摄清单'], confirmed: false, status: 'PENDING', preparedContentIds: [], locked: true }];
    const requirements = { requirementsId: id('req'), version: 1, confirmed: false, destinationCity: '北京', startDate: start, endDate: addDays(start, 1), timezone: 'Asia/Shanghai', travelerCount: 2,
      budgetIsHardLimit: false, transportModes: ['TRANSIT', 'WALK'], mustVisit: [{ query: '天坛', place: place('tiantan') }], avoidPlaces: [], preferences: ['历史文化', '拍照'],
      companions: [{ id: 'cp1', label: '我', interests: ['建筑'], specialNeeds: [] }, { id: 'cp2', label: '朋友', interests: ['拍照'], walkingTolerance: 'MEDIUM', specialNeeds: [] }],
      specialNeeds: [], fixedConstraints: [], intents };
    return [202, 'RUNNING', newJob(ctx, { requirements, intents, missingFields: ['budgetCny'], uncertainFields: [{ fieldPath: 'startDate', reason: '原文未给出具体日期，按今天填写' }] }, [['A1', '理解需求中']])];
  }
  if (path === '/api/v1/plans/generate') {
    const plan = makePlan(body.tripId, body.requirements);
    const prepared = plan.intents.map((i) => content(body.tripId, 1, 'PERSONAL_GOAL', '演讲视频准备稿', '（测试桩）这里会是 A7 预准备的讲稿提纲与拍摄清单。', { intentId: i.id, activityId: i.activityId, placeId: i.placeId }));
    return [202, 'RUNNING', newJob(ctx, { plan, validation: { status: 'PARTIALLY_VERIFIED', hardViolations: [], unknownChecks: ['测试桩：所有营业时间与票价均未核验'], warnings: ['这是契约测试桩生成的行程'], committable: true }, preparedContents: prepared },
      [['A1', '理解需求中'], ['A2', '正在检索景点', 'amap.poi'], ['A3', '正在计算交通', 'amap.route'], ['A4', '正在编排日程'], ['A5', '正在校验行程'], ['A7', '内容准备中']])];
  }
  if (path === '/api/v1/revisions/propose') {
    const st = body.tripState;
    if (body.operations) return [202, 'RUNNING', newJob(ctx, { kind: 'REVISION', proposal: proposal(st, body.operations) }, [['A4', '正在生成修改'], ['A3', '重新计算路段', 'amap.route'], ['A5', '正在校验']])];
    const q = body.userRequest;
    if (/讲解|介绍/.test(q)) return [202, 'RUNNING', newJob(ctx, { kind: 'CONTENT', content: content(st.tripId, st.revision, 'KNOWLEDGE', '讲解（测试桩）', '测试桩讲解文本。') }, [['A1', '理解请求中'], ['A7', '内容生成中']])];
    if (/哪个|那家/.test(q)) return [202, 'RUNNING', newJob(ctx, { kind: 'CLARIFICATION', questions: ['你指的是哪个地点？'], candidates: [place('jingshan'), place('gugong')] }, [['A1', '理解请求中']])];
    const day = st.activities.filter((a) => a.dayIndex === (body.selectedContext?.activeDay ?? 0)).sort((a, b) => a.orderIndex - b.orderIndex);
    const victim = day.find((a) => a.place.poiId === 'poi_jingshan') ?? day[day.length - 1];
    const ops = [{ type: 'REMOVE', activityId: victim.id }, { type: 'ADD', activity: { ...victim, id: id('act'), place: place('cafe'), locked: false, intentIds: [] } }];
    return [202, 'RUNNING', newJob(ctx, { kind: 'REVISION', proposal: proposal(st, ops) }, [['A1', '解析批量修改'], ['A2', '核查新地点', 'amap.poi'], ['A4', '生成方案'], ['A5', '校验约束']])];
  }
  if (path === '/api/v1/revisions/validate') return [202, 'RUNNING', newJob(ctx, { proposalId: body.proposal.proposalId, baseRevision: body.baseRevision, validation: body.proposal.validation }, [['A5', '最终复核中']])];
  if (path === '/api/v1/proactive/evaluate') {
    const e = body.currentEvent; const st = body.tripState;
    const a = st.activities.find((x) => x.id === e.activityId);
    const intent = st.intents.find((i) => a?.intentIds.includes(i.id));
    let card; const contents = [];
    if (e.type === 'RISK') card = { cardId: id('card'), level: 'L3', module: 'TRIP_RISK', activityId: e.activityId, title: e.risk.message, actions: ['VIEW_REVISION', 'REMIND_LATER', 'IGNORE'], contentIds: [], evidence: { source: e.source, eventId: e.eventId, facts: e.risk.evidence } };
    else if (intent) { const c = content(st.tripId, st.revision, 'PERSONAL_GOAL', '你的拍摄计划已准备好', '（测试桩）讲稿提纲……', { intentId: intent.id, activityId: a.id, placeId: a.place.poiId }); contents.push(c);
      card = { cardId: id('card'), level: 'L2', module: 'PERSONAL_GOAL', activityId: a.id, intentId: intent.id, title: '你的拍摄计划已经准备好了', actions: ['VIEW_SCRIPT', 'VIEW_SHOOTING_CHECKLIST', 'REMIND_LATER', 'IGNORE'], contentIds: [c.contentId], evidence: { source: e.source, eventId: e.eventId, facts: [] } }; }
    else { const c = content(st.tripId, st.revision, 'KNOWLEDGE', `${a?.place.name ?? ''} 小知识`, '（测试桩）建筑知识……', { activityId: a?.id, placeId: a?.place.poiId }); contents.push(c);
      card = { cardId: id('card'), level: 'L1', module: 'KNOWLEDGE', activityId: a?.id, title: `到了${a?.place.name ?? ''}，听一段建筑小知识？`, actions: ['VIEW_CONTENT', 'IGNORE'], contentIds: [c.contentId], evidence: { source: e.source, eventId: e.eventId, facts: [] } }; }
    return [202, 'RUNNING', newJob(ctx, { decision: { decisionId: id('dec'), eventId: e.eventId, tripId: st.tripId, baseRevision: st.revision, shouldNotify: true, reasonCode: 'STUB', card }, contents }, [['A6', '判断是否提醒']])];
  }
  if (path === '/api/v1/content/refine' || path === '/api/v1/content/prepare') {
    const st = body.tripState;
    const c = content(st.tripId, st.revision, body.intentId ? 'PERSONAL_GOAL' : 'KNOWLEDGE', '实时完善（测试桩）', `根据要求「${body.userRequest ?? ''}」完善后的测试桩文本。`, { intentId: body.intentId });
    return [202, 'RUNNING', newJob(ctx, path.endsWith('refine') ? { content: c } : { contents: [c] }, [['A7', '内容生成中']])];
  }
  if (path === '/api/v1/nearby/search') {
    const cands = ['cafe', 'qianmen'].map((k) => ({ place: place(k), distanceMeters: 420, distanceEvidence: ev('ESTIMATED'), relevanceReason: '测试桩候选：符合“休息/拍照”偏好', costStatus: 'UNKNOWN' }));
    return [202, 'RUNNING', newJob(ctx, { candidates: cands }, [['A2', '检索附近地点', 'amap.poi']])];
  }
  return [404, 'FAILED', null, [{ code: 'NOT_FOUND', message: `未实现 ${method} ${path}`, retryable: false }]];
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body; try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
    const [code, status, data, errors = []] = handle(req.method, req.url, body);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ request_id: req.headers['x-request-id'] ?? id('req'), status, data, errors, trace_id: id('trace') }));
  });
}).listen(PORT, () => console.log(`contract-stub listening on :${PORT}`));
