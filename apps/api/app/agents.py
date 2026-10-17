"""Agent execution boundary: isolated contexts, allowlisted tools, validated outputs and safe traces."""
import asyncio
import inspect
import json
import logging
import time
import uuid
from dataclasses import dataclass

from pydantic import TypeAdapter

from .jobs import digest, dump

logger = logging.getLogger("tripflow")
AGENTS = {
    "A1": ("理解需求与修改意图", {"model_structured", "poi_search"}),
    "A2": ("检索核验地点", {"poi_search", "poi_detail", "nearby_search", "knowledge_search"}),
    "A3": ("研究交通方案", {"route_query"}),
    "A4": ("编排行程候选", {"schedule", "edit", "proposal"}),
    "A5": ("独立审核约束", {"validate"}),
    "A6": ("评估主动服务", {"notification_policy"}),
    "A7": ("准备个性化内容", {"model_structured", "model_text"}),
}


@dataclass
class AgentContext:
    agent_id: str
    run_id: str
    job: object

    async def tool(self, name, function, *args, **kwargs):
        if name not in AGENTS[self.agent_id][1]:
            raise PermissionError(f"{self.agent_id} cannot use {name}")
        self.job.emit(self.agent_id, "tool_call_started", "正在调用" + name, self.run_id, name)
        result = function(*args, **kwargs)
        if inspect.isawaitable(result):
            result = await result
        self.job.emit(self.agent_id, "tool_call_finished", "已完成" + name, self.run_id, name)
        return result


class AgentRunner:
    def __init__(self, job):
        self.job = job

    async def run(self, agent_id, payload, output_schema, function):
        run_id, started = uuid.uuid4().hex, time.monotonic()
        ctx = AgentContext(agent_id, run_id, self.job)
        self.job.emit(agent_id, "agent_started", AGENTS[agent_id][0], run_id)
        try:
            result = await function(ctx)
            result = TypeAdapter(output_schema).validate_python(result)
            self.job.emit(agent_id, "agent_completed", AGENTS[agent_id][0] + "完成", run_id)
            logger.info(json.dumps({"event": "agent_completed", "agent_id": agent_id, "run_id": run_id,
                                    "input_hash": digest(payload), "output_schema": str(output_schema),
                                    "trace_id": self.job.trace_id, "latency_ms": round((time.monotonic()-started)*1000),
                                    "tool_calls": [e["toolName"] for e in self.job.events if e["runId"] == run_id and e["type"] == "tool_call_started"]}))
            return result
        except (Exception, asyncio.CancelledError):
            self.job.emit(agent_id, "agent_failed", AGENTS[agent_id][0] + "未完成", run_id)
            raise
