# TripFlow 完整应用

React/TypeScript 前端 + FastAPI 后端。前端源码保留在 `tripflow-frontend/tripflow/apps/web`，后端在 `apps/api`。构建后由 FastAPI 同时提供页面与 `/api/v1`，通过一个地址使用，无需运行契约测试桩。

**2026-10-17：已完成整合及真实联调，仍有阻塞性缺陷，按要求仅记录、没有修复。不能据此宣称全功能验收通过。** 详见 [整合测试与问题建议](docs/TripFlow_整合测试与问题建议_2026-10-17.md)。

## 本机使用

本机默认访问地址：<http://127.0.0.1:8010/>；接口文档：<http://127.0.0.1:8010/docs>。

首次克隆请先完成下方“首次安装”步骤。安装完成后，在项目根目录 PowerShell 运行：

```powershell
.\start-tripflow.ps1
# 或：npm start
```

默认先构建前端，再启动同源服务，端口为 8010。Ctrl+C 结束。已有实例运行时不要重复启动。可指定 `-Port 8012`。已构建且源码无变化时：

```powershell
.\start-tripflow.ps1 -SkipBuild
```

首次安装（Python 3.12、Node.js 22）：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -c apps/api/requirements-lock.txt -e './apps/api[test]'
npm ci --cache .npm-cache --no-audit --no-fund
npm --prefix tripflow-frontend/tripflow ci --cache .npm-cache --no-audit --no-fund
.\start-tripflow.ps1
```

开发模式同时启动后端与 Vite，浏览器使用 5173：

```powershell
.\start-tripflow.ps1 -Dev -Port 8011
```

**本地行程按浏览器和完整 origin 隔离**。`localhost`、`127.0.0.1`、不同端口及不同浏览器各自保存行程。切换地址后看不到旧行程，不能据此认定数据丢失。后端没有云端行程主库。

## 服务配置

克隆仓库后，先复制根目录 `.env.example` 为 `.env` 并自行填写服务密钥；前端公开 JS Key 参考其独立 `.env.example`。真实 `.env` 不随仓库分发，只供后端读取。支持 `AMAP_API_KEY` / `AMAP_WEB_SERVICE_KEY`、`AIPING_API_KEY` / `AIPING_BASE_URL`、`DEEPSEEK_API_KEY`。

同时配置两个模型入口时，缺省路由：

| Agent | 入口 | 默认模型 |
|---|---|---|
| A1 需求解析、编辑理解 | DeepSeek 直连 | `deepseek-flash` |
| A7 内容生成 | AIPing | `Qwen3.8-27B` |

`DEEPSEEK_BASE_URL` 默认 `https://api.deepseek.com`；`DEEPSEEK_MODEL` 可指定已核实可用的型号。显式 `MODEL_ROUTES` 优先于默认路由。仅配置 DeepSeek 时，A1/A7 均可使用它。`capabilities.available` 表示配置就绪，不代表每次调用都成功。单价未配置时费用仍是 UNKNOWN；进程内每日预留预算不是外部账单封顶。本轮 DeepSeek 已成功调用，AIPing 内容生成出现超时，详见报告。

高德 **Web Service Key 只用于后端地点和路线服务**。网页地图需要独立的 JS API 配置，填入 `tripflow-frontend/tripflow/apps/web/.env.local`（参考同目录 `.env.example`），随后重新构建：

```dotenv
VITE_AMAP_KEY=<高德 JS API 的公开 Key>
VITE_AMAP_SERVICE_HOST=<已配置的高德安全代理地址>
```

没有安全代理时，可按高德账户允许的方式配置 `VITE_AMAP_SECURITY_CODE`。不要把后端 Web Service Key、模型 Key 或根目录 `.env` 内容填入 `VITE_*` 变量。目前仅提供了 Web Service Key，网页显示“地图未配置”，保留可观察降级。

同源运行时 `VITE_API_BASE_URL` 留空。开发代理默认指向 8000，由整合开发启动脚本自动改为所选后端端口。

## 测试与证据

```powershell
.\.venv\Scripts\python.exe -m pytest -q -c apps/api/pyproject.toml apps/api/tests
node --test packages/context-engine/test.mjs
npm run typecheck
npm run test:web
npm --prefix tripflow-frontend/tripflow -w @tripflow/web run lint
npm run build
.\.venv\Scripts\python.exe packages/contracts/generate.py --app-openapi --check
```

真实接口审计会调用已配置的付费地图/模型服务：

```powershell
.\.venv\Scripts\python.exe apps/api/scripts/integration_verify.py --url http://127.0.0.1:8010
node tripflow-frontend/tripflow/tools/e2e/verify-live-contracts.mjs output/integration/contract-samples.json output/integration/live-contracts.json
node tripflow-frontend/tripflow/tools/e2e/audit-probes.mjs packages/context-engine/geo-policy.json output/integration/synthetic-probes.json
```

审计遇到规划失败会记录失败后停止依赖该计划的用例。可用脚本 `--help` 中的已有真实任务参数继续检查；不得把继续测试用的输入调整视为产品修复。再次运行会更新审计输出；本轮首次失败另存 `output/integration/live-http-initial.json`。定位探针明确使用 SYNTHETIC 数据，不证明真机 GPS。

- 问题、修复建议及复测方案：`docs/TripFlow_整合测试与问题建议_2026-10-17.md`
- 本轮 HTTP、契约、诊断与定位探针：`output/integration/`
- 整合前备份只留在开发者本机，不上传；旧说明保留在 `docs/backend-README-before-integration.md`
- 历史后端验收：`docs/acceptance.md`、`docs/live-verification.json`，不等于本轮整合验收
- 前端测试桩：`tripflow-frontend/tripflow/tools/contract-stub/`，没有接入产品运行

## 打包与边界

`Dockerfile` 用 Node 构建前端，再把构建产物复制进 Python 镜像；`render.yaml` 改为该 Docker 入口。本轮没有执行容器构建或公网部署，文件配置不等于部署验收。

生产仅运行一个 worker：任务、幂等记录及预算均为进程内临时状态。HTTPS、Android/iOS 真机定位、地图 JS 配置及供应商服务授权仍需单独验证。
