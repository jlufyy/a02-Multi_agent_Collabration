import type { ItineraryActivity, ValidationReport } from '@tripflow/contracts';

type Activities = Pick<ItineraryActivity, 'id' | 'place'>[];

/** Diagnostics remain in API/logs; product text contains place names and actionable explanations. */
export function cleanMessage(raw: string, activities: Activities = [], fallback = '这项信息暂时无法确认，请稍后重试。'): string {
  if (/ValidationError|Traceback|invalid_type|trace_id/.test(raw)) return fallback;
  let text = raw;
  for (const a of activities) text = text.split(a.id).join(a.place.name);
  text = text.replace(/\b(?:activity|trip|run|trace|job|req)[_-][a-zA-Z0-9_-]+\b/g, '相关活动')
    .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b[：:]?\s*/g, '')
    .replace(/\bVERIFIED\b/g, '已获取来源').replace(/\bUNKNOWN\b/g, '待确认')
    .replace(/^[\s:：，,;；]+/, '').trim();
  return /[\u3400-\u9fff]/.test(text) ? text : fallback;
}

export function validationMessages(report: ValidationReport, activities: Activities = []) {
  const names = new Map(activities.map((a) => [a.id, a.place.name]));
  const grouped = new Map<string, string[]>();
  const others: string[] = [];
  const fields: Record<string, string> = {
    OPENING_HOURS_UNKNOWN: '营业时间待确认', COST_UNKNOWN: '整团费用待确认', BOOKING_EVIDENCE_UNKNOWN: '预约凭据待确认',
  };
  for (const raw of report.unknownChecks) {
    const [code, target] = raw.split(':');
    if (fields[code]) {
      const name = names.get(target) ?? '相关景点';
      const items = grouped.get(name) ?? [];
      if (!items.includes(fields[code])) items.push(fields[code]);
      grouped.set(name, items);
    } else if (['TRANSIT_UNKNOWN', 'ROUTE_GEOMETRY_UNKNOWN'].includes(code)) {
      const endpoints = (target ?? '').split('->').map((id) => names.get(id) ?? '相关地点');
      others.push(`${endpoints.join(' → ')}：${code === 'TRANSIT_UNKNOWN' ? '交通时长待确认' : '路线详情待确认'}`);
    } else if (code === 'BOUNDARY_TRANSIT_UNKNOWN') {
      others.push(`${target === 'START' ? '出发地到首站' : target === 'END' ? '末站到返回地' : '起止路段'}的交通时长待确认`);
    } else if (code === 'REPROPOSE_REQUIRED') {
      others.push('资料或行程已更新，请重新计算这次修改后再确认。');
    } else {
      others.push(cleanMessage(raw, activities));
    }
  }
  return {
    hard: report.hardViolations.map((v) => cleanMessage(v.message, activities, '当前安排存在冲突，请调整时间或地点。')),
    unknown: [...grouped].map(([name, fields]) => `${name}：${fields.join('、')}`).concat([...new Set(others)]),
    warnings: [...new Set(report.warnings.map((x) => cleanMessage(x, activities)))],
  };
}

export function safeSourceUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return undefined;
    const host = u.hostname.toLowerCase();
    if (!host.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)
      || /\.(local|internal|localhost)$/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return undefined;
    return u.href;
  } catch { return undefined; }
}
