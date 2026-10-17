# 数据供应商与模型网关

核实日期：2026-10-17（北京时间）。代码适配和 MockTransport 测试已实现；离线测试中的地点、路线、模型响应均为**合成协议输入**。已使用用户指定的项目根目录 `.env` 完成高德与 AIPing 真实调用，14 个场景通过，详情见 [真实调用摘要](live-verification.json) 和 [验收记录](acceptance.md)。A1 使用 DeepSeek-V3.2，A7 使用 Qwen3.8-27B；两者经过同一个 AIPing 入口，不能等同于至少两家独立 API 供应商已验收。独立第二供应商、真实账单与额度核对仍待对应配置和证据。代码不查找其他项目或目录中的凭证。

## 高德 Web Service

后端 `AmapProvider` 使用 HTTPS GET：

| 能力 | 路径 | 重要参数/映射 |
|---|---|---|
| 关键词搜索 | `/v3/place/text` | `keywords/city/citylimit/offset`；按供应商 ID 去重 |
| ID 再核验 | `/v3/place/detail` | `id`；绕过 TTL，返回 ID 必须完全相同；缺失报 PLACE_UNVERIFIED |
| 周边 | `/v3/place/around` | `location/radius/keywords/city`，经度在前，最多25条；不凑足候选 |
| 步行 | `/v3/direction/walking` | `origin/destination` |
| 驾车 | `/v3/direction/driving` | `origin/destination` |
| 公交 | `/v3/direction/transit/integrated` | `city` 必填，跨城可传 `cityd`；出发时间传 `date/time` |

