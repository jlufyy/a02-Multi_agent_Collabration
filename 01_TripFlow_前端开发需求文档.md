# TripFlow 前端开发需求文档

> 面向负责人 A：Web UI、交互、本地权威状态与集成。版本 v1.0-split，2026-10-16。状态：研发拆分稿，尚未开发/测试。
>
> 来源：《多 Agent 情境感知智能旅行助手 — 产品需求文档（PRD）》v1.0。原文件保持不变。搭配《TripFlow 后端开发需求文档》使用，双方使用完全一致的共同附录 A。

## 1. 交付目标与范围

交付手机浏览器可用、免登录的 HTTPS H5：国内城市1–3天旅行，从自然语言输入、可编辑确认、真实规划、地图时间轴、修改预览，到旅行位置感知和主动服务形成完整链路。支持多人偏好、由一人操作，同设备多份行程。北京两日游是演示案例，不能写死城市和地点。依据原文§0–§3、§16。

所有29项已确认决策仍在交付范围。原文不包含账号、跨设备同步、在线共同编辑、酒店机票交易、支付、逐步导航/语音导航/外部导航按钮、后台定位保证、复杂历史版本树；本拆分不增加这些功能。不得做假按钮、计时假Agent或把模拟事件当真实数据。

建议技术栈沿原文§10.1：React+TypeScript+Vite、Tailwind/可访问组件、Zustand+Zod、TanStack Query/fetch、dnd-kit、成熟Bottom Sheet组件、高德JS SDK、本地IndexedDB（轻量可用localStorage）。这些是建议，不是新增产品限制。使用共享schema生成类型。

## 2. 两人职责界面

| 前端 A 直接完成 | 后端 B 提供，A 集成 |
|---|---|
| P01–P12、真实地图、时间轴、拖拽、AI面板、预览与卡片 | 需求提取、POI/路线、Agent任务、内容/风险/附近结果 |
| TripState权威、本地保存/恢复、CAS提交、undo/redo | propose/validate与明确校验报告，不能替前端提交正式计划 |
| 浏览器定位授权/监听/clearWatch、可见性与显示 | 浏览器可运行的坐标/地理状态机模块、GeoPolicy、自动测试 |
| 本地事实日志、通知队列/已展示/忽略/稍后、模拟运行隔离 | 通知规则、A6候选决策、A7内容与安全来源 |
| Netlify前端配置、手机交互、错误回退 | Render服务、CORS、模型私钥、限额、真实进度 |

A负责把B的定位模块放进浏览器运行，不把原始GPS连续上送服务端。B负责规则正确性，A负责是否真的授权、前台可见和展示。自动到达不能改成每站必须签到。精确责任与字段见共同附录。

## 3. 页面与交互任务（沿原文页面ID）

| 页面 | A 的具体交付 | 调用/依赖 | 成功及异常要求 |
|---|---|---|---|
| P01 首页/我的行程 | 新建、读取多份本地计划、进入、演示说明 | 本地TripState；I01/I13能力检查 | 无登录；存储清除无云恢复承诺；服务不可用仍能看旧计划 |
| P02 AI需求输入 | 文本/示例、解析中、取消/重试 | I02→I04；I14取消 | 保留用户输入；不能把模型抽取直接当用户确认 |
| P03 需求确认 | 城市/日期/人数/总或人均预算/包含项/交通/起止点/必须去与不想去/同行偏好/特殊需求/锁定项/地点任务全部可编辑 | TripRequirements；I07地点消歧 | missing/uncertain逐字段提示；未匹配任务POI先选择；confirmed后才规划 |
| P04 规划中 | 简洁真实Agent步骤、异常、取消/重试 | I03→I04、I14 | 不用定时器假装完成；关闭/取消不丢原计划；PARTIAL说明未核验 |
| P05 规划地图主页 | 真实底图、Marker/路线、日切换、三档抽屉、拖拽、undo/redo、AI入口 | TripState；I05/I06；I08 | Marker↔卡片双向高亮；地图失败仍保留时间轴；不得用直线伪装真实道路 |
| P06 活动详情 | 地址/坐标/来源、开始结束和时长、交通、费用/未知、预订/锁定、绑定意图 | Place/Evidence/Activity；修改走I05/I06 | 单个字段已核验不等于全部真实；用户主动解锁后才允许改锁定项 |
| P07 变更预览 | 原新对比、增删换序/时间/路线/费用影响、硬冲突与未知项、确认取消 | RevisionProposal、I06 | 未确认不动正式计划；版本过期拒绝；硬冲突禁确认；接受未知必须明确 |
| P08 旅行模式 | 当前点/下一站/当前活动/状态、退出、显式模拟入口 | geolocation+共享状态机；I09 | 用户启动后再请求权限；退出clearWatch；拒绝/误差/隐藏为未知，不虚构抵达 |
| P09 主动卡片 | L1知识、L2任务、L3风险；查看/忽略/稍后/处理 | ProactiveDecision；I10/I11/I12/I05 | 同时只一张，L3>L2>L1；风险只给修改入口，不自动改计划 |
| P10 全局AI | 当前上下文、快捷操作、连续对话/追问、批量指令、真实进度 | SelectedContext；I05→I04；讲解I11；附近I12 | 在地图/时间轴/详情/旅行可打开；增删替换移动改时间时长约束均进预览 |
| P11 偏好/提醒设置 | 暂停L1/L2、独立L3开关、定位说明、清除本地与模拟记录 | NotificationPolicy、本地存储 | 用户能控制；暂停普通提醒不能误关闭单独开启的风险提醒 |
| P12 演示控制台 | 水印、模拟轨迹/时间风险注入、重置/退出、真实执行摘要 | SimLocationAdapter→同一状态机；I09/I04 | demoRunId隔离；不能注入一个ARRIVE就绕过驻留；退出不留下真实到达污染 |

## 4. 视觉与手势验收

按原文§4：留白、温和渐变、圆角浅阴影和流畅弹性动效；背景#F8FAFC、卡片#FFFFFF、主色#438AF5、正文#192537，警示/危险/成功需明确区分。卡片16–20px、抽屉24px起、按钮12–16px；标题22–28px、正文14–16px、辅助12–13px。动效180–320ms，优先transform/opacity，尊重prefers-reduced-motion；重要触摸目标约44×44 CSS px。原文参数是初始建议，要通过不同屏高手机检查。

地图铺底，抽屉20%/55%默认/85%三档。只拖抽屉顶部手柄改变档位，活动右侧独立手柄控制排序；列表内部纵向滚动与地图平移缩放不抢事件。AI浮层/确认面板打开时压缩或关闭竞争面板，避免遮挡焦点。正式路线实线，预览路线用不同样式；路线未取得明确待核验。地图加载使用本地loading/verified/unknown/failed视觉状态，不与DataStatus/JobStatus混为一谈。

## 5. 本地状态与操作流程

### 5.1 新建/规划/保存

创建本地tripId与输入草稿；I02提取→用户编辑P03→确认requirements版本→I03异步规划→I04轮询。收到结果检查schema、tripId、请求代次与baseRevision；展示validation，不能因任务成功直接称行程全部可执行。合法初始计划落地为revision=1；无法满足硬条件时显示原因并返回表单调整。

本地独立保存正式TripState、pending提案、undo/redo、内容、EventLog、GeoRuntimeState和演示副本。正式状态从一个入口写入；地图、时间轴、AI上下文、提醒计划都订阅同一个已确认快照。掉线不清空正式计划；可做草稿交互，不能声称离线完成了真实查询或验证。

### 5.2 拖拽/批量修改/撤销

拖拽即时显示临时顺序，发MOVE到I05；后端重新查受影响路段、调整下游时间并审核，收到RevisionProposal后P07预览。自然语言一次批量修改同样走I05，任何失败整批保持未提交。确认前I06复核；确认瞬间本地CAS与存储事务，成功才替换全部计划视图；取消/失败不动正式计划。锁定活动、任务和固定窗口不得被静默改掉。

每次确认一整个批次作为一个undo单元；undo/redo恢复计划内容但revision继续+1，新编辑清空redo。事实到达和已展示通知不回滚，恢复后重新计算未来提醒并投影真实进度；避免重弹。历史栈容量原文约10–20次是建议，实际值在README声明；无历史版本列表或分支树。

### 5.3 AI上下文与附近添加

AI入口必须携带tripId、planRevision、mode、selectedActivityId、selectedPoiId、activeDay；发送前和返回后检查ID仍有效。A1路由返回REVISION/CONTENT/CLARIFICATION，前端明确分流：修改→预览，内容→显示，澄清→让用户选地点或补信息。附近真实2–5候选不足如实显示；选中新增形成ADD提案，不直接push进正式activities。

