/** Serialize the same instant in the plan's required Asia/Shanghai offset. */
export function planTime(value: string | number | Date): string {
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('无效的行程时间');
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 19) + '+08:00';
}

export function planDate(startDate: string, dayIndex: number): string {
  return new Date(Date.parse(startDate + 'T00:00:00Z') + dayIndex * 86400_000).toISOString().slice(0, 10);
}

export function displayMinutes(minutes?: number): string {
  if (minutes === undefined) return '—';
  const m = Number.isFinite(minutes) ? Math.max(0, Math.ceil(minutes)) : 0;
  return m < 60 ? `${m}分钟` : `${Math.floor(m / 60)}小时${m % 60 ? `${m % 60}分` : ''}`;
}
