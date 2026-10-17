# 运行、部署和故障恢复

## 本地

按根 README 安装依赖后运行 `start-backend.ps1`。根 `.env` 自动读取，不打印秘密。服务默认仅监听 127.0.0.1:8000；局域网测试才明确设置 HOST=0.0.0.0。启动不自动调用付费接口。

默认单 worker。不要把 `uvicorn --workers 4` 当成吞吐扩容：临时任务、幂等和预算不会跨进程共享。若将来需要扩容，必须先实现共享临时任务/预算存储，仍不能把它改成正式计划主库。

## Render

仓库根目录提供 `render.yaml`，Python 服务：

```text
Build: pip install -c apps/api/requirements-lock.txt ./apps/api
Start: python apps/api/serve.py
Health: /api/v1/health
HOST: 0.0.0.0
```

在平台私密环境变量中配置 Key、模型、CORS 正式前端域名；不要上传 `.env`。提供的是部署配置，并未自动创建公网服务。部署时核对 [Render Python 部署文档](https://render.com/docs/deploy-fastapi) 与当前套餐/休眠条件，不承诺固定价格或 SLA。

也提供非 root Dockerfile；从仓库根构建，运行时注入环境变量。此交付没有实际构建 Docker 镜像或部署到 Render。

## 备用入口

本地保持相同代码、配置与 `/api/v1` 路径。需要公网备用时可运行 Cloudflare Tunnel 指向本机8000端口，再将前端 API 基址切为隧道 HTTPS URL，并将该前端来源加入后端 CORS。此步骤会公开服务，应由项目负责人明确执行和测试。停止隧道后旧任务不保证可取回；前端保留正式计划，使用新 request ID 重新发起。

## 日志和异常

- 普通日志保留安全请求/trace/节点哈希、工具名称、实际 provider/model/token/latency，不打印 Key、模型提示词、完整供应商响应或原始 GPS。
- `FAILED`、`CANCELLED` 都是终态；`PARTIAL` 必须读取可用 result 和 unknown/errors，不能一直轮询。
- 404 JOB_NOT_FOUND：任务过期或进程重启。不是“行程丢失”，行程应仍在浏览器。
- 409 STALE_REVISION / REQUEST_ID_CONFLICT：丢弃旧代次结果或使用新请求 ID；不要自动覆盖。
- 429 RATE_LIMITED / BUDGET_LIMIT：退避并检查实际配额；不能无界重试。
- `REPROPOSE_REQUIRED`：新路线/地点证据与预览不一致，重新生成预览，不偷偷确认新候选。
- 地图时间存在但几何缺失：保留时间轴并显示路线待核验，不画直线冒充道路。
- 内容源不可达：显示明确来源不足；不能把旧文案称实时核验。

## 发布验收仍需执行

正式前端接入后的手机 HTTPS 权限、Wi-Fi/蜂窝、后台恢复、本地存储失败、旧结果拒收、真实展示回执、Netlify/Render/隧道切换必须端到端实测。后端测试不能替代这些结果。