### 5.4 定位、通知和模拟

用户主动旅行模式→单独位置授权→仅前台watchPosition；权限拒绝仍可看/改计划；隐藏暂停推断，前台重采样，不能补造未知轨迹。调用B提供的归一化/坐标转换/围栏纯函数，不另抄阈值。稳定到达后本地生成ProactiveEvent，经轻量规则过滤再I09唤醒A6；不是每个GPS样本请求LLM。

实际卡片进入本地优先队列。显示前重查当前revision、任务匹配、暂停、冷却、是否处于拖拽/确认/输入状态；shownAt只在真实显示时写。忽略、稍后、查看和处理写事实回执。预准备内容先展示，打开任务再调用A7实时完善；错误时标注缓存与生成时间。离开推定完成可纠错，不能把它写成“已实际参观”。

演示位置通过另一适配器进入同一算法，有明显水印和demoRunId，独立副本/队列/事实记录；真实GPS监听与模拟输入互斥，退出清理模拟并重新采样真实位置。天气/风险模拟标签不能消失，模型/Agent运行仍真实。

## 6. 前端错误与部署交付

网络失败/502/冷启动显示连接状态、原因、有限重试；已保存计划继续可读；超时可关闭AI面板；job丢失提示重新发起。地图失败保留时间轴，路线/票价/营业缺失标未知，不用0代替。存储失败不显示“保存成功”，保留旧快照和用户输入并提示备份内容。所有问题可查看trace_id，不展示秘密或内部提示词。

按原文§11部署Netlify前端、Render API，备用本地完整服务+Cloudflare Tunnel，轮询作为可靠进度通道。A配置API base URL和地图公开使用配置，不存模型Key或服务端私钥；最终前端域名加入B的CORS与地图来源白名单。免费套餐/额度/网络可达性上线前核实，本拆分不承诺当期平台价格/性能。备用切换按同源/api代理优先，完成手机Wi-Fi/蜂窝和至少两种屏高检查，记录真实结果。

## 7. A 的开发清单与验收责任

按共同附录M0→M4推进，先把生成→编辑→本地确认贯通，再完成主动服务和多模型集成。A主责AC-01/05/06/07/17/20/21/23及浏览器相关异常；与B共同完成AC-02/03/04/08/09/10/11/12/14/16/18/19/22/24/25/26；配合AC-13/15观察真实日志与UI，不把后端测试结果当手机验收。

A重点自动检查：类型/ESLint、共享Fixture解码、原子提交/存储失败、旧revision与请求代次拒收、undo/redo事实不回滚、多tripId隔离、通知真实展示与去重。移动端真实触摸/HTTPS权限和完整E2E按原文验收；具体矩阵在共同附录B。

A最终交付：apps/web源码、契约生成类型、可运行环境说明/无密钥.env.example、本地状态读写与回退说明、部署地址、页面截图/录屏、对应提交hash测试记录、已知问题与备用演示步骤。全项目提交材料/科研观测仍按原PRD§14–§16共同负责，不因两人分工消失。

---

## 共同附录 A：前后端共享接口与参数契约（两份文档完全相同）

契约编号：`TripFlow-Split-v1`；适用源 PRD v1.0（2026-10-16）。此附录是基于原文的开发对齐稿，尚未生成或运行 OpenAPI/schema，也不代表接口已经实现。

标记说明：**【原文】**表示 PRD 明确要求；**【补齐】**表示把原文未完整定义的接口、参数或归属变成可协作的工程约定，不增加产品功能。实现前两人一起将本附录固化到 `packages/contracts`；任何变更应同时更新 schema、生成类型、Fixtures 和这两份文档。原文功能边界优先，不能通过改契约删需求。

### A.1 两人交界与原文歧义处理

| 事项 | 统一约定 | 依据/性质 |
|---|---|---|
| 正式计划权威 | 当前设备 `TripState`；后端接收完整快照执行任务，不设云端计划主库 | 【原文】§7.1、§10.4 |
| 本地提交 | 后端 propose/validate，前端用户确认后原子提交；无新增云端 commit/undo/redo API | 【原文】§7、§10.4 |
| 字段风格 | 业务 JSON 用原文示例 camelCase；响应信封保留 request_id、trace_id。日志 snake_case 与业务字段做显式映射 | 【补齐】原文混用两种命名，禁止一端发送 base_revision、另一端只读 baseRevision |
| 修改枚举 | API 采用原文 §7 的 ADD/REMOVE/REPLACE/MOVE/UPDATE_TIME/UPDATE_CONSTRAINT，补 UPDATE_DURATION。§5 的 *_ACTIVITY 仅作语义名称 | 【补齐】原文 §5.6 有修改时长，但 §7.2 联合类型遗漏 |
| 需求保存 | TripState 增加 requirements；保存交通、预算包含项、起止点、锁定窗口等，后续修改必须继续校验 | 【补齐】原文文字要求完整，TripState 示例未包含全部字段 |
| 生命周期 | lifecycle 表示 DRAFT_INPUT/PLANNING/PLAN_READY/TRAVELING/TRIP_ENDED；TripMode 仍只取 PLANNING/TRAVELING | 【补齐】原文 §3.2 与 §7.2 是两个维度 |
| 真实/演示模式 | executionMode=REAL/DEMO；与 TripMode 无关；DEMO 必须有 demoRunId | 【补齐】解决 generate 的 mode 到底指哪种模式的问题 |
| 定位职责 | B 编写并测试可在浏览器运行的纯函数 GeoStateMachine、坐标适配和策略定义；A 负责权限、watchPosition、页面可见性、部署到浏览器和 UI | 【补齐】落实原文两人场景 B 负责定位适配，又符合 §11.3 本地围栏判断、最小上传 |
| 提醒职责 | B 定义规则与 A6 决策；A 管理本地事实日志、队列、真实展示/忽略回执及暂停；展示前再做最终限频检查 | 【补齐】后端无法知道用户是否真的看到了卡片 |
| 进度状态分离 | DataStatus、ValidationStatus、JobStatus、地图加载状态分别表示数据、可行性、执行、UI 状态 | 【补齐】PARTIAL 不等于可提交，SUCCEEDED 不等于所有事实 VERIFIED |
| HTTP 409 | 后端检查请求内部 tripId/revision 一致性；前端在接收异步结果、validate 返回后和提交瞬间对当前本地 revision 再做 CAS | 【补齐】无后端计划主库，后端不能独自感知请求发出后的本地新版本 |
| 长任务 | 下述耗时端点统一返回 jobId，GET jobs 轮询结果；不再同时实现“有时直接返回 plan”的另一套分支 | 【补齐】收敛原文 §10.4 的 jobId 或快速 plan 两种可选方式 |
| 取消任务 | B 增加 DELETE /jobs/{jobId}，只取消临时计算，幂等；A 同时废弃该请求代次，拒收晚到结果 | 【补齐】支撑 P04 取消要求，不扩展业务功能 |
| 普通 AI 对话/讲解 | revisions/propose 的 userRequest 由 A1 路由，result 区分 REVISION/CONTENT/CLARIFICATION，不为非修改对话制造空编辑 | 【补齐】复用原有入口完成 §5.6 普通上下文与 §4.4 讲解；修改结果仍必须确认 |
| 可调阈值 | PRD 给出范围时继续保留范围，B 用配置及 Fixture 固化首轮试验值、记录版本，不称其为最终最优值 | 【原文】§6.2、§6.3 |

### A.2 通用传输、时间与错误

