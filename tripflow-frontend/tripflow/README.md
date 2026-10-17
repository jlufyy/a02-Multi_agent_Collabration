# TripFlow 前端（负责人 A）

按《多 Agent 情境感知智能旅行助手 PRD v1.0》与《TripFlow 前端开发需求文档 v1.0-split》实现的移动端 H5。免登录，计划权威状态保存在本机 IndexedDB。

> 状态说明：前端已实现并通过本地自动测试与移动视口 E2E（对接契约测试桩）。**尚未**对接真实后端 B、未配置高德 Key、未做 Android/iOS 真机与 HTTPS 定位验收、未部署。见文末状态看板。

## 目录

```
tripflow/
├─ apps/web/                     # 前端（A 主责）React + TS + Vite + Tailwind + Zustand + dnd-kit
│  ├─ src/api/client.ts          # 信封校验、X-Request-Id、202→轮询 jobs、DELETE 取消
│  ├─ src/store/                 # 本地权威 TripState、CAS 原子提交、undo/redo、演示副本隔离
│  ├─ src/lib/useEditFlow.ts     # propose → 预览 → validate → 原子提交（拖拽与 AI 共用）
│  ├─ src/lib/useTravel.ts       # 前台定位 → 状态机 → 事实日志 → A6 评估 → 队列 → 显示前检查
│  ├─ src/pages/                 # P01 首页 / P02 输入 / P03 确认 / P04 规划中 / P05 主页 / P11 设置
│  └─ src/components/            # 地图、三档抽屉、时间轴、P06 详情、P07 预览、P09 卡片、P10 AI、P12 演示控制台
├─ packages/contracts/           # 附录 A 的 Zod 契约（B 应据此生成 Pydantic，勿手抄）
├─ packages/context-engine/      # 浏览器定位纯函数 + 提醒去重（附录 A.4：B 主责，A 先行起草）
└─ tools/
   ├─ contract-stub/server.mjs   # ⚠️ 仅本地联调用的契约测试桩，非产品后端，不部署
   └─ e2e/mobile_flow.py         # Playwright 移动视口全流程（规划→拖拽→预览→撤销→AI→旅行→L1/L2/L3）
```

## 运行

```bash
npm install                       # 根目录，npm workspaces
cp apps/web/.env.example apps/web/.env.local   # 填 VITE_AMAP_KEY / VITE_API_BASE_URL
npm run dev                       # vite，/api 代理到 TRIPFLOW_API_PROXY（默认 127.0.0.1:8000）
npm test                          # vitest：CAS/撤销/状态机/去重/持久化/演示隔离（20 项）
npm run build                     # tsc + vite build → apps/web/dist
python3 tools/e2e/acceptance.py out   # 22 步手机视口验收流程（需先启动测试桩与 vite），详见 docs/TEST_FLOW.md
```

本地联调（无后端时）：`node tools/contract-stub/server.mjs` 后再 `npm run dev`。桩数据全部标注 `contract-stub / 待核验 / 测试桩数据，非真实`，且不返回路线几何，地图上不会出现伪造道路。

部署：`apps/web/netlify.toml` 已配置；HashRouter 保证 Cloudflare Tunnel 等静态托管下也无需路由回退。最终 Netlify 域名需加入 B 的 CORS 白名单与高德 Key 来源白名单。

## 视觉

按设计稿（12 屏参考图）实现：明亮蓝 `#2F7CF6` 主色、冷白底 `#F4F7FB`、白色卡片、深墨蓝文字；L2 任务用橙色 `#F08A24` 区分，危险红 `#F04B4B`。插画为原创矢量示意图，契约里没有图片字段，因此地点缩略图用名称首字色块，不使用冒充实拍的照片。

与设计稿的两处有意差异：旅行模式右下角箭头只在地图上定位下一站（D27 不做内置导航）；主动提醒以页面内通知卡呈现（H5 不承诺锁屏推送）。

## 与文档的偏差 / 需与 B 共同冻结

| 项 | 说明 |
|---|---|
| 底部抽屉 | 原用 vaul，但 vaul 1.x 不把 `modal={false}` 传给 Radix，会给整个 `#root` 加 `aria-hidden` 并拦截焦点（E2E 中复现）。改为只处理“手柄拖动→吸附三档”的最小组件 `BottomSheet.tsx`，支持方向键切换。 |
| GeoPolicy | 运行时优先用 `/capabilities.geoPolicy`；缺失时用 `INTERIM_GEO_POLICY`（PRD 范围内首轮值，`minValidSamples / maxSpeed / maxGap` 为待冻结值）。 |
| 契约源 | 前端先落地了 `packages/contracts` 的 Zod 版本，B 需评审并以此生成后端模型。 |
| 撤销容量 | 20 次（PRD 建议 10–20）。 |
| “稍后提醒” | 用户可选 10 / 30 / 60 分钟，到期后重新做显示前检查。 |
| 手动填写 | P02 额外提供“直接手动填写表单”，与 AI 解析产出同一份未确认 requirements。 |

## 状态看板（2026-10-16）

| 范围 | 状态 |
|---|---|
| P01–P12 页面与交互、契约类型、API 客户端 | 功能已实现 |
| CAS 原子提交 / 撤销重做 / 事实日志不回滚 / 存储失败回退 / 多 trip 隔离 / 演示隔离 | 自动测试通过 |
| GeoStateMachine（驻留、滞回、跳点、低精度、后台、坐标转换）/ 提醒优先级去重冷却暂停 | 自动测试通过 |
| 移动视口验收流程 22 步（对接契约桩，见 docs/TEST_FLOW.md） | 自动测试通过 22/22 |
| 真实后端 B、真实高德地图/路线、第二模型供应商 | Blocked：依赖 B 与 Key |
| Android / iOS 真机触摸、HTTPS 定位授权、Wi‑Fi/蜂窝网络 | 未开始（需设备与部署） |
| Netlify 部署、Cloudflare Tunnel 备用演练 | 未开始 |

AC-01～AC-26 均未完成真机/真实服务验收，不能对外宣称“已全部上线”。
