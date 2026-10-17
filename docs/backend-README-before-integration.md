# TripFlow 后端

按《02_TripFlow_后端开发需求文档》的 `TripFlow-Split-v1` 实现。只包含后端、共享契约和浏览器定位纯函数；没有创建或修改前端页面。原始两份需求文档保留。

## 启动

要求 Python 3.12、Node.js 22（仅用于定位包测试/类型校验）。项目根目录已支持读取 `.env`，不要将其提交或分发。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -c apps/api/requirements-lock.txt -e './apps/api[test]'
.\start-backend.ps1
```

本机已有安装完成的 `.venv`，可直接运行 `start-backend.ps1`。也可以在 `apps/api` 目录执行 `uvicorn app.main:app --reload`。生产仅运行一个 worker；任务、幂等记录和费用限额都属于单实例临时状态。

- API 文档：<http://127.0.0.1:8000/docs>
- 健康检查：<http://127.0.0.1:8000/api/v1/health>
- 能力与阈值：<http://127.0.0.1:8000/api/v1/capabilities>
- 机器契约：`packages/contracts/generated/openapi.json`、`schema.json`、`index.d.ts`

未配置服务时仍可启动，health 返回 DEGRADED；真实调用报明确未配置错误，不偷偷使用合成数据。

## 已实现范围

| 模块 | 实现 |
|---|---|
| 14 个 HTTP 方法 | 需求解析、规划、任务查询/取消、提案/复核、地点、路线、主动服务、准备/完善内容、周边、health、capabilities |
| 任务系统 | 请求 ID 幂等、同 ID 不同 body 冲突、单调真实进度、超时、取消、容量、TTL、重复取结果、关闭清理 |
| 七个 Agent | A1 结构化解析，A2 地点研究，A3 交通研究，A4 确定性编排，A5 独立审核，A6 主动策略，A7 内容生成；每个节点有受限工具、输入哈希、运行记录和输出校验 |
| 规划/编辑 | 1–3 天、同行偏好、起止路线、固定/锁定/预约/必去/预算/营业检查、七种编辑操作、副本提案、变化摘要、最终复核、有限修复 |
| 数据 | 高德搜索/详情/周边/步行/公交/驾车；字段级证据、坐标标签、未知状态、真实路线几何，绝不直线补道路 |
| 模型 | OpenAI-compatible 和 Anthropic 原生协议；AIPing 配置兼容、按 Agent 切模型、结构校验与一次修复、实际型号/用量记录、调用上限 |
| 情境 | 浏览器 ESM 纯函数、同源 GeoPolicy、驻留/滞回/跳点/精度/重访/隐藏恢复、纠错/事实投影、通知优先级/去重/稍后/暂停、DEMO 隔离 |
| 内容 | 有地点/意图/版本适用范围的讲解、讲稿和清单；可选同名且坐标匹配的百科参考；来源不足明确未知，不承诺拍摄许可 |
| 交付 | 自动生成 TS/JSON Schema/OpenAPI、合成 Fixtures、离线测试、真实联调脚本、Dockerfile、Render 配置、CI |

正式 TripState 始终由浏览器保存。后端没有云端 commit、undo、redo 或账号接口。成功任务返回的候选也必须经过前端展示、用户确认和本地 CAS；撤销/重做使用新 revision，真实展示/到达事实不能回滚。

## 配置

已有 `.env` 中 `AMAP_API_KEY`、`AIPING_API_KEY`、`AIPING_BASE_URL` 可直接使用；也支持标准名 `AMAP_WEB_SERVICE_KEY`。模型缺省按实际联调选择 A1 `DeepSeek-V3.2`、A7 `Qwen3.8-27B`，可用 `AIPING_PRIMARY_MODEL` / `AIPING_SECONDARY_MODEL` 覆盖。

当前这两个模型都通过 **同一个 AIPing 聚合入口** 调用；不同模型家族不等于已验证两家独立 API 供应商。第二独立供应商的配置和适配已提供，但需相应密钥才能完成独立供应商验收。参见 `.env.example` 和 [供应商说明](docs/providers.md)。

`MODEL_ROUTES` 可以配置 `{"A1":"primary","A7":"secondary"}`；私密 URL 和 Key 不会出现在 capabilities。CORS 明确列出前端来源，生产部署时设置为真实 HTTPS 前端域名。

默认最多 128 个暂存任务、4 个同时运行、单任务 180 秒、终态结果保留 1800 秒、请求体 512 KiB、每来源 IP 每分钟 120 次、单任务最多 20 次模型请求。请求超时包含慢速请求体读取。默认每日预留预算 20 CNY；未配置实际单价时，每次 HTTP 尝试保守扣留 1 CNY，**这不是供应商实际账单，也不保证外部账户消费封顶**。设置供应商侧额度才能约束跨实例和重启后的消费。

单次模型调用默认等待 60 秒（`TRIPFLOW_MODEL_TIMEOUT_SECONDS`），与真实联调配置一致；异步任务仍受 180 秒总时限约束。供应商响应存在波动，真实联调曾出现含重试约 113 秒的内容请求，不承诺固定响应时延。

## 测试与生成

```powershell
Push-Location apps/api
..\..\.venv\Scripts\python.exe -m pytest -q
Pop-Location
node --test packages/context-engine/test.mjs
npm ci --cache .npm-cache
npm run typecheck
.\.venv\Scripts\python.exe packages/contracts/generate.py --app-openapi
.\.venv\Scripts\python.exe packages/contracts/generate.py --app-openapi --check
```

真实联调（会调用已配置服务和产生供应商用量）：

```powershell
.\.venv\Scripts\python.exe apps/api/scripts/live_verify.py
```

结果和限制见 [验收记录](docs/acceptance.md)、[真实调用摘要](docs/live-verification.json)。Fixtures 全部标记 `SYNTHETIC`，不是预核验景点库，不作为真实 API 成功证据。

## 前端接入

1. 每次 POST 生成 `X-Request-Id`，重试相同请求沿用 ID；修改 body 必须换 ID。
2. 接收 202 后按 `jobId` 轮询，使用 `afterSequence` 读取新增事件；遇终态结束轮询。失败/取消/过期不覆盖本地计划。
3. 以 `validation.committable` 决定能否提交，不能以 SUCCEEDED/PARTIAL 代替约束判断。所有未知项需要清楚展示。
4. I06 不改候选；新数据变化时返回 `REPROPOSE_REQUIRED`，请重新预览。提交瞬间再次比较 tripId、revision、proposalId 和请求代次。
5. 加载 `packages/context-engine/index.mjs` 和 capabilities.geoPolicy；实际显示提醒后才保存 shownAt。模块接法见 [定位包说明](packages/context-engine/README.md)。

所有示例、API 字段和运行边界见 [架构与接口交接](docs/architecture.md)；部署见 [运行手册](docs/runbook.md)。