- 基础路径 `/api/v1`，JSON UTF-8；无账号、登录、验证码、跨设备同步。CORS 白名单是部署约束，不是登录系统。
- 业务对象字段名大小写严格一致；可选字段缺失用省略，禁止以 0 或空字符串代替未知；数组无项用 `[]`。信封 `data` 在无结果/失败时允许 `null`。
- 时间戳 ISO 8601，必须带 `Z` 或偏移；国内计划时间带 `+08:00`，`timezone=Asia/Shanghai`；日期 `YYYY-MM-DD`，钟点 `HH:mm`；分钟和米见字段后缀；费用统一人民币 CNY。
- ID 均为不透明稳定字符串；改顺序不改 activity.id；活动同 POI 多日重访是不同 activityId，到达还有独立 arrivalId。dayIndex、orderIndex 【补齐】从 0 开始，展示时 +1。revision 为非负整数，首次成功落地为 1，每次计划提交/撤销/重做递增。
- 每个带 tripState 的请求都显式携带 tripId/baseRevision 并核对三者一致；首次生成也携带本地分配的 tripId 和 baseRevision=0。客户端只发必要上下文，不持续上传原始轨迹。
- 【补齐】POST 头 `X-Request-Id` 由客户端生成。后端在临时任务有效期内对“同路径、同 ID、同请求体”返回同一 job/result；同 ID 不同请求体返回 409 REQUEST_ID_CONFLICT。无持久数据库保证时，实例重启后不得承诺全局 exactly-once；客户端仍按任务代次和 revision 防重复落地。
- HTTP 200：同步调用/查询成功；202：任务已接受；422：字段/结构不合法；409：版本/请求冲突；404：任务或资源不存在；429：限流/预算限制；502/503：上游/服务不可用；504：超时。网络错误在前端单独处理，不能假造服务端错误信封。
- 同步成功信封 status=SUCCEEDED 或 PARTIAL；异步查询信封 status 跟随 job.status。FAILED/CANCELLED 不能被 UI 显示为完成。错误保留原计划并显示 request_id/trace_id 供排查。

```ts
type JobStatus = 'PENDING' | 'RUNNING' | 'PARTIAL' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
type DataStatus = 'VERIFIED' | 'ESTIMATED' | 'UNKNOWN' | 'FAILED';
type ValidationStatus = 'FEASIBLE' | 'PARTIALLY_VERIFIED' | 'INFEASIBLE';
type EventSource = 'REAL' | 'SIMULATED' | 'USER_CORRECTION';
type TripMode = 'PLANNING' | 'TRAVELING';
type ExecutionMode = 'REAL' | 'DEMO';
type Lifecycle = 'DRAFT_INPUT' | 'PLANNING' | 'PLAN_READY' | 'TRAVELING' | 'TRIP_ENDED';
type TravelMode = 'WALK' | 'TRANSIT' | 'DRIVE';
type ActivityProgress = 'NOT_STARTED' | 'APPROACHING' | 'ARRIVED' | 'VISITING'
  | 'INFERRED_COMPLETE' | 'LOCATION_UNKNOWN';
type IntentType = 'KNOWLEDGE' | 'PHOTO' | 'VIDEO_SHOOT' | 'SPEECH' | 'CHECK_IN' | 'FOOD' | 'OTHER';
type ServiceModule = 'KNOWLEDGE' | 'PERSONAL_GOAL' | 'TRIP_RISK' | 'NEARBY';
type ApiError = { code: string; message: string; retryable: boolean; fieldPath?: string };
type ApiResponse<T> = {
  request_id: string; status: JobStatus; data: T | null;
  errors: ApiError[]; trace_id: string;
};
type GeoPoint = { lat: number; lng: number; coordinateSystem: 'GCJ02' | 'WGS84' };
type Evidence = {
  provider: string; externalId?: string; fetchedAt?: string;
  status: DataStatus; sourceUrl?: string; note?: string;
};
type Fact<T> = { value?: T; evidence: Evidence }; // 【补齐】字段级事实，不把整个 POI 一概视为已核验
type Place = {
  poiId: string; name: string; address?: string; location: GeoPoint; evidence: Evidence[];
  openingHours?: Fact<string>; ticketPriceCny?: Fact<number>; queueMinutes?: Fact<number>;
  rating?: Fact<number>; bookingNote?: Fact<string>;
};
type CompanionPreference = {
  id: string; label: string; interests: string[];
  walkingTolerance?: 'LOW' | 'MEDIUM' | 'HIGH'; personalBudgetCny?: number;
  specialNeeds: string[]; // 【补齐】原文已要求的特殊需求
};
type TravelIntent = {
  id: string; activityId?: string; placeId?: string; placeQuery?: string;
  type: IntentType; userRequest: string; desiredOutputs: string[]; confirmed: boolean;
  status: 'PENDING' | 'READY' | 'TRIGGERED' | 'CANCELLED'; preparedContentIds: string[];
  locked: boolean; // 【补齐】保留“拍摄任务不许动”这种独立任务锁定条件
};
type PlaceReference = { query: string; place?: Place }; // 模糊 query 不能当成已匹配 POI
type FixedConstraint = {
  id: string; activityId?: string; place?: PlaceReference;
  startAt: string; endAt?: string; reason: string; locked: boolean;
};
type TripRequirements = {
  requirementsId: string; version: number; confirmed: boolean;
  destinationCity?: string; startDate?: string; endDate?: string; timezone: 'Asia/Shanghai';
  travelerCount?: number; budgetCny?: number; budgetScope?: 'PER_PERSON' | 'TOTAL';
  budgetIsHardLimit: boolean; includesAccommodation?: boolean; includesIntercityTransport?: boolean;
  arrivalAt?: string; departureAt?: string; startPoint?: PlaceReference; endPoint?: PlaceReference;
  transportModes: TravelMode[]; mustVisit: PlaceReference[]; avoidPlaces: PlaceReference[];
  preferences: string[]; companions: CompanionPreference[];
  walkingTolerance?: 'LOW' | 'MEDIUM' | 'HIGH'; specialNeeds: string[];
  dailyStartTime?: string; dailyEndTime?: string; fixedConstraints: FixedConstraint[];
  intents: TravelIntent[];
};
type NotificationPolicy = {
  enableL1: boolean; enableL2: boolean; enableL3: boolean;
  paused: boolean; cooldownMinutes: number; // paused 只暂停 L1/L2，L3 看 enableL3
};
type TravelSegment = {
  fromActivityId: string; toActivityId: string; mode: TravelMode;
  durationMin?: number; distanceMeters?: number; routeGeometry?: GeoPoint[]; evidence: Evidence;
};
type RouteEndpoint =
  | { kind: 'ACTIVITY'; activityId: string; place: Place }
  | { kind: 'START_POINT' | 'END_POINT'; place: Place };
type BoundarySegment = {
  dayIndex: number; from: RouteEndpoint; to: RouteEndpoint; mode: TravelMode;
  durationMin?: number; distanceMeters?: number; routeGeometry?: GeoPoint[]; evidence: Evidence;
}; // 【补齐】只用于指定起点→首站、末站→指定终点，不伪造普通游览活动
type ItineraryActivity = {
  id: string; place: Place; dayIndex: number; orderIndex: number; startAt: string; endAt: string;
  estimatedCostCny?: number; costStatus: DataStatus; locked: boolean; mandatory: boolean;
  progress: ActivityProgress; intentIds: string[];
  bookingStatus?: 'UNSPECIFIED' | 'REQUIRED' | 'BOOKED'; bookingEvidence?: Evidence;
};
type TripState = {
  schemaVersion: 1; tripId: string; revision: number; title: string;
  destinationCity: string; startDate: string; endDate: string; travelerCount: number;
  budgetCny?: number; budgetScope?: 'PER_PERSON' | 'TOTAL';
  companions: CompanionPreference[]; preferences: string[]; mode: TripMode;
  lifecycle: Lifecycle; requirements: TripRequirements;
  activities: ItineraryActivity[]; segments: TravelSegment[]; boundarySegments: BoundarySegment[];
  intents: TravelIntent[];
  notificationPolicy: NotificationPolicy; updatedAt: string;
};
```

【补齐】上列 requirements 新字段、lifecycle、locked、bookingStatus 与字段级事实仅用于承载原文文字需求。TripRequirements 在解析阶段允许缺字段；进入 generate 时 destinationCity、startDate、endDate、travelerCount 必须存在、confirmed=true，天数含首尾为 1–3，人数为正整数。未指定预算/交通等不得被抽取模型暗中“确认”，默认值须在表单可见。无需人为设置原文未规定的产品人数上限；服务容量限制另行配置并提示。

顶层重复字段保留以兼容原 PRD；`requirements` 是用户确认约束，顶层是其投影，城市、日期、人数、预算、companions、preferences、intents 必须一致；修改时一并校验和提交。intents 匹配/准备状态更新也同步，禁止两份分叉。未知费用不参与“已全部预算满足”的结论，不能当 0；多人预算统一换算后比较，并显式按包含项统计。活动时长由 endAt-startAt 计算，不再保存另一份可能不一致的 duration。

`ItineraryDay[]` 【补齐】作为按 dayIndex 派生的视图，不增加第二份可写日程；起止点/固定集合约束保存在 requirements，并纳入边界交通核验。boundarySegments 保留原文内部 TravelSegment 结构，同时补齐起止路线：startPoint用于首日到达→首站，endPoint用于末日末站→返程；未指定不猜酒店位置。from/to至少一个为边界端点，另一个为该日首/末活动。端点query尚未匹配真实Place时，不能填伪坐标或宣称已核验路线，须在validation列未知/阻断。两端地图和交通总计均包含boundarySegments，按证据避免重复计费。