POI ID、名称、坐标、有效地址映射到地点 Evidence。`biz_ext.rating` 仅标明供应商评分；`biz_ext.cost` 是人均消费，绝不当作门票或整团费用。当前接口不能可靠证明开放时段、门票、排队、预约或拍摄许可，这些保持 UNKNOWN。高德可能用空数组表示缺失值；不存在不转成0。[高德搜索文档](https://lbs.amap.com/api/webservice/guide/api-advanced/search)

路由把秒转为分钟，保留米；WALK/DRIVE 读取 `paths[].steps[].polyline`，TRANSIT 读取 `transits[].segments[]` 的步行与首个公交方案几何，公交备选不重复累加。缺失或不完整几何省略，不以起终点连线补道路；铁路仅有端点不构造线路。路线时长是供应商预测，不能当作真实通行测量或未来班次保证；当前无路线时返回 UNKNOWN。[高德路径规划文档](https://lbs.amap.com/api/webservice/guide/api/direction)

输入必须显式标记 GCJ02/WGS84；GCJ02 不重复偏移，WGS84 使用近似民用转换。该转换不是测绘结果；覆盖矩形外坐标不偏移。地点/路段输出统一标 GCJ02，浏览器围栏也必须使用相同体系。原始浏览器位置不应持续上传模型或后端。

每个 HTTP 请求有超时，网络/超时/限流/5xx执行有界退避重试；认证、格式或数据缺失不伪造回退。错误只含安全原因，不回传携带 Key 的请求 URL、原始异常或供应商响应。

### 缓存与许可

TTL 缓存在进程内，容量有界，保留原始 fetchedAt，并通过 Evidence.note 标 cache hit。TTL 过期不使用旧值回退；详情再核验始终请求上游。默认 TTL=0，且即使配置正值，构造时仍需 `cache_authorized=True` 才能开启。应用重启缓存消失。

**短 TTL 不是缓存许可。** 官方协议4.12与7.3对未经许可的缓存、存储、封装和数据使用存在限制。公开上线前须针对本应用确认 Web Service 许可、详情权限、展示/来源要求、结果存储及向前端交付的授权范围；不得把代码的可配置开关视作许可已经取得。额度与适用价格依账号和实际服务核对，当前未验证。[高德服务协议](https://lbs.amap.com/pages/terms/)、[官方流量限制](https://lbs.amap.com/api/webservice/guide/tools/flowlevel)

## ModelGateway

所有 Key 仅由配置模块注入，不写入源码、Fixture、日志和 capabilities。网关不自动切到 DEMO、不跨厂商静默回退，也不把失败供应商写作完成方。

```python
gateway = ModelGateway(
    provider_configs={
        "primary": {
            "kind": "openai-compatible", "base_url": "https://api.openai.com/v1",
            "api_key": primary_key, "model": configured_primary_model,
            # 按所选模型填写当日核实的CNY价格，未填时成本为UNKNOWN。
            "input_cost_per_million": verified_primary_input_cny,
            "output_cost_per_million": verified_primary_output_cny,
            "max_tokens": 2048,
        },
        "secondary": {
            "kind": "anthropic", "base_url": "https://api.anthropic.com/v1",
            "api_key": secondary_key, "model": configured_secondary_model,
            "max_tokens": 2048,
        },
    },
    role_routes={"A1": "primary", "A7": "secondary"},
    max_calls_per_job=18, daily_budget_cny=20,
)
result = await gateway.generate_structured("A1", PydanticOutputModel, payload, job_id=job_id)
# result.data是经schema验证的业务dict，result.usage是安全用量元数据。
text_result = await gateway.generate_text("A7", payload, job_id=job_id)
```

`role_routes` 也接受 `{ "provider": "primary", "model": "该角色指定模型" }`。未配置角色、密钥或模型返回503。应用将任务ID传入每次调用；重试和结构化修复均消耗同一个任务调用额度。仅在任务 TTL 清理后调用 `release_job`，避免重新使用已终止任务绕过限额。

### 两个真实协议实现

OpenAI-compatible 适配发送 `/chat/completions`、Bearer认证、system/user messages及 `max_tokens`；结构化默认 `response_format.type=json_object`，返回结果仍经本地 schema 校验。只有在具体供应商/模型验证支持后才配置 `structured_mode=json_schema`；不声称任意仅替换 base_url 的服务已兼容。[OpenAI Chat API](https://developers.openai.com/api/reference/resources/chat)

Anthropic 原生适配发送 `/messages`、`x-api-key`、`anthropic-version=2023-06-01`、顶层system与 `max_tokens`。结构化请求强制唯一 `emit_structured` tool，schema放在 `input_schema`，解析原生 `tool_use.input`；这只是结构化输出通道，没有赋予外部工具执行权。文本请求组合text blocks；token计数读原生usage字段，缓存token计入输入估算。[Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create)

结构化输出支持 Pydantic v2 模型或 JSON Schema dict（后者需要 jsonschema）。首次无效 JSON、拒绝、截断、结构校验失败最多再发**一次修复请求**；第二次仍不合法返回 INVALID_MODEL_OUTPUT。修复不传原始输出回用户，也不把它记录到日志。供应商错误不按JSON修复重试；网络/429/5xx按独立有界重试处理。

usage记录实际响应的provider、model、requestedModel、latencyMs、token计数（可未知）、调用次数与成本估算，结构化调用的calls保留各次成功解析调用的安全元数据。错误、未知计费或未解析调用保留预算预留；不记录完整模型回复或提示词。模型返回内容本身不构成POI/门票/开放事实证据，A2/A3仍必须调用地图工具。

### 限额边界

发送前在同一异步锁内原子预留当日成本和任务调用次数，防并发超发。已配置价格时按输入UTF-8字节保守上界、协议余量和max_tokens预留，取得usage后按配置单价结算估算；缺价格或调用失败时保留固定 `reservation_cny`。缺真实单价时，这是本实例的调用预算门槛，**不能保证外部账单封顶**。退款/缓存折扣/汇率/供应商额外费用不在精确账单范围。

每日UTC成本和任务计数只在单进程内存中，重启归零，多worker/多副本不共享。因此部署固定单worker；公网开放前同时配置供应商端硬预算/配额，真实核对所选模型单价。当前未取得真实计费记录。网关还有输入字节、响应字节、输出token、任务计数容量、超时与重试上限；API层负责请求限流和总任务时限。

## 本地验证

从 `apps/api` 运行：

```text
python -m pytest tests/test_providers.py tests/test_gateway.py -q
```

覆盖原生请求格式、响应字段、错误与密钥脱敏、坐标一次转换、TTL时效、详情ID匹配、三模式路线与几何缺失、JSON/schema失败与单次修复、模型实际标记、任务/并发日预算。离线测试验证代码与合成协议一致；真实调用仅证明记录中的接口在测试当时返回成功，不证明实地通行、生产稳定性、许可或独立两供应商授权。
