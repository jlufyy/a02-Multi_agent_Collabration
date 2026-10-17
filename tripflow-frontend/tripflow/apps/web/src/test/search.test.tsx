import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ValidationReport } from '@tripflow/contracts';
import { schemas as S } from '@tripflow/contracts';
import { cleanMessage, safeSourceUrl, validationMessages } from '../lib/validationMessages';
import { WebResearchPanel } from '../components/WebResearchPanel';
import { ErrorBox } from '../components/ui';
import { AgentProgress } from '../components/AgentProgress';
import { ApiClientError } from '../api/client';
import { trip } from './fixtures';

describe('readable validation and source-backed search', () => {
  it('groups checks by place and never renders diagnostic identifiers', () => {
    const activities = trip().activities;
    activities[0].id = 'activity-eac3b29246105f0ea35e'; activities[0].place.name = '灵隐寺';
    const id = activities[0].id;
    const report: ValidationReport = {
      status: 'PARTIALLY_VERIFIED', committable: true,
      unknownChecks: [`OPENING_HOURS_UNKNOWN:${id}:开放时段未核实。`, `COST_UNKNOWN:${id}:费用未核实。`, 'TRANSIT_COST_UNKNOWN:交通票价未核实。'],
      hardViolations: [{ code: 'TIME_WINDOW_VIOLATION', activityIds: [id], message: `${id}超出当天时间窗口。` }],
      warnings: ['内容准备失败：LLM_TIMEOUT，行程候选保留。'],
    };
    const messages = validationMessages(report, activities);
    expect(messages.unknown).toEqual(['灵隐寺：营业时间待确认、整团费用待确认', '交通票价未核实。']);
    expect(messages.hard).toEqual(['灵隐寺超出当天时间窗口。']);
    expect(JSON.stringify(messages)).not.toMatch(/activity-|OPENING_HOURS|COST_UNKNOWN|LLM_TIMEOUT|TIME_WINDOW/);
  });

  it('has readable fallback for unfamiliar and unavailable diagnostic contexts', () => {
    expect(cleanMessage('INTERNAL_ERROR: activity-abcd')).toContain('相关活动');
    expect(cleanMessage('ValidationError trace_id: 12345')).toContain('暂时无法确认');
    expect(validationMessages({ status: 'PARTIALLY_VERIFIED', committable: false, hardViolations: [], warnings: [],
      unknownChecks: ['REPROPOSE_REQUIRED: 地点与预览不一致。', 'OPENING_HOURS_UNKNOWN:activity-old:开放未核实。'] }).unknown)
      .toEqual(['相关景点：营业时间待确认', '资料或行程已更新，请重新计算这次修改后再确认。']);
  });

  it('renders sources and preserves search provenance through the runtime contract', () => {
    const research = S.WebResearch.parse({ status: 'AVAILABLE', query: '杭州 灵隐寺 开放时间', checkedAt: '2026-10-17T01:00:00Z',
      message: '已找到相关资料，请核对景区公告。', references: [{ title: '灵隐寺游览公告', url: 'https://example.org/notice',
        snippet: '合成摘要，仅用于测试。', evidence: { provider: 'tavily', status: 'ESTIMATED', sourceUrl: 'https://example.org/notice' } }] });
    const place = S.Place.parse({ ...trip().activities[0].place, webResearch: research });
    expect(place.webResearch).toEqual(research);
    const html = renderToStaticMarkup(<WebResearchPanel initial={research} />);
    expect(html).toContain('灵隐寺游览公告'); expect(html).toContain('href="https://example.org/notice"');
    expect(html).toContain('搜索参考'); expect(html).not.toContain('已核验');
    expect(safeSourceUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeSourceUrl('http://127.0.0.1/private')).toBeUndefined();
  });

  it('hides schema paths and trace IDs in error boxes and technical tool names in progress', () => {
    const error = new ApiClientError('SCHEMA', 'data.result.plan.activities.0 invalid_type', 200, [], 'private-trace');
    const html = renderToStaticMarkup(<ErrorBox error={error} />);
    expect(html).not.toMatch(/private-trace|trace_id|activities|invalid_type/);
    const progress = renderToStaticMarkup(<AgentProgress running events={[{ sequence: 1, runId: 'private-run',
      agentId: 'A2', type: 'tool_call_started', message: '正在调用knowledge_search', toolName: 'knowledge_search',
      eventId: 'test-event', traceId: 'private-trace', occurredAt: '2026-10-17T01:00:00Z' }]} />);
    expect(progress).toContain('正在查询联网资料'); expect(progress).not.toMatch(/knowledge_search|private-run/);
  });
});