### A.3 编辑、校验与内容模型

```ts
type ConstraintChange =
  | { key: 'budgetCny'; value: number }
  | { key: 'budgetScope'; value: 'PER_PERSON' | 'TOTAL' }
  | { key: 'budgetIsHardLimit'; value: boolean }
  | { key: 'includesAccommodation' | 'includesIntercityTransport'; value: boolean }
  | { key: 'transportModes'; value: TravelMode[] }
  | { key: 'preferences'; value: string[] }
  | { key: 'companions'; value: CompanionPreference[] }
  | { key: 'specialNeeds'; value: string[] }
  | { key: 'walkingTolerance'; value: 'LOW' | 'MEDIUM' | 'HIGH' }
  | { key: 'startDate' | 'endDate' | 'arrivalAt' | 'departureAt' | 'dailyStartTime' | 'dailyEndTime'; value: string }
  | { key: 'startPoint' | 'endPoint'; value: PlaceReference }
  | { key: 'mustVisit' | 'avoidPlaces'; value: PlaceReference[] }
  | { key: 'fixedConstraints'; value: FixedConstraint[] }
  | { key: 'intents'; value: TravelIntent[] }
  | { key: 'activityLocked'; value: { activityId: string; locked: boolean } };
type EditOperation =
  | { type: 'ADD'; activity: ItineraryActivity }
  | { type: 'REMOVE'; activityId: string }
  | { type: 'REPLACE'; activityId: string; candidatePlaceId: string; candidatePlace: Place }
  | { type: 'MOVE'; activityId: string; dayIndex: number; orderIndex: number }
  | { type: 'UPDATE_TIME'; activityId: string; startAt: string }
  | { type: 'UPDATE_DURATION'; activityId: string; durationMin: number }
  | ({ type: 'UPDATE_CONSTRAINT' } & ConstraintChange);
type Violation = { code: string; activityIds: string[]; message: string };
type ValidationReport = {
  status: ValidationStatus; hardViolations: Violation[];
  unknownChecks: string[]; warnings: string[];
  committable: boolean; // 【补齐】不得只根据 job.status 判定能否确认
};
type RevisionProposal = {
  proposalId: string; tripId: string; baseRevision: number; operations: EditOperation[];
  candidate: TripState; hardViolations: Violation[]; unknownChecks: string[];
  diff: { added: string[]; removed: string[]; moved: string[] };
  estimatedChanges: { travelMinutesDelta?: number; costCnyDelta?: number };
  validation: ValidationReport;
  activityChanges: { activityId: string; oldStartAt?: string; newStartAt?: string;
    oldEndAt?: string; newEndAt?: string; fields: string[] }[];
};
type PreparedContent = {
  contentId: string; tripId: string; baseRevision: number; activityId?: string; intentId?: string;
  placeId: string; module: ServiceModule; title: string; body: string;
  version: number; generatedAt: string; evidence: Evidence[]; scopeNote: string;
};
type SelectedContext = {
  tripId: string; planRevision: number; mode: TripMode; selectedActivityId?: string;
  selectedPoiId?: string; activeDay: number;
};
type ConversationMessage = { role: 'user' | 'assistant'; content: string };
type RevisionResult =
  | { kind: 'REVISION'; proposal: RevisionProposal }
  | { kind: 'CONTENT'; content: PreparedContent }
  | { kind: 'CLARIFICATION'; questions: string[]; candidates: Place[] };
type PlanResult = { plan?: TripState; validation: ValidationReport; preparedContents: PreparedContent[] };
```

【补齐】REPLACE 额外带 candidatePlace，让无持久 POI 库的后端可以定位候选来源，仍须重新核验其证据，不能信任客户端自称 VERIFIED。候选内的 candidatePlaceId 必须等于 candidatePlace.poiId。UPDATE_TIME 保持原时长再校验；UPDATE_DURATION 从原 startAt 重算 endAt，再重新计算受影响路线和下游时段。MOVE 的目标索引定义为从原序列移除后插入最终目标序列的索引；统一重排连续 orderIndex。全部 operations 按数组顺序在副本执行，只有整批通过才可提交。

ConstraintChange 是白名单，禁止向后端发送任意对象路径。解除锁定只能来自用户明确动作；A1 不得因编辑请求冲突自动添加解锁操作。未覆盖的约束变更应在 schema 评审时补充，不能临时透传 `unknown`。规则校验预算范围、开放信息、固定约束、必去、锁定意图、交通和日边界。

ValidationReport.status=INFEASIBLE 或 hardViolations 非空时 committable=false。PARTIALLY_VERIFIED 不自动视为可提交：后端标明 unknownChecks 并给出 committable，前端单独展示未核验内容并要求用户明确接受；若是地点不存在、硬交通可达性无法支持等阻断项，仍为 false。这不允许用户用“接受未知”绕过已知硬冲突。

RevisionProposal 保留原文两个校验字段以兼容示例，必须与 validation 内同名字段一致。candidate.revision 保持 baseRevision，确认时由前端提升为当前 revision+1。activityChanges 【补齐】解决原文 diff 仅列增删移动、无法展示改时长/费用/锁定变化的问题；fields 是 schema 中发生变化的字段名。PreparedContent 仅是结构化文案和证据，不包含自动执行的 HTML/脚本；讲稿明确创作辅助，管理政策必须核实。

### A.4 定位、事实日志、提醒结果

```ts
type ExecutionContext = { executionMode: ExecutionMode; demoRunId?: string };
type RequestContext = ExecutionContext & { tripId: string; baseRevision: number };
type NormalizedLocationEvent = {
  sampleId: string; tripId: string; source: 'REAL' | 'SIMULATED'; demoRunId?: string;
  location: GeoPoint; accuracyMeters: number; timestamp: string;
  pageVisible: boolean; speedMetersPerSecond?: number;
};
type ProactiveEvent = {
  eventId: string; tripId: string; revision: number; source: EventSource;
  type: 'APPROACH' | 'ARRIVE' | 'LEAVE' | 'RISK' | 'RESUME';
  activityId?: string; arrivalId?: string; demoRunId?: string;
  location?: GeoPoint; accuracyMeters?: number; occurredAt: string;
  risk?: { code: string; message: string; evidence: Evidence[]; activityIds: string[] };
};
type NotificationAction = 'VIEW_CONTENT' | 'VIEW_SCRIPT' | 'VIEW_SHOOTING_CHECKLIST'
  | 'REMIND_LATER' | 'IGNORE' | 'VIEW_REVISION' | 'VIEW_NEARBY' | 'ADD_TO_PLAN';
type ProactiveDecision = {
  decisionId: string; eventId: string; tripId: string; baseRevision: number;
  shouldNotify: boolean; reasonCode: string; suppressionReason?: string;
  card?: {
    cardId: string; level: 'L1' | 'L2' | 'L3'; module: ServiceModule; activityId?: string;
    intentId?: string; title: string; actions: NotificationAction[]; contentIds: string[];
    evidence: { source: EventSource; eventId: string; facts: Evidence[] };
  };
};
type NotificationRecord = {
  notificationId: string; eventId: string; tripRevision: number; source: EventSource;
  demoRunId?: string; arrivalId?: string; activityId?: string; intentId?: string;
  riskCode?: string; contentId?: string; level: 'L1' | 'L2' | 'L3';
  decision: string; suppressionReason?: string; shownAt?: string;
  actionTaken?: NotificationAction; actionAt?: string; snoozeUntil?: string;
};
type EventLogEntry = {
  logId: string; tripId: string; tripRevision: number; source: EventSource; demoRunId?: string;
  occurredAt: string; event?: ProactiveEvent; notification?: NotificationRecord;
  correction?: { activityId: string; previous: ActivityProgress; next: ActivityProgress; reason: string };
};
type GeoRuntimeState = {
  tripId: string; activityId: string; source: 'REAL' | 'SIMULATED'; demoRunId?: string;
  progress: ActivityProgress; arrivalId?: string; candidateSince?: string;
  outsideSince?: string; lastValidSampleAt?: string;
};
type GeoPolicy = {
  policyVersion: string; arrivalRadiusMeters: number; departureRadiusMeters: number;
  maxAccuracyMeters: number; arrivalDwellSeconds: number; departureDwellSeconds: number;
  minValidSamples: number; maxSpeedMetersPerSecond: number; maxSampleGapSeconds: number;
};
```

