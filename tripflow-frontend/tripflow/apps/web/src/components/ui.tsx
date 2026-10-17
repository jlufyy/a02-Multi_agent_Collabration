import { useEffect, useState, type ReactNode } from 'react';
import type { DataStatus, Evidence, ValidationStatus } from '@tripflow/contracts';
import { Icon } from './Icon';
import { describeError } from '../api/client';
import { cleanMessage, safeSourceUrl } from '../lib/validationMessages';

export const DATA_LABEL: Record<DataStatus, string> = { VERIFIED: '已核验', ESTIMATED: '估算', UNKNOWN: '待核验', FAILED: '查询失败' };
const DATA_CLS: Record<DataStatus, string> = {
  VERIFIED: 'bg-ok-soft text-ok', ESTIMATED: 'bg-warn-soft text-warn', UNKNOWN: 'bg-sand text-ink-soft', FAILED: 'bg-danger-soft text-danger',
};
export function DataBadge({ status, label }: { status: DataStatus; label?: string }) {
  return <span className={`chip ${DATA_CLS[status]}`}>{label ? `${label}·` : ''}{DATA_LABEL[status]}</span>;
}
export const VALID_LABEL: Record<ValidationStatus, string> = { FEASIBLE: '校验通过', PARTIALLY_VERIFIED: '部分待核验', INFEASIBLE: '不可行' };
export function ValidationBadge({ status }: { status: ValidationStatus }) {
  const c = status === 'FEASIBLE' ? 'bg-ok-soft text-ok' : status === 'PARTIALLY_VERIFIED' ? 'bg-warn-soft text-warn' : 'bg-danger-soft text-danger';
  return <span className={`chip ${c}`}>{VALID_LABEL[status]}</span>;
}

export function EvidenceList({ items }: { items: Evidence[] }) {
  if (!items.length) return <p className="text-[13px] text-ink-faint">无来源记录</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((e, i) => (
        <li key={i} className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-soft">
          <DataBadge status={e.status} />
          <span className="font-medium text-ink">{{ amap: '高德地图', tavily: '联网搜索', bocha: '博查搜索', tencent_wsa: '腾讯云联网搜索', wikipedia: '维基百科' }[e.provider] ?? '资料来源'}</span>
          {e.fetchedAt && <span className="text-ink-faint">获取于 {fmtDateTime(e.fetchedAt)}</span>}
          {safeSourceUrl(e.sourceUrl) && <a href={safeSourceUrl(e.sourceUrl)} target="_blank" rel="noopener noreferrer" className="text-brand underline">来源</a>}
          {e.note && <span className="w-full text-ink-faint">{cleanMessage(e.note)}</span>}
        </li>
      ))}
    </ul>
  );
}

export function ErrorBox({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const d = describeError(error);
  return (
    <div role="alert" className={`rounded-card border border-danger/20 bg-danger-soft/60 ${compact ? 'p-3' : 'p-4'} text-[14px]`}>
      <div className="flex items-start gap-2">
        <Icon name="alert" className="mt-0.5 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-danger">{d.title}</p>
          <p className="mt-0.5 break-words text-ink-soft">{d.detail}</p>
        </div>
      </div>
      {onRetry && d.retryable && <button className="btn-soft mt-3 w-full" onClick={onRetry}>重试</button>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, tall }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; tall?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="animate-fade absolute inset-0 bg-ink/35 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`animate-rise relative flex w-full max-w-lg flex-col rounded-t-sheet bg-white shadow-float sm:rounded-sheet ${tall ? 'h-[88dvh]' : 'max-h-[88dvh]'}`}>
        <div className="flex items-center gap-2 px-5 pb-2 pt-4">
          <div className="min-w-0 flex-1 text-[17px] font-semibold">{title}</div>
          <button className="icon-btn !h-9 !w-9 !shadow-none" onClick={onClose} aria-label="关闭"><Icon name="close" size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-sand px-5 pb-[calc(12px+var(--safe-b))] pt-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex min-h-[48px] items-center gap-3 ${disabled ? 'opacity-50' : ''}`}>
      <span className="flex-1">
        <span className="block text-[15px]">{label}</span>
        {hint && <span className="block text-[12.5px] text-ink-faint">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-brand' : 'bg-sand'}`}>
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-label="加载中" />;
}

let toastSetter: ((t: { id: number; text: string; tone: 'ok' | 'warn' | 'info' }[]) => void) | null = null;
let toasts: { id: number; text: string; tone: 'ok' | 'warn' | 'info' }[] = [];
export function toast(text: string, tone: 'ok' | 'warn' | 'info' = 'info') {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, text, tone }];
  toastSetter?.(toasts);
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); toastSetter?.(toasts); }, 3200);
}
export function Toaster() {
  const [list, setList] = useState(toasts);
  useEffect(() => { toastSetter = setList; return () => { toastSetter = null; }; }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(10px+var(--safe-t))] z-[80] flex flex-col items-center gap-2 px-4">
      {list.map((t) => (
        <div key={t.id} className={`animate-rise rounded-full px-4 py-2 text-[14px] shadow-float ${t.tone === 'ok' ? 'bg-brand text-paper' : t.tone === 'warn' ? 'bg-warn text-white' : 'bg-ink text-paper'}`}>{t.text}</div>
      ))}
    </div>
  );
}

// ---------- 时间格式（目的地时区 Asia/Shanghai） ----------
const TZ = 'Asia/Shanghai';
export const fmtTime = (iso: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
export const fmtDateTime = (iso: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
export const fmtDay = (date: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(date + 'T12:00:00+08:00'));
export const minutesBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 60000);
export { displayMinutes as fmtMin } from '../lib/time';
export const fmtCny = (v?: number) => (v === undefined ? '未知' : `¥${v.toLocaleString('zh-CN')}`);
export const todayInTz = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
export const describeTime = (s?: string, e?: string) => (s ? `${fmtTime(s)}${e ? '–' + fmtTime(e) : ''}` : '—');
