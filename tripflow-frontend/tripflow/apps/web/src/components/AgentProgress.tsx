import type { ProgressEvent, AgentId } from '@tripflow/contracts';
import { Icon } from './Icon';
import { Spinner } from './ui';

export const AGENT_NAME: Record<AgentId, string> = {
  A1: '需求理解', A2: '地点与资料研究', A3: '交通研究', A4: '行程规划', A5: '审核优化', A6: '主动服务', A7: '个性化内容',
};

type Row = { key: string; agentId: AgentId; message: string; state: 'running' | 'done' | 'failed'; tool?: string };

const TOOL_LABEL: Record<string, string> = {
  knowledge_search: '正在查询联网资料', poi_search: '正在搜索景点', poi_detail: '正在核对景点资料',
  nearby_search: '正在查找周边地点', route_query: '正在查询交通路线', model_structured: '正在整理旅行建议',
  model_text: '正在准备内容', schedule: '正在安排行程', edit: '正在调整行程', proposal: '正在生成修改预览',
  validate: '正在核对行程安排', notification_policy: '正在评估提醒',
};
function progressText(agent: AgentId, state: 'running' | 'done' | 'failed', tool?: string) {
  return state === 'done' ? '已完成' : state === 'failed' ? '暂未完成，请重试' : (tool && TOOL_LABEL[tool]) || `正在${AGENT_NAME[agent]}`;
}

/** 把后端真实事件折叠为“每个 Agent 一行”的简洁进度；没有事件时只显示“等待服务响应”，不伪造步骤。 */
export function AgentProgress({ events, running }: { events: ProgressEvent[]; running: boolean }) {
  const rows: Row[] = [];
  const idx = new Map<string, number>();
  for (const e of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const key = `${e.runId}:${e.agentId}`;
    let i = idx.get(key);
    if (i === undefined) { i = rows.length; idx.set(key, i); rows.push({ key, agentId: e.agentId, message: e.message, state: 'running' }); }
    const r = rows[i];
    r.message = e.message || r.message;
    if (e.type === 'agent_completed') r.state = 'done';
    else if (e.type === 'agent_failed') r.state = 'failed';
    else if (e.type === 'tool_call_started') r.tool = e.toolName;
    else if (e.type === 'tool_call_finished') r.tool = undefined;
  }
  return (
    <ol className="space-y-2" aria-live="polite">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-3 rounded-btn bg-card px-3 py-2.5 shadow-card">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold
            ${r.state === 'done' ? 'bg-brand text-paper' : r.state === 'failed' ? 'bg-danger text-white' : 'bg-accent-soft text-accent'}`}>
            {r.state === 'done' ? <Icon name="check" size={14} stroke={2.6} /> : r.state === 'failed' ? '!' : <Icon name="clock" size={14} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium">{AGENT_NAME[r.agentId]}</span>
            <span className="block truncate text-[12.5px] text-ink-soft">{progressText(r.agentId, r.state, r.tool)}</span>
          </span>
          {r.state === 'running' && running && <Spinner className="text-accent" />}
        </li>
      ))}
      {running && rows.length === 0 && (
        <li className="flex items-center gap-2 px-1 text-[13.5px] text-ink-soft"><Spinner /> 已提交任务，等待服务返回进度…</li>
      )}
    </ol>
  );
}

/**
 * 规划步骤清单（设计稿 04）：步骤按 PRD §8.2 P1 的协作顺序列出；
 * 每一步的“完成/进行中/失败”只由服务端真实事件决定，未收到事件的步骤保持灰色等待，不做定时动画。
 */
const PLAN_STEPS: { agentId: AgentId; label: string }[] = [
  { agentId: 'A1', label: '分析旅行需求' },
  { agentId: 'A2', label: '筛选优质景点' },
  { agentId: 'A3', label: '计算交通与路线' },
  { agentId: 'A4', label: '安排时间与顺序' },
  { agentId: 'A5', label: '校验行程可行性' },
  { agentId: 'A7', label: '准备专属内容' },
];
export function PlanSteps({ events, running }: { events: ProgressEvent[]; running: boolean }) {
  const state = new Map<AgentId, { s: 'running' | 'done' | 'failed'; msg: string; tool?: string }>();
  for (const e of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const cur = state.get(e.agentId) ?? { s: 'running' as const, msg: e.message };
    if (e.type === 'agent_completed') cur.s = 'done';
    else if (e.type === 'agent_failed') cur.s = 'failed';
    else if (e.type === 'tool_call_started') cur.tool = e.toolName;
    else if (e.type === 'tool_call_finished') cur.tool = undefined;
    cur.msg = e.message || cur.msg;
    state.set(e.agentId, cur);
  }
  const steps = [...PLAN_STEPS, ...[...state.keys()].filter((k) => !PLAN_STEPS.some((p) => p.agentId === k)).map((k) => ({ agentId: k, label: AGENT_NAME[k] }))];
  return (
    <ol className="space-y-1" aria-live="polite">
      {steps.map((st) => {
        const x = state.get(st.agentId);
        const s = x?.s ?? 'pending';
        return (
          <li key={st.agentId} className="flex items-center gap-3 py-2.5">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${s === 'pending' ? 'bg-sand text-ink-faint' : s === 'failed' ? 'bg-danger text-white' : 'bg-brand text-white'}`}>
              <Icon name={s === 'failed' ? 'alert' : s === 'pending' ? 'clock' : 'check'} size={13} stroke={2.4} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-[15px] ${s === 'pending' ? 'text-ink-faint' : 'text-ink'}`}>{st.label}</span>
              {x && s !== 'done' && <span className="block truncate text-[12px] text-ink-faint">{progressText(st.agentId, x.s, x.tool)}</span>}
            </span>
            {s === 'done' && <Icon name="check" size={18} className="text-ok" stroke={2.4} />}
            {s === 'running' && running && <Spinner className="text-brand" />}
            {s === 'failed' && <span className="text-[12px] text-danger">失败</span>}
          </li>
        );
      })}
    </ol>
  );
}