【补齐】原文 ProactiveEvent 是判定后的业务事件，不能代替浏览器原始样本。GeoStateMachine 的输入是 NormalizedLocationEvent + 当前已确认活动 + GeoRuntimeState + GeoPolicy，输出新 GeoRuntimeState 和零或多个 ProactiveEvent；B 提供该浏览器可用模块，A 消费。不得直接点“到达”绕过驻留算法；控制台的 DWELL/ARRIVE 意图要转成连续带时间戳样本，RISK 转为带证据/模拟标签的风险事件。演示时间加速只改变模拟时钟，不能改真实阈值或伪造真实时间。

初始可调范围保持原文：到达 200–350m；离开比到达多 100–150m；优先 accuracy≤100m；到达驻留 60–120s；离开驻留约 120s；普通冷却约15min。minValidSamples、跳点/速度/样本间隔阈值原文未给具体值，由 B 在 M0 以配置和测试数据冻结，A 不另写一套数值。使用统一坐标系计算距离，保留原样本坐标与转换来源；页面不可见、权限丢失、长间隔时变 UNKNOWN，不跨缺失窗口累计驻留。

【补齐】原文 progress 和 intent.status 存在于可撤销 TripState 中，但到达/触发事实不应回滚。因此到达/通知日志及 GeoRuntimeState 独立保存，TripState.progress 和已触发状态仅是当前投影。Undo/Redo 恢复计划后，根据仍适用的事实日志重新投影，重新生成未来提醒计划；不删除过去记录，不重新推同一次到达。新的有效重访有新 arrivalId。用户纠错记 USER_CORRECTION 并重算投影。演示运行单独副本和日志，不写入真实计划的到达字段。

去重键至少区分 tripId/executionMode/demoRunId/activityId/arrivalId/intentId/风险类型；revision 用于过期检查，不得仅靠“新 revision”重推相同事实。L3>L2>L1，一次一张；L2 同任务同抵达默认一次，L1 同抵达最多一次；用户忽略不重复同内容。拖拽/表单/确认中暂缓普通卡。暂停 L1/L2 不等于关闭 L3。

【补齐】“稍后”间隔原文未固定，A 向用户提供明确延后选择，写 snoozeUntil，恢复时重新检查当前 revision、位置/任务和暂停策略。请求 recentNotifications 必须覆盖本次到达去重记录、仍有效风险、冷却/稍后窗口，不能仅任意截最近几条；抑制记录也写日志。后端返回的是展示候选，最终显示时 A 再校验本地队列，实际显示才写 shownAt。

### A.5 异步任务与真实进度

```ts
type AgentId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7';
type ProgressEvent = {
  eventId: string; sequence: number; occurredAt: string; runId: string;
  agentId: AgentId; type: 'agent_started' | 'agent_completed' | 'agent_failed'
    | 'tool_call_started' | 'tool_call_finished';
  message: string; toolName?: string; traceId: string;
};
type JobAccepted = RequestContext & { jobId: string };
type JobSnapshot<T> = RequestContext & {
  jobId: string; status: JobStatus;
  progressEvents: ProgressEvent[]; nextCursor: number; result?: T;
};
```

- 【补齐】长任务入口返回 202 + ApiResponse<JobAccepted>（status=PENDING 或 RUNNING）；不直接写客户端计划。GET jobs 返回 200 + ApiResponse<JobSnapshot<T>>；后端不得返回假百分比或固定时序进度。
- 【补齐】`GET /jobs/{jobId}?afterSequence=0`；sequence 从 1 单调递增，返回大于 afterSequence 的事件，nextCursor 是本次已返回最高序号（无新事件沿用原游标）；结果保留到任务 TTL 内，重复查询不消费结果。游标过大返回 422，不静默跳过。
- SUCCEEDED/PARTIAL/FAILED/CANCELLED 为终态；PARTIAL 终态必须带可用结果和 warnings/unknownChecks 或 errors，不能让前端永久轮询。模型输出非法 JSON 做 schema 校验、有界修复，仍失败返回 FAILED。
- 任务 TTL、轮询频率、退避、总超时及运行上限【补齐】由能力接口公开并在 M0 冻结，不能让两端各猜；不固定原文未给出的性能 SLA。SSE 可选，轮询必须完整可用。
- 后端实例重启/TTL 到期查不到任务：404 JOB_NOT_FOUND；A 终止旧轮询，保留本地快照，提示重新发起，不展示“已恢复后端任务”。关闭面板只解除 UI 订阅；取消计算调用 DELETE 并废弃请求代次。
- job 结果必须匹配当前 tripId、baseRevision、executionMode/demoRunId 与请求代次；不满足即丢弃，禁止写入。result 与端点种类的对应关系见下一节，不能把未知 JSON 直接写进 Zustand。

### A.6 逐个 API 的请求/响应（13 个原文端点 + 1 个取消补齐）

下表请求均为 JSON body；GET/DELETE 除注明 query 外无 body。`S` 表示同步 200；`J<T>` 表示异步 202 JobAccepted，再由 jobs 取得 T。每行都包 A.2 的 ApiResponse，不能在部分端点省略信封。带 TripState 的请求同时包含 RequestContext；ExecutionContext 对不依赖正式计划的搜索也必须传。

| ID | 方法 /api/v1 后路径 | 请求字段（? 可选） | data / job result |
|---|---|---|---|
| I01 | GET /health | 无 | S: `{serviceStatus:'OK'\|'DEGRADED',version:string,capabilities:CapabilitySet}` |
| I02 | POST /requirements/parse | `RequestContext & {text:string,selectedContext?:SelectedContext,conversation?:ConversationMessage[]}`；新建使用本地tripId、baseRevision=0 | J<`{requirements:TripRequirements,intents:TravelIntent[],missingFields:string[],uncertainFields:{fieldPath:string,reason:string,candidates?:Place[]}[]}`> |
| I03 | POST /plans/generate | `RequestContext & {requirements:TripRequirements,mode:TripMode}`；首次 baseRevision=0，mode=PLANNING | J<PlanResult> |
| I04 | GET /jobs/{jobId} | path jobId；query afterSequence?:number（默认0） | S: JobSnapshot<对应入口 result>；外层 status 跟随 job.status |
| I05 | POST /revisions/propose | `RequestContext & {tripState:TripState,selectedContext?:SelectedContext,conversation?:ConversationMessage[],operations?:EditOperation[],userRequest?:string}` | J<RevisionResult> |
| I06 | POST /revisions/validate | `RequestContext & {tripState:TripState,proposal:RevisionProposal}` | J<`{proposalId:string,baseRevision:number,validation:ValidationReport}`> |
| I07 | POST /places/search | `ExecutionContext & {city:string,keyword:string,location?:GeoPoint}` | S: `{places:Place[]}` |
| I08 | POST /routes/segments | `RequestContext & {requirements:TripRequirements,activities:ItineraryActivity[],mode:TravelMode}` | S: `{segments:TravelSegment[],boundarySegments:BoundarySegment[],warnings:string[]}` |
| I09 | POST /proactive/evaluate | `RequestContext & {tripState:TripState,currentEvent:ProactiveEvent,recentNotifications:NotificationRecord[],uiBusy:boolean}` | J<`{decision:ProactiveDecision,contents:PreparedContent[]}`> |
| I10 | POST /content/prepare | `RequestContext & {tripState:TripState,intents:TravelIntent[],selectedContext?:SelectedContext}` | J<`{contents:PreparedContent[]}`> |
| I11 | POST /content/refine | `RequestContext & {tripState:TripState,intentId?:string,preparedContent?:PreparedContent,userRequest:string,context:SelectedContext}` | J<`{content:PreparedContent}`> |
| I12 | POST /nearby/search | `RequestContext & {tripState:TripState,location:GeoPoint,category:'FOOD'\|'REST'\|'PHOTO',preferences:string[],selectedContext?:SelectedContext}` | J<`{candidates:NearbyCandidate[]}`> |
| I13 | GET /capabilities | 无 | S: CapabilitySet |
| I14 | DELETE /jobs/{jobId} | path jobId | S: `{jobId:string,status:JobStatus}`；重复取消幂等，已终态不改变结果 |

```ts
type CapabilitySet = {
  planning: boolean; poiSearch: boolean; routes: TravelMode[];
  content: boolean; nearby: boolean; demo: boolean;
  tools: { name: string; available: boolean; reason?: string }[];
  modelRoutes: { agentId: AgentId; provider: string; model: string; available: boolean }[];
  limits: { pollIntervalMs: number; maxPollIntervalMs: number; jobTtlSeconds: number;
    requestTimeoutSeconds: number; maxJobSeconds: number; maxBodyBytes: number };
  geoPolicy: GeoPolicy;
};
type NearbyCandidate = {
  place: Place; distanceMeters?: number; distanceEvidence: Evidence;
  relevanceReason: string; estimatedCostCny?: number; costStatus: DataStatus;
};
```

【补齐】I02 结果的 intents 与 requirements.intents 必须相同；用户编辑后整份 requirements 是 I03 唯一输入，不能再拿未确认抽取缓存覆盖。missingFields/uncertainFields.fieldPath 使用 schema 字段路径。涉及地名不确定时返回候选并要求用户选择。

I05 operations 和 userRequest 必须且只能提供一个；拖拽走 operations，自然语言走 userRequest。SelectedContext 的 tripId/planRevision/mode 必须与快照一致，所选 ID 存在，activeDay 合法；不一致报错，不能猜地点。新增请求前 A 提示用户取消/替换旧草稿，一次仅一个待确认提案。

I06 复核时若候选需要重新规划/路线变化，返回 committable=false 并要求重新 propose，不把新候选藏在 validate 响应中。前端收到可提交结果后再次比对 revision 和当前 proposalId，再接受用户确认与原子落地。验证过程中用户取消则废弃结果。

I08 activities 按 dayIndex/orderIndex 排序、按日分组查询相邻路段，不自动连起不同旅行日；requirements指定的首日到达/末日返程路线写入boundarySegments；POI 与路段坐标严格标注。对路线部分失败返回 PARTIAL，warnings 与相应 segment.evidence=FAILED/UNKNOWN 对应；失败段不伪造 routeGeometry/durationMin。

I09 不接受客户端一句“ARRIVE”就跳过本地状态机验证链；开发/验收需保留触发依据日志。SIMULATED 必须在 DEMO 且 demoRunId 匹配；RISK 必须有 risk.evidence，真实模式不接受模拟风险冒充真实数据。decision.card 仅在 shouldNotify=true 时提供；false 时必须有 suppressionReason。卡片内容生成失败允许保留有来源的准备稿并说明，不能伪称实时完善完成。

I10/I11 不把内容响应自动提升成已确认行程变更；内容存储按 tripId/placeId/intentId/revision 检查适用性。I11 intentId 在 PERSONAL_GOAL 时必填；单纯知识讲解可省略，必须有 context 选中地点或 activity。无选中地点返回 CLARIFICATION 的任务路由（I05），或 I11 报字段缺失，不能随机讲另一个景点。

I12 返回有来源的2–5个候选为目标；不足时返回实际数量并用 PARTIAL/errors 解释，不凑虚构商家。预算、剩余时间从 tripState 获取，距离若本地几何估算则 distanceEvidence=ESTIMATED，不当成步行路线距离。加入地点转 I05 ADD，再预览确认。多模型信息只含安全 provider/model/可用性，不含 Key、私有 URL、提示词和原始供应商响应。

### A.7 提交/撤销/恢复协议（无云端写计划接口）

1. A 获取当前快照 N；建立唯一 pending proposal 请求代次；B 在副本计算，返回 baseRevision=N 的候选和 validation。
2. A 对候选做 schema/ID/版本检查，展示增删换序、时间变化、交通/费用差、硬冲突、未知项；用户取消只丢弃草稿。
3. 用户准备确认时 I06 最终复核；任一硬冲突或 committable=false 阻止提交。未知可接受项必须显式展示，不把 PARTIAL 涂成绿色“全部通过”。
4. 原子提交瞬间再次检查当前 tripId/revision/proposalId。写同一个本地存储事务/单一序列化快照：新计划 revision=N+1、旧计划入 undo、redo 清空、意图/路线/未来提醒计划一起更新；写入成功后才显示成功。存储失败保留旧计划、草稿与可重试提示。
5. Undo 恢复之前计划内容但使用当前 revision+1，旧当前计划入 redo；Redo 同理；新编辑提交清空 redo。计划快照包含意图、锁定、路线、提醒策略；事实日志不回滚，重新投影 progress/已触发状态和未来提醒。
6. 【补齐】修改模式/提醒设置等会影响异步上下文时也递增 revision 并作废旧请求，但不混入行程编辑 undo 单元。事实位置/展示事件只推进独立事实日志与投影，不随每个 GPS 样本递增计划 revision。首轮实现须将这两类 reducer 分离。
7. 本地恢复按 schemaVersion 校验，未知版本不得静默丢字段；多个 tripId 隔离本地计划、undo/redo、内容、事实/演示日志、请求代次。清除存储后没有云恢复承诺。

### A.8 错误码与双方动作

| code | HTTP/场景 | A 必须行为 | B 必须行为 |
|---|---|---|---|
| STALE_REVISION | 409/本地CAS失败 | 丢弃旧结果、重新预览 | 校验请求内版本一致性，不覆盖 |
| LOCKED_ACTIVITY_CHANGED | 200 任务结果 INFEASIBLE | 显示锁定冲突、禁用提交 | 确定性检查活动/意图锁定 |
| TIME_WINDOW_VIOLATION / TRANSIT_INFEASIBLE / BUDGET_EXCEEDED | 校验结果 | 显示活动/时间/费用依据 | 检查硬约束，不偷放宽 |
| PLACE_UNVERIFIED | 校验结果 | 不展示为已核实地点 | 不把不存在 POI 加入可提交结果 |
| OPENING_HOURS_UNKNOWN | 校验结果/unknownChecks | 展示待核验 | 不默认24小时营业 |
| API_UNAVAILABLE / LLM_TIMEOUT / INVALID_MODEL_OUTPUT | 502/503/504 或任务 FAILED | 保留计划、可重试、显示trace | 有界重试，失败可解释 |
| JOB_NOT_FOUND | 404 | 停止旧轮询，提示重新发起 | 说明丢失/过期，不伪造任务恢复 |
| REQUEST_ID_CONFLICT | 409 | 用新请求ID或修正冲突 | 同ID不同请求体拒绝 |
| RATE_LIMITED / BUDGET_LIMIT | 429 | 退避、明确受限，不无限重试 | 限额、最大请求体、运行时上限 |
| VALIDATION_ERROR | 422 | 定位字段并保留输入 | 返回字段路径和原因 |

浏览器拒绝位置、精度差、地图 SDK 失败、本地保存失败是前端可观察错误；A 在本地展示，B 不伪造服务器对浏览器权限的确认。所有外部检索文本视为不可信资料，不得改写工具权限或读取秘密。

### A.9 不由本次拆分擅自确定的事项（M0 共同冻结，不加功能）

| 未定项 | 原文界限与负责人 |
|---|---|
| 地图及模型具体服务配置 | 原文建议高德、至少两家真实模型；B 核实授权/额度、实际兼容性，A 配地图 JS Key 来源限制 |
| 围栏采样数/跳点阈值/内容有效期 | B 用 GeoPolicy/内容版本与测试用例给出可调值，A 不硬编码另一版 |
| 任务TTL/轮询/超时/容量/重试/每日成本上限 | B 配置并公开安全限值，A 按 capabilities 行为，原文没有实测 SLA |
| 数据源费用口径映射 | 本稿统一活动estimatedCostCny和proposal费用差为整团CNY，预算按budgetScope换算；B记录供应商按人/票种/包含项到该口径的转换与证据，未知住宿/城际费用不能补0；不得重复计费 |
| 预订/开放时段结构深度 | 本稿最小字段承载显示；复杂时段解析由B在验证模型中冻结，不要求新增交易预订系统 |
| 内容/提醒“稍后”默认时长 | 用户可选择延后；A/B冻结可选值与过期策略，避免刷新/暂停后无条件重弹 |

这张表表示源 PRD 缺少的实现细节，必须在开发契约评审中结清，不表示删去相关验收。本次仅交付两份研发文档，没有第三份独立接口文档；实现时共同附录才迁移为单一机器可读契约。

### A.10 合并门槛与共同联调顺序

| 阶段 | A 前端交付 | B 后端交付 | 合并前共同证明 |
|---|---|---|---|
| M0 契约 | 本地状态骨架、API client、生成类型消费 | Pydantic/JSON Schema/OpenAPI、health/capabilities、定位纯函数边界 | 同一schema校验同一Fixture；A.9未决项冻结；CORS/密钥隔离 |
| M1 真实生成 | P01–P06、真实地图/日切换/进度 | A1–A5、真实POI/路线、jobs | 北京和另一城市1/2/3天；表单改动影响结果 |
| M2 编辑 | 三档抽屉、拖拽、预览/确认、undo/redo | propose/validate、局部路线、锁定/预算/时间规则 | 取消不变、旧结果拒收、整批提交/撤销、重载可恢复 |
| M3 主动 | 权限/前台监听、模拟控制、卡片/队列/事实日志 | A6/A7、状态机、预准备/实时内容、风险/附近 | 同一轨迹算法、L1/L2/L3防打扰、推荐加入预览、演示隔离 |
| M4 交付 | 手机触摸、Netlify、错误恢复、备用入口 | 第二供应商真实路由、Render、成本/日志、备用API | AC-01至26、E01至16存证；公网和备用切换演练 |

共同测试资料至少包含：北京两日游、另一国内城市、1/2/3天、多人偏好、锁定视频任务、成功/无解/未知三种校验、旧revision、路线失败、真实来源样本、600m精度与跳点、驻留与离开、重复抵达/重访、L3/L2/L1同时触发、页面隐藏恢复、演示退出。Fixtures 必须有来源/核验日期；人工构造输入标明合成，不当作真实 API 成功证据。

单仓目录沿原文：`apps/web` A 主责；`apps/api` B 主责；`packages/contracts` B 维护生成源、A 评审与使用；【补齐】`packages/context-engine` B 主责编写浏览器用定位纯函数、A 集成；`fixtures`、`docs`、CI共同维护。先合契约PR，再并行实现，main保持可运行。不要在两个端分别手抄数据类型。

CI：前端类型校验/ESLint、后端pytest、schema与Fixture双端解析、关键规则/状态机、任务轮询和本地原子提交验证；端到端覆盖规划→编辑→确认→到达→风险→撤销。真机Android/iOS根据设备可得性至少各一次触摸和HTTPS权限检查，未获得设备明确记Blocked，不能以移动视口代替真机。开发命令按原文 `pnpm dev` 与 `uvicorn app.main:app --reload`，实际脚手架建立后写 README，不能声称现在已经可运行。

状态统一：未开始→开发中→功能已实现→自动测试通过→真机手工验收通过；另设Blocked/部分可用。每次验收记录case_id、git_commit、device/browser、mode、time、pass/fail/blocked、evidence、notes、tester。接口对齐和文档校对不等于真实 API、真机、部署或端到端已通过。

## 共同附录 B：原文决策与验收原样摘录

以下保留原PRD的D01–D29、AC-01–AC-26、E01–E16与DoD，不因前后端拆分删减。原章节号沿用以便回查；其中“本PRD”指源文档。所有测试状态仍为NOT_TESTED。

## 1. 决策台账：29 项已确认需求（禁止丢失）

| 编号 | 已确认决策 | PRD 对应模块 | 验收关联 |
|---|---|---|---|
| D01 | 手机响应式 Web App / H5 | §4、§11 | AC-01 |
| D02 | 规划 → 执行 → 主动服务完整链路 | §3、§5 | AC-02 |
| D03 | 国内城市 1–3 天自由行 | §2、§5 | AC-03 |
| D04 | 位置 + 行程 + 历史意图联合触发 | §6 | AC-09 |
| D05 | L1 轻提示、L2 交互任务卡、L3 风险提醒 | §6 | AC-10 |
| D06 | 自然语言输入 + AI 提取 + 可编辑结构化表单 | §5.1、§7 | AC-04 |
| D07 | 地图 + 自由拖拽时间轴双向联动 | §4.2、§5.3 | AC-05 |
| D08 | 拖动后智能预览、冲突检查、用户确认 | §5.4、§7 | AC-06 |
| D09 | 简洁的真实 Agent 工作进度 | §4.5、§8 | AC-12 |
| D10 | 完整型 6–8 专业 Agent | §8（7 个） | AC-13 |
| D11 | 提前准备 + 到达后实时生成 | §6.5、§8 | AC-11 |
| D12 | 核心真实 API + 清晰标注的演示数据 | §9 | AC-14 |
| D13 | 多供应商兼容 + 按 Agent/任务分配模型 | §8.4、§10 | AC-15 |
| D14 | 模块化主动服务：知识、任务、风险、周边推荐 | §6.4 | AC-16 |
| D15 | 当前不设任何账号/登录/验证 | §7、§10 | AC-17 |
| D16 | 支持多人出行、单人统一规划 | §5.1 | AC-18 |
| D17 | 2–3 人小团队 | §12 | AC-19 |
| D18 | 现有代码基础为零 | §12 | AC-19 |
| D19 | 用户确认允许赛前开发、现场继续完善 | §12、§14 | AC-19 |
| D20 | 高级极简 + 灵动智能交互 | §4.1 | AC-20 |
| D21 | 地图底层 + 三档 Bottom Sheet 时间轴 | §4.2 | AC-05 |
| D22 | 规划/旅行双模式 + 启动建议；用户控制定位 | §4.3、§5.5 | AC-07 |
| D23 | 到达和离开均自动感知，自动推定完成 | §6.2 | AC-08 |
| D24 | 全局悬浮 AI + 当前景点/卡片/模式上下文 | §4.4、§5.6 | AC-21 |
| D25 | 一次指令支持增删替换移动和条件化批量修改 | §5.6、§7.4 | AC-22 |
| D26 | 简单撤销/重做，无复杂历史版本 UI | §5.7、§7.3 | AC-23 |
| D27 | 地图真实路线展示；不内置导航 | §5.3、§9 | AC-24 |
| D28 | 智能适度提醒、去重、冷却、暂停 | §6.3 | AC-25 |
| D29 | 免费 HTTPS：Netlify + Render；Cloudflare Tunnel 备用 | §11 | AC-26 |

**解释优先级**：如早期讨论中曾建议把某核心模块延期，后续用户明确要求“之前选择的核心功能比赛都要真能使用”，以该较晚要求为准。本 PRD 因此为「周边推荐」保留可实际使用的最小闭环；仅将推荐算法的高阶增强列为赛后研究。

---

## 13. 功能验收矩阵（必须实际操作）

> 以下全部为**计划中的验收项**，当前状态默认 `NOT_TESTED`。`REAL` 表示需要真实 API 或真实产品行为；`SIMULATED_EVENT` 仅表示位置/突发事件输入可以模拟，Agent、业务状态与结果仍须真正运行。

| AC ID | 覆盖需求 | 操作步骤 | 通过条件 | 测试模式 |
|---|---|---|---|---|
| AC-01 | D01 | 手机浏览器打开 HTTPS 地址 | 主流程可操作、无遮挡或横向溢出 | REAL |
| AC-02 | D02 | 创建 → 编辑 → 旅行 → 主动服务 | 核心业务链路有数据传递，非静态跳页 | REAL + SIMULATED_EVENT |
| AC-03 | D03 | 切换北京与另一座国内城市、分别做 1/2/3 天 | 地点真实不同、日程覆盖对应天数 | REAL |
| AC-04 | D06 | 输入含预算/偏好/多人任务描述并修改表单 | 表单可编辑，确认后约束确实参与规划 | REAL |
| AC-05 | D07/D21 | 触摸拖动卡片、切换底部抽屉三档、选中地图 Marker | 卡片真实重新排序；地图/时间轴双向联动；手势不冲突 | REAL |
| AC-06 | D08 | 拖卡片并取消；再重新拖并确认 | 取消不修改正式计划；确认才统一提交 | REAL |
| AC-07 | D22 | 旅行日期临近时打开计划并点击开启 | 可建议启动但不自动定位，主动切换模式后再申请权限 | REAL |
| AC-08 | D23 | 注入逐步进入/驻留/离开轨迹及一次 GPS 跳点 | 经过规则后自动 ARRIVED/推定完成；跳点不误判；可纠错 | SIMULATED_EVENT + 真机前台复核 |
| AC-09 | D04 | 先录入天安门拍摄任务，再触发对应抵达 | 正确识别地点、计划、任务三重条件；无关地点不触发 | SIMULATED_EVENT |
| AC-10 | D05 | 分别触发知识/任务/风险事件 | L1/L2/L3 视觉等级、按钮与后续操作不同且可用 | SIMULATED_EVENT |
| AC-11 | D11 | 规划时预准备任务，抵达后追加修改稿件指令 | 使用预准备数据并进行真实实时完善，不是重复静态文案 | REAL + SIMULATED_EVENT |
| AC-12 | D09 | 发起规划并观察进度日志 | 前端进度与后端 Agent/工具开始结束事件一致 | REAL |
| AC-13 | D10 | 完成规划、位置提醒、批量修改三类工作流 | 7 个专业 Agent 定义真实可测；实际工作流发生跨 Agent 结构化数据流转 | REAL |
| AC-14 | D12 | 使用真实城市与演示轨迹，断开一个外部 API | 真实数据有来源；模拟显著标注；错误不会伪造数据 | REAL + SIMULATED_EVENT |
| AC-15 | D13 | 按任务配置不同供应商的两个模型，运行两个测试任务 | 实际调用日志体现 provider/model 路由；Key 不泄漏前端 | REAL |
| AC-16 | D14 | 依次使用知识、拍摄任务、风险、附近美食四模块 | 四模块都有实际输入与结果；附近 POI 可加入修改草稿 | REAL + SIMULATED_EVENT |
| AC-17 | D15 | 无账号直接进入、生成计划、刷新浏览器 | 本机可恢复数据，无注册拦截和凭证输入 | REAL |
| AC-18 | D16 | 设置 2–4 人不同兴趣与步行要求 | 行程说明可体现同行需求，仍由单人统一编辑 | REAL |
| AC-19 | D17/D18/D19 | 团队从源码搭建与部署，按允许规则准备 | 2–3 人可独立启动开发/部署环境；已提供运行文档 | REAL |
| AC-20 | D20 | 在至少两种不同手机屏高下滚动、拖拽和打开弹窗 | 视觉一致、文本可读、滑动自然，尊重减少动态效果设置 | REAL |
| AC-21 | D24 | 地图选中天坛 → 打开全局 AI → “讲解这里” | Agent 收到选中 activity ID，结果对应天坛且不误改别站 | REAL |
| AC-22 | D25 | 一句话删点+加点+保留锁定项+预算约束 | 生成整批预览；不满足时整体不提交；满足后一次确认 | REAL |
| AC-23 | D26 | 确认批量变更 → 撤销 → 重做 → 再新编辑 | 整批原子撤销/重做；redo 在新编辑后清空；提醒计划同步 | REAL |
| AC-24 | D27 | 查看真实地图路线、切换日期、修改确认 | 地图显示真实路段/距离/预计时间；不出现内置实时导航功能 | REAL |
| AC-25 | D28 | 同一位置反复定位、同时触发 L1/L2/L3，暂停普通提醒 | 不刷屏、优先级正确、关闭普通提醒后停止 L1/L2 | SIMULATED_EVENT |
| AC-26 | D29 | 通过手机扫码访问公网 HTTPS，切换本地备用环境 | 网络端到端可用；备用隧道提供轮询真实进度，不依赖 SSE | REAL |

### 13.1 必须另外执行的异常与边界测试

| Case | 测试输入/操作 | 预期 |
|---|---|---|
| E01 | 同一活动被快速拖动两次 | 只提交最后一次用户确认的合法预览 |
| E02 | 用户修改后才收到旧 Agent 结果 | 旧结果因 revision 不匹配拒绝覆盖 |
| E03 | 锁定拍摄任务却要求删除关联活动 | 明示冲突，未解锁不得静默删除任务 |
| E04 | 用户要求同时在两个远距离地点于同一分钟本人到场 | 返回无解及冲突条件，不虚构交通方案 |
| E05 | 推荐不存在/无法核实的 POI | 明确无法核验，不强行加入已确认路线 |
| E06 | GPS 精度 600m 或跳点数公里 | 暂停确认到达、记录异常，不触发 L2 |
| E07 | 页面隐藏、再次打开 | 不补造定位轨迹；重新获取最新位置 |
| E08 | 用户拒绝位置权限 | 地图和行程仍可使用，自动到达不声称有效 |
| E09 | 模拟到达两次+提示已忽略 | 同一到达不重复弹同内容 |
| E10 | 风险/任务/知识在同秒触发 | 按 L3 > L2 > L1 排队或抑制，不叠三张卡 |
| E11 | 关闭 Render 后端或强制返回 502 | 前端保留本地行程、给出失败原因并允许重试 |
| E12 | 断掉某个模型供应商 | 路由错误可见、合法回退；不能伪称该模型完成 |
| E13 | 清理浏览器站点存储 | 明确知道匿名数据可能丢失，没有虚假的云备份承诺 |
| E14 | 地图源返回 WGS84/GCJ02 混合样本 | 验证坐标转换，不出现显著地理偏移 |
| E15 | 手机纵向滚动底部抽屉并拖动卡片 | 不产生抽屉误展开、页面抖动或地图误平移 |
| E16 | 演示模式退出后进入真实模式 | 不会遗留模拟到达事实或模拟风险 |

### 13.2 测试分层

- **Unit**：时间窗口、预算、锁定项、GeoStateMachine 滞回、通知去重、undo/redo、schema。
- **Integration**：Agent 节点真实数据流、模型路由、地图检索、revision compare-and-swap、任务状态接口。
- **E2E**：Playwright 桌面+移动视口执行规划→编辑→确认→主动提醒→撤销；Android/iOS 真实手机各进行至少一次触摸和 HTTPS 定位权限检查（根据可得设备）。
- **人工内容检查**：景点真实性、视频拍摄限制标注、用户偏好一致性、风险解释准确、未知数据未造假。

### 13.3 记录格式

每次验收至少记录：`case_id、git_commit、device/browser、mode(real/demo)、time、pass/fail/blocked、evidence(snapshot/log/trace_id)、notes、tester`。

若某项失败或未测试，不允许在路演材料中写“已全部上线”；可解释客观限制及修复计划，但必须优先修复阻断核心链路的问题。

---

## 16. 最终交付定义（Definition of Done）

只有同时满足以下条件，才可对外说“黑客松版本可演示”：

1. **免登录 HTTPS H5 可以从新建行程开始操作**，无需开发者人工修改数据库或后台状态。
2. **7 个专业 Agent + 总调度器均有可运行定义与测试**，至少完成规划、批量修改、主动服务三条真实协作路径。
3. **实际地图/POI/路线存在真实外部服务调用**，缺失字段有正确状态；不能靠固定图片代替地图。
4. **Bottom Sheet 三档、卡片拖动、双向地图联动真正生效**；改变顺序必须预览，用户确认后才提交。
5. **AI 批量编辑一次处理多项操作**，遵守锁定项与原子提交；撤销/重做保持行程、地图与提醒计划一致。
6. **旅行模式真实定位在支持的前台浏览器与授权条件下可工作**，自动推定到达/离开规则经设备/模拟轨迹测试；后台限制清楚说明。
7. **知识、用户任务、风险、附近推荐四种主动模块可调用**，L1/L2/L3 防打扰规则经过测试。
8. **行前预准备与行中实时内容完善可复现**，地点任务意图由首次输入传递至主动 Agent。
9. **核心真实数据 + 显式演示数据的切换可用**；所有模拟事件有来源标签且不会污染真实记录。
10. **多模型网关按角色执行至少两个真实厂商路由测试**，前端无私密 API Key；只展示真实执行进度。
11. **已确认行程在本地可恢复**，无账号服务；不同旅行计划的数据相互隔离。
12. **完成 AC-01 至 AC-26 验收并存证**；未通过项必须如实列入已知问题，不能伪称完成。
13. **公网主方案可扫码访问，备用方案经过切换演练**；有 README、运行手册、源码提交与演示脚本。

### 16.1 最后一次用户选择核对

- 第 23 项是 **A：自动到达/离开推定**，不是强制手动签到。
- 第 25 项是 **B：智能批量自然语言修改**，不是默认要求复杂多轮草稿分支。
- 第 26 项是 **A：撤销/重做**，不是完整历史版本 UI。
- 第 27 项是 **A：地图路线展示**，不包括内置导航或额外导航按钮。
- 第 29 项由用户授权协助选择，采用 **免费 HTTPS 主部署与本地备用**。
- **此前全部核心功能均必须真实可用**，可降低内部复杂度，但不允许假按钮、假 Agent、隐蔽伪造数据。

---

---

来源文件：`C:\Users\Administrator\Downloads\多 Agent 情境感知智能旅行助手 — 产品需求文档（PRD）.md`  
来源 SHA-256：`d434eb91df1a37f7b3dd560cba19b30ad4d33fbd4559719c8d185897f7e4a3ac`  
共享附录 A SHA-256：`464866e45e3f7f8be5df99b459cd237783cf5c90a938ddd75db2e68439d6ca27`  
本次仅拆分和对齐研发文档，未开发、部署或执行产品验收。
